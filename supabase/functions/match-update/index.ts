// supabase/functions/match-update/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  supabase,
  handlePreflight,
  success,
  error,
  ApiError,
} from "../_shared/utils.ts";

type RequestBody = {
  matchId?: string;
};

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    if (req.method !== "POST") {
      throw new ApiError("Method not allowed", 405);
    }

    const body: RequestBody = (await req.json().catch(() => ({}))) as RequestBody;
    const matchId = body.matchId || (body as any).id;

    if (!matchId) {
      throw new ApiError("matchId is required", 400);
    }

    // 1) Fetch match row (scorecard + meta)
    const { data: match, error: matchError } = await supabase
      .from("matches")
      .select(
        `
        id,
        league,
        home_team,
        away_team,
        status,
        score_details,
        current_over,
        current_ball,
        current_inning,
        venue,
        start_time
      `
      )
      .eq("id", matchId)
      .maybeSingle();

    if (matchError) {
      throw new ApiError(matchError.message, 500);
    }
    if (!match) {
      throw new ApiError("Match not found", 404);
    }

    // 2) Fetch ball events (we'll show last ~24 balls)
    const { data: balls, error: ballsError } = await supabase
      .from("ball_events")
      .select(
        `
        inning,
        over,
        ball,
        runs,
        extras,
        total_runs,
        is_wicket,
        wicket_type,
        is_boundary,
        is_six,
        is_extra,
        extra_type,
        batsman_name,
        bowler_name,
        commentary,
        timestamp
      `
      )
      .eq("match_id", matchId)
      .order("inning", { ascending: true })
      .order("over", { ascending: true })
      .order("ball", { ascending: true });

    if (ballsError) {
      throw new ApiError(ballsError.message, 500);
    }

    const rawBalls = balls || [];

    const recentBalls = rawBalls
      .slice(-24)
      .map((b) => ({
        inning: b.inning,
        over: Number(b.over),
        ball: b.ball,
        runs: b.runs ?? 0,
        extras: b.extras ?? 0,
        totalRuns: b.total_runs ?? (b.runs ?? 0) + (b.extras ?? 0),
        isWicket: !!b.is_wicket,
        wicketType: b.wicket_type || null,
        isBoundary: !!b.is_boundary,
        isSix: !!b.is_six,
        isExtra: !!b.is_extra,
        extraType: b.extra_type || null,
        batsmanName: b.batsman_name || null,
        bowlerName: b.bowler_name || null,
        commentary: b.commentary || null,
        timestamp: b.timestamp,
        outcomeText: buildOutcomeText(b),
      }));

    const last = recentBalls.length ? recentBalls[recentBalls.length - 1] : null;

    const payload = {
      matchId: match.id,
      league: match.league,
      homeTeam: match.home_team,
      awayTeam: match.away_team,
      status: match.status,
      venue: match.venue,
      startTime: match.start_time,
      scoreDetails: match.score_details,
      currentOver: match.current_over,
      currentBall: match.current_ball,
      currentInning: match.current_inning,
      strikerName: last?.batsmanName || null,
      bowlerName: last?.bowlerName || null,
      lastBall: last,
      recentBalls,
    };

    return success(payload);
  } catch (err: any) {
    console.error("[match-update] error", err);
    if (err instanceof ApiError) {
      return error(err.message, err.status);
    }
    return error(err?.message || "Internal server error", 500);
  }
});

function buildOutcomeText(b: any): string {
  if (b.is_wicket) {
    return b.wicket_type ? `WICKET (${b.wicket_type})` : "WICKET";
  }

  const runs = Number(b.runs ?? 0);
  const extras = Number(b.extras ?? 0);
  const total = runs + extras;

  const parts: string[] = [];

  if (total === 0) {
    return "Dot ball";
  }

  if (runs > 0) {
    parts.push(`${runs} run${runs === 1 ? "" : "s"}`);
  }

  if (extras > 0) {
    const label =
      (b.extra_type || "").toLowerCase() === "wide"
        ? "wide"
        : (b.extra_type || "").toLowerCase() === "noball"
        ? "no ball"
        : "extra";
    parts.push(`${extras} ${label}${extras === 1 ? "" : "s"}`);
  }

  return parts.join(" + ");
}
