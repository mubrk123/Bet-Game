import { AppShell } from "@/components/layout/AppShell";
// Simplified odds display; full OddsCard not used here
import { BetSlip } from "@/components/betting/BetSlip";
import { MobileBetSlip } from "@/components/betting/MobileBetSlip";
import type { Match, Market, Runner } from "@/lib/store";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";

import { useStore } from "@/lib/store";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
// Icons not needed after simplifying header
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { wsClient } from "@/lib/websocket";

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

/* ==========
   TOP-LEVEL HELPERS
========== */

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
    new Set([
      trimmed,
      trimmed.toUpperCase(),
      acronym.toUpperCase(),
      short3.toUpperCase(),
    ])
  ).filter(Boolean);
}

function parseTarget(details?: string | null): number | null {
  if (!details) return null;
  const s = String(details);
  const m1 = s.match(/target[:\s]+(\d+)/i);
  if (m1?.[1]) return Number(m1[1]);
  const m2 = s.match(/(\d+)\s+runs?\s+to\s+win/i);
  if (m2?.[1]) return Number(m2[1]);
  return null;
}

// helper to map runner to team by name
function normalizeRunnerName(r: any): string {
  return String(r.runner_name || r.name || r.teamName || "")
    .trim()
    .toUpperCase();
}

function findRunnerForTeam(
  runners: any[],
  teamName: string,
  otherTeamName?: string
): any | null {
  if (!runners?.length || !teamName) return null;

  const aliases = teamAliases(teamName).map((a) => a.toUpperCase());
  const otherAliases = otherTeamName
    ? teamAliases(otherTeamName).map((a) => a.toUpperCase())
    : [];

  // 1) strong match by aliases
  let candidate =
    runners.find((r) => {
      const n = normalizeRunnerName(r);
      return aliases.some((a) => n.includes(a) || a.includes(n));
    }) || null;

  if (candidate) return candidate;

  // 2) fallback: something that is NOT obviously the other team
  if (otherAliases.length) {
    candidate =
      runners.find((r) => {
        const n = normalizeRunnerName(r);
        return !otherAliases.some((a) => n.includes(a) || a.includes(n));
      }) || null;
    if (candidate) return candidate;
  }

  // 3) final fallback
  return runners[0] || null;
}

function normalizeKey(val: string | null | undefined) {
  if (!val) return null;
  return String(val).trim().toLowerCase();
}

function runnerMatchesTeam(r: any, teamName: string | null | undefined) {
  if (!r || !teamName) return false;
  const aliases = teamAliases(teamName).map((a) => a.toUpperCase());
  const n = normalizeRunnerName(r);
  return aliases.some((a) => n.includes(a) || a.includes(n));
}

/**
 * Central mapping for match-winner market:
 * returns the correct runner for homeTeam and awayTeam.
 */
