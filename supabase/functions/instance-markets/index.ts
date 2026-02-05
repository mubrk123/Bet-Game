import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { supabase, handlePreflight, error, success } from "../_shared/utils.ts";

type RequestBody = {
  matchId?: string;
  match_id?: string; // allow both
  statuses?: string[];
};

type MatchRow = {
  id: string;
  status: string;
  current_over: number | null;
  current_ball: number | null;
  current_inning?: number | null;
  match_type?: string | null;
};

const NEXT_OVER_CATEGORY_CODES: Record<"RUNS" | "WICKET" | "BOUNDARY", number> = {
  RUNS: 1,
  WICKET: 2,
  BOUNDARY: 3,
};

function maxOversForMatchType(matchType?: string | null) {
  const mt = (matchType || "").toLowerCase();
  if (mt.includes("t10")) return 10;
  if (
    mt.includes("t20") ||
    mt.includes("ipl") ||
    mt.includes("sa20") ||
    mt.includes("psl") ||
    mt.includes("bbl") ||
    mt.includes("cpl")
  )
    return 20;
  if (mt.includes("odi") || mt.includes("50")) return 50;
  if (mt.includes("test")) return Infinity;
  return 20;
}

/**
 * Close time should be roughly "end of CURRENT over",
 * because this NEXT_OVER market is "1 over ahead".
 */
