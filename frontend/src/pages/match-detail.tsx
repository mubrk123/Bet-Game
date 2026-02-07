import { AppShell } from "@/components/layout/AppShell";
import { BetSlip } from "@/components/betting/BetSlip";
import { MobileBetSlip } from "@/components/betting/MobileBetSlip";
import { useStore } from "@/lib/store";
import type { Match, Market, Runner } from "@/lib/store";
import { useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Activity, Clock3, X, ArrowLeft } from "lucide-react";
import { useState, useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type InstanceMarket, type InstanceOutcome } from "@/lib/api";
import { wsClient } from "@/lib/websocket";
import type { MatchScoreUpdate, BallResult } from "@shared/realtime";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

/* =========================
   Visual tokens (Warm Ivory)
========================= */
const ui = {
  bg: "bg-[#F7F5EF]",
  card: "bg-[#FDFBF6]",
  text: "text-[#111827]",
  textMuted: "text-[#4B5563]",
  border: "border-[#E5E0D6]",
  icon: "text-[#B0B7C3]",
  backBg: "bg-[#D6F4E3]",
  backText: "text-[#0A6A4A]",
  layBg: "bg-[#FFE0E6]",
  layText: "text-[#C81E3D]",
  suspendedBg: "bg-[#F3F4F6]",
  suspendedText: "text-[#9CA3AF]",
  accentTeal: "text-[#1ABC9C]",
  accentBlue: "text-[#2980B9]",
  boundary: "bg-[rgba(244,208,63,0.8)] text-[#1F2733]",
  wicket: "bg-[#F1948A] text-white",
};

const softShadow = "shadow-[0_4px_16px_rgba(15,23,42,0.04)]";

// Merge helper to avoid transient null/empty values causing UI flicker
function mergeLiveScore<T extends Record<string, any>>(prev: T | null, next: T): T {
  if (!prev) return next;
  const merged: any = { ...prev };
  for (const [key, val] of Object.entries(next)) {
    const keepPrev =
      val === null ||
      val === undefined ||
      (typeof val === "string" && val.trim() === "");
    merged[key] = keepPrev ? prev[key] : val;
  }
  return merged as T;
}

function mergeBallResult(prev: BallResult | null, next: BallResult): BallResult {
  if (!prev) return next;
  return {
    ...prev,
    ...next,
    batsmanName: next.batsmanName ?? prev.batsmanName,
    bowlerName: next.bowlerName ?? prev.bowlerName,
  };
}

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
  commentary?: string | null;
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
  return p?.player?.name || p?.name || p?.short_name || p?.full_name || p?.player_name || key;
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

