import { AppShell } from "@/components/layout/AppShell";
import { OddsCard } from "@/components/betting/OddsCard";
import { MobileOddsCard } from "@/components/betting/MobileOddsCard";
import { BetSlip } from "@/components/betting/BetSlip";
import { MobileBetSlip } from "@/components/betting/MobileBetSlip";
import type { Match, Runner } from "@/lib/store";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useStore } from "@/lib/store";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Filter } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const { matches, setMatches } = useStore();
  const [phaseFilter, setPhaseFilter] = useState<"all" | "live" | "upcoming">(
    "all"
  );

  const [selectedBet, setSelectedBet] = useState<{
    match: Match;
    runner: Runner;
    type: "BACK" | "LAY";
    odds: number;
  } | null>(null);

  const isMobile = useIsMobile();
  const [, setLocation] = useLocation();

  const {
    data: matchesData,
    isLoading,
    refetch,
  } = useQuery<Match[]>({
    queryKey: ["live-matches"],
    queryFn: async () => {
      const result = await api.getCurrentCricketMatches();
      return result.matches || [];
    },
    refetchInterval: 20000,
    retry: 2,
  });

  function formatMatchTime(dateStr: string | null | undefined) {
    if (!dateStr) return "Time TBA";
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return "Time TBA";
    return d.toLocaleString(undefined, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatTimeToStart(dateStr: string | null | undefined) {
    if (!dateStr) return "";
    const start = new Date(dateStr).getTime();
    if (Number.isNaN(start)) return "";
    const diffMs = start - Date.now();
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin <= 0) return "Starting soon";
    if (diffMin < 60) return `Starts in ${diffMin}m`;
    const hours = Math.floor(diffMin / 60);
    const minutes = diffMin % 60;
    return `Starts in ${hours}h ${minutes}m`;
  }

  function teamInitials(name: string) {
    if (!name) return "";
    const parts = name.trim().split(/\s+/);
    const initials = parts.map((p) => p[0] || "").join("");
    return initials.slice(0, 3).toUpperCase();
  }

  const dicebearFor = (name: string) =>
    `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(
      name || "team"
    )}&backgroundColor=0f172a&fontWeight=700`;

  function TeamBadge({
    name,
    banner,
    score,
    subline,
    align = "left",
  }: {
    name: string;
    banner?: string | null;
    score?: string | null;
    subline?: string | null;
    align?: "left" | "right";
  }) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 min-w-0",
          align === "right" && "justify-end"
        )}
      >
        {align === "right" ? (
          <>
            <div className={cn("min-w-0 text-right")}>
              <p className="text-[12px] font-semibold text-white/90 truncate">
                {name}
              </p>

              {score ? (
                <p className="mt-0.5 font-mono tabular-nums text-[15px] font-bold text-emerald-300 leading-none">
                  {score}
                </p>
              ) : null}

              {subline ? (
                <p className="mt-0.5 text-[10px] text-white/55 truncate">
                  {subline}
                </p>
              ) : null}
            </div>

            {banner || dicebearFor(name) ? (
              <div className="h-9 w-9 rounded-full bg-white/5 border border-white/15 overflow-hidden flex items-center justify-center shrink-0">
                <img
                  src={banner || dicebearFor(name)}
                  alt={name}
                  className="h-full w-full object-contain p-1"
                />
              </div>
            ) : (
              <div className="h-9 w-9 rounded-full bg-white/5 border border-white/15 flex items-center justify-center text-[11px] font-semibold text-white shrink-0">
                {teamInitials(name)}
              </div>
            )}
          </>
        ) : (
          <>
            {banner || dicebearFor(name) ? (
              <div className="h-9 w-9 rounded-full bg-white/5 border border-white/15 overflow-hidden flex items-center justify-center shrink-0">
                <img
                  src={banner || dicebearFor(name)}
                  alt={name}
                  className="h-full w-full object-contain p-1"
                />
              </div>
            ) : (
              <div className="h-9 w-9 rounded-full bg-white/5 border border-white/15 flex items-center justify-center text-[11px] font-semibold text-white shrink-0">
                {teamInitials(name)}
              </div>
            )}

            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-white/90 truncate">
                {name}
              </p>

              {score ? (
                <p className="mt-0.5 font-mono tabular-nums text-[15px] font-bold text-emerald-300 leading-none">
                  {score}
                </p>
              ) : null}

              {subline ? (
                <p className="mt-0.5 text-[10px] text-white/55 truncate">
                  {subline}
                </p>
              ) : null}
            </div>
          </>
        )}
      </div>
    );
  }

  function escapeRegex(str: string) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function teamAliases(name: string): string[] {
    if (!name) return [];
    const trimmed = name.trim();
    const words = trimmed.split(/\s+/);
    const acronym = words.map((w) => w[0] || "").join("");
    const short3 = trimmed.slice(0, 3);
    return Array.from(
      new Set([trimmed, trimmed.toUpperCase(), acronym.toUpperCase(), short3.toUpperCase()])
    ).filter(Boolean);
  }

  function parseTeamScore(details: string | null | undefined, teamName: string) {
    if (!details || !teamName) return null;
    const aliases = teamAliases(teamName);
    for (const alias of aliases) {
      const re = new RegExp(
        `${escapeRegex(alias)}[\\s:,-]*([0-9]{1,3})(?:\\s*\\/\\s*([0-9]{1,2}|all\\s*out|ao))?\\s*(?:\\(?\\s*([0-9]{1,2}(?:\\.\\d)?)\\s*(?:ov|ovs|overs)?\\s*\\)?)?`,
        "i"
      );
      const m = details.match(re);
      if (m) {
        const runs = m[1] ? `${m[1]}${m[2] ? `/${m[2].replace(/all\s*out/i, "10")}` : ""}` : null;
        const overs = m[3] ? `${m[3]} ov` : null;
        if (runs) return { score: runs, overs };
      }
    }
    return null;
  }

  function getTossLine(match: any): string | null {
    const direct =
      match?.tossInfo ||
      match?.toss_info ||
      match?.toss ||
      match?.toss_text ||
      null;

    if (typeof direct === "string" && direct.trim()) return direct.trim();

    const winner =
      match?.tossWinnerTeam ||
      match?.toss_winner_team ||
      match?.tossWinner ||
      match?.toss_winner ||
      match?.tossWinnerName ||
      null;

    const decision =
      match?.tossDecision ||
      match?.toss_decision ||
      match?.tossElected ||
      match?.toss_elected ||
      null;

    if (winner && decision) {
      const d = String(decision).toLowerCase();
      const pretty =
        d.includes("bat") ? "bat" : d.includes("bowl") ? "bowl" : String(decision);
      return `Toss: ${winner} won & elected to ${pretty}`;
    }

    return null;
  }

  function resolveBattingSide(match: any): "home" | "away" | null {
    if (!match) return null;
    if (match.battingTeamKey && match.homeTeamKey && match.battingTeamKey === match.homeTeamKey) return "home";
    if (match.battingTeamKey && match.awayTeamKey && match.battingTeamKey === match.awayTeamKey) return "away";
    const details = match.scoreDetails || "";
    if (parseTeamScore(details, match.homeTeam)) return "home";
    if (parseTeamScore(details, match.awayTeam)) return "away";
    return null;
  }

  function isSecondInnings(match: any) {
    const d = (match?.scoreDetails || "").toString();
    if (/(need|requires|require|target)/i.test(d)) return true;

    return false;
  }

  useEffect(() => {
    if (!matchesData) return;

    const formattedMatches = matchesData.map((m: any) => {
      return {
        ...m,
        markets: (m.markets || []).map((market: any) => ({
          ...market,
          runners: (market.runners || []).map((r: any) => ({
            ...r,
            backOdds:
              typeof r.backOdds === "string" ? parseFloat(r.backOdds) : r.backOdds,
            layOdds:
              typeof r.layOdds === "string" ? parseFloat(r.layOdds) : r.layOdds,
          })),
        })),
      };
    });

    const filteredByStatus = formattedMatches.filter((m: any) => {
      const status = (m.status || "").toUpperCase();
      // Always hide finished matches
      if (status === "FINISHED") return false;
      if (phaseFilter === "live") return status === "LIVE";
      if (phaseFilter === "upcoming") return status !== "LIVE";
      // "All" shows live + upcoming only
      return status === "LIVE" || status === "UPCOMING" || status === "";
    });

    const sortByStart = (a: Match, b: Match) =>
      new Date(a.startTime || 0).getTime() - new Date(b.startTime || 0).getTime();

    const now = Date.now();
    const live = filteredByStatus.filter((m: any) => {
      const status = (m.status || "").toUpperCase();
      if (status !== "LIVE") return false;
      if (m.updatedAt) return Date.parse(m.updatedAt) >= now - 10 * 60 * 1000;
      return Date.parse(m.startTime) >= now - 6 * 60 * 60 * 1000;
    });
    const upcoming = filteredByStatus.filter((m: any) => {
      const status = (m.status || "").toUpperCase();
      return status !== "LIVE";
    });

    const ordered: Match[] = [...live.sort(sortByStart), ...upcoming.sort(sortByStart)];

    const current = useStore.getState().matches;
    if (
      current.length === ordered.length &&
      current.every(
        (m, i) =>
          m.id === ordered[i].id &&
          m.status === ordered[i].status &&
          m.scoreDetails === ordered[i].scoreDetails &&
          m.runs === ordered[i].runs &&
          m.wickets === ordered[i].wickets &&
          m.overs === ordered[i].overs
      )
    ) {
      return;
    }

    setMatches(ordered);
  }, [matchesData, setMatches, phaseFilter]);

  useEffect(() => {
    const channel = supabase
      .channel("matches-feed")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "matches" },
        (payload) => {
          const current = useStore.getState().matches;
          const updated = current.map((m) =>
            m.id === payload.new.id
              ? {
                  ...m,
                  status: payload.new.status,
                  scoreDetails: payload.new.score_details ?? m.scoreDetails,
                  runs: payload.new.ro_score_runs ?? m.runs ?? null,
                  wickets: payload.new.ro_score_wickets ?? m.wickets ?? null,
                  overs:
                    payload.new.ro_score_overs != null
                      ? Number(payload.new.ro_score_overs)
                      : m.overs ?? null,
                  currentInning: payload.new.ro_current_inning ?? m.currentInning ?? null,
                  targetRuns: payload.new.ro_target_runs ?? m.targetRuns ?? null,
                  battingTeamKey: payload.new.ro_batting_team_key ?? m.battingTeamKey ?? null,
                  bowlingTeamKey: payload.new.ro_bowling_team_key ?? m.bowlingTeamKey ?? null,
                  currentOver: payload.new.current_over ?? m.currentOver,
                  currentBall: payload.new.current_ball ?? m.currentBall,
                  updatedAt: payload.new.updated_at ?? m.updatedAt,
                }
              : m
          );
          setMatches(updated);
        }
      )
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") {
          refetch();
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [setMatches, refetch]);

  const handleBetSelect = (
    match: Match,
    runner: Runner,
    type: "BACK" | "LAY",
    odds: number
  ) => {
    setSelectedBet({ match, runner, type, odds });
  };

  const openMatch = (id: string) => setLocation(`/match/${id}`);

  return (
    <AppShell>
      <div className="grid grid-cols-12 gap-6 h-[calc(100vh-8rem)] bg-[radial-gradient(ellipse_at_top,_rgba(255,255,255,0.06),_rgba(0,0,0,0)_55%)] bg-neutral-950">
        {/* Left: Matches */}
        <div className="col-span-12 lg:col-span-9 flex flex-col gap-4 overflow-y-auto overflow-x-hidden pr-2 pb-20">
          {/* Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mt-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="relative inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.22em] text-white/70">
                  <span className="inline-flex h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                  Live
                </span>
                <span className="text-xs text-emerald-300/80">
                  Exchange Markets
                </span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-heading font-bold text-white">
                T20WC+IPL
              </h2>
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-3 sticky top-0 z-20 bg-neutral-950/80 backdrop-blur-xl pt-3 pb-2 border-b border-white/5">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={`cursor-pointer whitespace-nowrap flex-shrink-0 px-3 py-1.5 rounded-full text-xs border ${
                  phaseFilter === "all"
                    ? "bg-white/10 text-white border-white/40"
                    : "border-white/15 text-slate-100 hover:bg-white/5"
                }`}
                onClick={() => setPhaseFilter("all")}
              >
                All
              </Badge>
              <Badge
                variant="outline"
                className={`cursor-pointer whitespace-nowrap flex-shrink-0 px-3 py-1.5 rounded-full text-xs border ${
                  phaseFilter === "live"
                    ? "bg-emerald-500 text-emerald-950 border-emerald-400 shadow-sm"
                    : "border-white/15 text-slate-100 hover:bg-white/5"
                }`}
                onClick={() => setPhaseFilter("live")}
              >
                Live
              </Badge>
              <Badge
                variant="outline"
                className={`cursor-pointer whitespace-nowrap flex-shrink-0 px-3 py-1.5 rounded-full text-xs border ${
                  phaseFilter === "upcoming"
                    ? "bg-amber-400 text-amber-950 border-amber-300 shadow-sm"
                    : "border-white/15 text-slate-100 hover:bg-white/5"
                }`}
                onClick={() => setPhaseFilter("upcoming")}
              >
                Upcoming
              </Badge>
            </div>
          </div>

          {/* Match grid */}
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-48 bg-white/[0.03] rounded-2xl animate-pulse border border-white/10"
                />
              ))}
            </div>
          ) : matches.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No live or upcoming matches right now. Check back soon.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
              {matches.map((match) => {
                const status = (match.status || "").toUpperCase();
                const isLive = status === "LIVE";
                const isUpcoming = status !== "LIVE";

                // Determine batting side
                const battingSide = isLive ? resolveBattingSide(match) : null;
                const secondInnings = isLive
                  ? (match.currentInning ?? 1) >= 2 || isSecondInnings(match)
                  : false;
                const tossLine = getTossLine(match);

              const parsedHome = parseTeamScore(match.scoreDetails, match.homeTeam);
              const parsedAway = parseTeamScore(match.scoreDetails, match.awayTeam);

              const homeScore = parsedHome?.score || (isLive && match.runs != null && battingSide === "home"
                ? `${match.runs}/${match.wickets ?? 0}`
                : null);
              const awayScore = parsedAway?.score || (isLive && match.runs != null && battingSide === "away"
                ? `${match.runs}/${match.wickets ?? 0}`
                : null);

              let homeSub = parsedHome?.overs || (match.status === "LIVE" && battingSide === "home" && match.overs != null
                ? `${match.overs} ov`
                : null);
              let awaySub = parsedAway?.overs || (match.status === "LIVE" && battingSide === "away" && match.overs != null
                ? `${match.overs} ov`
                : null);

                let centerLine: string | null = null;
                if (isLive) {
                  if (secondInnings) {
                    centerLine =
                      match.targetRuns != null
                        ? `Target ${match.targetRuns}`
                        : null;
                  } else {
                    const decision =
                      match.toss_decision ||
                      match.elected_to ||
                      match.tossDecision ||
                      null;
                    const winner =
                      match.toss_won_by ||
                      null;

                    if (winner && decision) {
                      centerLine = `${winner} opted to ${decision}`;
                    } else {
                      centerLine = getTossLine(match);
                    }
                  }
                } else if (tossLine) {
                  centerLine = tossLine;
                }

                return (
                  <div
                    key={match.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openMatch(match.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") openMatch(match.id);
                    }}
                    className={cn(
                      "rounded-2xl border border-white/10 bg-white/[0.035] backdrop-blur-xl p-3",
                      "shadow-[0_14px_40px_rgba(0,0,0,0.45)] hover:border-white/20 transition-colors",
                      "cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
                    )}
                  >
                    {/* Slim meta row */}
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-[0.22em] text-white/55 truncate">
                          {match.league || "Cricket"}
                        </div>
                        <div className="text-[11px] text-white/40 truncate">
                          {match.venue || "Venue TBA"}
                        </div>
                      </div>

                      <div className="flex flex-col items-end shrink-0">
                        <div className="flex items-center gap-2">
                          {isLive && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-[2px] text-[10px] font-semibold text-red-300">
                              <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                              LIVE
                            </span>
                          )}
                          {isUpcoming && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-[2px] text-[10px] font-semibold text-amber-200">
                              UPCOMING
                            </span>
                          )}
                        </div>

                        <div className="mt-1 text-[11px] font-mono tabular-nums text-emerald-300/90">
                          {formatMatchTime(match.startTime)}
                        </div>

                        {isUpcoming && (
                          <div className="text-[10px] text-amber-200/70">
                            {formatTimeToStart(match.startTime)}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Teams + score + overs (single source) */}
                    <div className="mb-2 rounded-2xl border border-white/10 bg-white/[0.02] px-3 py-2">
                      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                        <TeamBadge
                          name={match.homeTeam}
                          banner={match.homeTeamBanner}
                          score={isLive ? homeScore : null}
                          subline={homeSub}
                          align="left"
                        />

                        <div className="flex flex-col items-center justify-center text-center min-w-0">
                          <span className="text-[10px] uppercase tracking-[0.2em] text-white/55">
                            VS
                          </span>

                          {centerLine ? (
                            <span className="mt-1 text-[10px] text-white/65 max-w-[160px] truncate">
                              {centerLine}
                            </span>
                          ) : (
                            <span className="mt-1 text-[10px] text-white/35">
                              {isLive ? "Live" : "—"}
                            </span>
                          )}
                        </div>

                        <TeamBadge
                          name={match.awayTeam}
                          banner={match.awayTeamBanner}
                          score={isLive ? awayScore : null}
                          subline={awaySub}
                          align="right"
                        />
                      </div>
                    </div>

                    {/* Odds hero (embedded so it doesn't duplicate teams/score/overs) */}
                    <div onClick={(e) => e.stopPropagation()}>
                      <div className="hidden md:block">
                        <OddsCard
                          matchId={match.id}
                          onBetSelect={handleBetSelect}
                          embedded
                        />
                      </div>
                      <div className="md:hidden">
                        <MobileOddsCard
                          matchId={match.id}
                          onBetSelect={handleBetSelect}
                          embedded
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right side: Bet slip */}
        <div className="hidden lg:block col-span-3">
          <Tabs defaultValue="bets" className="w-full">
            <TabsList className="w-full">
              <TabsTrigger value="bets" className="flex-1">
                Bet Slip
              </TabsTrigger>
              <TabsTrigger value="filter" className="flex-1">
                <Filter className="h-4 w-4" />
              </TabsTrigger>
            </TabsList>
            <TabsContent value="bets" className="mt-4">
              <BetSlip selectedBet={selectedBet} onClear={() => setSelectedBet(null)} />
            </TabsContent>
            <TabsContent value="filter" className="mt-4">
              <div className="p-4 rounded-xl border bg-muted/40">
                <p className="text-sm text-muted-foreground">Filters coming soon</p>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Mobile bet slip drawer */}
      <Sheet
        open={!!selectedBet && isMobile}
        onOpenChange={(open) => !open && setSelectedBet(null)}
      >
        <SheetContent side="bottom" className="h-[85vh] rounded-t-3xl p-0">
          <MobileBetSlip selectedBet={selectedBet} onClear={() => setSelectedBet(null)} />
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}