function estimateNextOverCloseTime(currentBall?: number | null) {
  const ball = Math.max(0, Math.trunc(Number(currentBall ?? 0)));
  // ball is typically 1..6. If 0/unknown, assume 1.
  const legalBall = Math.min(6, Math.max(1, ball));
  const ballsLeft = Math.max(0, 6 - legalBall);
  const seconds = Math.max(30, (ballsLeft + 1) * 25);
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function buildNextOverConfigs(match: MatchRow, inning: number, targetOverHuman: number) {
  const closeTime = estimateNextOverCloseTime(match.current_ball);

  const runOutcomes = [
    { id: "RUNS_0_3", name: "0-3 runs", odds: 3.25, probability: 0.28, min: 0, max: 3 },
    { id: "RUNS_4_6", name: "4-6 runs", odds: 2.4, probability: 0.35, min: 4, max: 6 },
    { id: "RUNS_7_10", name: "7-10 runs", odds: 2.9, probability: 0.25, min: 7, max: 10 },
    { id: "RUNS_11_PLUS", name: "11+ runs", odds: 5.5, probability: 0.12, min: 11, max: null as number | null },
  ];

  return [
    {
      category: "RUNS" as const,
      ballNumber: NEXT_OVER_CATEGORY_CODES.RUNS,
      name: `Runs in Over ${targetOverHuman}`,
      description: "Predict the total runs in the upcoming over.",
      outcomes: runOutcomes,
      metadata: {
        category: "RUNS",
        brackets: runOutcomes.map((o) => ({ id: o.id, min: o.min, max: o.max })),
        // IMPORTANT: target_over is HUMAN (1-based)
        target_over: targetOverHuman,
        inning_number: inning,
      },
    },
    {
      category: "WICKET" as const,
      ballNumber: NEXT_OVER_CATEGORY_CODES.WICKET,
      name: `Wicket in Over ${targetOverHuman}?`,
      description: "Will a wicket fall in the upcoming over?",
      outcomes: [
        { id: "WICKET_YES", name: "Yes, wicket falls", odds: 3.1, probability: 0.28 },
        { id: "WICKET_NO", name: "No wicket", odds: 1.45, probability: 0.72 },
      ],
      metadata: {
        category: "WICKET",
        target_over: targetOverHuman,
        inning_number: inning,
      },
    },
    {
      category: "BOUNDARY" as const,
      ballNumber: NEXT_OVER_CATEGORY_CODES.BOUNDARY,
      name: `Boundaries in Over ${targetOverHuman}`,
      description: "How many fours/sixes will be hit?",
      outcomes: [
        { id: "BOUNDARY_NONE", name: "0 boundaries", odds: 3.0, probability: 0.25 },
        { id: "BOUNDARY_ONE", name: "Exactly 1 boundary", odds: 2.1, probability: 0.4 },
        { id: "BOUNDARY_TWO_PLUS", name: "2+ boundaries", odds: 3.4, probability: 0.35 },
      ],
      metadata: {
        category: "BOUNDARY",
        target_over: targetOverHuman,
        inning_number: inning,
      },
    },
  ].map((cfg) => ({
    match_id: match.id,
    market_type: "NEXT_OVER" as const,
    name: cfg.name,
    description: cfg.description,
    status: "OPEN" as const,
    close_time: closeTime,

    // IMPORTANT: over_number is HUMAN (1-based) for NEXT_OVER
    over_number: targetOverHuman,
    ball_number: cfg.ballNumber,
    inning_number: inning,

    outcomes: cfg.outcomes,
    metadata: cfg.metadata,
  }));
}

/**
 * ✅ Core rules implemented:
 * - ball_events.over is 0-based (8.4 means over=8 which is "9th over running")
 * - We want NEXT_OVER to be STRICTLY one over ahead of the *next* over
 *   => targetOverHuman = currentOverIndex + 2
 * - Close all open NEXT_OVER markets whose over_number <= currentOverIndex + 1 (i.e. not 1-over-ahead anymore)
 */
async function ensureNextOverMarkets(matchId: string) {
  const { data: matchRow } = await supabase
    .from("matches")
    .select("id,status,current_over,current_ball,current_inning,match_type")
    .eq("id", matchId)
    .maybeSingle();

  if (!matchRow || matchRow.status !== "LIVE") return;

  const { data: lastBall } = await supabase
    .from("ball_events")
    .select("inning, over, ball")
    .eq("match_id", matchId)
    .order("inning", { ascending: false })
    .order("over", { ascending: false })
    .order("ball", { ascending: false })
    .limit(1)
    .maybeSingle();

  const inning = lastBall?.inning ?? matchRow.current_inning ?? 1;

  // ball_events.over is 0-based (8 => 9th over running)
  const currentOverIndex = Number(lastBall?.over ?? matchRow.current_over ?? 0);
  const currentBall = Number(lastBall?.ball ?? matchRow.current_ball ?? 0);

  // "current over" in human terms (1-based)
  const currentOverHuman = Math.max(0, currentOverIndex) + 1;

  // ✅ ONE-OVER-AHEAD market should be: currentOverHuman + 1
  // Example: current ball 8.4 => currentOverIndex=8 => currentOverHuman=9 => targetOver=10 ✅
  const targetOverHuman = currentOverHuman + 1;

  const maxOvers = maxOversForMatchType(matchRow.match_type);

  // ✅ Allow creating market for the LAST over (e.g. targetOverHuman=20 in T20)
  if (Number.isFinite(maxOvers) && targetOverHuman > (maxOvers as number)) return;

  // ✅ Close stale NEXT_OVER markets (they are no longer 1-over-ahead)
  // Keep only markets where over_number > currentOverHuman (i.e. strictly ahead)
  await supabase
    .from("instance_markets")
    .update({ status: "CLOSED" })
    .eq("match_id", matchId)
    .eq("market_type", "NEXT_OVER")
    .eq("inning_number", inning)
    .eq("status", "OPEN")
    .lte("over_number", currentOverHuman);

  // Check if the 3 configs for targetOverHuman exist
  const { data: existing } = await supabase
    .from("instance_markets")
    .select("id, market_type, over_number, ball_number, inning_number")
    .eq("match_id", matchId)
    .eq("market_type", "NEXT_OVER")
    .eq("inning_number", inning)
    .eq("over_number", targetOverHuman);

  if (existing && existing.length >= 3) return;

  const configs = buildNextOverConfigs(
    {
      ...matchRow,
      current_over: currentOverIndex,
      current_ball: currentBall,
    },
    inning,
    targetOverHuman
  );

  // NOTE: This assumes you have a unique constraint on (match_id, market_type, over_number, ball_number)
  // If you add inning_number to the unique index, also update onConflict below.
  await supabase
    .from("instance_markets")
    .upsert(configs, { onConflict: "match_id,market_type,over_number,ball_number" });
}

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const body: RequestBody = (await req.json().catch(() => ({}))) as RequestBody;
    const matchId = body.matchId || body.match_id;
    if (!matchId) {
      return error("matchId is required", 400);
    }

    const statuses =
      body.statuses && Array.isArray(body.statuses) && body.statuses.length > 0
        ? body.statuses
        : undefined;

    // Ensure next-over markets exist + stale ones closed
    await ensureNextOverMarkets(matchId);

    let query = supabase
      .from("instance_markets")
      .select("*")
      .eq("match_id", matchId)
      .order("close_time", { ascending: true });

    if (statuses) query = query.in("status", statuses);

    const { data, error: fetchError } = await query;
    if (fetchError) {
      console.error("[instance-markets] fetch error", fetchError);
      return error(fetchError.message, 500);
    }

    // Keep your existing display mapping
    const markets = (data || []).map((m: any) => {
      const meta = m?.metadata || {};
      const actualOver = meta.actual_over ?? m.over_number;
      const actualBall = meta.actual_ball ?? m.ball_number;
      return {
        ...m,
        display_over: actualOver,
        display_ball: actualBall,
        over_number: actualOver,
        ball_number: actualBall,
      };
    });

    return success({ markets });
  } catch (err) {
    console.error("[instance-markets] error", err);
    return error("Internal server error", 500);
  }
});
