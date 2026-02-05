// Roanuz helpers tailored for event-driven single-ball ingestion.
// Only normalize a single ball payload and provide minimal status mapping.

export type NormalizedBall = {
  inning: number;
  over: number;
  ball: number;
  sub_ball: number;
  runs: number;
  extras: number;
  total_runs: number;
  wicket: boolean;
  wicket_type: string | null;
  is_legal: boolean;
  is_extra: boolean;
  extra_type: string | null;
  batsman?: { id?: string | number | null; name?: string | null; fullname?: string | null };
  bowler?: { id?: string | number | null; name?: string | null; fullname?: string | null };
  commentary: string | null;
  outcome: string | null;
  provider_ball_id: string | null;
  timestamp: string | null;
  ro_raw: any;
};

const maybeNumber = (val: unknown) => {
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
};

const asIso = (val: unknown): string | null => {
  if (val === null || val === undefined) return null;
  if (typeof val === "number") {
    const ms = val > 2_000_000_000 ? val : val * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (!trimmed) return null;
    const maybeEpoch = Number(trimmed);
    if (Number.isFinite(maybeEpoch)) {
      const ms = trimmed.length > 11 ? maybeEpoch : maybeEpoch * 1000;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
};

const parseOverBall = (raw: unknown): { over: number | null; ball: number | null } => {
  if (raw === null || raw === undefined) return { over: null, ball: null };
  if (typeof raw === "number") {
    const over = Math.floor(raw);
    const ball = Math.round((raw - over) * 10);
    return { over, ball };
  }
  const str = String(raw);
  const m = str.match(/(\\d+)[\\.:](\\d+)/);
  if (m) return { over: Number(m[1]), ball: Number(m[2]) };
  return { over: null, ball: null };
};

export function mapRoanuzStatus(status: unknown): "UPCOMING" | "LIVE" | "FINISHED" {
  const s = String(status || "").toLowerCase();
  if (!s) return "UPCOMING";

  if (
    s.includes("complete") || s.includes("completed") || s.includes("result") ||
    s.includes("finished") || s.includes("closed") || s.includes("abandon") ||
    s.includes("no result") || s.includes("tie") || s.includes("draw")
  ) return "FINISHED";

  if (
    s.includes("live") || s.includes("innings") ||
    s.includes("in-progress") || s.includes("in progress") ||
    s.includes("running")
  ) return "LIVE";

  // statuses like "not_started", "scheduled" etc.
  return "UPCOMING";
}

function guessExtraType(ball: any): string | null {
  const raw =
    ball?.extra_type ||
    ball?.runs?.extra_type ||
    ball?.extras?.type ||
    ball?.ball_type ||
    ball?.delivery_type ||
    null;
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  if (s.includes("wide")) return "wide";
  if (s.includes("no") && s.includes("ball")) return "noball";
  if (s === "nb") return "noball";
  if (s === "wd") return "wide";
  if (s.includes("bye")) return s.includes("leg") ? "legbye" : "bye";
  return raw;
}

function guessIsLegal(ball: any, extraType: string | null): boolean {
  if (typeof ball?.is_legal_delivery === "boolean") return ball.is_legal_delivery;
  if (typeof ball?.legal_delivery === "boolean") return ball.legal_delivery;
  if (typeof ball?.legal === "boolean") return ball.legal;
  const bt = String(ball?.ball_type || "").toLowerCase();
  const illegalHints = ["wide", "no ball", "noball", "nb", "wd"];
  if (illegalHints.some((k) => bt.includes(k))) return false;
  if (extraType && illegalHints.some((k) => extraType.toLowerCase().includes(k))) {
    return false;
  }
  return true;
}

export function normalizeRoanuzSingleBall(ball: any): NormalizedBall {
  const overFromStr = parseOverBall(ball?.over_str || ball?.ball_str || ball?.over_ball);
  const over =
    maybeNumber(ball?.over) ??
    overFromStr.over ??
    maybeNumber(ball?.over_number) ??
    0;
  const ballNum =
    maybeNumber(ball?.ball) ??
    maybeNumber(ball?.ball_in_over) ??
    maybeNumber(ball?.ball_number) ??
    overFromStr.ball ??
    0;

  const extraType = guessExtraType(ball);
  const runs =
    maybeNumber(ball?.runs?.batsman) ??
    maybeNumber(ball?.runs?.bat) ??
    maybeNumber(ball?.batsman_runs) ??
    maybeNumber(ball?.runs) ??
    0;
  const extras =
    maybeNumber(ball?.runs?.extras) ??
    maybeNumber(ball?.extras?.total) ??
    maybeNumber(ball?.extras) ??
    0;
  const totalRuns =
    maybeNumber(ball?.runs?.total) ??
    maybeNumber(ball?.runs?.score) ??
    runs + extras;

  const wicketObj = ball?.wicket || ball?.wickets || null;
  const wicketType =
    (wicketObj && (wicketObj.kind || wicketObj.type || wicketObj.how_out)) ||
    ball?.wicket_type ||
    null;
  const isWicket = !!(wicketObj || ball?.is_wicket || ball?.wicket);

  const subBall =
    maybeNumber(ball?.sub_ball) ??
    maybeNumber(ball?.sub_ball_number) ??
    maybeNumber(ball?.sequence) ??
    0;

  const commentary =
    ball?.commentary ||
    ball?.text_commentary ||
    ball?.short_commentary ||
    ball?.ball_commentary ||
    null;

  const outcome =
    ball?.event ||
    ball?.result ||
    ball?.summary ||
    ball?.ball_type ||
    (isWicket ? "WICKET" : totalRuns === 0 ? "DOT" : `${totalRuns}_RUNS`);

  const providerId = ball?.ball_key || ball?.id || ball?.ball_id || ball?.key || null;

  const ts =
    asIso(ball?.timestamp) ||
    asIso(ball?.updated_at) ||
    asIso(ball?.created_at) ||
    null;

  return {
    inning:
      maybeNumber(ball?.inning_number) ??
      maybeNumber(ball?.innings) ??
      maybeNumber(ball?.inning) ??
      maybeNumber(ball?.live_inning) ??
      1,
    over: over ?? 0,
    ball: ballNum ?? 0,
    sub_ball: subBall ?? 0,
    runs: runs ?? 0,
    extras: extras ?? 0,
    total_runs: totalRuns ?? runs + extras,
    wicket: isWicket,
    wicket_type: wicketType,
    is_legal: guessIsLegal(ball, extraType),
    is_extra: (extras ?? 0) > 0 || !!extraType,
    extra_type: extraType,
    batsman: ball?.batsman || ball?.striker || ball?.player || undefined,
    bowler: ball?.bowler || ball?.current_bowler || undefined,
    commentary,
    outcome: outcome || null,
    provider_ball_id: providerId ? String(providerId) : null,
    timestamp: ts,
    ro_raw: ball,
  };
}

export function deriveScoreFromEvents(
  events: Array<{
    inning: number;
    over: number;
    ball: number;
    sub_ball: number;
    runs: number;
    extras: number;
    total_runs: number;
    is_wicket: boolean;
    is_legal: boolean;
  }>,
) {
  if (!events.length) {
    return {
      status: "UPCOMING" as const,
      score_details: null,
      current_over: null,
      current_ball: null,
      current_inning: null,
      target_runs: null,
      ro_play_status: null,
      ro_live: null,
      ro_innings: [],
      ro_last_payload: null,
    };
  }

  const sorted = [...events].sort((a, b) => {
    if (a.inning !== b.inning) return a.inning - b.inning;
    if (a.over !== b.over) return a.over - b.over;
    if (a.ball !== b.ball) return a.ball - b.ball;
    return a.sub_ball - b.sub_ball;
  });

  const currentInning = sorted.at(-1)!.inning;
  const currentEvents = sorted.filter((e) => e.inning === currentInning);
  const runs = currentEvents.reduce((sum, e) => sum + (e.total_runs ?? 0), 0);
  const wickets = currentEvents.filter((e) => e.is_wicket).length;
  const lastLegal = [...currentEvents].reverse().find((e) => e.is_legal) ?? currentEvents.at(-1)!;
  const current_over = lastLegal.over ?? null;
  const current_ball = lastLegal.ball ?? null;
  const overText =
    current_over !== null && current_ball !== null ? `${current_over}.${current_ball}` : null;
  const score_details = `${runs}${wickets ? `/${wickets}` : ""}${overText ? ` (${overText})` : ""}`;

  return {
    status: "LIVE" as const,
    score_details,
    current_over,
    current_ball,
    current_inning: currentInning,
    target_runs: null,
    ro_play_status: null,
    ro_live: null,
    ro_innings: [],
    ro_last_payload: null,
  };
}
