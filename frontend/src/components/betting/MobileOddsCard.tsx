import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useStore } from "@/lib/store";
import type { Match, Runner } from "@/lib/store";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Flame } from "lucide-react";
import { api, type InstanceMarket, type InstanceOutcome } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { wsClient } from "@/lib/websocket";
import { cn } from "@/lib/utils";

type MobileOddsCardProps = {
  matchId: string;
  onBetSelect: (
    match: Match,
    runner: Runner,
    type: "BACK" | "LAY",
    odds: number
  ) => void;
  onInstanceBetSelect?: (
    market: InstanceMarket,
    outcome: InstanceOutcome,
    matchId: string
  ) => void;

  /**
   * ✅ When used inside Dashboard cards, set embedded to true.
   * This hides the internal Team/Score/Over header to avoid duplication
   * (Dashboard already shows banners + scoreline).
   */
  embedded?: boolean;
};

function getTimeRemaining(closeTime: string) {
  const remaining = new Date(closeTime).getTime() - Date.now();
  if (Number.isNaN(remaining)) return "—";
  if (remaining <= 0) return "Closed";
  const seconds = Math.floor(remaining / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function shouldShowRunnerLabel(runnerName: string, match: Match) {
  const n = (runnerName || "").trim().toLowerCase();
  const home = (match.homeTeam || "").trim().toLowerCase();
  const away = (match.awayTeam || "").trim().toLowerCase();
  // Hide label if it repeats the team names
  if (n === home || n === away) return false;
  return true; // keep for "Draw" / other outcomes
}

function isBallByBallMarket(name: string | null | undefined, sport?: string) {
  if (sport !== "cricket") return false;
  const n = (name || "").trim().toLowerCase();
  if (!n) return false;
  return (
    /\bball[-\s]*by[-\s]*ball\b/.test(n) ||
    /\bnext\s*ball\b/.test(n) ||
    /^ball\s/.test(n) ||
    /\bball\s*\d+\b/.test(n)
  );
}

/**
 * ✅ Always pick Match Winner market (prevents Toss market showing up).
 * Falls back safely if naming varies or market not available yet.
 */
function pickMatchWinnerMarket(markets: any[], sport?: string) {
  const list = Array.isArray(markets) ? markets : [];
  const filtered =
    sport === "cricket" ? list.filter((m) => !isBallByBallMarket(m?.name, sport)) : list;
  const pool = filtered.length > 0 ? filtered : list;

  const norm = (s: any) => String(s ?? "").trim().toLowerCase();

  // Strict match
  const strict = pool.find((m) => norm(m?.name) === "match winner");
  if (strict) return strict;

  // Common variants (just in case your backend uses different labels)
  const variants = [
    "match odds",
    "winner",
    "match result",
    "match winners",
    "match-winner",
    "match_winner",
  ];

  const variantMatch = pool.find((m) => {
    const n = norm(m?.name);
    if (!n) return false;
    if (n.includes("match winner")) return true;
    return variants.some((v) => n === v || n.includes(v));
  });

  if (variantMatch) return variantMatch;

  // Fallback: first OPEN market with runners
  const openWithRunners = pool.find(
    (m) =>
      m?.status === "OPEN" &&
      Array.isArray(m?.runners) &&
      m.runners.length > 0
  );

  return openWithRunners || pool[0] || null;
}

function getTossLine(match: Match | null | undefined) {
  if (!match) return null;
  const winner = match.toss_won_by || null;
  const decision = match.elected_to || match.toss_decision || match.tossDecision || null;
  if (winner && decision) {
    const d = String(decision).toLowerCase();
    const pretty = d.includes("bat") ? "bat" : d.includes("bowl") ? "bowl" : decision;
    return `Toss: ${winner} won & elected to ${pretty}`;
  }
  return null;
}

export function MobileOddsCard({
  matchId,
  onBetSelect,
  onInstanceBetSelect,
  embedded = false,
}: MobileOddsCardProps) {
  const match = useStore((state) => state.matches.find((m) => m.id === matchId));
  const [, setLocation] = useLocation();

  const [marketSuspended, setMarketSuspended] = useState(false);
  const [liveScore, setLiveScore] = useState<{
    home?: string;
    away?: string;
    details?: string;
  } | null>(null);

  // ✅ blink/flash odds every 10 seconds
  const [oddsFlash, setOddsFlash] = useState(false);
  useEffect(() => {
    let t: any = null;
    const i = setInterval(() => {
      setOddsFlash(true);
      t = setTimeout(() => setOddsFlash(false), 650);
    }, 10000);
    return () => {
      clearInterval(i);
      if (t) clearTimeout(t);
    };
  }, []);

  const enableInstanceMarkets =
    !!match && match.status === "LIVE" && match.sport === "cricket" && !embedded;

  const { data: instanceData, refetch: refetchInstance } = useQuery({
    queryKey: ["instance-markets", matchId],
    queryFn: () => api.getInstanceMarkets(matchId, ["OPEN"]),
    enabled: enableInstanceMarkets,
  });

  const instanceMarkets = instanceData?.markets || [];
  const showInstanceMarkets = enableInstanceMarkets && instanceMarkets.length > 0;

  useEffect(() => {
    if (match?.status === "LIVE") {
      wsClient.subscribeToMatch(matchId);

      const unsubScore = wsClient.on("match:score", (data: any) => {
        if (data.matchId === matchId) {
          setLiveScore({
            details: data.scoreDetails,
          });
          if (data.marketsSuspended !== undefined) {
            setMarketSuspended(data.marketsSuspended);
          }
        }
      });

      let unsubMarket: (() => void) | null = null;
      if (enableInstanceMarkets) {
        unsubMarket = wsClient.on("markets:update", (data: any) => {
          if (data.matchId === matchId) {
            refetchInstance();
          }
        });
      }

      return () => {
        wsClient.unsubscribeFromMatch(matchId);
        unsubScore();
        if (unsubMarket) unsubMarket();
      };
    }
  }, [matchId, match?.status, enableInstanceMarkets, refetchInstance]);

  if (!match) return null;

  // ✅ FIX: was match.markets[0] (hardcoded). Now always Match Winner market.
  const mainMarket = pickMatchWinnerMarket(match.markets || [], match?.sport);
  const tossLine = getTossLine(match);

  const displayScore = liveScore || (match.scoreDetails ? { details: match.scoreDetails } : null);

  const isLive = match.status === "LIVE";

  const currentOver =
    typeof match.currentOver === "number"
      ? `Over ${match.currentOver}.${match.currentBall ?? 0}`
      : null;

  const isMarketOpen = mainMarket?.status === "OPEN" && !marketSuspended;
  const hasUsableOdds =
    isMarketOpen &&
    Array.isArray(mainMarket?.runners) &&
    mainMarket.runners.some(
      (r: Runner) => Number.isFinite(r.backOdds) && Number.isFinite(r.layOdds)
    );

  const handleOpenMatch = () => setLocation(`/match/${match.id}`);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleOpenMatch}
      onKeyDown={(e) => e.key === "Enter" && handleOpenMatch()}
      className={cn(
        "rounded-2xl p-3 border border-white/10 bg-white/[0.035] backdrop-blur-xl text-white",
        "shadow-[0_16px_50px_rgba(0,0,0,0.55)] space-y-2.5 cursor-pointer",
        "hover:border-white/20 transition-colors"
      )}
      data-testid={`mobile-odds-${match.id}`}
    >
      {/* ✅ Internal header hidden when embedded (Dashboard already shows banners/score/overs) */}
      {!embedded && (
        <>
          {/* Teams */}
          <div className="flex items-center justify-between mt-1">
            <span className="font-medium text-[13px] text-white max-w-[45%] truncate">
              {match.homeTeam}
            </span>
            <span className="font-medium text-[13px] text-white max-w-[45%] text-right truncate">
              {match.awayTeam}
            </span>
          </div>

          {/* Score */}
          {displayScore && (
            <div className="flex items-center justify-between text-base font-mono tabular-nums font-bold text-emerald-300">
              <span>{displayScore.home}</span>
              <span>{displayScore.away}</span>
            </div>
          )}

          {/* Over */}
          {currentOver && isLive && (
            <div className="text-[10px] text-emerald-200 flex items-center gap-1">
              <Flame className="h-3 w-3" /> {currentOver}
            </div>
          )}

          {/* Details */}
          {displayScore?.details && (
            <p className="text-[11px] text-slate-50/90 bg-white/[0.03] rounded-lg px-2.5 py-1.5 border border-white/10">
              {displayScore.details}
            </p>
          )}
        </>
      )}

      {tossLine && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-300 animate-pulse" />
          <span className="truncate">{tossLine}</span>
        </div>
      )}

      {marketSuspended && (
        <div className="mt-1 text-[10px] text-amber-300">
          Market temporarily suspended
        </div>
      )}

      {/* Odds */}
      {hasUsableOdds ? (
        <div className="grid grid-cols-2 gap-2 mt-2">
          {mainMarket?.runners?.map((runner: Runner) => {
            const showLabel = shouldShowRunnerLabel(runner.name, match);
            const back = Number.isFinite(runner.backOdds) ? Number(runner.backOdds) : null;
            const lay = Number.isFinite(runner.layOdds) ? Number(runner.layOdds) : null;
            return (
              <div
                key={runner.id}
                className="p-2.5 rounded-xl border border-white/10 bg-white/[0.03]"
                onClick={(e) => e.stopPropagation()}
              >
                {showLabel && (
                  <div className="text-xs font-medium mb-1.5 text-white truncate">
                    {runner.name}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-col h-10 rounded-xl bg-sky-500/15 border-sky-300/25 text-white transition active:scale-[0.99] hover:bg-sky-500/20 hover:border-sky-200/40"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (back !== null) onBetSelect(match, runner, "BACK", back);
                    }}
                    disabled={!isMarketOpen || back === null}
                  >
                    <span
                      className={cn(
                        "font-mono tabular-nums font-semibold text-[17px] leading-none",
                        oddsFlash && "animate-pulse"
                      )}
                    >
                      {back !== null ? back.toFixed(2) : "—"}
                    </span>
                    <span className="text-[9px] mt-0.5">Back</span>
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-col h-10 rounded-xl bg-rose-500/15 border-rose-300/25 text-white transition active:scale-[0.99] hover:bg-rose-500/20 hover:border-rose-200/40"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (lay !== null) onBetSelect(match, runner, "LAY", lay);
                    }}
                    disabled={!isMarketOpen || lay === null}
                  >
                    <span
                      className={cn(
                        "font-mono tabular-nums font-semibold text-[17px] leading-none",
                        oddsFlash && "animate-pulse"
                      )}
                    >
                      {lay !== null ? lay.toFixed(2) : "—"}
                    </span>
                    <span className="text-[9px] mt-0.5">Lay</span>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-3 text-center text-[12px] text-white/65">
          Odds unavailable
        </div>
      )}

      {/* Quick plays */}
      {showInstanceMarkets && (
        <div className="mt-3 space-y-1.5" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-white/60">
              Quick Plays
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-emerald-300 hover:text-emerald-200"
              onClick={(e) => {
                e.stopPropagation();
                setLocation(`/match/${match.id}`);
              }}
            >
              View All
            </Button>
          </div>

          {instanceMarkets.slice(0, 2).map((market) => (
            <div
              key={market.id}
              className="p-2.5 rounded-xl border border-white/10 bg-white/[0.03] space-y-1.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium truncate max-w-[70%]">
                  {market.name}
                </span>
                <Badge
                  variant="outline"
                  className="text-[9px] border-white/20 bg-black/30 text-white/80"
                >
                  {getTimeRemaining(market.closeTime || "")}
                </Badge>
              </div>

              <div className="grid grid-cols-3 gap-1">
                {market.outcomes.slice(0, 4).map((outcome) => (
                  <Button
                    key={outcome.id}
                    variant="outline"
                    size="sm"
                    disabled={market.status !== "OPEN"}
                    className={cn(
                      "h-8 flex-col gap-0 text-center p-1 rounded-lg border-white/20 bg-white/[0.02]",
                      market.status !== "OPEN" && "opacity-50"
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onInstanceBetSelect) {
                        onInstanceBetSelect(market, outcome, match.id);
                      }
                    }}
                  >
                    <span className="text-[9px] font-medium leading-tight truncate w-full">
                      {outcome.name}
                    </span>
                    <span
                      className={cn(
                        "font-mono tabular-nums font-bold text-[11px] text-emerald-300",
                        oddsFlash && "animate-pulse"
                      )}
                    >
                      {outcome.odds.toFixed(2)}
                    </span>
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