function formatShortDayTime(dateStr: string | null | undefined) {
  if (!dateStr) return "Date/Time TBA";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "Date/Time TBA";
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dicebearFor(name: string) {
  return `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(
    name || "team"
  )}&backgroundColor=0f172a&fontWeight=700`;
}

// Helper: best-effort over.ball label from market metadata
function formatOverLabel(market: InstanceMarket | null | undefined): string | null {
  if (!market) return null;
  const over = toNum((market as any).ro_over_number ?? (market as any).over_number ?? (market as any).over ?? NaN, NaN);
  const ball = toNum((market as any).ro_ball_number ?? (market as any).ball_number ?? (market as any).ball ?? NaN, NaN);
  if (Number.isFinite(over) && Number.isFinite(ball)) return `${over}.${ball}`;
  if (Number.isFinite(over)) return `Over ${over}`;
  return null;
}

function TeamBadge({ name, banner }: { name: string; banner?: string | null }) {
  const [imgError, setImgError] = useState(false);
  const resolvedBanner = banner || dicebearFor(name);
  const showFallback = imgError || !resolvedBanner;

  return (
    <div className="flex flex-col items-center gap-1.5">
      {showFallback ? (
        <div className="h-8 w-11 sm:h-9 sm:w-12 rounded-sm bg-[#E5E7EB] border border-[#E2E8F0] flex items-center justify-center text-sm sm:text-base font-semibold text-[#2D3436]">
          {teamInitials(name)}
        </div>
      ) : (
        <div className="h-8 w-11 sm:h-9 sm:w-12 rounded-sm overflow-hidden flex items-center justify-center border border-[#E2E8F0]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={resolvedBanner}
            alt={name}
            className="h-full w-full object-contain"
            onError={() => setImgError(true)}
            loading="lazy"
            crossOrigin="anonymous"
            referrerPolicy="no-referrer"
          />
        </div>
      )}
      <p className="text-[11px] sm:text-xs text-[#2D3436] text-center max-w-[120px] truncate">{name}</p>
    </div>
  );
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
  const baseMuted = muted ? "opacity-60" : "opacity-100";
  if (label === "W") return `${ui.wicket} font-semibold ${baseMuted}`;
  if (label === "6" || label === "4") return `${ui.boundary} font-semibold ${baseMuted}`;
  if (label.startsWith("Wd") || label.startsWith("Nb"))
    return `${ui.backBg} ${ui.accentBlue} font-semibold ${baseMuted}`;
  if (label === "0") return `bg-[#E5E7EB] text-[#4B5563] font-semibold ${baseMuted}`;
  const n = Number(label);
  if (Number.isFinite(n) && n > 0) return `${ui.backBg} ${ui.backText} font-semibold ${baseMuted}`;
  return `bg-[#FDFBF6] text-[#4B5563] border border-[#E5E0D6] ${baseMuted}`;
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
    bowler: {
      name: bowlerName,
      runs: runsConceded,
      wkts,
      econ,
      overs,
      maidens,
      fig: `${overs}-${maidens}-${runsConceded}-${wkts}`,
      compact,
    },
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
  onPick: (m: InstanceMarket, o: InstanceOutcome, pos?: { x: number; y: number }) => void;
  selectedOutcomeId?: string | null;
  timeRemaining: (closeTime?: string | null) => string;
  maxCells?: number;
}) {
  const outcomes = (market?.outcomes ?? []).slice(0, maxCells);
  const status = String((market as any)?.market_status || (market as any)?.status || "").toUpperCase();
  const isClosed = status && status !== "OPEN";
  const cols = outcomes.length <= 2 ? 2 : outcomes.length === 4 ? 2 : 3;

  return (
    <div className={cn("rounded-2xl border border-[#E5E0D6] bg-[#FDFBF6] p-1.5", softShadow)}>
      <div className="flex items-center justify-between gap-2">
        {title ? <div className="text-[11px] text-[#111827] truncate font-semibold">{title}</div> : <div />}
        <Badge
          className={cn(
            "flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border",
            isClosed
              ? "bg-[#FEE2E2] text-[#B91C1C] border-[#FCA5A5]"
              : "bg-[#E8F6F1] text-[#1ABC9C] border-[#1ABC9C33]"
          )}
        >
          <Clock3 className="h-3 w-3" />
          {isClosed ? "Closed" : timeRemaining(market.close_time)}
        </Badge>
      </div>

      <div className="mt-1.5 overflow-hidden rounded-xl border border-[#94A3B8]">
        <div className={cn("grid", cols === 2 ? "grid-cols-2" : "grid-cols-3")}>
          {outcomes.map((o, idx) => {
            const selected = selectedOutcomeId === o.id;
            const isLastRow = idx >= outcomes.length - cols;
            return (
              <button
                key={o.id}
                onClick={(e) => {
                  if (isClosed) return;
                  onPick(market, o, { x: e.clientX, y: e.clientY });
                }}
                className={cn(
                  "text-left bg-[#FDFBF6] hover:bg-[#F1EDE2] transition",
                  "px-2 py-1.5 min-h-[44px] flex flex-col justify-center gap-1",
                  idx % cols !== cols - 1 && "border-r border-[#94A3B8]",
                  !isLastRow && "border-b border-[#94A3B8]",
                  selected && "bg-[#E8F6F1] ring-1 ring-[#1ABC9C]",
                  isClosed && "opacity-60 cursor-not-allowed"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-[#111827] leading-snug truncate">{o.name}</span>
                  <span className="font-mono tabular-nums text-[13px] font-bold text-[#0B8A5F]">
                    {Number(o.odds).toFixed(2)}
                  </span>
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
  anchor,
  placing,
  currencySymbol = "₹",
}: {
  open: boolean;
  market: InstanceMarket | null;
  outcome: InstanceOutcome | null;
  stake: string;
  setStake: (v: string) => void;
  onClose: () => void;
  onPlace: () => void;
  anchor: { x: number; y: number } | null;
  placing: boolean;
  currencySymbol?: string;
}) {
  if (!open || !market || !outcome) return null;

  const quickAmounts = [50, 100, 200, 500];
  const infoOver = formatOverLabel(market);

  const dims = { w: 320, h: 210 };
  const viewport =
    typeof window !== "undefined"
      ? { w: window.innerWidth, h: window.innerHeight }
      : { w: 360, h: 640 };
  const target = anchor ?? { x: viewport.w / 2, y: viewport.h / 2 };
  const left = Math.max(12, Math.min(viewport.w - dims.w - 12, target.x - dims.w / 2));
  const top = Math.max(12, Math.min(viewport.h - dims.h - 12, target.y - dims.h / 2));

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div
        className="absolute rounded-2xl border border-[#E5E0D6] bg-[#FDFBF6] shadow-[0_14px_40px_rgba(0,0,0,0.18)] p-3 space-y-2"
        style={{ left, top, width: dims.w, maxWidth: "92vw" }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <div className="text-sm font-semibold text-[#111827] truncate">
              Selected: {outcome.name} @ {Number(outcome.odds).toFixed(2)}
            </div>
            {infoOver && <div className="text-[11px] text-[#4B5563]">Over: {infoOver}</div>}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={onClose}>
              <X className="h-4 w-4 text-[#6C757D]" />
            </Button>
            <Button
              size="sm"
              className={cn(
                "h-9 px-3 rounded-xl text-white",
                placing ? "bg-[#9AE6B4] cursor-wait" : "bg-[#1ABC9C] hover:bg-[#159b82]"
              )}
              disabled={placing}
              onClick={onPlace}
            >
              {placing ? "Placing..." : "Place bet"}
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 space-y-1">
            <label className="text-[10px] uppercase tracking-[0.08em] text-[#6B7280]">
              Type your amount
            </label>
            <input
              value={stake}
              onChange={(e) => setStake(e.target.value.replace(/[^0-9.]/g, ""))}
              type="text"
              inputMode="decimal"
              pattern="[0-9]*"
              className="w-full h-10 rounded-lg border border-[#94A3B8] bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1ABC9C66]"
              placeholder="e.g. 100"
              autoFocus
            />
          </div>
        </div>

        <div className="flex gap-2">
          {quickAmounts.map((amt) => (
            <button
              key={amt}
              className="flex-1 rounded-lg border border-[#94A3B8] bg-white py-2 text-center text-[13px] font-bold text-[#0B1B31] hover:bg-[#F1F5F9] transition shadow-sm"
              onClick={(e) => {
                e.stopPropagation();
                setStake(String(amt));
              }}
            >
              {currencySymbol}
              {amt}
            </button>
          ))}
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

  const [nowTs, setNowTs] = useState(() => Date.now());

  const [instanceStake, setInstanceStake] = useState("50");
  const [selectedOutcome, setSelectedOutcome] = useState<InstanceOutcome | null>(null);
  const [selectedMarket, setSelectedMarket] = useState<InstanceMarket | null>(null);
  const [betAnchor, setBetAnchor] = useState<{ x: number; y: number } | null>(null);
  const [placingQuick, setPlacingQuick] = useState(false);
  const [selectedBet, setSelectedBet] = useState<{
    match: Match;
    market: Market;
    runner: Runner;
    type: "BACK" | "LAY";
    odds: number;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<"winner" | "live" | "session" | "commentary">("winner");
  const defaultTabSetRef = useRef(false);
  const isMobile = useIsMobile();

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
    refetchInterval: 15000,
    refetchOnWindowFocus: false,
  });

  const matchWithMarkets = useMemo(() => {
    if (!baseMatch) return null;

    const normalizeMarket = (m: any) => ({
      ...m,
      runners: (m.runners || []).map((r: any) => ({
        ...r,
        backOdds: typeof r.backOdds === "string" ? parseFloat(r.backOdds) : r.backOdds,
        layOdds: typeof r.layOdds === "string" ? parseFloat(r.layOdds) : r.layOdds,
        back_odds: typeof r.back_odds === "string" ? parseFloat(r.back_odds) : r.back_odds,
        lay_odds: typeof r.lay_odds === "string" ? parseFloat(r.lay_odds) : r.lay_odds,
      })),
    });

    const base = (baseMatch.markets || []).map(normalizeMarket);
    const override = (marketsOverride || []).map(normalizeMarket);

    const mergedMap = new Map<string, any>();
    const keyFor = (m: any) => (m.id ? `id:${m.id}` : `name:${String(m.name || m.market_name || "").toLowerCase()}`);

    for (const m of override) mergedMap.set(keyFor(m), m);
    for (const m of base) {
      const k = keyFor(m);
      if (!mergedMap.has(k)) mergedMap.set(k, m);
    }

    return { ...baseMatch, markets: Array.from(mergedMap.values()) };
  }, [baseMatch, marketsOverride]);

  const match = matchWithMarkets;
    const isFinishedMatch = match?.status === "FINISHED";


  useEffect(() => {
    if (match && !defaultTabSetRef.current) {
      setActiveTab(match.status === "LIVE" ? "live" : "winner");
      defaultTabSetRef.current = true;
    }
  }, [match?.status]);

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
    refetchInterval: 15000,
  });

  const [ballFeed, setBallFeed] = useState<BallEventRow[]>([]);
  const [commentary, setCommentary] = useState<BallEventRow[]>([]);
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
          "ro_inning_number, ro_over_number, ro_ball_in_over, ro_sub_ball_number, ro_ball_key, ro_is_legal_delivery, ro_batsman_name, ro_non_striker_name, ro_bowler_name, ro_batsman_runs, ro_extras_runs, ro_total_runs, ro_is_wicket, ro_extra_type, ro_is_boundary, ro_is_six, ro_batsman_key, ro_non_striker_key, ro_bowler_key, ro_commentary, created_at"
        )
        .eq("match_id", dbMatchId)
        .or("ro_is_deleted.is.null,ro_is_deleted.eq.false")
        .order("created_at", { ascending: false })
        .limit(250);

      if (error) throw error;

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

      const mapped = (data ?? [])
        .map((row: any) => {
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
            non_striker_name:
              row.ro_non_striker_name || nameMap[row.ro_non_striker_key] || row.ro_non_striker_key || "—",
            bowler_name: row.ro_bowler_name || nameMap[row.ro_bowler_key] || row.ro_bowler_key || "—",
            runs: Number(row.ro_batsman_runs ?? 0),
            extras: Number(row.ro_extras_runs ?? 0),
            total_runs: totalRunsNum,
            is_wicket: wicket,
            is_extra: (row.ro_extras_runs ?? 0) > 0 || !!extraShort,
            extra_type: extraShort ? row.ro_extra_type ?? null : null,
            is_boundary: !!row.ro_is_boundary,
            is_six: !!row.ro_is_six,
            commentary: row.ro_commentary ?? null,
            created_at: row.created_at,
          };
        })
        .filter(Boolean) as BallEventRow[];

      const deduped = dedupeBallEvents(mapped);
      setBallFeed(deduped);
      setCommentary(deduped.filter((b) => (b.commentary || "").trim().length > 0));
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
        commentary: row.ro_commentary ?? null,
        created_at: row.created_at,
      };

      setBallFeed((prev) => {
        const filtered = prev.filter((b) => {
          const sameKey = mapped.ball_key && b.ball_key === mapped.ball_key;
          const sameTs = !mapped.ball_key && b.created_at === mapped.created_at;
          return !(sameKey || sameTs);
        });
        const next = dedupeBallEvents([mapped, ...filtered]);
        const withComment = next.filter((b) => (b.commentary || "").trim().length > 0);
        setCommentary(withComment);
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
  const inningScoreFromDb = useMemo(
    () => deriveScoreFromBallEvents(effectiveEvents, activeInning),
    [effectiveEvents, activeInning]
  );

  const [stablePlayers, setStablePlayers] = useState({
    striker: { name: "—", runs: "—", balls: "—" },
    nonStriker: { name: "—", runs: "—", balls: "—" },
    bowler: { name: "—", runs: 0, wkts: 0, econ: "", overs: "—", maidens: 0, fig: "—", compact: "—" },
  });

  useEffect(() => {
    setStablePlayers((prev) => {
      const next = { ...prev };
      const hasStriker = derived.striker.name && derived.striker.name !== "—";
      const hasNon = derived.nonStriker.name && derived.nonStriker.name !== "—";
      const hasBowler = derived.bowler.name && derived.bowler.name !== "—";

      if (hasStriker) next.striker = derived.striker;
      if (hasNon) next.nonStriker = derived.nonStriker;
      if (hasBowler) next.bowler = derived.bowler;
      return next;
    });
  }, [derived.striker, derived.nonStriker, derived.bowler]);

  const displayStriker = derived.striker.name !== "—" ? derived.striker : stablePlayers.striker;
  const displayNonStriker = derived.nonStriker.name !== "—" ? derived.nonStriker : stablePlayers.nonStriker;
  const displayBowler = derived.bowler.name !== "—" ? derived.bowler : stablePlayers.bowler;

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

  useEffect(() => {
    const subId = dbMatchId || params?.id;
    if (!subId) return;

    wsClient.subscribeToMatch(subId);

    const unsubScore = wsClient.on<MatchScoreUpdate>("match:score", (data) => {
      if (data.matchId === subId) {
        setLiveScore((prev) => mergeLiveScore(prev, data));
        queryClient.invalidateQueries({ queryKey: ["realtime", subId] });
      }
    });

    const unsubBall = wsClient.on<BallResult>("match:ball", (data) => {
      if (data.matchId === subId) {
        setLastBall((prev) => mergeBallResult(prev, data));
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
  const rrr = required && required.balls > 0 ? ((required.runs / required.balls) * 6).toFixed(2) : null;

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

  const lastOverRuns = useMemo(() => {
    const overNum = Math.floor(toNum(authoritativeOverForText, 0));
    const prev = overNum - 1;
    if (prev < 0) return null;
    const rows = (effectiveEvents ?? []).filter(
      (e) => toNum(e.inning, 1) === activeInning && Math.floor(toNum(e.over, 0)) === prev
    );
    if (!rows.length) return null;
    return rows.reduce((sum, e) => sum + toNum(e.total_runs, toNum(e.runs) + toNum(e.extras)), 0);
  }, [effectiveEvents, activeInning, authoritativeOverForText]);

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
  }, [pulseOverEvents]);

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
          ((m as any).market_status === "OPEN" || (m as any).status === "OPEN" || (m as any).marketStatus === "OPEN")
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

  const addBallOffset = (over: number, ball: number, offset: number) => {
    // ball numbers assumed 1-6
    let o = over;
    let b = ball + offset;
    while (b > 6) {
      b -= 6;
      o += 1;
    }
    return { over: o, ball: b };
  };

  const activeNextBallMarket = useMemo(() => {
    if (openNextBallMarkets.length === 0) return null;
    const currentInningMarkets = openNextBallMarkets.filter(
      (m) => toNum((m as any).ro_inning_number ?? (m as any).inning_number ?? 1, 1) === activeInning
    );
    const latestOver = toNum(latestInningBall?.over, -1);
    const latestBallNum = toNum(latestInningBall?.ball, 0);

    const { over: targetOver, ball: targetBall } = addBallOffset(latestOver, latestBallNum, 2);

    const nextForCurrent = currentInningMarkets.find((m) => {
      const over = toNum((m as any).ro_over_number ?? (m as any).over_number ?? 0, 0);
      const ball = toNum((m as any).ro_ball_number ?? (m as any).ball_number ?? 0, 0);
      return over > targetOver || (over === targetOver && ball >= targetBall);
    });
    if (nextForCurrent) return nextForCurrent;
    if (currentInningMarkets.length > 0) return currentInningMarkets[currentInningMarkets.length - 1];
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
          ((m as any).market_status === "OPEN" || (m as any).status === "OPEN" || (m as any).marketStatus === "OPEN")
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
    const currentInningMarkets = openNextOverMarkets.filter((m) => toNum((m as any).ro_inning_number ?? 1, 1) === activeInning);
    const latestOver = toNum(latestInningBall?.over, -1);
    const futureForCurrent = currentInningMarkets.filter((m) => toNum((m as any).ro_over_number ?? 0, 0) > latestOver);
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

  const openNextWicketMarkets = useMemo(() => {
    return (instanceMarkets as InstanceMarket[])
      .filter(
        (m) =>
          (m.instance_type || (m as any).instanceType) === "NEXT_WICKET_METHOD" &&
          ((m as any).market_status === "OPEN" || (m as any).status === "OPEN" || (m as any).marketStatus === "OPEN")
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
    const currentInningMarkets = openNextWicketMarkets.filter((m) => toNum((m as any).ro_inning_number ?? 1, 1) === activeInning);
    if (currentInningMarkets.length > 0) return currentInningMarkets[0];
    return openNextWicketMarkets[0];
  }, [openNextWicketMarkets, activeInning]);

  const onPickOutcome = (m: InstanceMarket, o: InstanceOutcome, pos?: { x: number; y: number }) => {
    setSelectedMarket(m);
    setSelectedOutcome(o);
    if (pos) setBetAnchor(pos);
    else if (typeof window !== "undefined") {
      setBetAnchor({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    }
  };

  const matchWinnerMarket = useMemo(() => {
    if (!match?.markets) return null;
    return (
      match.markets.find((m: any) => String(m.name || m.market_name || "").toLowerCase() === "match winner") || null
    );
  }, [match?.markets]);

  const tossMarket = useMemo(() => {
    if (!match?.markets) return null;
    return (
      match.markets.find((m: any) => {
        const n = String(m.name || m.market_name || "").toLowerCase();
        return n === "toss" || n.includes("toss") || n.includes("coin");
      }) || null
    );
  }, [match?.markets]);

  const winSplit = useMemo(() => {
    if (!match || !matchWinnerMarket) return null;
    const runners = matchWinnerMarket.runners || [];
    if (runners.length === 0) return null;

    type RunnerEntry = { name: string; team: string | null; implied: number | null };
    const mapped: RunnerEntry[] = runners
      .map((r: any): RunnerEntry => {
        const name = r.name || r.runner_name || "";
        const odds = Number(r.backOdds ?? r.back_odds);
        const probMeta = Number(r.probability ?? r.prob ?? r.implied_prob);
        let implied = Number.isFinite(probMeta) ? probMeta : Number.isFinite(odds) && odds > 1.01 ? 1 / odds : null;
        if (implied && implied > 1) implied = implied / 100;
        const team = mapToHomeAwayTeam(name, match.homeTeam, match.awayTeam) ?? null;
        return { name, team, implied: implied ?? null };
      })
      .filter(
        (r: RunnerEntry): r is Required<RunnerEntry> =>
          !!r.team && r.implied !== null && Number.isFinite(r.implied)
      );

    if (mapped.length === 0) return null;
    const sum = mapped.reduce((s, r) => s + (r.implied ?? 0), 0) || 1;
    const pct = (team: string) => {
      const entry = mapped.find((r) => strictTeamEquals(r.team, team) || fuzzyTeamMatch(r.team, team));
      if (!entry) return null;
      return entry.implied == null ? null : Math.max(0, Math.min(100, (entry.implied / sum) * 100));
    };

    const homePct = pct(match.homeTeam);
    const awayPct = pct(match.awayTeam);

    if (homePct === null || awayPct === null) {
      return { homePct: 50, awayPct: 50 };
    }
    const scale = homePct + awayPct === 0 ? 1 : 100 / (homePct + awayPct);
    return { homePct: homePct * scale, awayPct: awayPct * scale };
  }, [match, matchWinnerMarket]);

  const sessionMarkets = useMemo(() => {
    return (instanceMarkets as InstanceMarket[]).filter((m) => (m.instance_type || (m as any).instanceType) === "OVER_RUNS");
  }, [instanceMarkets]);

  const onPickRunner = (runner: any, market: any, type: "BACK" | "LAY" = "BACK") => {
    if (!match) return;
    if (match.status === "FINISHED") {
      toast({
        title: "Betting closed",
        description: "This match is completed. New bets are not allowed.",
        variant: "destructive",
      });
      return;
    }

    const back = Number(runner.backOdds ?? runner.back_odds ?? 0);
    const layVal = Number(runner.layOdds ?? runner.lay_odds);
    const lay = Number.isFinite(layVal) ? layVal : back;
    const odds = type === "BACK" ? back : lay || back;

    setSelectedBet({
      match,
      market,
      runner: {
        ...(runner as Runner),
        name: runner.name || runner.runner_name,
      } as Runner,
      type,
      odds,
    });
  };

  const handleInstanceBet = async (market: InstanceMarket, outcome: InstanceOutcome) => {
    if (placingQuick) return;
    // 🚫 If match is finished, don't allow any instance bets
    if (!match || match.status === "FINISHED") {
      toast({
        title: "Betting closed",
        description: "This match is completed. Live plays are closed.",
        variant: "destructive",
      });
      setSelectedOutcome(null);
      setSelectedMarket(null);
      return;
    }

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
      setPlacingQuick(true);
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
      setBetAnchor(null);

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
    } finally {
      setPlacingQuick(false);
    }
  };


  const winDisplay = winSplit || { homePct: 50, awayPct: 50 };
  const homeWinPct = Math.max(0, Math.min(100, winDisplay.homePct));
  const awayWinPct = Math.max(0, Math.min(100, winDisplay.awayPct));

  const strikerRuns = displayStriker.runs;
  const strikerBalls = displayStriker.balls;
  const nonStrikerRuns = displayNonStriker.runs;
  const nonStrikerBalls = displayNonStriker.balls;

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
          <Button variant="outline" className="mt-4" onClick={() => (window.location.href = "/")}>
            Back to Dashboard
          </Button>
        </div>
      </AppShell>
    );
  }

  const matchTitle = `${match.homeTeam} vs ${match.awayTeam}`;
  const matchShortDate = formatShortDayTime(match.startTime);

  const latestSix = pulseResults.slice(-6);
  const slots = Array.from({ length: 6 }, (_, idx) => latestSix[idx] ?? null);
  const currentIndex = latestSix.length - 1;

  const circleClasses = (label?: string, isCurrent?: boolean) =>
    cn(
      "h-7 rounded-full flex items-center justify-center border border-[#E5E7EB] text-[10px] font-semibold leading-none",
      label ? chipStyle(label) : "bg-[#F6F8FB] text-[#6C757D]",
      isCurrent && "ring-2 ring-[#1ABC9C66]"
    );

  const ballTimeline = (
    <>
      <div className="flex items-center justify-between text-[11px] text-[#7A7F87]">
        <span className="flex items-center gap-1">
          <Activity className="h-3 w-3 text-[#1ABC9C]" />
          This over
        </span>
        <span>{lastOverRuns !== null ? `Last over: ${lastOverRuns} runs` : `Runs: ${thisOverRuns}`}</span>
      </div>
      <div className="mt-1 grid grid-cols-6 gap-1">
        {slots.map((slot, idx) => (
          <div key={`ball-slot-${idx}`} className={circleClasses(slot?.label, idx === currentIndex)}>
            {slot?.label || ""}
          </div>
        ))}
      </div>
    </>
  );

  // ✅ make batsman score more visible (higher contrast + bolder numbers)
 const playerBar = (
  <div className="border-t border-[#E5E0D6] pt-1.5 mt-1.5">
    <div className="flex items-start justify-between gap-3">
      {/* Left: batsmen stacked */}
      <div className="flex-[2] min-w-0">
        <div className="flex flex-col gap-1">
          {/* Striker */}
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-[12px] text-[#111827] truncate min-w-0 flex items-center gap-1">
              <span className="text-[#27AE60]">●</span>
              <span className="truncate">{lastKnownBatsRef.current.striker}</span>
            </p>
            <span className="shrink-0 font-mono tabular-nums font-semibold text-[#111827] text-[12px]">
              {strikerRuns}/{strikerBalls}
            </span>
          </div>

          {/* Non-striker */}
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-[12px] text-[#111827] truncate min-w-0 flex items-center gap-1">
              <span className="text-[#B0B7C3]">●</span>
              <span className="truncate">{lastKnownBatsRef.current.non}</span>
            </p>
            <span className="shrink-0 font-mono tabular-nums font-semibold text-[#111827] text-[12px]">
              {nonStrikerRuns}/{nonStrikerBalls}
            </span>
          </div>
        </div>
      </div>

      {/* Right: bowler */}
      <div className="flex-1 min-w-0 text-right">
        <p className="text-[12px] text-[#111827] truncate">
          Bowling: {displayBowler.name}
        </p>
        <p className="text-[11px] text-[#6B7280]">{displayBowler.fig}</p>
        <p className="text-[11px] text-[#6B7280]">
          Economy {displayBowler.econ || "—"}
        </p>
      </div>
    </div>
  </div>
);

  const renderRunnerRow = (r: any, market: any, bettingDisabled: boolean) => {
    const back = Number(r.backOdds ?? r.back_odds ?? 0);
    const lay = Number(r.layOdds ?? r.lay_odds ?? 0);
    const hasLay = lay > 1.01;
    const teamName = r.name || r.runner_name;
    const lastTradedBack = Number.isFinite(back) ? back.toFixed(2) : "—";
    const lastTradedLay = hasLay ? lay.toFixed(2) : "—";

    const tileBase = "h-full w-full rounded-xl px-3 py-2 text-left transition";

    return (
      <div
        key={r.id}
        className="grid grid-cols-[1.4fr_1fr_1fr] items-stretch gap-2 rounded-xl bg-white"
      >
        <div className="min-w-0 flex flex-col justify-center">
          <p className="text-[14px] font-semibold text-[#0F172A] truncate">{teamName}</p>
          <p className="text-[12px] text-[#374151]">Last traded: {lastTradedBack} / {lastTradedLay}</p>
        </div>
        <button
          className={cn(
            tileBase,
            "bg-[#E3F4E8] text-[#0B1B31] rounded-lg",
            bettingDisabled && "opacity-60 cursor-not-allowed"
          )}
          disabled={bettingDisabled}
          onClick={() => {
            if (bettingDisabled) return;
            onPickRunner(r, market, "BACK");
          }}
        >
          <div className="text-[13px] font-semibold">{lastTradedBack}</div>
          <div className="text-[11px] text-[#0B1B31]">Back</div>
        </button>
        <button
          className={cn(
            tileBase,
            "bg-[#FDE8EB] text-[#0B1B31] rounded-lg",
            (!hasLay || bettingDisabled) && "opacity-60 cursor-not-allowed"
          )}
          disabled={bettingDisabled || !hasLay}
          onClick={() => {
            if (bettingDisabled || !hasLay) return;
            onPickRunner(r, market, "LAY");
          }}
        >
          <div className="text-[14px] font-bold">{lastTradedLay}</div>
          <div className="text-[11px] text-[#0B1B31] font-semibold">Lay</div>
        </button>
      </div>
    );
  };


  // ✅ darker % text (label removed per request)
  const renderProbabilityBar = () => (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px] text-[#0F172A] font-semibold">
        <span className="truncate pr-2">{match.homeTeam} · {homeWinPct.toFixed(1)}%</span>
        <span className="truncate pl-2 text-right">{awayWinPct.toFixed(1)}% · {match.awayTeam}</span>
      </div>
      <div className="relative h-2 rounded-full bg-[#D9DEE5] overflow-hidden">
        <div className="absolute inset-y-0 left-0 bg-[#8FD1AE]" style={{ width: `${homeWinPct}%` }} />
        <div className="absolute inset-y-0 right-0 bg-[#F2A7B3]" style={{ width: `${awayWinPct}%` }} />
        <div
          className="absolute -translate-x-1/2 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-white border border-[#9CA3AF]"
          style={{ left: `${homeWinPct}%` }}
        />
      </div>
    </div>
  );

  // ✅ simpler winner card (no extra random headings)
  const renderMatchWinnerCard = () => {
    if (!matchWinnerMarket) {
      return (
        <Card className={cn("border border-[#E5E7EB] bg-[#F6F8FB]", softShadow)}>
          <CardContent className="p-4">
            <p className="text-[13px] text-[#6C757D]">Match Winner market not available.</p>
          </CardContent>
        </Card>
      );
    }

    const rawStatus =
      (matchWinnerMarket as any)?.status || (matchWinnerMarket as any)?.market_status || "—";
    const statusText = String(rawStatus).toUpperCase();

    // 🔒 Betting disabled if match completed, or market is not OPEN
    const bettingDisabled = isFinishedMatch || statusText !== "OPEN";

    return (
      <Card className={cn("border border-[#94A3B8] bg-white shadow-xl", softShadow)}>
        <CardContent className="p-4 space-y-3">
          <div className="flex justify-end">
            <span className="px-2 py-0.5 rounded-full border border-[#94A3B8] text-[11px] text-[#0B1B31] font-semibold">
              {isFinishedMatch ? "FINISHED" : statusText}
            </span>
          </div>

          {isFinishedMatch && (
            <p className="text-[11px] text-[#DC2626] mt-0.5">
              Match completed · betting closed
            </p>
          )}

          {renderProbabilityBar()}

          <div className="grid gap-2">
            {(matchWinnerMarket.runners || []).map((r: any) =>
              renderRunnerRow(r, matchWinnerMarket, bettingDisabled),
            )}
          </div>
        </CardContent>
      </Card>
    );
  };


  const renderTossCard = () => {
    if (!tossMarket) return null;
    const statusText = String((tossMarket as any)?.market_status || (tossMarket as any)?.status || "—").toUpperCase();
    const disabled = statusText !== "OPEN";

    return (
      <Card className={cn("border border-[#CBD5E1] bg-white shadow-lg", softShadow)}>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-base font-semibold text-[#0B1B31]">Toss Winner</p>
            <span className="px-2 py-0.5 rounded-full border border-[#94A3B8] text-[11px] text-[#0B1B31]">
              {statusText}
            </span>
          </div>
          {((tossMarket?.runners as any[]) || []).length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {tossMarket.runners.map((r: any) => {
                const back = Number(r.backOdds ?? r.back_odds ?? 1.9);
                return (
                  <div
                    key={r.id}
                    className="rounded-xl border border-[#E5E7EB] bg-[#F6F8FB] p-3 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-[#111827] truncate">{r.name || r.runner_name}</p>
                      <p className="text-[11px] text-[#6C757D]">Odds {back.toFixed(2)}</p>
                    </div>
                    <Button
                      size="sm"
                      className="h-9 px-3 rounded-lg bg-[#1ABC9C] text-white hover:bg-[#159b82]"
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
            <p className="text-[12px] text-[#6C757D]">Toss market not available yet.</p>
          )}
        </CardContent>
      </Card>
    );
  };

  // ✅ next ball market uses SAME compact 2-row grid (like other compact markets)
  const renderNextDeliveryMarketCompact = () => {
    if (!activeNextBallMarket) {
      return (
        <Card className={cn("border border-[#CBD5E1] bg-white shadow-lg", softShadow)}>
          <CardContent className="p-3 text-[12px] text-[#0B1B31] font-semibold">No next-ball market right now.</CardContent>
        </Card>
      );
    }

    const over = toNum((activeNextBallMarket as any).ro_over_number ?? (activeNextBallMarket as any).over_number ?? 0, 0);
    const ball = toNum((activeNextBallMarket as any).ro_ball_number ?? (activeNextBallMarket as any).ball_number ?? 1, 1);
    const fallbackClose = new Date(Date.now() + 25_000).toISOString();
    const displayMarket = { ...activeNextBallMarket, close_time: (activeNextBallMarket as any).close_time ?? fallbackClose };
    return (
      <CompactMarketGrid
        market={displayMarket as any}
        title={`Next Delivery Result • Over ${over} · Ball ${ball}`}
        onPick={onPickOutcome}
        selectedOutcomeId={selectedMarket?.id === activeNextBallMarket.id ? selectedOutcome?.id : null}
        timeRemaining={timeRemaining}
        maxCells={6}
      />
    );
  };

  const renderCompactMarket = (m: InstanceMarket, label: string) => (
    <CompactMarketGrid
      key={m.id}
      market={m}
      title={label}
      onPick={onPickOutcome}
      selectedOutcomeId={selectedMarket?.id === m.id ? selectedOutcome?.id : null}
      timeRemaining={timeRemaining}
      maxCells={6}
    />
  );

  const renderSquadsCard = () => (
    <Card className={cn("border border-[#E5E7EB] bg-[#F6F8FB]", softShadow)}>
      <CardContent className="p-3 sm:p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-[#111827]">Squads</p>
            <p className="text-[11px] text-[#6C757D]">Playing XI and bench (Roanuz)</p>
          </div>
          <Badge className="bg-[#F6F8FB] border border-[#E5E7EB] text-[10px] px-2 py-0.5 text-[#6C757D]">Latest</Badge>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { side: "home", label: match.homeTeam, data: squadsData?.home },
            { side: "away", label: match.awayTeam, data: squadsData?.away },
          ].map(({ side, label, data }) => (
            <div key={side} className="rounded-2xl border border-[#E5E7EB] bg-[#F6F8FB] p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-semibold text-[#111827] truncate">{label}</p>
                <div className="text-[10px] text-[#6C757D]">Playing XI</div>
              </div>
              {data ? (
                <>
                  <ul className="space-y-1.5">
                    {data.playingXi.map((p, idx) => {
                      const isCaptain = data.captain && p === data.captain;
                      const isKeeper = data.keeper && p === data.keeper;
                      return (
                        <li key={`${side}-xi-${p}-${idx}`} className="flex items-center gap-2">
                          <span className="text-[11px] text-[#6C757D] w-5 text-right">{idx + 1}.</span>
                          <span className="text-[12px] text-[#111827] truncate flex-1">{p}</span>
                          <span className="flex items-center gap-1 text-[10px] text-[#1ABC9C]">
                            {isCaptain && (
                              <span className="rounded-full bg-[#E8F6F1] px-1.5 py-0.5 border border-[#1ABC9C33]">C</span>
                            )}
                            {isKeeper && (
                              <span className="rounded-full bg-[#E8F6F1] px-1.5 py-0.5 border border-[#1ABC9C33]">WK</span>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {data.bench.length > 0 && (
                    <div className="pt-2 border-t border-[#E5E7EB]">
                      <p className="text-[11px] text-[#6C757D] mb-1">Bench</p>
                      <div className="flex flex-wrap gap-1">
                        {data.bench.map((p) => (
                          <span
                            key={`${side}-bench-${p}`}
                            className="text-[11px] text-[#111827] bg-[#F8F9FA] border border-[#E5E7EB] px-2 py-0.5 rounded-full"
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-[12px] text-[#6C757D]">Squad not available yet.</p>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );

  const renderSessionCard = (m: InstanceMarket) => {
    const statusText = String((m as any).market_status || (m as any).status || "").toUpperCase();
    const suspended = statusText === "SUSPENDED";
    const settled = statusText === "SETTLED";
    const disabled = suspended || settled;

    return (
      <Card key={m.id} className={cn("border border-[#E5E7EB] bg-[#F6F8FB]", softShadow)}>
        <CardContent className="p-3 sm:p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-[#111827] truncate">
                {(m as any).market_title || (m as any).name || "Session market"}
              </p>
              <p className="text-[11px] text-[#6C757D]">
                {(m as any).metadata?.description || (m as any).score_note || `Line: ${(m as any).line ?? (m as any).target ?? "—"}`}
              </p>
            </div>
            <span
              className={cn(
                "px-2 py-0.5 rounded-full border text-[11px]",
                suspended ? ui.suspendedBg : "bg-[#F6F8FB]",
                "border-[#E5E7EB]",
                suspended ? ui.suspendedText : ui.textMuted
              )}
            >
              {settled ? "SETTLED" : suspended ? "SUSPENDED" : statusText || "OPEN"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {(m.outcomes || []).map((o) => {
              const odds = Number(o.odds ?? 0).toFixed(2);
              return (
                <button
                  key={o.id}
                  disabled={disabled}
                  onClick={() => onPickOutcome(m, o)}
                  className={cn(
                    "rounded-xl border border-[#E5E7EB] bg-[#F6F8FB] px-3 py-2 text-left transition hover:shadow-sm",
                    selectedOutcome?.id === o.id && selectedMarket?.id === m.id && "bg-[#E8F6F1] ring-1 ring-[#1ABC9C]",
                    disabled && "opacity-60 cursor-not-allowed"
                  )}
                >
                  <p className="text-[11px] text-[#6C757D] truncate">{o.name}</p>
                  <p className="text-[15px] font-semibold text-[#111827]">{odds}</p>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderSessionMarkets = () => {
    if (sessionMarkets.length === 0) {
      return (
        <Card className={cn("border border-[#E5E7EB] bg-[#F6F8FB]", softShadow)}>
          <CardContent className="p-3 text-[12px] text-[#6C757D]">No session markets available yet.</CardContent>
        </Card>
      );
    }

    const groups: Record<string, InstanceMarket[]> = { CURRENT: [], UPCOMING: [], COMPLETED: [] };
    sessionMarkets.forEach((m) => {
      const status = String((m as any).market_status || (m as any).status || "").toUpperCase();
      if (status === "SETTLED") groups.COMPLETED.push(m);
      else if (status === "OPEN") groups.CURRENT.push(m);
      else if (status === "SUSPENDED") groups.CURRENT.push(m);
      else groups.UPCOMING.push(m);
    });

    const order = [
      { key: "CURRENT", label: "CURRENT SESSIONS" },
      { key: "UPCOMING", label: "UPCOMING SESSIONS" },
      { key: "COMPLETED", label: "COMPLETED" },
    ];

    return (
      <div className="space-y-2">
        {order.map((g) =>
          groups[g.key].length ? (
            <div key={g.key} className="space-y-1.5">
              <p className="text-[11px] text-[#6C757D] tracking-[0.05em]">{g.label}</p>
              <div className="space-y-1.5">{groups[g.key].map((m) => renderSessionCard(m))}</div>
            </div>
          ) : null
        )}
      </div>
    );
  };

  const renderCommentaryTab = () => {
    const items = commentary
      .filter((c) => (c.commentary || "").trim().length > 0)
      .slice()
      .sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));

    const renderCommentaryText = (raw: string) => {
      const clean = raw.replace(/<\/?[^>]+(>|$)/g, "");
      const parts = clean.split(/(\d+\s*runs?)/gi);
      return parts.map((part, idx) => {
        const isRuns = /^\d+\s*runs?$/i.test(part.trim());
        return isRuns ? (
          <span key={`run-${idx}`} className="font-semibold text-[#0B8A5F]">
            {part}
          </span>
        ) : (
          <span key={`txt-${idx}`}>{part}</span>
        );
      });
    };

    return (
      <div className="w-full">
        {items.length === 0 ? (
          <div className="p-4 text-[12px] text-[#6C757D]">No commentary yet.</div>
        ) : (
          <ScrollArea className="h-[70vh] w-full">
            <div className="divide-y divide-[#E5E7EB] pb-6">
              {items.map((c, idx) => {
                const overLabel = `${c.over}.${c.ball}`;
                const outcome = outcomeFromBallEvent(c) || "·";

                return (
                  <div
                    key={`${c.ball_key || "row"}-${c.created_at}-${idx}`}
                    className="px-3 sm:px-4 py-3.5"
                  >
                    <div className="flex items-start gap-3.5">
                      <div
                        className={cn(
                          "h-11 w-11 rounded-full flex items-center justify-center text-[14px] font-semibold",
                          chipStyle(outcome)
                        )}
                      >
                        {outcome}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-[12px] text-[#6B7280] mb-0.5">
                          <span className="font-mono tabular-nums text-[#0F172A] font-semibold text-[12px]">{overLabel}</span>
                          <span>·</span>
                          <span>{new Date(c.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                        <p className="text-[14px] leading-[1.55] text-[#0F172A] whitespace-pre-line">
                          {renderCommentaryText(c.commentary || "")}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </div>
    );
  };

  const inningsBreak = statusNote && /innings break/i.test(String(statusNote));

  return (
    <AppShell hideHeader hideBottomNav fullBleed>
      <div className={cn("min-h-screen pb-24", ui.bg)}>
        <div className="max-w-5xl mx-auto px-3 sm:px-4 pt-3 space-y-2">
          <Card className={cn("rounded-2xl border border-[#94A3B8] px-3 sm:px-4 py-3 shadow-xl", ui.card, ui.border, softShadow)}>
            <CardContent className="p-0 space-y-2">
              <div className="flex items-center gap-2 text-[11px] text-[#6C757D]">
                <button
                  type="button"
                  onClick={() => (window.history.length > 1 ? window.history.back() : (window.location.href = "/"))}
                  className="inline-flex items-center gap-1 rounded-full border border-[#E5E7EB] bg-white px-3 py-1 text-[12px] font-medium text-[#1F2937] hover:bg-[#F3F4F6] transition"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </button>

                <div className="flex-1" />

                {/* Right: live/status & innings break */}
                <div className="flex items-center gap-2 justify-end min-w-[140px]">
                  {inningsBreak && (
                    <span className="px-2 py-0.5 rounded-full bg-[#FEF3C7] text-[#92400E] text-[11px]">
                      Innings Break
                    </span>
                  )}
                  {isLive ? (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-[#1ABC9C33] text-[11px] font-medium text-[#1ABC9C]">
                      <span className="h-2 w-2 rounded-full bg-[#1ABC9C] animate-pulse" />
                      LIVE
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full border border-[#E5E7EB] text-[11px] font-medium text-[#374151] bg-[#F6F8FB]">
                      {match.status}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] text-[#6B7280]">
                <span className="hidden sm:inline">{matchTitle}</span>
                {!isLive && <span className="ml-auto">{matchShortDate}</span>}
              </div>

              <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <TeamBadge name={match.homeTeam} banner={match.homeTeamBanner} />
              </div>

                <div className="text-center min-w-[106px]">
                  <p className="text-[20px] sm:text-[22px] font-semibold text-[#111827] font-mono tabular-nums leading-none">
                    {String(totalScore)}
                    </p>
                  <p className="text-[11px] text-[#6B7280]">
                    {isLive ? `Over ${overText}` : countdown || matchShortDate}
                  </p>
                </div>

              <div className="flex items-center gap-2 min-w-0 justify-end">
                  <TeamBadge name={match.awayTeam} banner={match.awayTeamBanner} />
                </div>
              </div>

              <div className="flex items-center gap-2 text-[11px] text-[#6B7280]">
                {/* Left spacer (keeps center truly centered even when right text exists) */}
                <div className="shrink-0 w-[52px]" />

                {/* Center already handled above; keep this row for target/rrr only */}
                <div className="flex-1 min-w-0 flex justify-center" />

                {/* Right: target/rrr */}
                <div className="shrink-0 text-right font-mono tabular-nums">
                  {target ? `Target ${target}` : ""}
                  {target && rrr ? " · " : ""}
                  {rrr ? `RRR ${rrr}` : ""}
                </div>
              </div>

              {isLive && playerBar}
            </CardContent>
          </Card>

          {isLive && pulseResults.length > 0 && (
            <Card className={cn("rounded-2xl border px-3 sm:px-4 py-2.5", ui.card, ui.border, softShadow)}>
              <CardContent className="p-0">{ballTimeline}</CardContent>
            </Card>
          )}

          {/* Tabs */}
          <div className="mt-0.5">
            <div className="grid grid-cols-4 w-full rounded-full border border-[#E5E7EB] bg-[#FDFBF6] p-0.5 text-[13px] overflow-hidden">
              {[
                { key: "winner" as const, label: "Winner" },
                { key: "live" as const, label: "Live Play" },
                { key: "session" as const, label: "Session" },
                { key: "commentary" as const, label: "Commentary" },
              ].map((t) => {
                const isActiveTab = activeTab === t.key;
                return (
                  <button
                    key={t.key}
                    className={cn(
                      "w-full h-10 px-3 sm:px-4 rounded-full transition-colors text-center flex items-center justify-center",
                      isActiveTab ? "bg-[#1ABC9C] text-white shadow-sm" : "text-[#4B5563]"
                    )}
                    onClick={() => setActiveTab(t.key)}
                  >
                    {t.label}
                    {t.key === "live" && isLive && (
                      <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-white/80 align-middle" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Content */}
          {activeTab === "live" && (
            <div className="space-y-2.5">
              {renderNextDeliveryMarketCompact()}
              {activeNextOverMarkets.length > 0 && (
                <div className="space-y-1.5">{activeNextOverMarkets.map((m) => renderCompactMarket(m, nextOverLabel(m)))}</div>
              )}
              {activeNextWicketMarket &&
                renderCompactMarket(activeNextWicketMarket, (activeNextWicketMarket as any).market_title || "Next wicket dismissal")}
            </div>
          )}

          {activeTab === "winner" && (
            <div className="space-y-2.5">
              {renderMatchWinnerCard()}
              {tossMarket && renderTossCard()}
              {match.status === "UPCOMING" && squadsData && (squadsData.home || squadsData.away) && renderSquadsCard()}
            </div>
          )}

          {activeTab === "session" && <div className="space-y-2.5">{renderSessionMarkets()}</div>}
          {activeTab === "commentary" && <div className="space-y-2.5">{renderCommentaryTab()}</div>}
        </div>
      </div>

      {/* Stake sheets */}
      <QuickBetSheet
        open={!!selectedMarket && !!selectedOutcome}
        market={selectedMarket}
        outcome={selectedOutcome}
        stake={instanceStake}
        setStake={setInstanceStake}
        onClose={() => {
          setSelectedOutcome(null);
          setSelectedMarket(null);
          setBetAnchor(null);
        }}
        onPlace={() => {
          if (selectedMarket && selectedOutcome) handleInstanceBet(selectedMarket, selectedOutcome);
        }}
        anchor={betAnchor}
        placing={placingQuick}
        currencySymbol={currentUser?.currency || "₹"}
      />

      {!isMobile && selectedBet && (
        <div className="fixed bottom-6 right-6 z-50 w-[360px]">
          <BetSlip selectedBet={selectedBet} onClear={() => setSelectedBet(null)} variant="compact" />
        </div>
      )}

      <Sheet open={!!selectedBet && isMobile} onOpenChange={(open) => !open && setSelectedBet(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl p-0 h-auto pb-6">
          <SheetTitle className="sr-only">Bet Slip</SheetTitle>
          <SheetDescription className="sr-only">Choose your selection, stake, and place the bet.</SheetDescription>
          <div className="p-3">
            <MobileBetSlip selectedBet={selectedBet} onClear={() => setSelectedBet(null)} />
          </div>
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}
