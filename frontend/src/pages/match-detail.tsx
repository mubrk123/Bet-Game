import { AppShell } from "@/components/layout/AppShell";
import { useStore } from "@/lib/store";
import type { Match, Market } from "@/lib/store";
import { useRoute, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Activity, Clock3, X } from "lucide-react";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type InstanceMarket, type InstanceOutcome } from "@/lib/api";
import { wsClient } from "@/lib/websocket";
import type { MatchScoreUpdate, BallResult } from "@shared/realtime";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

/* =========================
   Helpers + Types
========================= */
type BallEventRow = {
  inning: number;
  over: number;
  ball: number;
  sub_ball: number;
  ball_key?: string;
  is_legal: boolean;
  batsman_name: string;
  non_striker_name: string;
  bowler_name: string;
  runs: number;
  extras: number;
  total_runs: number;
  is_wicket: boolean;
  is_extra: boolean;
  extra_type: string | null;
  is_boundary: boolean;
  is_six: boolean;
  created_at: string;
};

function dedupeBallEvents(list: BallEventRow[]): BallEventRow[] {
  const seen = new Set<string>();
  const result: BallEventRow[] = [];
  for (const ev of list) {
    const key = ev.ball_key
      ? `k:${ev.ball_key}`
      : `t:${ev.inning}-${ev.over}-${ev.ball}-${ev.sub_ball}-${ev.created_at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ev);
  }
  return result;
}

type PulseChip = {
  label: string;
  kind: "RESULT" | "UPCOMING";
  muted?: boolean;
  emphasize?: boolean;
  subLabel?: string;
};

type SquadSide = {
  playingXi: string[];
  bench: string[];
  captain?: string | null;
  keeper?: string | null;
};

type Squads = {
  home: SquadSide | null;
  away: SquadSide | null;
};

type RealtimeUpdate = {
  inning?: number;
  currentInnings?: number;
  battingTeam?: string;
  runs?: number;
  wickets?: number;
  strikerRuns?: number;
  strikerBalls?: number;
  nonStrikerRuns?: number;
  nonStrikerBalls?: number;
  currentOver?: number;
  currentBall?: number;
  targetRuns?: number;
  scoreDetails?: string;
  [key: string]: any;
};

function toNum(v: any, fallback = 0) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeTeamName(s: string | null | undefined) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function fuzzyTeamMatch(a: string | null | undefined, b: string | null | undefined) {
  const A = normalizeTeamName(a);
  const B = normalizeTeamName(b);
  if (!A || !B) return false;
  if (A === B) return true;
  return A.includes(B) || B.includes(A);
}

function strictTeamEquals(a: string | null | undefined, b: string | null | undefined) {
  const A = normalizeTeamName(a);
  const B = normalizeTeamName(b);
  return !!A && !!B && A === B;
}

function getTossWinner(match: any): string | null {
  return (
    match?.toss_won_by ||
    match?.tossWinnerTeam ||
    match?.toss_winner_team ||
    match?.tossWinner ||
    match?.toss_winner ||
    match?.tossWinnerName ||
    null
  );
}

function getTossDecision(match: any): string | null {
  return (
    match?.elected_to ||
    match?.tossDecision ||
    match?.toss_decision ||
    match?.tossElected ||
    match?.toss_elected ||
    null
  );
}

function mapToHomeAwayTeam(raw: string | null | undefined, home: string, away: string): string | null {
  if (!raw) return null;
  if (strictTeamEquals(raw, home)) return home;
  if (strictTeamEquals(raw, away)) return away;
  if (fuzzyTeamMatch(raw, home)) return home;
  if (fuzzyTeamMatch(raw, away)) return away;
  return null;
}

function resolvePlayerName(players: Record<string, any> | null | undefined, key?: string | null) {
  if (!key) return null;
  const p = players?.[key];
  return (
    p?.player?.name ||
    p?.name ||
    p?.short_name ||
    p?.full_name ||
    p?.player_name ||
    key
  );
}

function extractSquadSide(node: any, players: Record<string, any> | null | undefined): SquadSide | null {
  if (!node) return null;
  const playingKeys = Array.isArray(node.playing_xi) ? node.playing_xi : [];
  const allKeys = Array.isArray(node.player_keys) ? node.player_keys : playingKeys;
  const benchKeys = allKeys.filter((k: string) => !playingKeys.includes(k));
  const mapName = (k: string) => resolvePlayerName(players, k) || k;

  return {
    playingXi: playingKeys.map(mapName),
    bench: benchKeys.map(mapName),
    captain: resolvePlayerName(players, node.captain),
    keeper: resolvePlayerName(players, node.keeper),
  };
}

function extractSquadsFromPayload(payload: any): Squads {
  if (!payload?.squad) return { home: null, away: null };
  const players = payload.players || {};
  const squad = payload.squad || {};
  return {
    home: extractSquadSide(squad.a, players),
    away: extractSquadSide(squad.b, players),
  };
}

function teamInitials(name: string) {
  if (!name) return "";
  const parts = name.trim().split(/\s+/);
  const initials = parts.map((p) => p[0] || "").join("");
  return initials.slice(0, 3).toUpperCase();
}

function formatMatchTime(dateStr: string | null | undefined) {
  if (!dateStr) return "Time TBA";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "Time TBA";
  return d.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function dicebearFor(name: string) {
  return `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(
    name || "team"
  )}&backgroundColor=0f172a&fontWeight=700`;
}

function TeamBadge({ name, banner }: { name: string; banner?: string | null }) {
  const [imgError, setImgError] = useState(false);
  const resolvedBanner = banner || dicebearFor(name);
  const showFallback = imgError || !resolvedBanner;

  return (
    <div className="flex flex-col items-center gap-1.5">
      {showFallback ? (
        <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-full bg-white/5 border border-white/15 flex items-center justify-center text-sm sm:text-base font-semibold text-white">
          {teamInitials(name)}
        </div>
      ) : (
        <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-full bg-white/5 border border-white/15 overflow-hidden flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={resolvedBanner}
            alt={name}
            className="h-full w-full object-contain p-1"
            onError={() => setImgError(true)}
            loading="lazy"
            crossOrigin="anonymous"
            referrerPolicy="no-referrer"
          />
        </div>
      )}
      <p className="text-[11px] sm:text-xs text-white/80 text-center max-w-[120px] truncate">{name}</p>
    </div>
  );
}

function extractTossWinner(source: any): string | null {
  return (
    source?.toss_won_by ||
    source?.tossWinnerTeam ||
    source?.toss_winner_team ||
    source?.tossWinner ||
    source?.toss_winner ||
    source?.tossWinnerName ||
    null
  );
}

function extractTossDecision(source: any): string | null {
  return (
    source?.elected_to ||
    source?.tossDecision ||
    source?.toss_decision ||
    source?.tossElected ||
    source?.toss_elected ||
    null
  );
}

function formatTossLine(winner: string, decision: string) {
  const d = String(decision).toLowerCase();
  const pretty = d.includes("bat") ? "bat" : d.includes("bowl") ? "bowl" : String(decision);
  return `Toss: ${winner} won & elected to ${pretty}`;
}

function getTossLine(...sources: any[]): string | null {
  for (const src of sources) {
    if (!src) continue;
    const winner = extractTossWinner(src);
    const decision = extractTossDecision(src);
    if (winner && decision) return formatTossLine(winner, decision);
  }
  return null;
}

function formatScoreCompact(runs?: number | null, wickets?: number | null) {
  if (runs === null || runs === undefined) return null;
  const w = wickets ?? 0;
  return `${runs}/${w}`;
}

function formatOversCompact(over?: number, ball0to5?: number) {
  if (over === undefined || over === null) return null;
  const b = ball0to5 ?? 0;
  return `${over}.${b}`;
}

function scoreStringHasValue(score?: string | null) {
  if (!score) return false;
  return /\d/.test(String(score));
}

function normalizeOverValue(over?: number | null, ball?: number | null) {
  if (over === undefined || over === null) return null;
  const o = Number(over);
  if (!Number.isFinite(o)) return null;
  const b = Number.isFinite(ball as number) ? Number(ball) : 0;
  return o + b / 10;
}

function parseScoreDetailsCompact(details: string | null | undefined): {
  runs: number | null;
  wkts: number | null;
  oversText: string | null;
} {
  if (!details) return { runs: null, wkts: null, oversText: null };
  const s = String(details);
  const score = s.match(/(\d+)\s*\/\s*(\d+)/);
  const runs = score?.[1] ? Number(score[1]) : null;
  const wkts = score?.[2] ? Number(score[2]) : null;

  const ov1 = s.match(/\((\d+(?:[\.,]\d+)?)\s*ov\)/i);
  const ov2 = s.match(/(\d+(?:[\.,]\d+)?)\s*ov/i);
  const ov3 = s.match(/\((\d+)[\.,](\d+)\)/);
  const oversRaw = ov1?.[1] || ov2?.[1] || (ov3 ? `${ov3[1]}.${ov3[2]}` : null);
  const oversText = oversRaw ? oversRaw.replace(",", ".") : null;

  return { runs, wkts, oversText };
}

function parseScoreDetailsInnings(details: string | null | undefined, home: string, away: string) {
  if (!details) return [];
  const parts = String(details)
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);

  return parts
    .map((part) => {
      const m1 = part.match(/^(.*?)[\s:-]+(\d+)\s*\/\s*(\d+)\s*\(([\d\.,]+)\s*ov/i);
      const m2 = part.match(/^(.*?)[\s:-]+(\d+)\s*\/\s*(\d+)/i);
      const rawTeam = (m1?.[1] || m2?.[1] || "").trim();
      if (!rawTeam) return null;
      const mappedTeam = mapToHomeAwayTeam(rawTeam, home, away);
      const runs = m1?.[2] ?? m2?.[2];
      const wkts = m1?.[3] ?? m2?.[3];
      const overs = m1?.[4];
      return {
        rawTeam,
        team: mappedTeam,
        runs: runs ? Number(runs) : null,
        wkts: wkts ? Number(wkts) : null,
        overs: overs ? Number(overs) : null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x && x.team));
}

function battingSideFromScores(match: any, liveScore?: MatchScoreUpdate | null, realtime?: RealtimeUpdate | null) {
  const home = match?.homeTeam || "";
  const away = match?.awayTeam || "";
  if (!home || !away) return null;

  const scoreDetails = liveScore?.scoreDetails ?? realtime?.scoreDetails ?? match?.scoreDetails;
  const details = realtime?.scoreDetails || liveScore?.scoreDetails || match?.scoreDetails || "";

  const homeStarted = scoreStringHasValue(scoreDetails);
  const awayStarted = scoreStringHasValue(scoreDetails);

  if (homeStarted && !awayStarted) return home;
  if (!homeStarted && awayStarted) return away;

  if (details) {
    const innings = parseScoreDetailsInnings(details, home, away);
    const currentOvers = normalizeOverValue(
      realtime?.currentOver ?? liveScore?.currentOver ?? match?.currentOver,
      realtime?.currentBall ?? liveScore?.currentBall ?? match?.currentBall
    );

    if (innings.length >= 2) {
      const withOvers = innings.filter((i) => Number.isFinite(i.overs));
      if (currentOvers !== null && withOvers.length > 0) {
        const closest = withOvers.reduce((best, curr) => {
          if (!best) return curr;
          const dBest = Math.abs((best.overs ?? 0) - currentOvers);
          const dCurr = Math.abs((curr.overs ?? 0) - currentOvers);
          return dCurr < dBest ? curr : best;
        }, withOvers[0]);
        if (closest?.team) return closest.team;
      }
      const last = innings[innings.length - 1];
      if (last?.team) return last.team;
    } else if (innings.length === 1) {
      return innings[0].team || null;
    }

    if (fuzzyTeamMatch(details, home)) return home;
    if (fuzzyTeamMatch(details, away)) return away;
  }
  return null;
}

/* =========================
   ✅ LEGAL BALL LOGIC
========================= */
function normalizeExtraTypeShort(extraType: string | null | undefined) {
  const s = String(extraType ?? "").toLowerCase().trim();
  if (!s) return null;
  if (s.includes("wide") || s === "wd") return "Wd";
  if ((s.includes("no") && s.includes("ball")) || s === "nb" || s === "noball") return "Nb";
  if (s === "bye") return "B";
  if (s.includes("leg") && s.includes("bye")) return "Lb";
  return null;
}
function countsAsLegalBall(ev: BallEventRow) {
  return ev.is_legal === true;
}
function outcomeFromBallEvent(ev: BallEventRow) {
  const extraShort = ev.is_extra ? normalizeExtraTypeShort(ev.extra_type) : null;
  if (extraShort) {
    const total = toNum(ev.total_runs, toNum(ev.runs) + toNum(ev.extras));
    if ((extraShort === "Wd" || extraShort === "Nb") && total > 1) return `${extraShort}+${total}`;
    return extraShort;
  }
  if (ev.is_wicket) return "W";
  if (ev.is_six) return "6";
  if (ev.is_boundary) return "4";
  const total = toNum(ev.total_runs, toNum(ev.runs) + toNum(ev.extras));
  if (total === 0) return "0";
  return String(total);
}

// Exported to avoid noUnusedLocals while keeping the helper around
export function ballResultToEvent(b: BallResult, inning: number): BallEventRow {
  const total = toNum(b.totalRuns, b.runsScored + toNum(b.extras));
  const isBoundary = b.isBoundary || total === 4;
  const isSix = b.isSix || total === 6;
  const extraType = b.isExtra ? b.outcome ?? "extra" : null;

  return {
    inning: toNum(b.inning, inning),
    over: toNum(b.over, 0),
    ball: toNum(b.ball, 0),
    sub_ball: toNum(b.subBall, 0),
    is_legal: b.isLegal ?? !b.isExtra,
    batsman_name: b.batsmanName || "—",
    non_striker_name: "—",
    bowler_name: b.bowlerName || "—",
    runs: toNum(b.runsScored, 0),
    extras: toNum(b.extras, 0),
    total_runs: total,
    is_wicket: !!b.isWicket,
    is_extra: !!b.isExtra,
    extra_type: extraType,
    is_boundary: !!isBoundary,
    is_six: !!isSix,
    created_at: new Date(b.timestamp || Date.now()).toISOString(),
  };
}

function isPlaceholderBall(over: number, ball: number, totalRuns: number, isWicket: boolean) {
  return over === 0 && ball === 0 && totalRuns === 0 && !isWicket;
}

export function outcomeFromBallResult(b: BallResult) {
  const normalizedExtra = normalizeExtraTypeShort(b.outcome);
  if (normalizedExtra) return normalizedExtra;
  if (b.outcome) {
    const outcome = b.outcome.toUpperCase();
    if (outcome.includes("NO BALL") || outcome.includes("NOBALL")) return "Nb";
    if (outcome.includes("WIDE") || outcome === "WD") return "Wd";
    if (outcome.includes("WICKET") || outcome === "W") return "W";
    if (outcome.includes("SIX") || outcome === "6") return "6";
    if (outcome.includes("FOUR") || outcome === "4") return "4";
    if (outcome.includes("DOT") || outcome === "0") return "0";
    if (["1", "2", "3", "5"].includes(outcome)) return outcome;
  }
  if (b.isExtra) {
    const txt = String(b.outcome ?? "").toLowerCase();
    if ((txt.includes("no") && txt.includes("ball")) || txt.includes("nb")) return "Nb";
    return "Wd";
  }
  if (b.isWicket) return "W";
  if (b.isSix) return "6";
  if (b.isBoundary) return "4";
  if (b.runsScored === 0 && !b.isExtra) return "0";
  return b.runsScored > 0 ? String(b.runsScored) : "0";
}

function chipStyle(label: string, muted = false) {
  const baseMuted = muted ? "opacity-45" : "opacity-100";
  if (label === "W") return `bg-amber-400 text-amber-950 font-bold shadow-[0_8px_18px_rgba(0,0,0,0.5)] ${baseMuted}`;
  if (label.startsWith("Wd")) return `bg-violet-500/85 text-white font-bold shadow-[0_8px_18px_rgba(0,0,0,0.5)] ${baseMuted}`;
  if (label.startsWith("Nb")) return `bg-fuchsia-500/85 text-white font-bold shadow-[0_8px_18px_rgba(0,0,0,0.5)] ${baseMuted}`;
  if (label === "6") return `bg-red-500/85 text-white font-bold shadow-[0_8px_18px_rgba(0,0,0,0.5)] ${baseMuted}`;
  if (label === "4") return `bg-emerald-400/85 text-emerald-950 font-bold shadow-[0_8px_18px_rgba(0,0,0,0.5)] ${baseMuted}`;
  if (label === "0") return `bg-emerald-700/60 text-white font-bold shadow-[0_8px_18px_rgba(0,0,0,0.5)] ${baseMuted}`;
  const n = Number(label);
  if (Number.isFinite(n) && n > 0) return `bg-sky-500/40 text-white font-semibold ${baseMuted}`;
  return `bg-white/[0.02] text-white/70 border border-white/10 ${baseMuted}`;
}

function deriveFromBallEvents(events: BallEventRow[], activeInning: number) {
  if (!events || events.length === 0) {
    return {
      striker: { name: "—", runs: "—", balls: "—" },
      nonStriker: { name: "—", runs: "—", balls: "—" },
      bowler: { name: "—", runs: 0, wkts: 0, econ: "", overs: "—", maidens: 0, fig: "—", compact: "—" },
    };
  }

  const inningEvents = events
    .filter((e) => toNum(e.inning, 1) === activeInning)
    .slice()
    .sort((a, b) => {
      const ta = Date.parse(a.created_at ?? "") || 0;
      const tb = Date.parse(b.created_at ?? "") || 0;
      if (tb !== ta) return tb - ta;
      const aOver = Math.floor(toNum(a.over, 0));
      const bOver = Math.floor(toNum(b.over, 0));
      if (aOver !== bOver) return bOver - aOver;
      return toNum(b.ball, 0) - toNum(a.ball, 0);
    });

  if (inningEvents.length === 0) {
    return {
      striker: { name: "—", runs: "—", balls: "—" },
      nonStriker: { name: "—", runs: "—", balls: "—" },
      bowler: { name: "—", runs: 0, wkts: 0, econ: "", overs: "—", maidens: 0, fig: "—", compact: "—" },
    };
  }

  const latest = inningEvents[0];
  const bowlerName = (latest.bowler_name || "").trim() || "—";
  const strikerName = (latest.batsman_name || "").trim() || "—";
  const nonStrikerFromField = (latest.non_striker_name || "").trim();
  const nonStrikerName =
    nonStrikerFromField ||
    inningEvents.find((e) => {
      const bn = (e.batsman_name || "").trim();
      return bn && bn !== strikerName && bn !== bowlerName;
    })?.batsman_name?.trim() ||
    "—";

  const batsmanStats = (name: string) => {
    if (!name || name === "—") return { runs: "—", balls: "—" };
    const rows = inningEvents.filter((e) => (e.batsman_name || "").trim() === name);
    const runs = rows.reduce((acc, e) => acc + toNum(e.runs), 0);
    const balls = rows.filter(countsAsLegalBall).length;
    return { runs: String(runs), balls: String(balls) };
  };

  const strikerStats = batsmanStats(strikerName);
  const nonStrikerStats = batsmanStats(nonStrikerName);

  const bowlerRows = inningEvents.filter((e) => (e.bowler_name || "").trim() === bowlerName);
  const runsConceded = bowlerRows.reduce((acc, e) => acc + toNum(e.total_runs, toNum(e.runs) + toNum(e.extras)), 0);
  const legalBalls = bowlerRows.filter(countsAsLegalBall).length;
  const overs = `${Math.floor(legalBalls / 6)}.${legalBalls % 6}`;
  const wkts = bowlerRows.filter((e) => !!e.is_wicket).length;

  const overMap = new Map<number, number>();
  for (const r of bowlerRows) {
    const overNum = Math.floor(toNum(r.over, 0));
    overMap.set(overNum, (overMap.get(overNum) || 0) + toNum(r.total_runs, toNum(r.runs) + toNum(r.extras)));
  }
  const maidens = Array.from(overMap.values()).filter((sum) => sum === 0).length;
  const econ = legalBalls > 0 ? ((runsConceded * 6) / legalBalls).toFixed(1) : "";
  const compact = econ ? `${runsConceded}-${wkts}-${econ}` : `${runsConceded}-${wkts}-—`;

  return {
    striker: { name: strikerName, ...strikerStats },
    nonStriker: { name: nonStrikerName, ...nonStrikerStats },
    bowler: { name: bowlerName, runs: runsConceded, wkts, econ, overs, maidens, fig: `${overs}-${maidens}-${runsConceded}-${wkts}`, compact },
  };
}

function deriveScoreFromBallEvents(events: BallEventRow[], activeInning: number) {
  if (!events || events.length === 0) return null;

  const inningEvents = events
    .filter((e) => toNum(e.inning, 1) === activeInning)
    .slice()
    .sort((a, b) => (Date.parse(b.created_at ?? "") || 0) - (Date.parse(a.created_at ?? "") || 0));

  if (inningEvents.length === 0) return null;

  let runs = 0;
  let wkts = 0;
  let legalBalls = 0;

  for (const e of inningEvents) {
    const totalForBall = toNum(e.total_runs, toNum(e.runs) + toNum(e.extras));
    runs += totalForBall;
    if (e.is_wicket) wkts += 1;
    if (countsAsLegalBall(e)) legalBalls += 1;
  }

  const over = Math.floor(legalBalls / 6);
  const ball0to5 = legalBalls % 6;
  return { inning: activeInning, runs, wkts, over, ball0to5, legalBalls };
}

function parseTarget(details: string | null | undefined): number | null {
  if (!details) return null;
  const s = details.toLowerCase();
  const m1 = s.match(/target[:\s]+(\d+)/i);
  if (m1?.[1]) return Number(m1[1]);
  const m2 = s.match(/(\d+)\s+runs?\s+to\s+win/i);
  if (m2?.[1]) return Number(m2[1]);
  return null;
}

function parseRequired(details: string | null | undefined): { runs: number; balls: number } | null {
  if (!details) return null;
  const m1 = details.match(/(\d+)\s+runs?\s+required\s+from\s+(\d+)\s+balls/i);
  if (m1?.[1] && m1?.[2]) return { runs: Number(m1[1]), balls: Number(m1[2]) };
  const m2 = details.match(/need\s+(\d+)\s+runs?\s+in\s+(\d+)\s+balls/i);
  if (m2?.[1] && m2?.[2]) return { runs: Number(m2[1]), balls: Number(m2[2]) };
  const m3 = details.match(/requires?\s+(\d+)\s+runs?\s+in\s+(\d+)\s+balls/i);
  if (m3?.[1] && m3?.[2]) return { runs: Number(m3[1]), balls: Number(m3[2]) };
  return null;
}

/* =========================
   UI helpers (compact markets)
========================= */
function CompactMarketGrid({
  market,
  title,
  onPick,
  selectedOutcomeId,
  timeRemaining,
  maxCells = 6,
}: {
  market: InstanceMarket;
  title?: string | null;
  onPick: (m: InstanceMarket, o: InstanceOutcome) => void;
  selectedOutcomeId?: string | null;
  timeRemaining: (closeTime?: string | null) => string;
  maxCells?: number;
}) {
  const outcomes = (market?.outcomes ?? []).slice(0, maxCells);

  // 3 columns always; 6 outcomes -> 2 rows. If fewer, still table-like.
  return (
    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/5 p-2 shadow-[0_14px_32px_rgba(0,0,0,0.35)]">
      <div className="flex items-center justify-between gap-2">
        {/* ultra-compact title (optional, no big heading line) */}
        {title ? <div className="text-[11px] text-white/75 truncate">{title}</div> : <div />}
        <Badge className="bg-white/10 text-emerald-200 border-emerald-400/40 flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full">
          <Clock3 className="h-3 w-3" />
          {timeRemaining(market.close_time)}
        </Badge>
      </div>

      <div className="mt-2 overflow-hidden rounded-xl border border-white/10">
        <div className="grid grid-cols-3">
          {outcomes.map((o, idx) => {
            const selected = selectedOutcomeId === o.id;
            const isRowTop = idx < 3;
            return (
              <button
                key={o.id}
                onClick={() => onPick(market, o)}
                className={cn(
                  "group text-left bg-white/[0.03] hover:bg-white/[0.06] transition",
                  "px-2 py-1.5 min-h-[44px] flex flex-col justify-center",
                  idx % 3 !== 2 && "border-r border-white/10",
                  isRowTop && "border-b border-white/10",
                  selected && "bg-emerald-500/10 ring-1 ring-emerald-400/60"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-white/85 truncate">{o.name}</span>
                  <span className="font-mono tabular-nums text-[13px] font-bold text-emerald-300">
                    {Number(o.odds).toFixed(2)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between">
                  <span className="text-[10px] text-white/45">Tap to bet</span>
                  <span className="text-[10px] text-white/35 group-hover:text-white/55">▶</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function QuickBetSheet({
  open,
  market,
  outcome,
  stake,
  setStake,
  onClose,
  onPlace,
}: {
  open: boolean;
  market: InstanceMarket | null;
  outcome: InstanceOutcome | null;
  stake: string;
  setStake: (v: string) => void;
  onClose: () => void;
  onPlace: () => void;
}) {
  if (!open || !market || !outcome) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* overlay */}
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} />

      {/* compact bottom sheet */}
      <div className="absolute inset-x-0 bottom-2 px-3 sm:px-4">
        <div className="rounded-2xl border border-white/10 bg-slate-950/80 backdrop-blur-xl shadow-[0_18px_44px_rgba(0,0,0,0.75)]">
          <div className="p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white truncate">
                  {outcome.name} @ {Number(outcome.odds).toFixed(2)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={onClose}>
                  <X className="h-4 w-4 text-white/80" />
                </Button>
                <Button size="sm" className="h-8 px-3 rounded-xl" onClick={onPlace}>
                  Place bet
                </Button>
              </div>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                className="w-24 rounded-xl bg-black/40 border border-white/15 px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-400/60"
                value={stake}
                min={1}
                onChange={(e) => setStake(e.target.value)}
              />
              <div className="flex items-center gap-1.5">
                {[50, 100, 200].map((amt) => (
                  <Button
                    key={amt}
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-[11px] border border-white/10 bg-white/5"
                    onClick={() => setStake(String(amt))}
                  >
                    ₹{amt}
                  </Button>
                ))}
              </div>
              <div className="flex-1" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreMatchBetSheet({
  open,
  runner,
  stake,
  setStake,
  onClose,
  onPlace,
  setType,
}: {
  open: boolean;
  runner: { name: string; backOdds: number; layOdds: number | null; type: "BACK" | "LAY" } | null;
  stake: string;
  setStake: (v: string) => void;
  onClose: () => void;
  onPlace: () => void;
  setType: (t: "BACK" | "LAY") => void;
}) {
  if (!open || !runner) return null;

  const hasLay = Number.isFinite(runner.layOdds) && (runner.layOdds ?? 0) > 1.01;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-2 px-3 sm:px-4">
        <div className="rounded-2xl border border-white/10 bg-slate-950/80 backdrop-blur-xl shadow-[0_18px_44px_rgba(0,0,0,0.75)]">
          <div className="p-3 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white truncate">{runner.name}</div>
                <div className="text-[11px] text-white/65">
                  <span
                    className={cn(
                      "mr-2 px-2 py-0.5 rounded-full text-[10px] border",
                      runner.type === "BACK"
                        ? "bg-emerald-500/20 border-emerald-400/60 text-emerald-100"
                        : "bg-white/5 border-white/15 text-white/65"
                    )}
                    onClick={() => setType("BACK")}
                    role="button"
                    tabIndex={0}
                  >
                    Back {runner.backOdds.toFixed(2)}
                  </span>
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded-full text-[10px] border cursor-pointer",
                      runner.type === "LAY"
                        ? "bg-amber-500/20 border-amber-400/60 text-amber-100"
                        : "bg-white/5 border-white/15 text-white/65",
                      !hasLay && "opacity-40 cursor-not-allowed"
                    )}
                    onClick={() => hasLay && setType("LAY")}
                    role="button"
                    tabIndex={0}
                  >
                    Lay {hasLay ? (runner.layOdds as number).toFixed(2) : "—"}
                  </span>
                </div>
              </div>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={onClose}>
                <X className="h-4 w-4 text-white/80" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                className="w-28 rounded-xl bg-black/40 border border-white/15 px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-400/60"
                value={stake}
                min={1}
                onChange={(e) => setStake(e.target.value)}
              />
              <div className="flex items-center gap-1.5">
                {[100, 250, 500].map((amt) => (
                  <Button
                    key={amt}
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-[11px] border border-white/10 bg-white/5"
                    onClick={() => setStake(String(amt))}
                  >
                    ₹{amt}
                  </Button>
                ))}
              </div>
              <div className="flex-1" />
              <Button size="sm" className="h-9 px-3 rounded-xl" onClick={onPlace}>
                Place {runner.type === "BACK" ? "Back" : "Lay"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================
   Component
========================= */
export default function MatchDetail() {
  const [, params] = useRoute("/match/:id");
  const matchId = String(params?.id ?? "");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dbMatchId, setDbMatchId] = useState<string | null>(null);

  const storeMatch = useStore((state) => state.matches.find((m) => m.id === params?.id));
  const setMatches = useStore((state) => state.setMatches);
  const matches = useStore((state) => state.matches);
  const currentUser = useStore((state) => state.currentUser);
  const setCurrentUser = useStore((state) => state.setCurrentUser);
  const [marketsOverride, setMarketsOverride] = useState<Market[] | null>(null);

  const [liveScore, setLiveScore] = useState<MatchScoreUpdate | null>(null);
  const [lastBall, setLastBall] = useState<BallResult | null>(null);

  const [scorePulse, setScorePulse] = useState(false);
  const [nowTs, setNowTs] = useState(() => Date.now());

  const [instanceStake, setInstanceStake] = useState("50");
  const [selectedOutcome, setSelectedOutcome] = useState<InstanceOutcome | null>(null);
  const [selectedMarket, setSelectedMarket] = useState<InstanceMarket | null>(null);
  const [selectedRunner, setSelectedRunner] = useState<{
    marketId: string;
    runnerId: string;
    runnerName: string;
    backOdds: number;
    layOdds: number | null;
    type: "BACK" | "LAY";
  } | null>(null);
  const [winnerStake, setWinnerStake] = useState("100");
  const [activeTab, setActiveTab] = useState<"winner" | "live" | "session">("winner");

  useEffect(() => {
    wsClient.connect();
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const { data: fetchedMatch, isLoading: isLoadingMatch } = useQuery({
    queryKey: ["match", params?.id],
    queryFn: async () => {
      if (!params?.id) return null;
      try {
        const result = await api.getCurrentCricketMatches();
        const found = result.matches.find((m) => m.id === params.id);
        if (!found) return null;

        const converted: Match = {
          ...found,
          markets: found.markets.map((market) => ({
            ...market,
            runners: market.runners.map((runner) => ({
              ...runner,
              backOdds: typeof runner.backOdds === "string" ? parseFloat(runner.backOdds) : runner.backOdds,
              layOdds: typeof runner.layOdds === "string" ? parseFloat(runner.layOdds) : runner.layOdds,
            })),
          })),
        };
        return converted;
      } catch {
        return null;
      }
    },
    enabled: !!params?.id && !storeMatch,
    staleTime: 10000,
  });

  const baseMatch = storeMatch || fetchedMatch;

  useQuery({
    queryKey: ["markets", dbMatchId],
    enabled: Boolean(dbMatchId),
    queryFn: async () => {
      if (!dbMatchId) return [];
      const { markets } = await api.getMatchMarkets(dbMatchId);
      setMarketsOverride(markets);
      return markets;
    },
    staleTime: 5000,
  });

  const matchWithMarkets = useMemo(() => {
    if (!baseMatch) return null;
    if (marketsOverride) return { ...baseMatch, markets: marketsOverride };
    return baseMatch;
  }, [baseMatch, marketsOverride]);

  const match = matchWithMarkets;

  useEffect(() => {
    if (fetchedMatch && !storeMatch) setMatches([...matches, fetchedMatch]);
  }, [fetchedMatch, storeMatch, matches, setMatches]);

  useEffect(() => {
    let cancelled = false;
    async function resolveId() {
      if (!matchId) {
        if (!cancelled) setDbMatchId(null);
        return;
      }
      const looksLikeUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(matchId);

      if (looksLikeUuid) {
        if (!cancelled) setDbMatchId(matchId);
        return;
      }

      const { data, error } = await supabase.from("matches").select("id").eq("ro_match_key", matchId).maybeSingle();
      if (!cancelled) {
        if (error) {
          console.error("Failed to resolve match id from ro_match_key", error);
          setDbMatchId(null);
        } else {
          setDbMatchId((data as any)?.id ?? null);
        }
      }
    }
    resolveId();
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  const [countdown, setCountdown] = useState("");
  useEffect(() => {
    if (!match?.startTime || match.status === "LIVE") {
      setCountdown("");
      return;
    }
    const update = () => {
      const start = new Date(match.startTime!).getTime();
      const diff = start - Date.now();
      if (diff <= 0) {
        setCountdown("Starting soon");
        return;
      }
      const totalSeconds = Math.floor(diff / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      setCountdown(
        `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
      );
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [match?.startTime, match?.status]);

  const { data: realtimeData } = useQuery({
    queryKey: ["realtime", params?.id],
    queryFn: async () => {
      if (!params?.id) return null;
      try {
        const response = await api.getRealtimeUpdate(params.id);
        return response as RealtimeUpdate;
      } catch {
        return null;
      }
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 15_000,
    enabled: Boolean(params?.id),
  });

  const [ballFeed, setBallFeed] = useState<BallEventRow[]>([]);
  useQuery({
    queryKey: ["ball-events", dbMatchId],
    enabled: Boolean(dbMatchId),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    queryFn: async () => {
      if (!dbMatchId) return [];
      const { data, error } = await supabase
        .from("ball_events")
        .select(
          "ro_inning_number, ro_over_number, ro_ball_in_over, ro_sub_ball_number, ro_ball_key, ro_is_legal_delivery, ro_batsman_name, ro_non_striker_name, ro_bowler_name, ro_batsman_runs, ro_extras_runs, ro_total_runs, ro_is_wicket, ro_extra_type, ro_is_boundary, ro_is_six, ro_batsman_key, ro_non_striker_key, ro_bowler_key, created_at"
        )
        .eq("match_id", dbMatchId)
        .or("ro_is_deleted.is.null,ro_is_deleted.eq.false")
        .order("created_at", { ascending: false })
        .limit(250);

      if (error) throw error;

      // Map keys -> names from players table once per fetch
      const keys = Array.from(
        new Set(
          (data || [])
            .flatMap((row: any) => [row.ro_batsman_key, row.ro_non_striker_key, row.ro_bowler_key])
            .filter(Boolean)
            .map(String)
        )
      );

      let nameMap: Record<string, string> = {};
      if (keys.length) {
        const { data: players, error: pErr } = await supabase
          .from("players")
          .select("ro_player_key, ro_player_name")
          .in("ro_player_key", keys);
        if (!pErr && players) {
          nameMap = Object.fromEntries(
            players
              .filter((p: any) => p?.ro_player_key)
              .map((p: any) => [String(p.ro_player_key), p.ro_player_name || String(p.ro_player_key)])
          );
        }
      }

      const mapped = (data ?? []).map((row: any) => {
        const extraShort = normalizeExtraTypeShort(row.ro_extra_type);
        const over = Number(row.ro_over_number ?? 0);
        const ballNum = Number(row.ro_ball_in_over ?? 0);
        const totalRunsNum = Number(row.ro_total_runs ?? 0);
        const wicket = !!row.ro_is_wicket;
        if (isPlaceholderBall(over, ballNum, totalRunsNum, wicket)) return null;
        return {
          inning: Number(row.ro_inning_number ?? 1),
          over,
          ball: ballNum,
          sub_ball: Number(row.ro_sub_ball_number ?? 0),
          ball_key: row.ro_ball_key || undefined,
          is_legal: row.ro_is_legal_delivery ?? true,
          batsman_name: row.ro_batsman_name || nameMap[row.ro_batsman_key] || row.ro_batsman_key || "—",
          non_striker_name: row.ro_non_striker_name || nameMap[row.ro_non_striker_key] || row.ro_non_striker_key || "—",
          bowler_name: row.ro_bowler_name || nameMap[row.ro_bowler_key] || row.ro_bowler_key || "—",
          runs: Number(row.ro_batsman_runs ?? 0),
          extras: Number(row.ro_extras_runs ?? 0),
          total_runs: totalRunsNum,
          is_wicket: wicket,
          is_extra: (row.ro_extras_runs ?? 0) > 0 || !!extraShort,
          extra_type: extraShort ? row.ro_extra_type ?? null : null,
          is_boundary: !!row.ro_is_boundary,
          is_six: !!row.ro_is_six,
          created_at: row.created_at,
        };
      }).filter(Boolean) as BallEventRow[];

      const deduped = dedupeBallEvents(mapped);
      setBallFeed(deduped);
      return deduped;
    },
  });

const { data: instanceMarkets = [], refetch: refetchInstanceMarkets } = useQuery<InstanceMarket[]>({
  queryKey: ["instance-markets", dbMatchId],
  enabled: Boolean(dbMatchId),
  refetchOnWindowFocus: false,
  refetchOnReconnect: true,
  queryFn: async () => {
    if (!dbMatchId) return [];
    const { markets } = await api.getInstanceMarkets(dbMatchId, ["OPEN"]);
    return markets as InstanceMarket[];
  },
});

  const { data: squadsData } = useQuery<Squads | null>({
    queryKey: ["match-squad", dbMatchId, match?.status, match?.homeTeam, match?.awayTeam],
    enabled: Boolean(dbMatchId) && match?.status === "UPCOMING",
    staleTime: 60_000,
    queryFn: async () => {
      if (!dbMatchId) return null;
      const { data, error } = await supabase.from("matches").select("ro_last_payload").eq("id", dbMatchId).single();
      if (error) {
        console.error("Squad fetch failed", error);
        return null;
      }
      const payload = (data as any)?.ro_last_payload;
      if (!payload) return null;
      return extractSquadsFromPayload(payload);
    },
  });

  useEffect(() => {
    if (!dbMatchId) return;
    const upsertRow = (row: any) => {
      const extraShort = normalizeExtraTypeShort(row.ro_extra_type);
      const over = Number(row.ro_over_number ?? 0);
      const ballNum = Number(row.ro_ball_in_over ?? 0);
      const totalRunsNum = Number(row.ro_total_runs ?? 0);
      const wicket = !!row.ro_is_wicket;
      if (isPlaceholderBall(over, ballNum, totalRunsNum, wicket)) return;

      const mapped: BallEventRow = {
        inning: Number(row.ro_inning_number ?? 1),
        over,
        ball: ballNum,
        sub_ball: Number(row.ro_sub_ball_number ?? 0),
        ball_key: row.ro_ball_key || undefined,
        is_legal: row.ro_is_legal_delivery ?? true,
        batsman_name: row.ro_batsman_name || row.ro_batsman_key || "—",
        non_striker_name: row.ro_non_striker_name || row.ro_non_striker_key || "—",
        bowler_name: row.ro_bowler_name || row.ro_bowler_key || "—",
        runs: Number(row.ro_batsman_runs ?? 0),
        extras: Number(row.ro_extras_runs ?? 0),
        total_runs: totalRunsNum,
        is_wicket: wicket,
        is_extra: (row.ro_extras_runs ?? 0) > 0 || !!extraShort,
        extra_type: extraShort ? row.ro_extra_type ?? null : null,
        is_boundary: !!row.ro_is_boundary,
        is_six: !!row.ro_is_six,
        created_at: row.created_at,
      };

      setBallFeed((prev) => {
        const filtered = prev.filter((b) => {
          const sameKey = mapped.ball_key && b.ball_key === mapped.ball_key;
          const sameTs = !mapped.ball_key && b.created_at === mapped.created_at;
          return !(sameKey || sameTs);
        });
        const next = dedupeBallEvents([mapped, ...filtered]);
        return next.slice(0, 300);
      });
    };

    const channel = supabase
      .channel(`ball_events_live_${dbMatchId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "ball_events", filter: `match_id=eq.${dbMatchId}` },
        (payload) => upsertRow(payload.new as any)
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "ball_events", filter: `match_id=eq.${dbMatchId}` },
        (payload) => upsertRow(payload.new as any)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [dbMatchId]);

  useEffect(() => {
    if (!dbMatchId) return;
    const channel = supabase
      .channel(`instance_markets_live_${dbMatchId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "instance_markets", filter: `match_id=eq.${dbMatchId}` }, () =>
        refetchInstanceMarkets()
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "instance_markets", filter: `match_id=eq.${dbMatchId}` }, () =>
        refetchInstanceMarkets()
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "instance_markets", filter: `match_id=eq.${dbMatchId}` }, () =>
        refetchInstanceMarkets()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [dbMatchId, refetchInstanceMarkets]);

  const activeInning = useMemo(() => {
    if (ballFeed && ballFeed.length > 0) {
      const innings = ballFeed.map((e) => toNum(e.inning, 1));
      return Math.max(...innings);
    }
    const rtAny = realtimeData as any;
    if (rtAny?.inning != null) return toNum(rtAny.inning, 1);
    if (rtAny?.currentInning != null) return toNum(rtAny.currentInning, 1);
    if (liveScore?.currentInning != null) return toNum(liveScore.currentInning, 1);
    return 1;
  }, [ballFeed, realtimeData, liveScore]);

  const effectiveEvents = useMemo(() => {
    if (ballFeed.length > 0) return ballFeed;
    return [];
  }, [ballFeed]);

  const latestInningBall = useMemo(() => {
    const relevant = effectiveEvents
      .filter((e) => toNum(e.inning, 1) === activeInning)
      .slice()
      .sort((a, b) => (Date.parse(b.created_at ?? "") || 0) - (Date.parse(a.created_at ?? "") || 0));
    return relevant[0] ?? null;
  }, [effectiveEvents, activeInning]);

  const derived = useMemo(() => deriveFromBallEvents(effectiveEvents, activeInning), [effectiveEvents, activeInning]);
  const inningScoreFromDb = useMemo(() => deriveScoreFromBallEvents(effectiveEvents, activeInning), [effectiveEvents, activeInning]);

  const battingTeamResolved = useMemo(() => {
    const home = match?.homeTeam || "";
    const away = match?.awayTeam || "";
    if (!home || !away) return "";

    const tossWinnerRaw = getTossWinner(match);
    const tossDecisionRaw = getTossDecision(match);
    const decision = String(tossDecisionRaw ?? "").toLowerCase();

    const wsMapped = mapToHomeAwayTeam(liveScore?.battingTeam, home, away);
    if (wsMapped) return wsMapped;
    const rtMapped = mapToHomeAwayTeam(realtimeData?.battingTeam, home, away);
    if (rtMapped) return rtMapped;

    const scoreSide = battingSideFromScores(match, liveScore, realtimeData);
    if (scoreSide) return scoreSide;

    const tossWinner = mapToHomeAwayTeam(tossWinnerRaw, home, away);
    let firstInningsBatting: string | null = null;

    if (tossWinner && decision) {
      if (decision.includes("bat")) firstInningsBatting = tossWinner;
      else if (decision.includes("bowl")) firstInningsBatting = strictTeamEquals(tossWinner, home) ? away : home;
    }

    if (activeInning === 1) return firstInningsBatting || "";
    if (activeInning === 2) {
      if (!firstInningsBatting) return "";
      return strictTeamEquals(firstInningsBatting, home) ? away : home;
    }
    return "";
  }, [match, activeInning, liveScore?.battingTeam, realtimeData?.battingTeam]);

  const isHomeBatting = useMemo(() => {
    if (!battingTeamResolved || !match?.homeTeam) return false;
    return strictTeamEquals(battingTeamResolved, match.homeTeam) || fuzzyTeamMatch(battingTeamResolved, match.homeTeam);
  }, [battingTeamResolved, match?.homeTeam]);

  const isAwayBatting = useMemo(() => {
    if (!battingTeamResolved || !match?.awayTeam) return false;
    return strictTeamEquals(battingTeamResolved, match.awayTeam) || fuzzyTeamMatch(battingTeamResolved, match.awayTeam);
  }, [battingTeamResolved, match?.awayTeam]);

  useEffect(() => {
    const subId = dbMatchId || params?.id;
    if (!subId) return;

    wsClient.subscribeToMatch(subId);

    const unsubScore = wsClient.on<MatchScoreUpdate>("match:score", (data) => {
      if (data.matchId === subId) {
        setLiveScore(data);
        queryClient.invalidateQueries({ queryKey: ["realtime", subId] });
      }
    });

    const unsubBall = wsClient.on<BallResult>("match:ball", (data) => {
      if (data.matchId === subId) {
        setLastBall(data);
        setScorePulse(true);
        setTimeout(() => setScorePulse(false), 220);
      }
    });

    return () => {
      wsClient.unsubscribeFromMatch(subId);
      unsubScore();
      unsubBall();
    };
  }, [dbMatchId, params?.id, queryClient, activeInning]);

  const displayDetails = realtimeData?.scoreDetails || liveScore?.scoreDetails || match?.scoreDetails;
  const isLive = match?.status === "LIVE";
  const target = realtimeData?.targetRuns ?? parseTarget(displayDetails) ?? (match as any)?.targetRuns ?? null;
  const statusNote = (realtimeData as any)?.statusNote ?? match?.statusNote ?? null;

  const teamContextLine = useCallback(
    (teamName: string) => {
      if (!isLive) return "";
      const isBatting = fuzzyTeamMatch(teamName, battingTeamResolved);
      if (activeInning === 1) return isBatting ? "Batting" : "Yet to bat";
      if (isBatting) return target ? `Target ${target}` : "Chasing";
      return "Bowling";
    },
    [isLive, battingTeamResolved, activeInning, target]
  );

  const tossLine = getTossLine(match, realtimeData, liveScore);
  const parsedDetails = parseScoreDetailsCompact(displayDetails);
  const parsedInnings = parseScoreDetailsInnings(displayDetails, match?.homeTeam || "", match?.awayTeam || "");

  const scoreFromDb = inningScoreFromDb ? formatScoreCompact(inningScoreFromDb.runs, inningScoreFromDb.wkts) : null;

  const scoreFromDetails =
    (() => {
      if (battingTeamResolved && parsedInnings.length > 0) {
        const entry = parsedInnings.find((i) => (i.team ? strictTeamEquals(i.team, battingTeamResolved) : false));
        if (entry && entry.runs !== null) return formatScoreCompact(entry.runs, entry.wkts ?? 0);
      }
      return parsedDetails.runs !== null ? formatScoreCompact(parsedDetails.runs, parsedDetails.wkts) : null;
    })() || null;

  const totalScore =
    scoreFromDetails ||
    scoreFromDb ||
    (isLive && liveScore?.runs !== undefined ? formatScoreCompact(liveScore.runs, liveScore.wickets) : null) ||
    "—";

  const authoritativeOverForText = useMemo(() => {
    if (effectiveEvents.length > 0) {
      const latest = effectiveEvents
        .filter((e) => toNum(e.inning, 1) === activeInning)
        .reduce((max, e) => Math.max(max, Math.floor(toNum(e.over, 0))), 0);
      return latest;
    }
    if (lastBall) return Math.floor(toNum(lastBall.over, 0));
    return inningScoreFromDb?.over ?? 0;
  }, [effectiveEvents, activeInning, lastBall, inningScoreFromDb?.over]);

  const authoritativeBall0to5ForText =
    inningScoreFromDb?.ball0to5 ?? (lastBall ? Math.max(0, toNum(lastBall.ball, 1) - 1) : 0);

  const overFromDb = inningScoreFromDb ? formatOversCompact(authoritativeOverForText, authoritativeBall0to5ForText) : null;

  const overText =
    (() => {
      if (battingTeamResolved && parsedInnings.length > 0) {
        const entry = parsedInnings.find((i) => (i.team ? strictTeamEquals(i.team, battingTeamResolved) : false));
        if (entry && entry.overs !== null) return String(entry.overs);
      }
      return parsedDetails.oversText ? String(parsedDetails.oversText) : null;
    })() ||
    overFromDb ||
    (liveScore?.overs ? String(liveScore.overs) : null) ||
    "—";

  const required = parseRequired(displayDetails);

  const currentOverEvents = useMemo(() => {
    const overNum = Math.floor(toNum(authoritativeOverForText, 0));
    return (effectiveEvents ?? [])
      .filter((e) => toNum(e.inning, 1) === activeInning && Math.floor(toNum(e.over, 0)) === overNum)
      .slice()
      .sort((a, b) => {
        const ta = Date.parse(a.created_at ?? "") || 0;
        const tb = Date.parse(b.created_at ?? "") || 0;
        if (ta !== tb) return ta - tb;
        const ballCmp = toNum(a.ball, 0) - toNum(b.ball, 0);
        if (ballCmp !== 0) return ballCmp;
        const aSub = toNum(a.sub_ball, 0);
        const bSub = toNum(b.sub_ball, 0);
        const aOrder = aSub === 0 ? 999 : aSub;
        const bOrder = bSub === 0 ? 999 : bSub;
        return aOrder - bOrder;
      });
  }, [effectiveEvents, activeInning, authoritativeOverForText]);

  const thisOverRuns = useMemo(
    () => currentOverEvents.reduce((sum, e) => sum + toNum(e.total_runs, toNum(e.runs) + toNum(e.extras)), 0),
    [currentOverEvents]
  );

  const pulseOverEvents = useMemo(() => {
    const legalCount = currentOverEvents.filter((e) => e.is_legal !== false).length;
    if (legalCount >= 6) return [] as typeof currentOverEvents;
    return currentOverEvents;
  }, [currentOverEvents]);

  const pulseResults = useMemo(() => {
    const list =
      pulseOverEvents.map((e) => ({
        label: outcomeFromBallEvent(e),
        subLabel: normalizeExtraTypeShort(e.extra_type),
        over: Math.floor(toNum(e.over, 0)),
        ball: toNum(e.ball, 0),
        subBall: toNum(e.sub_ball, 0),
        createdAt: Date.parse(e.created_at ?? "") || 0,
      })) || [];

    return list.sort((a, b) => {
      if (a.over !== b.over) return a.over - b.over;
      if (a.ball !== b.ball) return a.ball - b.ball;
      if ((a.subBall ?? 0) !== (b.subBall ?? 0)) return (a.subBall ?? 0) - (b.subBall ?? 0);
      return a.createdAt - b.createdAt;
    });
  }, [pulseOverEvents, lastBall, authoritativeOverForText, ballFeed.length]);

  const pulse = useMemo(() => {
    const filled: PulseChip[] = [];
    pulseResults.forEach((res, idx) => {
      filled.push({
        label: res.label,
        kind: "RESULT",
        muted: false,
        emphasize: idx === pulseResults.length - 1,
        subLabel: res.subLabel || undefined,
      });
    });
    filled.push({ label: "•", kind: "UPCOMING", muted: false, emphasize: true });
    return filled;
  }, [pulseResults]);

  const lastKnownBatsRef = useRef<{ striker: string; non: string }>({ striker: "—", non: "—" });
  useEffect(() => {
    const bowler = (derived.bowler.name || "").trim();
    const s = (derived.striker.name || "").trim();
    const n = (derived.nonStriker.name || "").trim();
    const validStriker = s && s !== "—" && s !== bowler;
    const validNon = n && n !== "—" && n !== bowler && n !== s;
    if (validStriker) lastKnownBatsRef.current.striker = s;
    if (validNon) lastKnownBatsRef.current.non = n;
  }, [derived.striker.name, derived.nonStriker.name, derived.bowler.name]);

  // Parse timestamps that may arrive without an explicit offset; default to UTC.
  const parseUtcMs = (t?: string | null) => {
    if (!t) return Number.NaN;
    const hasZone = /[zZ]|[+-]\d{2}:\d{2}$/.test(t);
    return Date.parse(hasZone ? t : `${t}Z`);
  };
  const timeRemaining = (closeTime?: string | null) => {
    if (!closeTime) return "—";
    const diff = parseUtcMs(closeTime) - nowTs;
    if (!Number.isFinite(diff)) return "—";
    if (diff <= 0) return "Closed";
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s}s`;
  };

  /* =========================
     Markets selection (compact)
========================= */
  const openNextBallMarkets = useMemo(() => {
    return (instanceMarkets as InstanceMarket[])
      .filter(
        (m) =>
          (m.instance_type || (m as any).instanceType) === "NEXT_BALL" &&
          ((m as any).market_status === "OPEN" ||
            (m as any).status === "OPEN" ||
            (m as any).marketStatus === "OPEN")
      )
      .sort((a, b) => {
        const ia = toNum((a as any).ro_inning_number ?? (a as any).inning_number ?? 1, 1);
        const ib = toNum((b as any).ro_inning_number ?? (b as any).inning_number ?? 1, 1);
        if (ia !== ib) return ia - ib;
        const oa = toNum((a as any).ro_over_number ?? (a as any).over_number ?? 0, 0);
        const ob = toNum((b as any).ro_over_number ?? (b as any).over_number ?? 0, 0);
        if (oa !== ob) return oa - ob;
        const ba = toNum((a as any).ro_ball_number ?? (a as any).ball_number ?? 0, 0);
        const bb = toNum((b as any).ro_ball_number ?? (b as any).ball_number ?? 0, 0);
        if (ba !== bb) return ba - bb;
        return 0;
      });
  }, [instanceMarkets]);

  const activeNextBallMarket = useMemo(() => {
    if (openNextBallMarkets.length === 0) return null;
    const currentInningMarkets = openNextBallMarkets.filter(
      (m) => toNum((m as any).ro_inning_number ?? (m as any).inning_number ?? 1, 1) === activeInning
    );
    const latestOver = toNum(latestInningBall?.over, -1);
    const latestBallNum = toNum(latestInningBall?.ball, 0);

    const nextForCurrent = currentInningMarkets.find((m) => {
      const over = toNum((m as any).ro_over_number ?? (m as any).over_number ?? 0, 0);
      const ball = toNum((m as any).ro_ball_number ?? (m as any).ball_number ?? 0, 0);
      return over > latestOver || (over === latestOver && ball > latestBallNum);
    });
    if (nextForCurrent) return nextForCurrent;
    if (currentInningMarkets.length > 0) return currentInningMarkets[0];
    return openNextBallMarkets[0];
  }, [openNextBallMarkets, activeInning, latestInningBall]);

  const openNextOverMarkets = useMemo(() => {
    const kindPriority: Record<string, number> = {
      BOUNDARIES_COUNT: 0,
      RUNS_GT8: 1,
      WICKET_FALL: 2,
    };

    return (instanceMarkets as InstanceMarket[])
      .filter(
        (m) =>
          (m.instance_type || (m as any).instanceType) === "NEXT_OVER" &&
          ((m as any).market_status === "OPEN" ||
            (m as any).status === "OPEN" ||
            (m as any).marketStatus === "OPEN")
      )
      .sort((a, b) => {
        const ia = toNum((a as any).ro_inning_number ?? 1, 1);
        const ib = toNum((b as any).ro_inning_number ?? 1, 1);
        if (ia !== ib) return ia - ib;
        const oa = toNum((a as any).ro_over_number ?? 0, 0);
        const ob = toNum((b as any).ro_over_number ?? 0, 0);
        if (oa !== ob) return oa - ob;
        const ka = (a as any).metadata?.kind || (a as any).kind || "";
        const kb = (b as any).metadata?.kind || (b as any).kind || "";
        return (kindPriority[ka] ?? 99) - (kindPriority[kb] ?? 99);
      });
  }, [instanceMarkets]);

  const activeNextOverMarkets = useMemo(() => {
    if (openNextOverMarkets.length === 0) return [];
    const currentInningMarkets = openNextOverMarkets.filter(
      (m) => toNum((m as any).ro_inning_number ?? 1, 1) === activeInning
    );
    const latestOver = toNum(latestInningBall?.over, -1);
    const futureForCurrent = currentInningMarkets.filter((m) => {
      const over = toNum((m as any).ro_over_number ?? 0, 0);
      return over > latestOver;
    });
    if (futureForCurrent.length > 0) return futureForCurrent;
    if (currentInningMarkets.length > 0) return currentInningMarkets;
    return openNextOverMarkets;
  }, [openNextOverMarkets, activeInning, latestInningBall]);

  const nextOverLabel = (m: InstanceMarket) => {
    const title = (m as any).market_title || (m as any).name;
    if (title) return title;
    const over = toNum((m as any).ro_over_number ?? 0, 0) + 1;
    return `Over ${over}`;
  };

  const nextBallLabel = (m: InstanceMarket) => {
    const over = toNum((m as any).ro_over_number ?? (m as any).over_number ?? 0, 0);
    const ball = toNum((m as any).ro_ball_number ?? (m as any).ball_number ?? 1, 1);
    const base = (m as any).market_title || (m as any).name || "Next Ball";
    return `${base} • Ball ${over}.${ball}`;
  };

  const openNextWicketMarkets = useMemo(() => {
    return (instanceMarkets as InstanceMarket[])
      .filter(
        (m) =>
          (m.instance_type || (m as any).instanceType) === "NEXT_WICKET_METHOD" &&
          ((m as any).market_status === "OPEN" ||
            (m as any).status === "OPEN" ||
            (m as any).marketStatus === "OPEN")
      )
      .sort((a, b) => {
        const ia = toNum((a as any).ro_inning_number ?? 1, 1);
        const ib = toNum((b as any).ro_inning_number ?? 1, 1);
        if (ia !== ib) return ia - ib;
        const oa = toNum((a as any).ro_over_number ?? 0, 0);
        const ob = toNum((b as any).ro_over_number ?? 0, 0);
        return oa - ob;
      });
  }, [instanceMarkets]);

  const activeNextWicketMarket = useMemo(() => {
    if (openNextWicketMarkets.length === 0) return null;
    const currentInningMarkets = openNextWicketMarkets.filter(
      (m) => toNum((m as any).ro_inning_number ?? 1, 1) === activeInning
    );
    if (currentInningMarkets.length > 0) return currentInningMarkets[0];
    return openNextWicketMarkets[0];
  }, [openNextWicketMarkets, activeInning]);

  const onPickOutcome = (m: InstanceMarket, o: InstanceOutcome) => {
    setSelectedMarket(m);
    setSelectedOutcome(o);
  };

  const matchWinnerMarket = useMemo(() => {
    if (!match?.markets) return null;
    return match.markets.find(
      (m: any) =>
        String(m.name || m.market_name || "").toLowerCase() === "match winner"
    ) || null;
  }, [match?.markets]);

  const tossMarket = useMemo(() => {
    if (!match?.markets) return null;
    return match.markets.find(
      (m: any) => String(m.name || m.market_name || "").toLowerCase() === "toss"
    ) || null;
  }, [match?.markets]);

  const winSplit = useMemo(() => {
    if (!match || !matchWinnerMarket) return null;
    const runners = matchWinnerMarket.runners || [];
    if (runners.length === 0) return null;

    const mapped = runners
      .map((r: any) => {
        const name = r.name || r.runner_name || "";
        const odds = Number(r.backOdds ?? r.back_odds);
        const probMeta = Number((r as any).probability ?? (r as any).prob ?? (r as any).implied_prob);
        let implied = Number.isFinite(probMeta) ? probMeta : Number.isFinite(odds) && odds > 1.01 ? 1 / odds : null;
        if (implied && implied > 1) implied = implied / 100;
        const team = mapToHomeAwayTeam(name, match.homeTeam, match.awayTeam);
        return { name, team, implied: implied ?? null };
      })
      .filter((r) => r.team && Number.isFinite(r.implied)) as Array<{ name: string; team: string; implied: number }>;

    if (mapped.length === 0) return null;
    const sum = mapped.reduce((s, r) => s + r.implied, 0) || 1;
    const pct = (team: string) => {
      const entry = mapped.find((r) => strictTeamEquals(r.team, team) || fuzzyTeamMatch(r.team, team));
      if (!entry) return null;
      return Math.max(0, Math.min(100, (entry.implied / sum) * 100));
    };

    const homePct = pct(match.homeTeam);
    const awayPct = pct(match.awayTeam);

    if (homePct === null || awayPct === null) {
      return { homePct: 50, awayPct: 50 };
    }
    const scale = homePct + awayPct === 0 ? 1 : 100 / (homePct + awayPct);
    return { homePct: homePct * scale, awayPct: awayPct * scale };
  }, [match, matchWinnerMarket]);

  const livePlayMarkets = useMemo(() => {
    return {
      nextBall: activeNextBallMarket,
      nextOvers: activeNextOverMarkets,
      nextWicket: activeNextWicketMarket,
    };
  }, [activeNextBallMarket, activeNextOverMarkets, activeNextWicketMarket]);

  const sessionMarkets = useMemo(() => {
    return (instanceMarkets as InstanceMarket[]).filter(
      (m) => (m.instance_type || (m as any).instanceType) === "OVER_RUNS"
    );
  }, [instanceMarkets]);

  const onPickRunner = (runner: any, market: any, type: "BACK" | "LAY" = "BACK") => {
    setSelectedRunner({
      marketId: market.id,
      runnerId: runner.id,
      runnerName: runner.name || runner.runner_name,
      backOdds: Number(runner.backOdds ?? runner.back_odds ?? 0),
      layOdds: Number.isFinite(Number(runner.layOdds ?? runner.lay_odds))
        ? Number(runner.layOdds ?? runner.lay_odds)
        : null,
      type,
    });
  };

  const handleWinnerBet = async () => {
    if (!selectedRunner || !match) return;
    if (!currentUser) {
      toast({ title: "Please login", description: "Login to place a bet.", variant: "destructive" });
      return;
    }
    const stakeNum = Number(winnerStake || 0);
    if (!Number.isFinite(stakeNum) || stakeNum <= 0) {
      toast({ title: "Invalid stake", description: "Enter a stake greater than 0.", variant: "destructive" });
      return;
    }

    try {
      const odds =
        selectedRunner.type === "BACK"
          ? selectedRunner.backOdds
          : selectedRunner.layOdds ?? selectedRunner.backOdds;

      await api.placeBet({
        matchId: match.id,
        marketId: selectedRunner.marketId,
        runnerId: selectedRunner.runnerId,
        runnerName: selectedRunner.runnerName,
        type: selectedRunner.type,
        odds,
        stake: stakeNum,
      });

      toast({
        title: "Bet placed",
        description: `${selectedRunner.runnerName} ${selectedRunner.type} @ ${odds.toFixed(2)} | ₹${stakeNum.toFixed(0)}`,
      });

      setSelectedRunner(null);

      const { user } = await api.getCurrentUser();
      setCurrentUser({
        id: user.id,
        username: user.username,
        role: user.role,
        balance: parseFloat(user.balance),
        exposure: parseFloat(user.exposure),
        currency: user.currency,
      });
    } catch (err: any) {
      toast({ title: "Bet failed", description: err?.message || "Unable to place bet", variant: "destructive" });
    }
  };

  const handleInstanceBet = async (market: InstanceMarket, outcome: InstanceOutcome) => {
    if (!currentUser) {
      toast({ title: "Please login", description: "Login to place a quick play bet.", variant: "destructive" });
      return;
    }
    const stakeNum = Number(instanceStake || 0);
    if (!Number.isFinite(stakeNum) || stakeNum <= 0) {
      toast({ title: "Invalid stake", description: "Enter a stake greater than 0.", variant: "destructive" });
      return;
    }

    try {
      const result = await api.placeInstanceBet({ marketId: market.id, outcomeId: outcome.id, stake: stakeNum });

      const newBet = (result as any)?.bet;
      if (newBet) {
        const normalizedBet = {
          ...newBet,
          status: newBet.bet_status || newBet.status,
          type: newBet.bet_type || newBet.type,
          createdAt: newBet.created_at,
          settledAt: newBet.settled_at,
        };
        queryClient.setQueryData<any[]>(["my-bets"], (prev) => {
          const list = Array.isArray(prev) ? prev : [];
          return [normalizedBet, ...list];
        });
      }
      queryClient.invalidateQueries({ queryKey: ["my-bets"] });

      toast({
        title: "Bet placed",
        description: `${outcome.name} @ ${Number(outcome.odds).toFixed(2)} | ₹${stakeNum.toFixed(0)}`,
      });

      setSelectedOutcome(null);
      setSelectedMarket(null);

      const { user } = await api.getCurrentUser();
      setCurrentUser({
        id: user.id,
        username: user.username,
        role: user.role,
        balance: parseFloat(user.balance),
        exposure: parseFloat(user.exposure),
        currency: user.currency,
      });
    } catch (err: any) {
      toast({ title: "Bet failed", description: err?.message || "Unable to place bet", variant: "destructive" });
    }
  };

  const winDisplay = winSplit || { homePct: 50, awayPct: 50 };
  const homeWinPct = Math.max(0, Math.min(100, winDisplay.homePct));
  const awayWinPct = Math.max(0, Math.min(100, winDisplay.awayPct));

  const renderBattingNames = (strikerRuns: string, strikerBalls: string, nonStrikerRuns: string, nonStrikerBalls: string) => (
    <div className="mt-0.5 text-[11px] text-white/85 text-center space-y-0.5">
      <p className="truncate max-w-[140px]">
        <span className="text-emerald-300">●</span> {lastKnownBatsRef.current.striker}
        <span className="text-emerald-300"> *</span>{" "}
        <span className="ml-1 font-mono tabular-nums text-[10px] text-white/65">
          {strikerRuns}/{strikerBalls}
        </span>
      </p>
      <p className="truncate max-w-[140px] text-white/75">
        <span className="text-white/35">●</span> {lastKnownBatsRef.current.non}{" "}
        <span className="ml-1 font-mono tabular-nums text-[10px] text-white/60">
          {nonStrikerRuns}/{nonStrikerBalls}
        </span>
      </p>
    </div>
  );

  const renderBowlingInfo = (teamName: string) => {
    const isBatting = fuzzyTeamMatch(teamName, battingTeamResolved);
    return (
      <div className="mt-0.5 text-[11px] text-white/80 text-center space-y-0.5">
        <p className="truncate max-w-[140px] text-white/70">{teamContextLine(teamName) || "—"}</p>
        {!isBatting && (
          <>
            <p className="truncate max-w-[140px]">
              <span className="text-white/55">Bowler:</span> <span className="text-white/90">{derived.bowler.name}</span>
            </p>
            <p className="truncate max-w-[140px] font-mono tabular-nums text-[10px] text-white/60">{derived.bowler.compact}</p>
          </>
        )}
      </div>
    );
  };

  const strikerRuns = derived.striker.runs;
  const strikerBalls = derived.striker.balls;
  const nonStrikerRuns = derived.nonStriker.runs;
  const nonStrikerBalls = derived.nonStriker.balls;

  const startSubLabel = match?.startTime ? formatMatchTime(match.startTime) : "";

  if (!match && isLoadingMatch) {
    return (
      <AppShell hideHeader hideBottomNav fullBleed>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent" />
            <p className="mt-4 text-muted-foreground">Loading match...</p>
          </div>
        </div>
      </AppShell>
    );
  }

  if (!match) {
    return (
      <AppShell hideHeader hideBottomNav fullBleed>
        <div className="text-center py-12">
          <p className="text-muted-foreground">Match not found</p>
          <Link href="/">
            <Button variant="outline" className="mt-4">
              Back to Dashboard
            </Button>
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell hideHeader hideBottomNav fullBleed>
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 pb-24">
        <div className="max-w-5xl mx-auto px-3 sm:px-4 pt-0 space-y-2.5 sm:space-y-3">
          {/* Hero card compact and decluttered */}
          <Card className="relative mt-1 border border-white/10 bg-white/[0.03] backdrop-blur-xl shadow-[0_18px_45px_rgba(0,0,0,0.65)]">
            <Link href="/" className="absolute left-3 top-1 sm:top-2 z-10">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 px-3 rounded-full bg-white/5 border border-white/10 hover:bg-white/10"
              >
                <ArrowLeft className="h-4 w-4 text-white" />
              </Button>
            </Link>
            {/* Small tournament tag centered at top */}
            {(() => {
              const t = match.tournament || match.competition || match.series || "";
              const norm = String(t).toLowerCase();
              const label = norm.includes("t20 world cup") ? "T20WC" : t || "";
              return label ? (
                <span className="absolute top-2 left-1/2 -translate-x-1/2 text-[10px] text-white/60 uppercase tracking-wide truncate max-w-[180px] text-center">
                  {label}
                </span>
              ) : null;
            })()}
            <CardContent className="p-3 sm:p-4 pt-8 sm:pt-9 space-y-2.5">
              {/* Top meta: venue left, time right */}
              <div className="flex items-center justify-between gap-2 text-[11px] text-white/60">
                <span className="truncate">{match.venue || "Venue TBA"}</span>
                <span className="min-w-[96px] text-right text-white/50">{startSubLabel}</span>
              </div>

              {isLive ? (
                <>
                  <div className="grid grid-cols-3 gap-2 sm:gap-3 items-start">
                    <div className="flex flex-col items-center">
                      <TeamBadge name={match.homeTeam} banner={match.homeTeamBanner} />
                      {isHomeBatting ? (
                        <>
                          <div className="mt-0.5 text-[10px] text-white/60">{teamContextLine(match.homeTeam)}</div>
                          {renderBattingNames(strikerRuns, strikerBalls, nonStrikerRuns, nonStrikerBalls)}
                        </>
                      ) : (
                        renderBowlingInfo(match.homeTeam)
                      )}
                    </div>

                    <div
                      className={cn(
                        "flex flex-col items-center justify-center rounded-2xl px-2.5 py-2.5 border border-white/10 bg-black/30",
                        scorePulse && "ring-2 ring-emerald-400/60"
                      )}
                    >
                      <span className="text-[10px] uppercase tracking-[0.2em] text-white/55">Score</span>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge className="bg-white/10 text-white/75 border-white/15 text-[10px] px-2 py-0.5 rounded-full">
                          Inn {activeInning}
                        </Badge>
                        <p className="text-[22px] sm:text-3xl font-mono tabular-nums font-bold text-white leading-none">
                          {String(totalScore)}
                        </p>
                      </div>
                      <p className="mt-1 text-[11px] font-mono tabular-nums text-white/65">Over {overText}</p>
                      {statusNote && (
                        <div className="mt-1">
                          <span className="inline-flex items-center rounded-full bg-amber-500/20 text-amber-100 border border-amber-400/40 px-2 py-0.5 text-[10px] font-semibold tracking-wide">
                            {statusNote}
                          </span>
                        </div>
                      )}
                      {activeInning >= 2 && required && (
                        <p className="mt-1 text-[10px] text-emerald-200/85 text-center leading-snug">
                          {required.runs} req in {required.balls} balls
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col items-center">
                      <TeamBadge name={match.awayTeam} banner={match.awayTeamBanner} />
                      {isAwayBatting ? (
                        <>
                          <div className="mt-0.5 text-[10px] text-white/60">{teamContextLine(match.awayTeam)}</div>
                          {renderBattingNames(strikerRuns, strikerBalls, nonStrikerRuns, nonStrikerBalls)}
                        </>
                      ) : (
                        renderBowlingInfo(match.awayTeam)
                      )}
                    </div>
                  </div>

                  {/* Pulse row only */}
                  <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-2">
                    <div className="flex items-center justify-between text-[10px] text-white/60">
                      <span className="flex items-center gap-1">
                        <Activity className="h-3 w-3 text-emerald-300" />
                        This over: {thisOverRuns} runs
                      </span>
                      <span className="text-white/45">Inn {activeInning}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1 overflow-x-auto pb-0.5">
                      {pulse.map((b, idx) => (
                        <div
                          key={`${idx}-${b.label}-${b.subLabel ?? ""}`}
                          className={cn(
                            "shrink-0 rounded-full flex items-center justify-center border border-transparent transition-all",
                            "h-6 w-6 text-[9px] sm:h-7 sm:w-7 sm:text-[10px]",
                            b.kind === "UPCOMING" && "ring-2 ring-emerald-400/70 animate-pulse",
                            b.emphasize && b.kind === "RESULT" && "ring-2 ring-white/25",
                            chipStyle(b.label, !!b.muted)
                          )}
                          title={b.kind === "UPCOMING" ? "Upcoming ball" : `Ball result: ${b.label}`}
                        >
                          <div className="flex flex-col items-center justify-center leading-none">
                            <span>{b.label}</span>
                            {b.subLabel && <span className="text-[7px] mt-[-1px] opacity-90">{b.subLabel}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="grid grid-cols-3 items-center">
                  <div className="flex flex-col items-center">
                    <TeamBadge name={match.homeTeam} banner={match.homeTeamBanner} />
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <p className="text-lg font-semibold text-emerald-300">{countdown || "Starting soon"}</p>
                    {tossLine && <p className="text-[11px] text-white/70 text-center truncate">{tossLine}</p>}
                  </div>
                  <div className="flex flex-col items-center">
                    <TeamBadge name={match.awayTeam} banner={match.awayTeamBanner} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {match.status === "UPCOMING" && squadsData && (squadsData.home || squadsData.away) && (
            <Card className="border border-white/10 bg-white/[0.03]">
              <CardContent className="p-3 sm:p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-white">Squads</p>
                    <p className="text-[11px] text-white/55">Playing XI and bench (Roanuz)</p>
                  </div>
                  <Badge className="bg-white/10 border-white/20 text-[10px] px-2 py-0.5 text-white/70">Latest</Badge>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { side: "home", label: match.homeTeam, data: squadsData.home },
                    { side: "away", label: match.awayTeam, data: squadsData.away },
                  ].map(({ side, label, data }) => (
                    <div key={side} className="rounded-2xl border border-white/10 bg-black/25 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-[13px] font-semibold text-white truncate">{label}</p>
                        <div className="text-[10px] text-white/50">Playing XI</div>
                      </div>
                      {data ? (
                        <>
                          <ul className="space-y-1.5">
                            {data.playingXi.map((p, idx) => {
                              const isCaptain = data.captain && p === data.captain;
                              const isKeeper = data.keeper && p === data.keeper;
                              return (
                                <li key={`${side}-xi-${p}-${idx}`} className="flex items-center gap-2">
                                  <span className="text-[11px] text-white/45 w-5 text-right">{idx + 1}.</span>
                                  <span className="text-[12px] text-white/85 truncate flex-1">{p}</span>
                                  <span className="flex items-center gap-1 text-[10px] text-emerald-200">
                                    {isCaptain && <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 border border-emerald-400/40">C</span>}
                                    {isKeeper && <span className="rounded-full bg-cyan-500/20 px-1.5 py-0.5 border border-cyan-400/40">WK</span>}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                          {data.bench.length > 0 && (
                            <div className="pt-2 border-t border-white/10">
                              <p className="text-[11px] text-white/55 mb-1">Bench</p>
                              <div className="flex flex-wrap gap-1">
                                {data.bench.map((p) => (
                                  <span
                                    key={`${side}-bench-${p}`}
                                    className="text-[11px] text-white/75 bg-white/5 border border-white/10 px-2 py-0.5 rounded-full"
                                  >
                                    {p}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="text-[12px] text-white/55">Squad not available yet.</p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Markets: Winner / Live Play / Session Play */}
          <div className="mt-3 space-y-3">
            <div className="sticky top-14 z-20 flex items-center justify-center">
              <div className="inline-flex rounded-full border border-white/15 bg-white/5 p-1 gap-1">
                {[
                  { key: "winner", label: "Winner" },
                  { key: "live", label: "Live Play" },
                  { key: "session", label: "Session Play" },
                ].map((t) => (
                  <button
                    key={t.key}
                    className={cn(
                      "px-3 py-1.5 text-[12px] rounded-full transition",
                      activeTab === (t.key as any)
                        ? "bg-emerald-500 text-white shadow-[0_8px_20px_rgba(16,185,129,0.35)]"
                        : "text-white/70"
                    )}
                    onClick={() => setActiveTab(t.key as any)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {activeTab === "winner" && (
              <Card className="border border-white/10 bg-white/[0.03]">
                <CardContent className="p-3 sm:p-4 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-base font-semibold text-white">Match Winner</p>
                    <Badge className="text-[10px] px-2 py-0.5 bg-white/10 border-white/20 text-white/70">
                      {(matchWinnerMarket as any)?.status || (matchWinnerMarket as any)?.market_status || "—"}
                    </Badge>
                  </div>

                  {/* Win chances inline */}
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2">
                    <div className="flex items-center justify-between text-[11px] text-white/75">
                      <span className="truncate pr-2">{match.homeTeam}</span>
                      <span className="text-white/45">Based on Match Winner odds</span>
                      <span className="truncate pl-2 text-right">{match.awayTeam}</span>
                    </div>
                    <div className="mt-1.5 relative h-3 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-400/80 via-emerald-300/70 to-cyan-400/70"
                        style={{ width: `${homeWinPct}%` }}
                      />
                      <div
                        className="absolute inset-y-0 right-0 bg-gradient-to-l from-pink-400/80 via-fuchsia-300/70 to-indigo-400/70"
                        style={{ width: `${awayWinPct}%` }}
                      />
                      <div
                        className="absolute -translate-x-1/2 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-white/85 shadow-[0_0_0_3px_rgba(16,185,129,0.25)]"
                        style={{ left: `${homeWinPct}%` }}
                        title={`${match.homeTeam} win chance`}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] font-mono tabular-nums text-white/80">
                      <span>{homeWinPct.toFixed(1)}%</span>
                      <span>{awayWinPct.toFixed(1)}%</span>
                    </div>
                  </div>

                  {matchWinnerMarket ? (
                    <div className="space-y-2">
                      {(matchWinnerMarket.runners || []).map((r: any) => {
                        const back = Number(r.backOdds ?? r.back_odds ?? 0);
                        const lay = Number(r.layOdds ?? r.lay_odds ?? 0);
                        const hasLay = lay > 1.01;
                        return (
                          <div
                            key={r.id}
                            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <div className="text-[13px] text-white font-semibold truncate">{r.name}</div>
                              <div className="text-[11px] text-white/55">
                                Back {back.toFixed(2)} • Lay {hasLay ? lay.toFixed(2) : "—"}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                className="h-9 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-600"
                                onClick={() => onPickRunner(r, matchWinnerMarket, "BACK")}
                              >
                                Back {back.toFixed(2)}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className={cn(
                                  "h-9 px-3 rounded-lg border-amber-400/60 text-amber-200",
                                  !hasLay && "opacity-40 cursor-not-allowed"
                                )}
                                disabled={!hasLay}
                                onClick={() => hasLay && onPickRunner(r, matchWinnerMarket, "LAY")}
                              >
                                Lay {hasLay ? lay.toFixed(2) : "—"}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-[12px] text-white/55">Match Winner market not available.</p>
                  )}
                </CardContent>
              </Card>
            )}

            {activeTab === "winner" && tossMarket && (
              <Card className="border border-white/10 bg-white/[0.03]">
                <CardContent className="p-3 sm:p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-base font-semibold text-white">Toss</p>
                    <Badge className="text-[10px] px-2 py-0.5 bg-white/10 border-white/20 text-white/70">
                      {(tossMarket as any)?.status || (tossMarket as any)?.market_status || "—"}
                    </Badge>
                  </div>

                  {((tossMarket.runners as any[]) || []).length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {tossMarket.runners.map((r: any) => {
                        const back = Number(r.backOdds ?? r.back_odds ?? 1.9);
                        const disabled =
                          String((tossMarket as any)?.market_status || (tossMarket as any)?.status || "").toUpperCase() !==
                          "OPEN";
                        return (
                          <div
                            key={r.id}
                            className="rounded-xl border border-white/10 bg-white/[0.03] p-3 flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <p className="text-[13px] font-semibold text-white truncate">
                                {r.name || r.runner_name}
                              </p>
                              <p className="text-[11px] text-white/55">Odds {back.toFixed(2)}</p>
                            </div>
                            <Button
                              size="sm"
                              className="h-9 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-600"
                              disabled={disabled}
                              onClick={() => onPickRunner(r, tossMarket, "BACK")}
                            >
                              Select
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-[12px] text-white/55">Toss market not available.</p>
                  )}

                  {String((tossMarket as any)?.market_status || (tossMarket as any)?.status || "").toUpperCase() ===
                    "SETTLED" && (
                    <p className="text-[12px] text-emerald-200">
                      Toss won by {(tossMarket as any)?.winning_outcome || "—"}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {activeTab === "live" && (
              <div className="space-y-2">
                {livePlayMarkets.nextBall ? (
                  <CompactMarketGrid
                    market={livePlayMarkets.nextBall}
                    title={nextBallLabel(livePlayMarkets.nextBall)}
                    onPick={onPickOutcome}
                    selectedOutcomeId={
                      selectedMarket?.id === livePlayMarkets.nextBall.id ? selectedOutcome?.id : null
                    }
                    timeRemaining={timeRemaining}
                    maxCells={6}
                  />
                ) : (
                  <Card className="border border-white/10 bg-white/[0.02]">
                    <CardContent className="p-3 text-[12px] text-white/55">No next-ball market right now.</CardContent>
                  </Card>
                )}

                {livePlayMarkets.nextOvers && livePlayMarkets.nextOvers.length > 0 ? (
                  livePlayMarkets.nextOvers.map((m) => (
                    <CompactMarketGrid
                      key={m.id}
                      market={m}
                      title={nextOverLabel(m)}
                      onPick={onPickOutcome}
                      selectedOutcomeId={selectedMarket?.id === m.id ? selectedOutcome?.id : null}
                      timeRemaining={timeRemaining}
                      maxCells={6}
                    />
                  ))
                ) : null}

                {livePlayMarkets.nextWicket && (
                  <CompactMarketGrid
                    market={livePlayMarkets.nextWicket}
                    title={(livePlayMarkets.nextWicket as any).market_title || "Next wicket dismissal"}
                    onPick={onPickOutcome}
                    selectedOutcomeId={
                      selectedMarket?.id === livePlayMarkets.nextWicket.id ? selectedOutcome?.id : null
                    }
                    timeRemaining={timeRemaining}
                    maxCells={6}
                  />
                )}
              </div>
            )}

            {activeTab === "session" && (
              <div className="space-y-2">
                {sessionMarkets.length === 0 && (
                  <Card className="border border-white/10 bg-white/[0.02]">
                    <CardContent className="p-3 text-[12px] text-white/55">No session markets available yet.</CardContent>
                  </Card>
                )}
                {sessionMarkets.map((m) => (
                  <CompactMarketGrid
                    key={m.id}
                    market={m}
                    title={(m as any).market_title || (m as any).name || "Session market"}
                    onPick={onPickOutcome}
                    selectedOutcomeId={selectedMarket?.id === m.id ? selectedOutcome?.id : null}
                    timeRemaining={timeRemaining}
                    maxCells={6}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ✅ stake sheet opens only on click; doesn’t eat page space */}
      <QuickBetSheet
        open={!!selectedMarket && !!selectedOutcome}
        market={selectedMarket}
        outcome={selectedOutcome}
        stake={instanceStake}
        setStake={setInstanceStake}
        onClose={() => {
          setSelectedOutcome(null);
          setSelectedMarket(null);
        }}
        onPlace={() => {
          if (selectedMarket && selectedOutcome) handleInstanceBet(selectedMarket, selectedOutcome);
        }}
      />

      <PreMatchBetSheet
        open={!!selectedRunner}
        runner={
          selectedRunner
            ? {
                name: selectedRunner.runnerName,
                backOdds: selectedRunner.backOdds,
                layOdds: selectedRunner.layOdds,
                type: selectedRunner.type,
              }
            : null
        }
        stake={winnerStake}
        setStake={setWinnerStake}
        onClose={() => setSelectedRunner(null)}
        onPlace={handleWinnerBet}
        setType={(t) =>
          setSelectedRunner((prev) => (prev ? { ...prev, type: t } : prev))
        }
      />
    </AppShell>
  );
}