function mapMatchWinnerRunners(
  match: Match,
  matchWinnerMarket: Market | null
): { homeRunner: Runner | null; awayRunner: Runner | null } {
  const runners = (matchWinnerMarket?.runners || []) as any[];
  if (!runners.length) {
    return { homeRunner: null, awayRunner: null };
  }

  const homeKey = normalizeKey((match as any).homeTeamKey);
  const awayKey = normalizeKey((match as any).awayTeamKey);

  let homeRunner: any = null;
  let awayRunner: any = null;

  // 1) Map via explicit metadata flags first (authoritative)
  for (const r of runners) {
    const meta = (r as any).metadata || {};
    if (!homeRunner && meta.is_home === true) homeRunner = r;
    if (!awayRunner && meta.is_away === true) awayRunner = r;
  }

  // 2) Map using team keys (most reliable when consistent)
  if (homeKey || awayKey) {
    for (const r of runners) {
      const rKey = normalizeKey(
        (r as any).ro_team_key ||
          (r as any).teamKey ||
          (r as any).team_key ||
          null
      );
      if (!rKey) continue;
      if (!homeRunner && homeKey && rKey === homeKey) {
        homeRunner = r;
      }
      if (!awayRunner && awayKey && rKey === awayKey) {
        awayRunner = r;
      }
    }
  }

  // 2) Fallback to name-based mapping if needed
  if (!homeRunner) {
    homeRunner = findRunnerForTeam(
      runners,
      match.homeTeam,
      match.awayTeam
    );
  }
  if (!awayRunner) {
    awayRunner = findRunnerForTeam(
      runners,
      match.awayTeam,
      match.homeTeam
    );
  }

  // 3) If both sides mapped to the same runner, try to pick a different one for away
  if (homeRunner && awayRunner && homeRunner === awayRunner && runners.length > 1) {
    const alt = runners.find((r) => r !== homeRunner);
    if (alt) {
      awayRunner = alt;
    }
  }

  // 4) Final fallbacks so UI always shows something
  if (!homeRunner && !awayRunner) {
    if (runners.length >= 1) homeRunner = runners[0];
    if (runners.length >= 2) awayRunner = runners[1];
  } else if (!homeRunner && awayRunner) {
    homeRunner = runners.find((r) => r !== awayRunner) || runners[0];
  } else if (!awayRunner && homeRunner) {
    awayRunner = runners.find((r) => r !== homeRunner) || runners[0];
  }

  // 5) SAFETY CHECK: if they look obviously reversed (by name), swap them.
  if (
    homeRunner &&
    awayRunner &&
    runnerMatchesTeam(homeRunner, (match as any).awayTeam) &&
    runnerMatchesTeam(awayRunner, (match as any).homeTeam)
  ) {
    const tmp = homeRunner;
    homeRunner = awayRunner;
    awayRunner = tmp;
  }

  return {
    homeRunner: (homeRunner || null) as Runner | null,
    awayRunner: (awayRunner || null) as Runner | null,
  };
}

/* ==========
   DASHBOARD COMPONENT
========== */

