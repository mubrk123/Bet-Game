import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import type { Match, Runner } from "@/lib/store";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

type OddsCardProps = {
  matchId: string;
  onBetSelect: (match: Match, runner: Runner, type: "BACK" | "LAY", odds: number) => void;
  embedded?: boolean;
  variant?: "ivory" | "default" | "dark";
};

function shouldShowRunnerLabel(runnerName: string, match: Match) {
  const n = (runnerName || "").trim().toLowerCase();
  const home = (match.homeTeam || "").trim().toLowerCase();
  const away = (match.awayTeam || "").trim().toLowerCase();
  if (n === home || n === away) return false;
  return true;
}

function isTossLikeMarket(name: string | null | undefined) {
  const n = (name || "").toLowerCase();
  return /toss|coin|flip/.test(n);
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

function pickPrimaryMarket(match: Match) {
  const markets = match.markets || [];
  const nonBallMarkets =
    match.sport === "cricket"
      ? markets.filter((m) => !isBallByBallMarket(m.name, match.sport))
      : markets;
  const list = nonBallMarkets.length > 0 ? nonBallMarkets : markets;
  // ✅ Always prefer Match Winner
  const mw = list.find((m) => (m.name || "").toLowerCase() === "match winner");
  if (mw) return mw;

  // ✅ Otherwise: pick first non-toss market with runners
  const nonToss = list.find((m) => !isTossLikeMarket(m.name) && (m.runners?.length ?? 0) > 0);
  if (nonToss) return nonToss;

  // Fallback (last resort)
  return list[0] ?? null;
}

function getTossLine(match: Match | null | undefined) {
  if (!match) return null;
  const winner =
    match.toss_won_by ||
    null;
  const decision =
    match.elected_to ||
    match.toss_decision ||
    match.tossDecision ||
    null;
  if (winner && decision) {
    const d = String(decision).toLowerCase();
    const pretty = d.includes("bat") ? "bat" : d.includes("bowl") ? "bowl" : decision;
    return `Toss: ${winner} won & elected to ${pretty}`;
  }
  return null;
}

export function OddsCard({ matchId, onBetSelect, embedded = false, variant = "default" }: OddsCardProps) {
  const match = useStore((state) => state.matches.find((m) => m.id === matchId));
  const [, setLocation] = useLocation();

  const [oddsChanged, setOddsChanged] = useState<Record<string, "up" | "down">>({});
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

  const mainMarket = useMemo(() => (match ? pickPrimaryMarket(match) : null), [match]);
  const tossLine = useMemo(() => getTossLine(match), [match]);

  // ✅ Detect odds changes (Match Winner only), match runners by runner.id (not index)
  useEffect(() => {
    const unsubscribe = useStore.subscribe((state, prevState) => {
      const prevMatch = prevState.matches.find((m) => m.id === matchId);
      const currMatch = state.matches.find((m) => m.id === matchId);
      if (!prevMatch || !currMatch) return;

      const prevMarket = pickPrimaryMarket(prevMatch);
      const currMarket = pickPrimaryMarket(currMatch);
      if (!prevMarket || !currMarket) return;

      const prevById = new Map<string, Runner>();
      (prevMarket.runners || []).forEach((r) => prevById.set(r.id, r));

      const changes: Record<string, "up" | "down"> = {};
      (currMarket.runners || []).forEach((r) => {
        const pr = prevById.get(r.id);
        if (!pr) return;

        const currBack = typeof r.backOdds === "number" ? r.backOdds : NaN;
        const prevBack = typeof pr.backOdds === "number" ? pr.backOdds : NaN;
        if (!Number.isFinite(currBack) || !Number.isFinite(prevBack)) return;

        if (currBack > prevBack) changes[r.id] = "up";
        else if (currBack < prevBack) changes[r.id] = "down";
      });

      if (Object.keys(changes).length > 0) {
        setOddsChanged(changes);
        setTimeout(() => setOddsChanged({}), 500);
      }
    });

    return () => unsubscribe();
  }, [matchId]);

  if (!match || !mainMarket) return null;

  const runnerGridCols = mainMarket.runners?.length === 3 ? "grid-cols-3" : "grid-cols-2";
  const marketOpen = (mainMarket.status || "").toUpperCase() === "OPEN";
  const hasUsableOdds =
    marketOpen &&
    Array.isArray(mainMarket.runners) &&
    mainMarket.runners.some((r) => Number.isFinite(r.backOdds));
  const handleOpenMatch = () => setLocation(`/match/${match.id}`);

  const isIvory = variant === "ivory";
  const isDark = variant === "dark";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleOpenMatch}
      onKeyDown={(e) => e.key === "Enter" && handleOpenMatch()}
      className={cn(
        "rounded-2xl overflow-hidden cursor-pointer transition",
        isIvory
          ? "border border-[#E5E0D6] bg-[#FDFBF6] shadow-sm hover:shadow-md"
          : isDark
            ? "border border-[#1F2937] bg-[#0B1220] text-white shadow-[0_18px_45px_rgba(0,0,0,0.45)] hover:border-[#22d3ee44]"
            : "border border-white/10 bg-white/[0.03] backdrop-blur-xl text-foreground shadow-[0_18px_55px_rgba(0,0,0,0.55)] hover:border-white/20"
      )}
      data-testid={`odds-card-${match.id}`}
    >
      <div className="px-3 py-3 space-y-3">
        {!embedded && (
          <div className={cn("text-xs", isIvory ? "text-[#718096]" : isDark ? "text-[#E2E8F0]" : "text-white/70")}>
            {match.homeTeam}{" "}
            <span className={cn(isIvory ? "text-[#CBD5E0]" : isDark ? "text-[#94A3B8]" : "text-white/40")}>vs</span>{" "}
            {match.awayTeam}
          </div>
        )}

        {tossLine && (
          <div
            className={cn(
              "flex items-center gap-2 rounded-xl px-2.5 py-2 text-[11px]",
              isIvory
                ? "border border-[#F6E05E] bg-[#FFF9DB] text-[#B7791F]"
                : isDark
                  ? "border border-[#1F2937] bg-[#111827] text-[#E5E7EB]"
                  : "border border-amber-400/40 bg-amber-500/10 text-amber-100"
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", isIvory ? "bg-[#B7791F]" : "bg-amber-300", "animate-pulse")} />
            <span className="truncate">{tossLine}</span>
          </div>
        )}

        {hasUsableOdds ? (
          <div className={cn("grid gap-2", runnerGridCols)}>
            {(mainMarket.runners || []).map((runner) => {
              const showLabel = shouldShowRunnerLabel(runner.name, match);

              const back = typeof runner.backOdds === "number" ? runner.backOdds : null;
              const lay = typeof runner.layOdds === "number" ? runner.layOdds : null;
              const liquidity = Number.isFinite(runner.volume) ? runner.volume : null;

              return (
                <div
                  key={runner.id}
                  className={cn(
                    "p-2.5 rounded-xl flex flex-col gap-1.5",
                    isIvory ? "border border-[#E2E8F0] bg-white" : "border border-white/10 bg-white/[0.03]"
                  )}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex justify-between items-center">
                    {showLabel ? (
                      <span className={cn("text-xs font-medium truncate", isIvory ? "text-[#1A202C]" : "text-white")}>
                        {runner.name}
                      </span>
                    ) : (
                      <span className={cn("text-[10px]", isIvory ? "text-[#CBD5E0]" : "text-white/45")}> </span>
                    )}

                    {oddsChanged[runner.id] && (
                      <span
                        className={cn(
                          "text-[10px] font-bold",
                          oddsChanged[runner.id] === "up"
                            ? isIvory
                              ? "text-[#059669]"
                              : "text-emerald-400"
                            : isIvory
                              ? "text-[#E11D48]"
                              : "text-rose-400"
                        )}
                      >
                        {oddsChanged[runner.id] === "up" ? "↑" : "↓"}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <Button
                      variant="outline"
                      className={cn(
                        "h-12 flex-col rounded-xl border text-xs transition active:scale-[0.99]",
                        isIvory
                          ? "bg-[#ECFDF5] border-[#BBF7D0] text-[#059669] hover:bg-[#DDF7EB]"
                          : "bg-sky-500/15 border-sky-300/25 text-white hover:bg-sky-500/20 hover:border-sky-200/40",
                        oddsChanged[runner.id] === "up" && (isIvory ? "ring-1 ring-[#34D399]/40" : "ring-1 ring-emerald-400/60")
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (back !== null) onBetSelect(match, runner, "BACK", back);
                      }}
                      disabled={back === null}
                      data-testid={`back-${runner.id}`}
                    >
                      <span
                        className={cn(
                          "font-mono tabular-nums font-semibold text-[17px] leading-none",
                          oddsFlash && "animate-pulse"
                        )}
                      >
                        {back !== null ? back.toFixed(2) : "—"}
                      </span>
                      <span className={cn("text-[10px] mt-0.5", isIvory ? "text-[#718096]" : "text-white/75")}>
                        Back
                        {liquidity ? ` · ${Math.round(liquidity / 1000)}k` : ""}
                      </span>
                    </Button>

                    <Button
                      variant="outline"
                      className={cn(
                        "h-12 flex-col rounded-xl border text-xs transition active:scale-[0.99]",
                        isIvory
                          ? "bg-[#FFF1F2] border-[#FECDD3] text-[#E11D48] hover:bg-[#FFE4E8]"
                          : "bg-rose-500/15 border-rose-300/25 text-white hover:bg-rose-500/20 hover:border-rose-200/40",
                        oddsChanged[runner.id] === "down" && (isIvory ? "ring-1 ring-[#FB7185]/50" : "ring-1 ring-rose-400/60")
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (lay !== null) onBetSelect(match, runner, "LAY", lay);
                      }}
                      disabled={lay === null}
                      data-testid={`lay-${runner.id}`}
                    >
                      <span
                        className={cn(
                          "font-mono tabular-nums font-semibold text-[17px] leading-none",
                          oddsFlash && "animate-pulse"
                        )}
                      >
                        {lay !== null ? lay.toFixed(2) : "—"}
                      </span>
                      <span className={cn("text-[10px] mt-0.5", isIvory ? "text-[#718096]" : "text-white/75")}>
                        Lay
                        {liquidity ? ` · ${Math.round(liquidity / 1000)}k` : ""}
                      </span>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div
            className={cn(
              "rounded-xl px-3 py-4 text-center text-[12px]",
              isIvory ? "border border-[#E2E8F0] bg-white text-[#718096]" : "border border-white/10 bg-white/[0.02] text-white/65"
            )}
          >
            Odds unavailable
          </div>
        )}

        {/* Optional: show which market we are showing (useful while debugging) */}
        {/* <div className="text-[10px] text-white/40">Market: {mainMarket.name}</div> */}
      </div>
    </div>
  );
}
