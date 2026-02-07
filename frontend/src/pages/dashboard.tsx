import { AppShell } from "@/components/layout/AppShell";
// Simplified odds display; full OddsCard not used here
import { BetSlip } from "@/components/betting/BetSlip";
import { MobileBetSlip } from "@/components/betting/MobileBetSlip";
import type { Match, Market, Runner } from "@/lib/store";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";

import { useStore } from "@/lib/store";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
// Icons not needed after simplifying header
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

const ivoryTheme = {
  canvas: "bg-[#F7F5EF]",
  card: "bg-[#FDFBF6]",
  border: "border-[#E5E0D6]",
  text: "text-[#1F2733]",
  subtext: "text-[#7A7F87]",
  backBg: "bg-[#ECFDF5]",
  backText: "text-[#0B8A5F]",
  layBg: "bg-[#FFF1F2]",
  layText: "text-[#D92148]",
  chipActiveBg: "bg-[#E8F1FF]",
  chipActiveText: "text-[#1F2733]",
  chipBorder: "border-[#D9D2C6]",
  marine: "#2563EB",
};

export default function Dashboard() {
  const { matches, setMatches, currentUser } = useStore();
  const [phaseFilter, setPhaseFilter] = useState<"all" | "live" | "upcoming">(
    "all"
  );

  const [selectedBet, setSelectedBet] = useState<{
    match: Match;
    market: Market;
    runner: Runner;
    type: "BACK" | "LAY";
    odds: number;
  } | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());

  const isMobile = useIsMobile();
  const [, setLocation] = useLocation();

  // global ticker for countdowns
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const {
    data: matchesData,
    isLoading,
    refetch,
  } = useQuery<Match[]>({
    queryKey: ["live-matches"],
    queryFn: async () => {
      const result = await api.getCurrentCricketMatches();
      const now = Date.now();
      const horizonMs = 450 * 60 * 60 * 1000; // 450 hours (~18.75 days)
      return (result.matches || []).filter((m: Match) => {
        if (!m.startTime) return true; // keep if missing time to avoid hiding unknowns
        const ts = Date.parse(m.startTime);
        if (Number.isNaN(ts)) return true;
        return ts <= now + horizonMs;
      });
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

  function formatCountdownExact(dateStr: string | null | undefined) {
    if (!dateStr) return "";
    const start = new Date(dateStr).getTime();
    if (Number.isNaN(start)) return "";
    const diffMs = Math.max(0, start - nowTick);
    const totalSeconds = Math.floor(diffMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  function teamInitials(name: string) {
    if (!name) return "";
    const parts = name.trim().split(/\s+/);
    const initials = parts.map((p) => p[0] || "").join("");
    return initials.slice(0, 3).toUpperCase();
  }

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
          "flex items-center min-w-0",
          align === "right" && "justify-end"
        )}
      >
        <div
          className={cn(
            "flex flex-col items-center gap-1 min-w-0 text-center",
            align === "right" && "items-center text-center"
          )}
        >
          {banner ? (
            <img
              src={banner}
              alt={name}
              className="h-8 w-11 rounded-sm object-contain border border-[#E2E8F0]"
            />
          ) : (
            <div className="h-8 w-11 rounded-sm bg-[#E5E7EB] border border-[#E2E8F0] flex items-center justify-center text-[11px] font-semibold text-[#1A202C]">
              {teamInitials(name)}
            </div>
          )}

          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-[#1A202C] truncate">{name}</p>
            {score ? (
              <p className="font-mono tabular-nums text-[15px] font-bold text-[#1A202C] leading-none">
                {score}
              </p>
            ) : null}
            {subline ? (
              <p className="text-[11px] text-[#718096] truncate">{subline}</p>
            ) : null}
          </div>
        </div>
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

  function hasScore(match: Match | null | undefined) {
    if (!match) return false;

    const runs = Number(match.runs);
    const wkts = Number(match.wickets);
    const overs = Number(match.overs);

    if (
      (Number.isFinite(runs) && runs > 0) ||
      (Number.isFinite(wkts) && wkts > 0) ||
      (Number.isFinite(overs) && overs > 0)
    ) {
      return true;
    }

    const parsedHome = parseTeamScore(match.scoreDetails, match.homeTeam);
    const parsedAway = parseTeamScore(match.scoreDetails, match.awayTeam);

    const parsedHasScore = (parsed: ReturnType<typeof parseTeamScore> | null) => {
      if (!parsed) return false;
      const runVal = parsed.score ? parseInt(parsed.score, 10) : NaN;
      const overVal = parsed.overs ? parseFloat(parsed.overs) : NaN;
      return (Number.isFinite(runVal) && runVal > 0) || (Number.isFinite(overVal) && overVal > 0);
    };

    return parsedHasScore(parsedHome) || parsedHasScore(parsedAway);
  }

  // Minimal toss line for dashboard cards; hide once scoring starts
  function getTossLine(match: Match | null | undefined) {
    if (!match || hasScore(match)) return null;
    const winner = match.toss_won_by || null;
    const decision =
      match.elected_to || match.toss_decision || match.tossDecision || null;
    if (!winner || !decision) return null;

    const prettyDecision = (() => {
      const d = String(decision).toLowerCase();
      if (d.includes("bat")) return "bat";
      if (d.includes("bowl")) return "bowl";
      return decision;
    })();

    return `Toss: ${winner} won & elected to ${prettyDecision}`;
  }

  function compactLabel(label?: string | null) {
    if (!label) return "";
    const v = label.trim();
    if (/^united states of america$/i.test(v)) return "USA";
    return v;
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

  function resolveBattingSide(match: any): "home" | "away" | null {
    if (!match) return null;
    if (match.battingTeamKey && match.homeTeamKey && match.battingTeamKey === match.homeTeamKey) return "home";
    if (match.battingTeamKey && match.awayTeamKey && match.battingTeamKey === match.awayTeamKey) return "away";
    const details = match.scoreDetails || "";
    if (parseTeamScore(details, match.homeTeam)) return "home";
    if (parseTeamScore(details, match.awayTeam)) return "away";
    return null;
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
          m.overs === ordered[i].overs &&
          m.toss_won_by === ordered[i].toss_won_by &&
          (m.elected_to || m.toss_decision || m.tossDecision) ===
            (ordered[i].elected_to || ordered[i].toss_decision || ordered[i].tossDecision)
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
                  status: (payload.new.display_status ?? payload.new.status ?? m.status) as Match["status"],
                  scoreDetails:
                    payload.new.display_score ?? payload.new.score_details ?? m.scoreDetails,
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
                  toss_won_by:
                    payload.new.toss_won_by ?? payload.new.ro_toss_won_by ?? m.toss_won_by ?? null,
                  elected_to:
                    payload.new.elected_to ?? payload.new.ro_toss_decision ?? m.elected_to ?? null,
                  toss_decision:
                    payload.new.elected_to ?? payload.new.ro_toss_decision ?? m.toss_decision ?? null,
                  tossDecision:
                    payload.new.elected_to ?? payload.new.ro_toss_decision ?? m.tossDecision ?? null,
                  toss_recorded_at: payload.new.toss_recorded_at ?? m.toss_recorded_at ?? null,
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
    market: Market,
    runner: Runner,
    type: "BACK" | "LAY",
    odds: number
  ) => {
    setSelectedBet({ match, market, runner, type, odds });
  };

  const openMatch = (id: string) => setLocation(`/match/${id}`);

  return (
    <AppShell hideHeader>
      <div className={cn("min-h-[calc(100vh-3rem)] -mx-3 md:-mx-6", ivoryTheme.canvas)}>
        <div className="max-w-6xl mx-auto px-3 md:px-6 pt-3 pb-18 space-y-2.5">
          {/* Command Center */}
          <div
            className={cn(
              "rounded-2xl border shadow-sm px-3 py-2.5 space-y-1.25",
              "bg-white",
              ivoryTheme.border
            )}
          >
            {/* Row 1: Brand */}
            <div className="w-full flex justify-center">
              <div className="text-2xl font-extrabold tracking-tight text-[#0F172A]">CricFun</div>
            </div>

            {/* Row 2: Filters + balance */}
            <div className="w-full flex items-center justify-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                {(["all", "live", "upcoming"] as const).map((key) => {
                  const active = phaseFilter === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setPhaseFilter(key)}
                      className={cn(
                        "px-3 py-1.5 rounded-full border text-sm font-medium transition",
                        ivoryTheme.chipBorder,
                        active
                          ? `${ivoryTheme.chipActiveBg} ${ivoryTheme.chipActiveText} border-[#BEE3F8] shadow-sm`
                          : `bg-[#F8FAFC] ${ivoryTheme.subtext} hover:bg-[#EDF2F7]`
                      )}
                    >
                      {key === "all" ? "All" : key === "live" ? "Live" : "Upcoming"}
                    </button>
                  );
                })}
              </div>

              {currentUser && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#D9D2C6] bg-[#FDFBF6]">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1F2733" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7h18v10H3z" />
                    <path d="M16 12h.01" />
                    <path d="M5 7V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2" />
                  </svg>
                  <span className="font-mono text-sm font-semibold text-[#1F2733]">
                    {currentUser.currency} {currentUser.balance.toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-8 xl:col-span-9">
              {/* Match grid */}
              {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-1">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="h-48 rounded-2xl border border-[#E2E8F0] bg-white animate-pulse shadow-sm"
                    />
                  ))}
                </div>
              ) : matches.length === 0 ? (
                <div className="text-center py-12 text-[#718096]">
                  No live or upcoming matches right now. Check back soon.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {matches.map((match) => {
                    const status = (match.status || "").toUpperCase();
                    const isLive = status === "LIVE";

                    const battingSide = isLive ? resolveBattingSide(match) : null;

                    const parsedHome = parseTeamScore(match.scoreDetails, match.homeTeam);
                    const parsedAway = parseTeamScore(match.scoreDetails, match.awayTeam);

                    const homeScore =
                      parsedHome?.score ||
                      (isLive && match.runs != null && battingSide === "home"
                        ? `${match.runs}/${match.wickets ?? 0}`
                        : null);
                    const awayScore =
                      parsedAway?.score ||
                      (isLive && match.runs != null && battingSide === "away"
                        ? `${match.runs}/${match.wickets ?? 0}`
                        : null);

                    let homeSub =
                      parsedHome?.overs ||
                      (match.status === "LIVE" && battingSide === "home" && match.overs != null
                        ? `${match.overs} ov`
                        : null);
                    let awaySub =
                      parsedAway?.overs ||
                      (match.status === "LIVE" && battingSide === "away" && match.overs != null
                        ? `${match.overs} ov`
                        : null);

                    const statusPill = isLive ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#DCFCE7] text-[#15803D] px-2 py-[3px] text-[11px] font-semibold border border-[#BBF7D0]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#15803D] animate-pulse" />
                        LIVE
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#FEF9C3] text-[#B45309] px-2 py-[3px] text-[11px] font-semibold border border-[#FDE68A]">
                        UPCOMING
                      </span>
                    );

                    const matchWinnerMarket: Market | null =
                      ((match.markets || []) as Market[]).find((m) => {
                        const name = String((m as any).market_name || m.name || "").toLowerCase();
                        return name.includes("match winner") || name === "winner" || name === "win";
                      }) || null;

                    const normalizedMarket =
                      matchWinnerMarket && {
                        ...matchWinnerMarket,
                        name:
                          matchWinnerMarket.name ||
                          (matchWinnerMarket as any).market_name ||
                          "Match Winner",
                      };

                    const tossLine = getTossLine(match);

                    const runners = matchWinnerMarket ? (matchWinnerMarket.runners || []).slice(0, 2) : [];
                    const countdownExact = formatCountdownExact(match.startTime);

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
                          "rounded-2xl border border-[#D7DDE5] bg-white p-3.5 shadow-md hover:shadow-lg transition",
                          "cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#2563EB33]",
                          "flex flex-col gap-2"
                        )}
                      >
                        <div className="flex items-start gap-2 pb-1.5 border-b border-[#E2E8F0]">
                          <div className="min-w-0">
                            <div className="text-[11px] uppercase tracking-[0.16em] text-[#475569] truncate">
                              {compactLabel(match.league) || "Cricket"}
                            </div>
                            <div className="text-[12px] text-[#1F2733] truncate">
                              {match.venue || "Venue TBA"}
                            </div>
                          </div>
                          <div className="flex-1" />
                          <div className="shrink-0 flex flex-col items-end gap-1">
                            <div className="shrink-0">{statusPill}</div>
                            <span className="text-[11px] text-[#475569] font-mono tabular-nums">
                              {formatMatchTime(match.startTime)}
                            </span>
                          </div>
                        </div>

                        <div className="pb-1.5 border-b border-[#E2E8F0]">
                          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
                            <TeamBadge
                              name={match.homeTeam}
                              banner={match.homeTeamBanner}
                              score={isLive ? homeScore : null}
                              subline={homeSub}
                              align="left"
                            />
                            <div className="flex flex-col items-center justify-center text-center min-w-0">
                              {!isLive && countdownExact && (
                                <span className="text-[13px] font-semibold font-mono tabular-nums text-[#0F172A]">
                                  {countdownExact}
                                </span>
                              )}
                              {isLive && (
                                <span className="text-[13px] font-semibold text-[#15803D]">Live</span>
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

                        {tossLine && (
                          <div className="pt-1 text-center text-[12px] text-[#475569]">
                            {tossLine}
                          </div>
                        )}

                        {/* Simple odds for Match Winner only */}
                        {runners.length > 0 && (
                          <div className="pt-1" onClick={(e) => e.stopPropagation()}>
                            <div className="grid grid-cols-2 gap-1.25">
                              {runners.map((r: any, idx: number) => {
                                const back = Number(r.backOdds ?? r.back_odds ?? 0).toFixed(2);
                                const lay = Number(r.layOdds ?? r.lay_odds ?? 0).toFixed(2);
                                return (
                                  <div key={r.id || idx} className="space-y-1">
                                    <div className="grid grid-cols-2 gap-1">
                                      <button
                                        className={cn(
                                          "rounded-md border border-[#34D399] bg-[#ECFDF3] py-2 text-center text-[13px] font-semibold text-[#065F46]",
                                          "hover:shadow-sm transition"
                                        )}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          normalizedMarket &&
                                          handleBetSelect(match, normalizedMarket, r, "BACK", Number(back));
                                        }}
                                      >
                                        Back {back}
                                      </button>
                                      <button
                                        className={cn(
                                          "rounded-md border border-[#FECACA] bg-[#FEF2F2] py-2 text-center text-[13px] font-semibold text-[#991B1B]",
                                          "hover:shadow-sm transition"
                                        )}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          normalizedMarket &&
                                          handleBetSelect(match, normalizedMarket, r, "LAY", Number(lay));
                                        }}
                                      >
                                        Lay {lay}
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right side: Bet slip removed; using floating slip below */}
          </div>
        </div>
      </div>

      {!isMobile && selectedBet && (
        <div className="fixed bottom-6 right-6 z-50 w-[360px]">
          <BetSlip selectedBet={selectedBet} onClear={() => setSelectedBet(null)} variant="compact" />
        </div>
      )}

      {/* Mobile bet slip drawer */}
      <Sheet open={!!selectedBet && isMobile} onOpenChange={(open) => !open && setSelectedBet(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl p-0 h-auto pb-6">
          <SheetTitle className="sr-only">Bet Slip</SheetTitle>
          <SheetDescription className="sr-only">
            Choose your selection, stake, and place the bet.
          </SheetDescription>
          <div className="p-3">
            <MobileBetSlip selectedBet={selectedBet} onClear={() => setSelectedBet(null)} />
          </div>
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}