export default function Dashboard() {
  const { matches, setMatches, currentUser } = useStore();

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
    extra,
    align = "left",
  }: {
    name: string;
    banner?: string | null;
    score?: string | null;
    subline?: string | null;
    extra?: string | null;
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
            <p className="text-[13px] font-semibold text-[#1A202C] truncate">
              {name}
            </p>
            {score ? (
              <p className="font-mono tabular-nums text-[15px] font-bold text-[#1A202C] leading-none">
                {score}
              </p>
            ) : null}
            {subline ? (
              <p className="text-[11px] text-[#718096] truncate">{subline}</p>
            ) : null}
            {extra ? (
              <p className="text-[11px] text-[#94A3B8] truncate">{extra}</p>
            ) : null}
          </div>
        </div>
      </div>
    );
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

    const parsedHasScore = (
      parsed: ReturnType<typeof parseTeamScore> | null
    ) => {
      if (!parsed) return false;
      const runVal = parsed.score ? parseInt(parsed.score, 10) : NaN;
      const overVal = parsed.overs ? parseFloat(parsed.overs) : NaN;
      return (
        (Number.isFinite(runVal) && runVal > 0) ||
        (Number.isFinite(overVal) && overVal > 0)
      );
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
        const runs = m[1]
          ? `${m[1]}${
              m[2] ? `/${m[2].replace(/all\s*out/i, "10")}` : ""
            }`
          : null;
        const overs = m[3] ? `${m[3]} ov` : null;
        if (runs) return { score: runs, overs };
      }
    }
    return null;
  }

  // Generic parser when display_score does not include team names (e.g., "81/3 in 10.6 overs")
  function parseGenericScore(details: string | null | undefined) {
    if (!details) return null;
    const m = details.match(/(\d+\s*\/\s*\d+)|(\d+\s*\/\s*all\s*out)/i);
    const overMatch = details.match(/([\d.]+)\s*(?:ov|overs)/i);
    const score = m ? m[0].replace(/\s+/g, "") : null;
    const overs = overMatch ? `${overMatch[1]} ov` : null;
    if (!score && !overs) return null;
    return { score, overs };
  }

  function resolveBattingSide(match: any): "home" | "away" | null {
    if (!match) return null;
    if (
      match.battingTeamKey &&
      match.homeTeamKey &&
      match.battingTeamKey === match.homeTeamKey
    )
      return "home";
    if (
      match.battingTeamKey &&
      match.awayTeamKey &&
      match.battingTeamKey === match.awayTeamKey
    )
      return "away";
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
              typeof r.backOdds === "string"
                ? parseFloat(r.backOdds)
                : r.backOdds,
            layOdds:
              typeof r.layOdds === "string"
                ? parseFloat(r.layOdds)
                : r.layOdds,
          })),
        })),
      };
    });

    const filteredByStatus = formattedMatches.filter((m: any) => {
      const status = (m.status || "").toUpperCase();
      if (status === "FINISHED") return false;
      return true;
    });

    const sortByStart = (a: Match, b: Match) =>
      new Date(a.startTime || 0).getTime() -
      new Date(b.startTime || 0).getTime();

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

    const ordered: Match[] = [
      ...live.sort(sortByStart),
      ...upcoming.sort(sortByStart),
    ];

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
            (ordered[i].elected_to ||
              ordered[i].toss_decision ||
              ordered[i].tossDecision)
      )
    ) {
      return;
    }

    setMatches(ordered);
  }, [matchesData, setMatches]);

  useEffect(() => {
    if (!currentUser?.id) return;

    wsClient.connect();
    wsClient.subscribeToUser(currentUser.id);

    const unsubscribeWallet = wsClient.on("wallet:update", async () => {
      try {
        const { user } = await api.getCurrentUser();
        useStore.setState({
          currentUser: {
            id: user.id,
            username: user.username,
            role: user.role,
            balance: parseFloat(user.balance),
            exposure: parseFloat(user.exposure),
            currency: user.currency,
          },
        });
      } catch (err) {
        console.error("wallet:update refresh failed", err);
      }
    });

    return () => {
      unsubscribeWallet?.();
      wsClient.unsubscribe(`user:${currentUser.id}`);
    };
  }, [currentUser?.id]);

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
                  status: (payload.new.display_status ??
                    payload.new.status ??
                    m.status) as Match["status"],
                  scoreDetails:
                    payload.new.display_score ??
                    payload.new.score_details ??
                    m.scoreDetails,
                  runs: payload.new.ro_score_runs ?? m.runs ?? null,
                  wickets: payload.new.ro_score_wickets ?? m.wickets ?? null,
                  overs:
                    payload.new.ro_score_overs != null
                      ? Number(payload.new.ro_score_overs)
                      : m.overs ?? null,
                  currentInning:
                    payload.new.ro_current_inning ?? m.currentInning ?? null,
                  targetRuns:
                    payload.new.ro_target_runs ?? m.targetRuns ?? null,
                  battingTeamKey:
                    payload.new.ro_batting_team_key ??
                    m.battingTeamKey ??
                    null,
                  bowlingTeamKey:
                    payload.new.ro_bowling_team_key ??
                    m.bowlingTeamKey ??
                    null,
                  currentOver: payload.new.current_over ?? m.currentOver,
                  currentBall: payload.new.current_ball ?? m.currentBall,
                  updatedAt: payload.new.updated_at ?? m.updatedAt,
                  toss_won_by:
                    payload.new.toss_won_by ??
                    payload.new.ro_toss_won_by ??
                    m.toss_won_by ??
                    null,
                  elected_to:
                    payload.new.elected_to ??
                    payload.new.ro_toss_decision ??
                    m.elected_to ??
                    null,
                  toss_decision:
                    payload.new.elected_to ??
                    payload.new.ro_toss_decision ??
                    m.toss_decision ??
                    null,
                  tossDecision:
                    payload.new.elected_to ??
                    payload.new.ro_toss_decision ??
                    m.tossDecision ??
                    null,
                  toss_recorded_at:
                    payload.new.toss_recorded_at ??
                    m.toss_recorded_at ??
                    null,
                }
              : m
          );
          const alive = updated.filter(
            (m) => (m.status || "").toUpperCase() !== "FINISHED"
          );
          setMatches(alive);
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
      <div
        className={cn(
          "min-h-[calc(100vh-3rem)] -mx-3 md:-mx-6",
          ivoryTheme.canvas
        )}
      >
        <div className="max-w-6xl mx-auto px-3 md:px-6 pt-3 pb-18 space-y-2.5">
          {/* Top bar: brand left, balance right */}
          <div className="flex items-center justify-between px-1.5 md:px-0">
            <div className="text-2xl font-extrabold tracking-tight text-[#0F172A]">
              CricFun
            </div>
            {currentUser && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#D9D2C6] bg-white shadow-sm">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#1F2733"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 7h18v10H3z" />
                  <path d="M16 12h.01" />
                  <path d="M5 7V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2" />
                </svg>
                <span className="font-mono text-sm font-semibold text-[#1F2733]">
                  {currentUser.currency}{" "}
                  {currentUser.balance.toLocaleString()}
                </span>
              </div>
            )}
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
                  No matches right now. Check back soon.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {matches.map((match) => {
                    const status = (match.status || "").toUpperCase();
                    const isLive = status === "LIVE";

                    const battingSide = isLive ? resolveBattingSide(match) : null;

                    const parsedHome = parseTeamScore(
                      match.scoreDetails,
                      match.homeTeam
                    );
                    const parsedAway = parseTeamScore(
                      match.scoreDetails,
                      match.awayTeam
                    );
                    const parsedGeneric = parseGenericScore(match.scoreDetails);

                    // Prefer provider-formatted display_score (same as match-details); fallback to numeric columns
                    const parsedScore =
                      battingSide === "home"
                        ? parsedHome?.score
                        : battingSide === "away"
                        ? parsedAway?.score
                        : parsedHome?.score || parsedAway?.score || null;

                    const parsedOvers =
                      battingSide === "home"
                        ? parsedHome?.overs
                        : battingSide === "away"
                        ? parsedAway?.overs
                        : parsedHome?.overs || parsedAway?.overs || null;

                    const liveScore =
                      parsedScore ??
                      parsedGeneric?.score ??
                      (match.runs != null
                        ? `${match.runs}/${match.wickets ?? 0}`
                        : null);

                    const liveOvers =
                      parsedOvers ??
                      parsedGeneric?.overs ??
                      (match.overs != null ? `${match.overs} ov` : null);

                    const targetRuns =
                      (Number.isFinite(Number(match.targetRuns)) && Number(match.targetRuns) > 0
                        ? Number(match.targetRuns)
                        : null) ??
                      parseTarget(match.scoreDetails);

                    const requiredRuns =
                      isLive &&
                      (match.currentInning ?? 1) >= 2 &&
                      targetRuns != null &&
                      match.runs != null
                        ? Math.max(0, targetRuns - match.runs)
                        : null;
                    const ballsRemaining = (() => {
                      if (!isLive || (match.currentInning ?? 1) < 2 || match.overs == null) return null;
                      const oversCap = 20; // default cap; adjust if format known
                      const whole = Math.floor(match.overs);
                      const frac = Math.round((match.overs - whole) * 10);
                      const ballsBowled = whole * 6 + frac;
                      const totalBalls = oversCap * 6;
                      return Math.max(0, totalBalls - ballsBowled);
                    })();
                    const requiredRate =
                      requiredRuns != null && ballsRemaining != null && ballsRemaining > 0
                        ? (requiredRuns / ballsRemaining) * 6
                        : null;

                    const homeRole =
                      battingSide === "home"
                        ? "Batting"
                        : battingSide === "away"
                        ? "Bowling"
                        : null;
                    const awayRole =
                      battingSide === "away"
                        ? "Batting"
                        : battingSide === "home"
                        ? "Bowling"
                        : null;

                    const statusPill = isLive ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#DCFCE7] text-[#15803D] px-2 py-[3px] text-[11px] font-semibold border border-[#BBF7D0]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#15803D] live-blink" />
                        LIVE
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#FEF9C3] text-[#B45309] px-2 py-[3px] text-[11px] font-semibold border border-[#FDE68A]">
                        UPCOMING
                      </span>
                    );

                    const matchWinnerMarket: Market | null =
                      ((match.markets || []) as Market[]).find((m) => {
                        const name = String(
                          (m as any).market_name || m.name || ""
                        ).toLowerCase();
                        return (
                          name.includes("match winner") ||
                          name === "winner" ||
                          name === "win"
                        );
                      }) || null;

                    const normalizedMarket =
                      matchWinnerMarket && {
                        ...matchWinnerMarket,
                        name:
                          matchWinnerMarket.name ||
                          (matchWinnerMarket as any).market_name ||
                          "Match Winner",
                      };

                    const marketStatusRaw =
                      (matchWinnerMarket as any)?.status ||
                      (matchWinnerMarket as any)?.market_status ||
                      "";
                    const marketStatus = marketStatusRaw
                      ? String(marketStatusRaw).toUpperCase()
                      : "OPEN";
                    const bettingClosed =
                      status === "FINISHED" || marketStatus !== "OPEN";

                    const tossLine = getTossLine(match);

                    const countdownExact = formatCountdownExact(match.startTime);

                    const { homeRunner, awayRunner } = mapMatchWinnerRunners(
                      match,
                      matchWinnerMarket
                    );

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
                              score={null}
                              subline={homeRole}
                              extra={null}
                              align="left"
                            />
                            <div className="flex flex-col items-center justify-center text-center min-w-0">
                              {isLive && liveScore ? (
                                <>
                                  <span className="text-[18px] font-semibold font-mono tabular-nums text-[#0F172A]">
                                    {liveScore}
                                  </span>
                                  {liveOvers && (
                                    <span className="text-[12px] text-[#475569] font-mono tabular-nums">
                                      {liveOvers}
                                    </span>
                                  )}
                                </>
                              ) : (
                                countdownExact && (
                                  <span className="text-[13px] font-semibold font-mono tabular-nums text-[#0F172A]">
                                    {countdownExact}
                                  </span>
                                )
                              )}
                            </div>
                            <TeamBadge
                              name={match.awayTeam}
                              banner={match.awayTeamBanner}
                              score={null}
                              subline={awayRole}
                              extra={null}
                              align="right"
                            />
                          </div>
                        </div>

                        {(requiredRuns != null || tossLine) && (
                          <div className="pt-1 text-center">
                            {requiredRuns != null ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold text-[#0B8A5F] bg-[#ECFDF3] border border-[#BBF7D0]">
                                Need {requiredRuns} runs
                                {ballsRemaining != null && ` in ${ballsRemaining} balls`}
                                {requiredRate != null && (
                                  <span className="text-[#0B8A5F]/80"> (RR {requiredRate.toFixed(2)})</span>
                                )}
                              </span>
                            ) : (
                              tossLine && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold text-[#C81E3D] bg-[#FDE8EB] border border-[#C81E3D33]">
                                  {tossLine}
                                </span>
                              )
                            )}
                          </div>
                        )}

                        {/* Simple odds for Match Winner only */}
                        {(homeRunner || awayRunner) && (
                          <div
                            className="pt-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="grid grid-cols-2 gap-1.25">
                              {/* Home side odds */}
                              {homeRunner && (
                                <div className="space-y-1">
                                  <div className="grid grid-cols-2 gap-1">
                                    {(() => {
                                      const back = Number(
                                        (homeRunner as any).backOdds ??
                                          (homeRunner as any).back_odds ??
                                          0
                                      ).toFixed(2);
                                      const lay = Number(
                                        (homeRunner as any).layOdds ??
                                          (homeRunner as any).lay_odds ??
                                          0
                                      ).toFixed(2);

                                      return (
                                        <>
                                          <button
                                            className={cn(
                                              "rounded-md border border-[#34D399] bg-[#ECFDF3] py-2 text-center text-[13px] font-semibold text-[#065F46]",
                                              "hover:shadow-sm transition",
                                              bettingClosed &&
                                                "opacity-60 cursor-not-allowed"
                                            )}
                                            disabled={bettingClosed}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (bettingClosed) return;
                                              normalizedMarket &&
                                                handleBetSelect(
                                                  match,
                                                  normalizedMarket,
                                                  homeRunner,
                                                  "BACK",
                                                  Number(back)
                                                );
                                            }}
                                          >
                                            Back {back}
                                          </button>
                                          <button
                                            className={cn(
                                              "rounded-md border border-[#FECACA] bg-[#FEF2F2] py-2 text-center text-[13px] font-semibold text-[#991B1B]",
                                              "hover:shadow-sm transition",
                                              bettingClosed &&
                                                "opacity-60 cursor-not-allowed"
                                            )}
                                            disabled={bettingClosed}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (bettingClosed) return;
                                              normalizedMarket &&
                                                handleBetSelect(
                                                  match,
                                                  normalizedMarket,
                                                  homeRunner,
                                                  "LAY",
                                                  Number(lay)
                                                );
                                            }}
                                          >
                                            Lay {lay}
                                          </button>
                                        </>
                                      );
                                    })()}
                                  </div>
                                </div>
                              )}

                              {/* Away side odds */}
                              {awayRunner && (
                                <div className="space-y-1">
                                  <div className="grid grid-cols-2 gap-1">
                                    {(() => {
                                      const back = Number(
                                        (awayRunner as any).backOdds ??
                                          (awayRunner as any).back_odds ??
                                          0
                                      ).toFixed(2);
                                      const lay = Number(
                                        (awayRunner as any).layOdds ??
                                          (awayRunner as any).lay_odds ??
                                          0
                                      ).toFixed(2);

                                      return (
                                        <>
                                          <button
                                            className={cn(
                                              "rounded-md border border-[#34D399] bg-[#ECFDF3] py-2 text-center text-[13px] font-semibold text-[#065F46]",
                                              "hover:shadow-sm transition",
                                              bettingClosed &&
                                                "opacity-60 cursor-not-allowed"
                                            )}
                                            disabled={bettingClosed}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (bettingClosed) return;
                                              normalizedMarket &&
                                                handleBetSelect(
                                                  match,
                                                  normalizedMarket,
                                                  awayRunner,
                                                  "BACK",
                                                  Number(back)
                                                );
                                            }}
                                          >
                                            Back {back}
                                          </button>
                                          <button
                                            className={cn(
                                              "rounded-md border border-[#FECACA] bg-[#FEF2F2] py-2 text-center text-[13px] font-semibold text-[#991B1B]",
                                              "hover:shadow-sm transition",
                                              bettingClosed &&
                                                "opacity-60 cursor-not-allowed"
                                            )}
                                            disabled={bettingClosed}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (bettingClosed) return;
                                              normalizedMarket &&
                                                handleBetSelect(
                                                  match,
                                                  normalizedMarket,
                                                  awayRunner,
                                                  "LAY",
                                                  Number(lay)
                                                );
                                            }}
                                          >
                                            Lay {lay}
                                          </button>
                                        </>
                                      );
                                    })()}
                                  </div>
                                </div>
                              )}
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
          <BetSlip
            selectedBet={selectedBet}
            onClear={() => setSelectedBet(null)}
            variant="compact"
          />
        </div>
      )}

      {/* Mobile bet slip drawer */}
      <Sheet
        open={!!selectedBet && isMobile}
        onOpenChange={(open) => !open && setSelectedBet(null)}
      >
        <SheetContent side="bottom" className="rounded-t-3xl p-0 h-auto pb-6">
          <SheetTitle className="sr-only">Bet Slip</SheetTitle>
          <SheetDescription className="sr-only">
            Choose your selection, stake, and place the bet.
          </SheetDescription>
          <div className="p-3">
            <MobileBetSlip
              selectedBet={selectedBet}
              onClear={() => setSelectedBet(null)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}
