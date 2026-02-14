import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  adminSupabase as supabase,
  handlePreflight,
  success,
  error,
  ApiError,
  isServiceRoleRequest,
  requireUser,
} from "../_shared/utils.ts";

// ======================= ENV =======================
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const ROANUZ_PROJECT_KEY = Deno.env.get("ROANUZ_PROJECT_KEY") ||
  Deno.env.get("ROANUZ_PROJECTID") ||
  "";
const ROANUZ_API_KEY = Deno.env.get("ROANUZ_API_KEY") ||
  Deno.env.get("ROANUZ_APIKEY") ||
  "";

function isFinishedStatus(val?: string | null) {
  const v = String(val || "").toLowerCase().trim();
  return (
    v.includes("complete") ||
    v.includes("completed") ||
    v.includes("finished") ||
    v.includes("result") ||
    v.includes("abandoned") ||
    v.includes("no result") ||
    v.includes("cancel") ||
    v.includes("stumps day 5") ||
    v.includes("draw")
  );
}

function computeDisplayStatus(
  roStatus?: string | null,
  _matchState?: string | null, // ignored on purpose (garbage/inconsistent)
  _playStatus?: string | null, // ignored on purpose
  prevDisplay?: "UPCOMING" | "LIVE" | "FINISHED" | null,
): "UPCOMING" | "LIVE" | "FINISHED" {
  const raw = roStatus || "";
  const val = raw.toLowerCase().trim();

  // 1) Terminal states: once finished, always FINISHED
  if (isFinishedStatus(raw)) {
    return "FINISHED";
  }

  // 2) Explicit "live-ish" statuses from ro_status
  //    These should ALWAYS appear as LIVE, even if they come first.
  const liveHints = [
    "live",
    "toss",
    "in-progress",
    "in progress",
    "running",
    "innings",
    "break",
    "drinks",
    "rain",
    "rain stopped play",
    "bad light",
    "delayed",
    "suspended",
    "stumps",
    "tea",
    "lunch",
    "review",
    "super over",
    "superover",
  ];

  if (liveHints.some((h) => val.includes(h))) {
    return "LIVE";
  }

  // 3) Sticky-live: if we were already LIVE and ro_status is some weird
  //    mid-state that isn't clearly finished or upcoming, stay LIVE
  if (prevDisplay === "LIVE") {
    return "LIVE";
  }

  // 4) Everything else is treated as UPCOMING
  //    (scheduled, not started, toss, lineups, etc.)
  return "UPCOMING";
}


// ======================= ROANUZ TOKEN CACHE =======================
let _tokenCache: { token: string; exp: number } | null = null;
// Debounce live-odds polling per match to avoid excessive provider calls
const _oddsPollLast: Record<string, number> = {};
// Cache squad fetches to avoid hammering provider
const _squadFetchCache: Record<string, number> = {};
// Track matches where we've already hydrated full squads (avoid repeated upserts)
const _playersSeeded: Set<string> = new Set();
// Track latest ball seq for match-winner pulse reopen
const _mwLatestSeq: Record<string, string> = {};
// Track debounce timers for reopening match winner markets
const _mwReopenTimer: Record<string, NodeJS.Timeout> = {};

// Safe number helper
function toNum(v: any, fallback = 0) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Fallback: derive target as (first-innings total + 1) from ball events
async function computeTargetFromBallEvents(matchId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from("ball_events")
    .select("ro_total_runs")
    .eq("match_id", matchId)
    .eq("ro_inning_number", 1)
    .or("ro_is_deleted.is.null,ro_is_deleted.eq.false");

  if (error) {
    console.error("[computeTargetFromBallEvents] failed", { matchId, error });
    return null;
  }

  const sum = (data || []).reduce((acc, row) => acc + Number(row?.ro_total_runs ?? 0), 0);
  if (!Number.isFinite(sum) || sum <= 0) return null;
  return sum + 1;
}

// Compute target when the provider didn't send one; do not overwrite a valid target.
async function deriveTargetIfMissing(
  matchId: string,
  inningNumber: number,
  existingTarget?: number | null,
): Promise<number | null> {
  const target = existingTarget ?? null;
  if (target && target > 0) return target;
  if (inningNumber < 2) return target;

  const computed = await computeTargetFromBallEvents(matchId);
  if (computed && computed > 0) return computed;
  return target;
}

function extractTargetFromSnapshot(snapshot: any): { target?: number | null; firstInningsTotal?: number | null } {
  // Prefer Roanuz play.target.runs which already includes +1 for the chase
  const target =
    snapshot?.play?.target?.runs ??
    snapshot?.target_runs ??
    snapshot?.target?.runs ??
    snapshot?.required?.target ??
    null;

  // innings can be an object (a_1, b_1) or an array; prefer play.innings
  const inningsNode = snapshot?.play?.innings ?? snapshot?.innings ?? snapshot?.match?.innings ?? null;
  let firstInningsTotal: number | null = null;

  if (inningsNode) {
    if (Array.isArray(inningsNode)) {
      const first =
        inningsNode.find((inn: any) =>
          Number(inn?.batting_order ?? inn?.inning_number ?? inn?.number ?? inn?.index) === 1) ||
        inningsNode[0];
      const runs =
        first?.score?.runs ??
        first?.score?.total ??
        first?.team_score?.runs ??
        first?.runs ??
        first?.team_runs ??
        null;
      const runsNum = Number(runs);
      if (Number.isFinite(runsNum) && runsNum > 0) firstInningsTotal = runsNum;
    } else if (typeof inningsNode === "object") {
      // use innings_order if present, else first key ending with "_1", else first value
      const orderList: string[] =
        (snapshot?.play?.innings_order as string[]) ||
        Object.keys(inningsNode);
      const firstKey =
        (orderList || []).find((k) => k && String(k).includes("_1")) ||
        Object.keys(inningsNode).find((k) => k && String(k).includes("_1")) ||
        (orderList && orderList[0]) ||
        Object.keys(inningsNode)[0];
      const first = inningsNode[firstKey];
      const runs =
        first?.score?.runs ??
        first?.score?.total ??
        first?.team_score?.runs ??
        first?.runs ??
        first?.team_runs ??
        null;
      const runsNum = Number(runs);
      if (Number.isFinite(runsNum) && runsNum > 0) firstInningsTotal = runsNum;
    }
  }

  return { target: Number.isFinite(Number(target)) ? Number(target) : null, firstInningsTotal };
}

function extractRequiredFromSnapshot(snapshot: any): { runs?: number | null; balls?: number | null } {
  const req =
    snapshot?.play?.required_score ??
    snapshot?.live?.required_score ??
    snapshot?.required_score ??
    snapshot?.required ??
    null;
  const runs = toNum(req?.runs, null);
  const balls = toNum(req?.balls, null);
  return { runs: Number.isFinite(runs as number) ? runs : null, balls: Number.isFinite(balls as number) ? balls : null };
}

function extractRequiredFromDetail(detail: any): { runs?: number | null; balls?: number | null } {
  const req =
    detail?.required_score ??
    detail?.live?.required_score ??
    detail?.required ??
    null;
  const runs = toNum(req?.runs, null);
  const balls = toNum(req?.balls, null);
  return { runs: Number.isFinite(runs as number) ? runs : null, balls: Number.isFinite(balls as number) ? balls : null };
}

function oversLimitFromCompetition(compType?: string | null, compName?: string | null): number | null {
  const s = `${compType || ""} ${compName || ""}`.toLowerCase();
  if (s.includes("t10")) return 10;
  if (s.includes("t20") || s.includes("20/20") || s.includes("twenty20")) return 20;
  if (s.includes("odi") || s.includes("one day") || s.includes("50")) return 50;
  return null;
}

async function getRoanuzToken(): Promise<string> {
  if (!ROANUZ_PROJECT_KEY || !ROANUZ_API_KEY) {
    throw new ApiError("Missing ROANUZ_PROJECT_KEY/ROANUZ_API_KEY", 500);
  }

  const now = Date.now();
  if (_tokenCache && _tokenCache.exp > now + 15_000) return _tokenCache.token;

  const resp = await fetch(`https://api.sports.roanuz.com/v5/core/${ROANUZ_PROJECT_KEY}/auth/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: ROANUZ_API_KEY }),
  });

  const json = await resp.json().catch(() => ({}));
  const token = json?.data?.token;
  if (!resp.ok || !token) {
    throw new ApiError(`Roanuz auth failed: ${json?.error?.msg || resp.statusText}`, resp.status);
  }

  // token lifetime isn’t documented reliably; cache for 10 minutes
  _tokenCache = { token, exp: now + 10 * 60_000 };
  return token;
}

async function fetchRoanuzMatchSnapshot(roMatchKey: string): Promise<any> {
  const token = await getRoanuzToken();
  const url = `https://api.sports.roanuz.com/v5/cricket/${ROANUZ_PROJECT_KEY}/match/${roMatchKey}/`;
  const resp = await fetch(url, { headers: { "rs-token": token } });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new ApiError(`Roanuz match snapshot failed: ${json?.error?.msg || resp.statusText}`, resp.status);
  }
  return json?.data || json;
}

// Fetch a single player profile (used as a fallback when squad snapshot lacks names)
async function fetchRoanuzPlayerProfile(roPlayerKey: string): Promise<{ name: string | null; teamKey: string | null }> {
  const token = await getRoanuzToken();
  const url = `https://api.sports.roanuz.com/v5/cricket/${ROANUZ_PROJECT_KEY}/player/${roPlayerKey}/`;
  const resp = await fetch(url, { headers: { "rs-token": token } });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error("[fetchRoanuzPlayerProfile] failed", { roPlayerKey, status: resp.status, msg: json?.error?.msg });
    return { name: null, teamKey: null };
  }

  const player =
    json?.data?.player ||
    json?.player ||
    json?.data ||
    json ||
    null;

  const name =
    player?.name ||
    player?.full_name ||
    player?.short_name ||
    null;
  const teamKey = player?.team_key || player?.team || null;
  return { name: name ? String(name) : null, teamKey: teamKey ? String(teamKey) : null };
}
function extractPlayersFromSnapshot(
  snapshot: any,
): Array<{ key: string; name: string | null; teamKey: string | null }> {
  const buckets: any[] = [];

  // Collect all possible player containers
  const candidates = [
    snapshot?.players,
    snapshot?.team_players,
    snapshot?.squads,
    snapshot?.squad,
    snapshot?.match?.players,
    snapshot?.match?.team_players,
    snapshot?.match?.squads,
    snapshot?.match?.squad,
  ].filter(Boolean);

  for (const node of candidates) {
    if (Array.isArray(node)) {
      buckets.push(...node);
    } else if (node && typeof node === "object") {
      for (const k of Object.keys(node)) {
        const val = (node as any)[k];
        if (Array.isArray(val)) {
          buckets.push(...val);
        } else if (val && typeof val === "object") {
          // For maps like { [player_key]: { player: {...}, score: {...} } }
          buckets.push(val);
        }
      }
    }
  }

  return buckets
    .map((p) => {
      // 🔑 Roanuz shape: p.player is the actual player object
      const player = p?.player ?? p;

      const key =
        player?.key ??
        p?.key ??
        p?.player_key ??
        p?.id ??
        p?.player_id ??
        null;

      if (!key) return null;

      const name =
        player?.jersey_name_v2 ??
        player?.jersey_name ??
        player?.name ??
        player?.legal_name_v2 ??
        player?.legal_name ??
        p?.name ??
        p?.short_name ??
        p?.full_name ??
        null;

      const teamKey =
        p?.team_key ??
        p?.team ??
        p?.teamKey ??
        player?.team_key ??
        null;

      return {
        key: String(key),
        name: name ?? null,
        teamKey: teamKey ? String(teamKey) : null,
      };
    })
    .filter(
      (
        x,
      ): x is { key: string; name: string | null; teamKey: string | null } =>
        !!x?.key,
    );
}



// ======================= SQUAD HYDRATION (SAFE + THROTTLED) =======================
async function ensurePlayersForMatch(roMatchKey: string, keys: Array<string | null | undefined>) {
  const cleanKeys = Array.from(new Set((keys || []).filter(Boolean).map(String)));

  // Which requested keys are missing names?
  let missing: string[] = [];
  if (cleanKeys.length > 0) {
    const { data: rows, error } = await supabase
      .from("players")
      .select("ro_player_key, ro_player_name")
      .in("ro_player_key", cleanKeys);

    if (error) {
      console.error("[ensurePlayersForMatch] lookup failed", error);
    } else {
      const named = new Set(
        (rows || [])
          .filter((r: any) => r?.ro_player_name && String(r.ro_player_name).trim())
          .map((r: any) => String(r.ro_player_key)),
      );
      missing = cleanKeys.filter((k) => !named.has(k));
    }
  }

  // If all requested keys already have names, we usually skip — but allow a snapshot refetch to backfill
  // legacy rows that were inserted without names (even when cleanKeys is empty). Only skip when we
  // explicitly provided keys and they all already have names.
  if (cleanKeys.length > 0 && missing.length === 0) return;

  // Throttle squad fetch per match (5 minutes)
  const now = Date.now();
  const last = _squadFetchCache[roMatchKey] || 0;
  if (now - last < 5 * 60 * 1000) return;

  try {
    const snapshot = await fetchRoanuzMatchSnapshot(roMatchKey);
    const players = extractPlayersFromSnapshot(snapshot);
    if (!players.length) return;

    const nowIso = new Date().toISOString();

    // IMPORTANT: only include ro_player_name if present (never overwrite with null)
    const upserts = players.map((p) => {
      const row: any = {
        ro_player_key: String(p.key),
        ro_last_seen_at: nowIso,
        updated_at: nowIso,
      };
      if (p.name && String(p.name).trim()) row.ro_player_name = String(p.name).trim();
      if (p.teamKey && String(p.teamKey).trim()) row.ro_team_key = String(p.teamKey).trim();
      return row;
    });

    await supabase.from("players").upsert(upserts, {
      onConflict: "ro_player_key",
      ignoreDuplicates: false,
    });

    _squadFetchCache[roMatchKey] = Date.now();
    if (cleanKeys.length === 0) _playersSeeded.add(roMatchKey);

    // Fallback: fetch individual player profiles for keys still missing names
    const checkKeys = cleanKeys.length > 0 ? missing : players.map((p) => p.key);
    if (checkKeys.length > 0) {
      const { data: afterRows } = await supabase
        .from("players")
        .select("ro_player_key, ro_player_name")
        .in("ro_player_key", checkKeys);

      const stillMissing = (afterRows || [])
        .filter((r: any) => !r?.ro_player_name)
        .map((r: any) => String(r.ro_player_key));

      if (stillMissing.length > 0) {
        const batch = stillMissing.slice(0, 25); // avoid hammering provider
        const profiles = await Promise.all(batch.map((k) => fetchRoanuzPlayerProfile(k)));
        const profileRows = batch
          .map((k, idx) => {
            const p = profiles[idx];
            const row: any = {
              ro_player_key: k,
              ro_last_seen_at: nowIso,
              updated_at: nowIso,
            };
            if (p.name) row.ro_player_name = p.name;
            if (p.teamKey) row.ro_team_key = p.teamKey;
            return row;
          })
          .filter((r) => r.ro_player_name);

        if (profileRows.length > 0) {
          await supabase.from("players").upsert(profileRows, {
            onConflict: "ro_player_key",
            ignoreDuplicates: false,
          });
        }
      }
    }
  } catch (err) {
    console.error("[ensurePlayersForMatch] squad fetch failed", { roMatchKey, err });
  }
}


async function fetchRoanuzPreMatchOdds(roMatchKey: string): Promise<any> {
  const token = await getRoanuzToken();
  const url = `https://api.sports.roanuz.com/v5/cricket/${ROANUZ_PROJECT_KEY}/match/${roMatchKey}/pre-match-odds/`;
  const resp = await fetch(url, { headers: { "rs-token": token } });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = json?.error?.msg || resp.statusText;
    if (resp.status === 404) {
      // Soft miss: odds not prepared yet or match completed
      return null;
    }
    throw new ApiError(`Roanuz pre-match odds failed: ${msg}`, resp.status);
  }
  return json?.data || json;
}

async function fetchRoanuzLiveMatchOdds(roMatchKey: string): Promise<any> {
  const token = await getRoanuzToken();
  const url = `https://api.sports.roanuz.com/v5/cricket/${ROANUZ_PROJECT_KEY}/match/${roMatchKey}/live-match-odds/`;
  const resp = await fetch(url, { headers: { "rs-token": token } });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = json?.error?.msg || resp.statusText;
    if (resp.status === 404) {
      // Soft miss: odds not prepared yet or match completed
      return null;
    }
    throw new ApiError(`Roanuz live match odds failed: ${msg}`, resp.status);
  }
  return json?.data || json;
}

async function fetchRoanuzMatchInsights(roMatchKey: string): Promise<any> {
  const token = await getRoanuzToken();
  const url = `https://api.sports.roanuz.com/v5/cricket/${ROANUZ_PROJECT_KEY}/match/${roMatchKey}/insights/`;
  const resp = await fetch(url, { headers: { "rs-token": token } });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new ApiError(`Roanuz match insights failed: ${json?.error?.msg || resp.statusText}`, resp.status);
  return json?.data || json;
}

// ======================= HELPERS =======================
function extractMatchKey(body: any): string | null {
  const candidates = [
    body?.matchkey,
    body?.match_key,
    body?.data?.matchkey,
    body?.data?.match_key,
    body?.match?.key,
    body?.card?.key,
    body?.data?.context?.match_key,
    body?.data?.context?.matchkey,
    body?.context?.match_key,
    body?.context?.matchkey,
  ].filter((v) => typeof v === "string" && v.length > 0);

  return candidates.length ? String(candidates[0]) : null;
}

function mapNonBallEventType(kindRaw?: string | null): { type: string; text: string } | null {
  const k = String(kindRaw || "").toLowerCase();
  if (!k) return null;
  if (k.includes("review")) return { type: "review", text: "Review in progress" };
  if (k.includes("drinks")) return { type: "drinks", text: "Drinks break" };
  if (k.includes("rain")) return { type: "rain", text: "Rain delay" };
  if (k.includes("light")) return { type: "bad_light", text: "Bad light – play suspended" };
  if (k.includes("innings") && k.includes("break")) return { type: "innings_break", text: "Innings break" };
  if (k.includes("super") && k.includes("over")) return { type: "super_over", text: "Super Over preparation" };
  if (k.includes("status")) return { type: "status", text: "Status update" };
  return { type: k, text: k };
}

function normalizeTeamKey(val: string | null | undefined): string {
  return String(val || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function extractTossInfo(payload: any): { winner: string | null; decision: string | null } {
  const candidates = [
    payload?.data?.toss,
    payload?.toss,
    payload?.match?.toss,
    payload?.card?.toss,
    payload?.data?.match?.toss,
  ];

  for (const t of candidates) {
    if (!t) continue;
    const winner =
      t.won_by ??
      t.wonby ??
      t.winner ??
      t.team ??
      t.team_key ??
      t.teamName ??
      null;
    const decision = t.elected ?? t.decision ?? t.choose ?? t.opted ?? null;
    if (winner || decision) return { winner: winner || null, decision: decision || null };
  }

  return { winner: null, decision: null };
}

async function findOrCreateMatch(roMatchKey: string, payload: any): Promise<string> {
  const { data: existing } = await supabase
    .from("matches")
    .select("id, sport")
    .eq("ro_match_key", roMatchKey)
    .maybeSingle();

  const matchData = payload?.match || payload?.card || payload?.data?.match || payload || {};
  const teams = matchData?.teams || {};

  // If exists, still ensure markets (idempotent). If teams missing, ensure funcs will just no-op runners.
  if (existing?.id) {
    // Backfill sport if missing (frontend filters by sport === "cricket")
    if (!existing.sport) {
      await supabase.from("matches").update({ sport: "cricket" }).eq("id", existing.id);
    }
    await ensureMatchWinnerMarket(existing.id, teams);
    await ensureTossMarket(existing.id, teams);
    return existing.id;
  }

  const { data: newMatch, error: insertErr } = await supabase
    .from("matches")
    .insert({
      ro_match_key: roMatchKey,
      ro_series_key: matchData?.series?.key || matchData?.tournament?.key,
      ro_competition_name: matchData?.tournament?.name || matchData?.competition?.name || "Cricket",
      ro_competition_type: matchData?.format || "cricket",

      ro_team_home_key: teams?.a?.key,
      ro_team_home_name: teams?.a?.name || "Team A",
      ro_team_away_key: teams?.b?.key,
      ro_team_away_name: teams?.b?.name || "Team B",

      ro_start_time: matchData?.start_time ? new Date(matchData.start_time).toISOString() : new Date().toISOString(),
      ro_status: matchData?.status || "not_started",
      ro_match_state: matchData?.match_state || "not_started",
    ro_play_status: matchData?.play_status,

      toss_won_by: matchData?.toss?.won_by,
      elected_to: matchData?.toss?.elected,
      ro_toss_won_by: matchData?.toss?.won_by,
      ro_toss_decision: matchData?.toss?.elected,
      toss_recorded_at: matchData?.toss ? new Date().toISOString() : null,
      ro_venue_name: matchData?.venue?.name,
      ro_venue_city: matchData?.venue?.city,

      display_status: computeDisplayStatus(matchData?.status, matchData?.match_state, matchData?.play_status),
      ro_last_payload: matchData,

      ro_score_runs: 0,
      ro_score_wickets: 0,
      ro_score_overs: 0,
      ro_current_inning: 1,
      sport: "cricket",
    })
    .select("id")
    .single();

  if (insertErr || !newMatch?.id) throw new ApiError(`Failed to create match: ${insertErr?.message}`, 500);

  await ensureMatchWinnerMarket(newMatch.id, teams);
  await ensureTossMarket(newMatch.id, teams);

  return newMatch.id;
}


async function ensureMatchWinnerMarket(matchId: string, teams: any) {
  const { data: existingMarket } = await supabase
    .from("markets")
    .select("id")
    .eq("match_id", matchId)
    .eq("market_name", "Match Winner")
    .maybeSingle();

  if (existingMarket?.id) return;

  const { data: market, error: marketError } = await supabase
    .from("markets")
    .insert({
      match_id: matchId,
      market_type: "pre_match",
      market_name: "Match Winner",
      odds_source: "roanuz",
      market_status: "CLOSED", // will open once real odds arrive
      open_time: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (marketError || !market?.id) {
    console.error("Failed to create Match Winner market:", marketError);
    return;
  }

  const runners: any[] = [];
  if (teams?.a) {
    runners.push({
      market_id: market.id,
      runner_name: teams.a.name || "Home",
      ro_team_key: teams.a.key,
      back_odds: null,
      lay_odds: null,
      metadata: { is_home: true },
    });
  }
  if (teams?.b) {
    runners.push({
      market_id: market.id,
      runner_name: teams.b.name || "Away",
      ro_team_key: teams.b.key,
      back_odds: null,
      lay_odds: null,
      metadata: { is_away: true },
    });
  }
  if (runners.length) await supabase.from("market_runners").insert(runners);
}

// ======================= NOTIFICATIONS =======================
type NotificationEventType =
  | "TOSS_RESULT"
  | "START_MINUS5"
  | "LIVE_START"
  | "OVER_6"
  | "OVER_10"
  | "OVER_15"
  | "INNINGS_END"
  | "PRE_INNINGS2"
  | "MATCH_END"
  | "CUSTOM";

type NotificationContext = {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  tossWinner?: string | null;
  tossDecision?: string | null;
  score?: string | null;
  runs?: number | null;
  wickets?: number | null;
  overs?: number | null;
  runRate?: string | null;
  target?: number | null;
  inning?: number | null;
  over?: number | null;
  oddsHome?: number | null;
  oddsAway?: number | null;
  status?: string | null;
};

const normalizeName = (val?: string | null) =>
  (val || "").toLowerCase().trim();

const oversToFloat = (overs?: number | null) => {
  if (!Number.isFinite(Number(overs))) return null;
  const raw = Number(overs);
  const whole = Math.floor(raw);
  const balls = Math.round((raw - whole) * 10);
  return whole + balls / 6;
};

// ======================= PLAYER MARKET NAMES =======================
const MARKET_TOP_BATTER = "Top Batter";
const MARKET_TOP_BOWLER = "Top Bowler";
const MARKET_BEST_BATTER_INN1 = "Best Batter - Innings 1";
const MARKET_BEST_BOWLER_INN1 = "Best Bowler - Innings 1";
const MARKET_BEST_BATTER_INN2 = "Best Batter - Innings 2";
const MARKET_BEST_BOWLER_INN2 = "Best Bowler - Innings 2";

type PlayingXI = { home: string[]; away: string[] };

function extractPlayingXIFromSnapshot(snapshot: any): PlayingXI {
  const xiHome =
    snapshot?.squad?.a?.playing_xi ||
    snapshot?.match?.squad?.a?.playing_xi ||
    snapshot?.lineups?.a?.playing_xi ||
    [];
  const xiAway =
    snapshot?.squad?.b?.playing_xi ||
    snapshot?.match?.squad?.b?.playing_xi ||
    snapshot?.lineups?.b?.playing_xi ||
    [];

  return {
    home: Array.isArray(xiHome) ? xiHome.map(String) : [],
    away: Array.isArray(xiAway) ? xiAway.map(String) : [],
  };
}

function pickTop(list: string[], count = 3) {
  return list.filter(Boolean).slice(0, count);
}

function defaultOddsList(count: number, base = 3): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(Number((base + i * 0.8).toFixed(2)));
  }
  return out;
}

async function ensureMarketWithRunners(
  matchId: string,
  name: string,
  runners: Array<{ key: string; name: string; order: number }>,
  metadata: Record<string, any>,
  status: "OPEN" | "SUSPENDED" = "OPEN",
) {
  // Try to find existing market
  const { data: existing } = await supabase
    .from("markets")
    .select("id")
    .eq("match_id", matchId)
    .eq("market_name", name)
    .maybeSingle();

  let marketId = existing?.id as string | undefined;

  if (!marketId) {
    const { data: market, error: mErr } = await supabase
      .from("markets")
      .insert({
        match_id: matchId,
        market_type: "pre_match",
        market_name: name,
        market_status: status,
        open_time: new Date().toISOString(),
        metadata,
      })
      .select("id")
      .single();

    if (mErr || !market?.id) {
      console.error("[player-markets] create market failed", { name, mErr });
      return;
    }
    marketId = market.id;
  }

  // Seed runners (upsert by market_id + ro_player_key)
  const oddsList = defaultOddsList(runners.length, 3.0);
  const rows = runners.map((r, idx) => ({
    market_id: marketId!,
    runner_name: r.name || r.key,
    ro_player_key: r.key,
    back_odds: oddsList[idx] ?? 5.0,
    lay_odds: null,
    metadata: { order: r.order, kind: metadata.kind, inning: metadata.inning, team: metadata.team },
  }));

  await supabase.from("market_runners").upsert(rows, {
    onConflict: "market_id,ro_player_key",
    ignoreDuplicates: false,
  });
}

async function ensureBestPlayerMarketsPreStart(
  matchId: string,
  snapshot: any,
  teamKeys: { homeKey: string | null; awayKey: string | null },
  _teamNames: { home: string; away: string },
  tossDecision: { battingFirstKey: string | null; bowlingFirstKey: string | null },
) {
  const xi = extractPlayingXIFromSnapshot(snapshot);

  const battingFirst = tossDecision.battingFirstKey || teamKeys.homeKey;
  const bowlingFirst = tossDecision.bowlingFirstKey || teamKeys.awayKey;

  const battingXI = battingFirst === teamKeys.homeKey ? xi.home : xi.away;
  const bowlingXI = bowlingFirst === teamKeys.homeKey ? xi.home : xi.away;

  const topBattersInn1 = pickTop(battingXI, 3);
  const topBowlersInn1 = pickTop(bowlingXI.slice().reverse(), 3); // heuristic: tail has frontline bowlers

  // Match-wide markets: include all XI so settlement is fair
  const allBatters = [...xi.home, ...xi.away].map((k, i) => ({ key: k, name: k, order: i }));
  const allBowlers = [...xi.home, ...xi.away].map((k, i) => ({ key: k, name: k, order: i }));

  await ensureMarketWithRunners(matchId, MARKET_TOP_BATTER, allBatters, { kind: "TOP_BATTER", scope: "MATCH" });
  await ensureMarketWithRunners(matchId, MARKET_TOP_BOWLER, allBowlers, { kind: "TOP_BOWLER", scope: "MATCH" });

  await ensureMarketWithRunners(
    matchId,
    MARKET_BEST_BATTER_INN1,
    topBattersInn1.map((k, idx) => ({ key: k, name: k, order: idx })),
    { kind: "BEST_BATTER", inning: 1, team: battingFirst },
  );

  await ensureMarketWithRunners(
    matchId,
    MARKET_BEST_BOWLER_INN1,
    topBowlersInn1.map((k, idx) => ({ key: k, name: k, order: idx })),
    { kind: "BEST_BOWLER", inning: 1, team: bowlingFirst },
  );
}

async function ensureInnings2Markets(
  matchId: string,
  snapshot: any,
  teamKeys: { homeKey: string | null; awayKey: string | null },
) {
  const xi = extractPlayingXIFromSnapshot(snapshot);
  const battingSecond = snapshot?.match?.second_batting_team_key || snapshot?.second_batting_team_key || null;

  const inferredSecondBat = battingSecond
    ? String(battingSecond)
    : teamKeys.homeKey && teamKeys.awayKey
    ? null
    : null;

  const battingXI = inferredSecondBat === teamKeys.homeKey ? xi.home : inferredSecondBat === teamKeys.awayKey ? xi.away : xi.away;
  const bowlingXI = inferredSecondBat === teamKeys.homeKey ? xi.away : xi.home;

  const topBat = pickTop(battingXI, 3).map((k, idx) => ({ key: k, name: k, order: idx }));
  const topBowl = pickTop(bowlingXI.slice().reverse(), 3).map((k, idx) => ({ key: k, name: k, order: idx }));

  await ensureMarketWithRunners(matchId, MARKET_BEST_BATTER_INN2, topBat, { kind: "BEST_BATTER", inning: 2, team: battingSecond });
  await ensureMarketWithRunners(matchId, MARKET_BEST_BOWLER_INN2, topBowl, { kind: "BEST_BOWLER", inning: 2, team: bowlingXI === xi.home ? teamKeys.awayKey : teamKeys.homeKey });
}

async function closePlayerMarketsOnFirstBall(matchId: string, inning: number) {
  const namesToClose = inning === 1
    ? [MARKET_TOP_BATTER, MARKET_TOP_BOWLER, MARKET_BEST_BATTER_INN1, MARKET_BEST_BOWLER_INN1]
    : [MARKET_BEST_BATTER_INN2, MARKET_BEST_BOWLER_INN2];

  await supabase
    .from("markets")
    .update({ market_status: "CLOSED", close_time: new Date().toISOString() })
    .eq("match_id", matchId)
    .in("market_name", namesToClose)
    .eq("market_status", "OPEN");
}

async function aggregateInningStats(matchId: string, inning: number) {
  const { data: balls } = await supabase
    .from("ball_events")
    .select("ro_batsman_key, ro_bowler_key, ro_batsman_runs, ro_extras_runs, ro_total_runs, ro_is_wicket, ro_wicket_kind, ro_extra_type")
    .eq("match_id", matchId)
    .eq("ro_inning_number", inning)
    .eq("ro_is_deleted", false);

  const bat: Record<string, { runs: number; balls: number }> = {};
  const bowl: Record<string, { wickets: number; runs: number; balls: number }> = {};

  for (const b of balls || []) {
    const batKey = b.ro_batsman_key || null;
    const bowlKey = b.ro_bowler_key || null;
    const runsBat = Number(b.ro_batsman_runs || 0);
    const runsTotal = Number(b.ro_total_runs || 0);
    const extraType = String(b.ro_extra_type || "").toLowerCase();
    const legal = extraType !== "wide" && extraType !== "no_ball";

    if (batKey) {
      if (!bat[batKey]) bat[batKey] = { runs: 0, balls: 0 };
      bat[batKey].runs += runsBat;
      if (legal) bat[batKey].balls += 1;
    }

    if (bowlKey) {
      if (!bowl[bowlKey]) bowl[bowlKey] = { wickets: 0, runs: 0, balls: 0 };
      bowl[bowlKey].runs += runsTotal;
      if (legal) bowl[bowlKey].balls += 1;

      const wk = (b.ro_wicket_kind || "").toLowerCase();
      const isRunOut = wk.includes("run out");
      if (b.ro_is_wicket && !isRunOut) bowl[bowlKey].wickets += 1;
    }
  }

  return { bat, bowl };
}

function topByRuns(bat: Record<string, { runs: number; balls: number }>): string[] {
  return Object.entries(bat)
    .sort((a, b) => {
      if (b[1].runs !== a[1].runs) return b[1].runs - a[1].runs;
      return a[1].balls - b[1].balls;
    })
    .map((x) => x[0]);
}

function topByWickets(bowl: Record<string, { wickets: number; runs: number; balls: number }>): string[] {
  return Object.entries(bowl)
    .sort((a, b) => {
      if (b[1].wickets !== a[1].wickets) return b[1].wickets - a[1].wickets;
      if (a[1].runs !== b[1].runs) return a[1].runs - b[1].runs;
      return a[1].balls - b[1].balls;
    })
    .map((x) => x[0]);
}

async function settlePlayerMarket(matchId: string, marketName: string, winnerKeys: string[]) {
  if (!winnerKeys.length) return;

  const { data: market } = await supabase
    .from("markets")
    .select("id, market_status")
    .eq("match_id", matchId)
    .eq("market_name", marketName)
    .maybeSingle();

  if (!market?.id || market.market_status === "SETTLED") return;

  const { data: runners } = await supabase
    .from("market_runners")
    .select("id, runner_name, ro_player_key")
    .eq("market_id", market.id);

  const winnerRunner = (runners || []).find((r) => r.ro_player_key && winnerKeys.includes(String(r.ro_player_key)));
  if (!winnerRunner) return;

  const winningOutcome = winnerRunner.runner_name;
  const nowIso = new Date().toISOString();

  await supabase
    .from("markets")
    .update({
      market_status: "SETTLED",
      winning_outcome: winningOutcome,
      settle_time: nowIso,
      close_time: nowIso,
      updated_at: nowIso,
    })
    .eq("id", market.id);

  // Reuse settleMarketBets for traditional bets if available
  await settleMarketBets(market.id, winningOutcome);
}

async function settleInningPlayerMarkets(matchId: string, inning: number) {
  const { bat, bowl } = await aggregateInningStats(matchId, inning);

  const bestBat = topByRuns(bat)[0] ? [topByRuns(bat)[0]] : [];
  const bestBowl = topByWickets(bowl)[0] ? [topByWickets(bowl)[0]] : [];

  if (inning === 1) {
    await settlePlayerMarket(matchId, MARKET_BEST_BATTER_INN1, bestBat);
    await settlePlayerMarket(matchId, MARKET_BEST_BOWLER_INN1, bestBowl);
  } else if (inning === 2) {
    await settlePlayerMarket(matchId, MARKET_BEST_BATTER_INN2, bestBat);
    await settlePlayerMarket(matchId, MARKET_BEST_BOWLER_INN2, bestBowl);
  }
}

async function settleMatchPlayerMarkets(matchId: string) {
  const { bat, bowl } = await aggregateInningStats(matchId, 1);
  const { bat: bat2, bowl: bowl2 } = await aggregateInningStats(matchId, 2);

  // merge innings
  for (const [k, v] of Object.entries(bat2)) {
    if (!bat[k]) bat[k] = { runs: 0, balls: 0 };
    bat[k].runs += v.runs;
    bat[k].balls += v.balls;
  }
  for (const [k, v] of Object.entries(bowl2)) {
    if (!bowl[k]) bowl[k] = { wickets: 0, runs: 0, balls: 0 };
    bowl[k].wickets += v.wickets;
    bowl[k].runs += v.runs;
    bowl[k].balls += v.balls;
  }

  const bestBat = topByRuns(bat)[0] ? [topByRuns(bat)[0]] : [];
  const bestBowl = topByWickets(bowl)[0] ? [topByWickets(bowl)[0]] : [];

  await settlePlayerMarket(matchId, MARKET_TOP_BATTER, bestBat);
  await settlePlayerMarket(matchId, MARKET_TOP_BOWLER, bestBowl);
}

async function fetchMatchWinnerOdds(
  matchId: string,
  homeGuess?: string | null,
  awayGuess?: string | null,
): Promise<{ homeOdds: number | null; awayOdds: number | null }> {
  const { data: market } = await supabase
    .from("markets")
    .select("id")
    .eq("match_id", matchId)
    .eq("market_name", "Match Winner")
    .order("open_time", { ascending: false })
    .maybeSingle();

  if (!market?.id) return { homeOdds: null, awayOdds: null };

  const { data: runners } = await supabase
    .from("market_runners")
    .select("runner_name, back_odds, metadata")
    .eq("market_id", market.id);

  if (!runners?.length) return { homeOdds: null, awayOdds: null };

  let homeOdds: number | null = null;
  let awayOdds: number | null = null;

  for (const r of runners) {
    const meta = (r as any).metadata || {};
    const isHome =
      meta.is_home === true ||
      (homeGuess && normalizeName(r.runner_name) === normalizeName(homeGuess));
    const isAway =
      meta.is_away === true ||
      (awayGuess && normalizeName(r.runner_name) === normalizeName(awayGuess));

    if (isHome) homeOdds = Number(r.back_odds ?? homeOdds);
    if (isAway) awayOdds = Number(r.back_odds ?? awayOdds);
  }

  return { homeOdds, awayOdds };
}

async function fetchMatchContext(
  matchId: string,
  partial?: Partial<NotificationContext>,
): Promise<NotificationContext> {
  const { data: row } = await supabase
    .from("matches")
    .select(
      "home_team, away_team, ro_team_home_name, ro_team_away_name, display_score, ro_score_runs, ro_score_wickets, ro_score_overs, target_runs, ro_last_payload, toss_won_by, elected_to, display_status"
    )
    .eq("id", matchId)
    .maybeSingle();

  const homeTeam = (row?.ro_team_home_name || row?.home_team || "Home").trim();
  const awayTeam = (row?.ro_team_away_name || row?.away_team || "Away").trim();

  const runs = Number.isFinite(Number(row?.ro_score_runs))
    ? Number(row?.ro_score_runs)
    : null;
  const wickets = Number.isFinite(Number(row?.ro_score_wickets))
    ? Number(row?.ro_score_wickets)
    : null;
  const oversRaw = Number.isFinite(Number(row?.ro_score_overs))
    ? Number(row?.ro_score_overs)
    : null;
  const oversFloat = oversToFloat(oversRaw);
  const runRate =
    runs !== null && oversFloat && oversFloat > 0
      ? (runs / oversFloat).toFixed(2)
      : null;

  let score = row?.display_score || null;
  if (!score && runs !== null) {
    const wicketPart = wickets !== null ? `/${wickets}` : "";
    const overPart = oversRaw !== null ? ` (${oversRaw})` : "";
    score = `${runs}${wicketPart}${overPart}`;
  }

  const { homeOdds, awayOdds } = await fetchMatchWinnerOdds(
    matchId,
    homeTeam,
    awayTeam,
  );

  return {
    matchId,
    homeTeam,
    awayTeam,
    tossWinner: row?.toss_won_by ?? null,
    tossDecision: row?.elected_to ?? null,
    score,
    runs,
    wickets,
    overs: oversRaw,
    runRate,
    target: Number.isFinite(Number((row as any)?.ro_target_runs))
      ? Number((row as any).ro_target_runs)
      : Number.isFinite(Number(row?.target_runs))
      ? Number(row?.target_runs)
      : null,
    inning: partial?.inning ?? null,
    over: partial?.over ?? null,
    oddsHome: homeOdds,
    oddsAway: awayOdds,
    status: row?.display_status ?? null,
    ...partial,
  };
}

function renderNotification(
  event: NotificationEventType,
  ctx: NotificationContext,
): { title: string; body: string; payload: any } | null {
  const oddsLine =
    ctx.oddsHome || ctx.oddsAway
      ? `${ctx.homeTeam} ${ctx.oddsHome ?? "--"} | ${ctx.awayTeam} ${ctx.oddsAway ?? "--"}`
      : `${ctx.homeTeam} vs ${ctx.awayTeam}`;

  const scoreLine = ctx.score || "Live score unavailable";
  const rr = ctx.runRate ? ` RR ${ctx.runRate}` : "";

  switch (event) {
    case "TOSS_RESULT":
      return {
        title: "Toss update",
        body: `${ctx.tossWinner || "Toss"} choose to ${ctx.tossDecision || "decide"}. Early edge? ${oddsLine}`,
        payload: ctx,
      };
    case "START_MINUS5":
      return {
        title: "5 minutes to start",
        body: `${ctx.homeTeam} vs ${ctx.awayTeam} starts soon. Lock picks before odds move: ${oddsLine}`,
        payload: ctx,
      };
    case "LIVE_START":
      return {
        title: "We're live",
        body: `${ctx.homeTeam} vs ${ctx.awayTeam} underway. Live odds: ${oddsLine}`,
        payload: ctx,
      };
    case "OVER_6":
      return {
        title: "Powerplay done",
        body: `${scoreLine}${rr}. Momentum call? ${oddsLine}`,
        payload: ctx,
      };
    case "OVER_10":
      return {
        title: "10-over check",
        body: `${scoreLine}${rr}. Spot value on totals & wickets.`,
        payload: ctx,
      };
    case "OVER_15":
      return {
        title: "Death overs coming",
        body: `${scoreLine}${rr}. Who finishes stronger? ${oddsLine}`,
        payload: ctx,
      };
    case "INNINGS_END":
      return {
        title: "Innings complete",
        body: `Score: ${scoreLine}. Target ${ctx.target ?? "tbd"}. Back a chase or a defend? ${oddsLine}`,
        payload: ctx,
      };
    case "PRE_INNINGS2":
      return {
        title: "Second innings imminent",
        body: `Target ${ctx.target ?? "tbd"}. Odds now: ${oddsLine}. Set your stance.`,
        payload: ctx,
      };
    case "MATCH_END":
      return {
        title: "Match finished",
        body: `${ctx.homeTeam} vs ${ctx.awayTeam} wrapped. Final: ${scoreLine}. Check your returns.`,
        payload: ctx,
      };
    default:
      return null;
  }
}

async function getInterestedUsers(matchId: string): Promise<string[]> {
  const userIds = new Set<string>();

  const { data: subs } = await supabase
    .from("user_match_subscriptions")
    .select("user_id")
    .eq("match_id", matchId)
    .eq("is_active", true);

  subs?.forEach((s: any) => s?.user_id && userIds.add(String(s.user_id)));

  const { data: betUsers } = await supabase
    .from("bets")
    .select("user_id")
    .eq("match_id", matchId);

  betUsers?.forEach((b: any) => b?.user_id && userIds.add(String(b.user_id)));

  const { data: instUsers } = await supabase
    .from("instance_bets")
    .select("user_id")
    .eq("match_id", matchId);

  instUsers?.forEach((b: any) => b?.user_id && userIds.add(String(b.user_id)));

  // Also push to any user who has an active device token (global broadcast)
  const { data: deviceUsers } = await supabase
    .from("user_devices")
    .select("user_id")
    .eq("is_active", true);

  deviceUsers?.forEach((d: any) => d?.user_id && userIds.add(String(d.user_id)));

  return Array.from(userIds);
}

async function fanoutNotification(
  notificationId: string,
  matchId: string,
  payload: any,
) {
  const users = await getInterestedUsers(matchId);
  if (!users.length) return;

  const { data: nRow } = await supabase
    .from("match_notifications")
    .select("title, body")
    .eq("id", notificationId)
    .maybeSingle();

  const nowIso = new Date().toISOString();
  const inAppRows = users.map((uid) => ({
    user_id: uid,
    notification_id: notificationId,
    match_id: matchId,
    channel: "IN_APP",
    status: "SENT",
    sent_at: nowIso,
    payload: { ...(payload ?? {}), title: nRow?.title, body: nRow?.body },
  }));

  await supabase.from("user_notifications").upsert(inAppRows, {
    onConflict: "notification_id,user_id,channel",
    ignoreDuplicates: true,
  });

  // Push channel: one token per user (first active token)
  const { data: devices } = await supabase
    .from("user_devices")
    .select("user_id, token, platform, provider")
    .in("user_id", users)
    .eq("is_active", true);

  if (devices?.length) {
    const pushRows: any[] = [];
    const seenUser: Set<string> = new Set();
    for (const d of devices) {
      const uid = String(d.user_id);
      if (seenUser.has(uid)) continue; // one token per user to avoid UNIQUE clash
      seenUser.add(uid);
      pushRows.push({
        user_id: uid,
        notification_id: notificationId,
        match_id: matchId,
        channel: "PUSH",
        status: "QUEUED",
        payload: {
          ...(payload ?? {}),
          title: nRow?.title,
          body: nRow?.body,
          token: d.token,
          platform: d.platform,
          provider: d.provider || "fcm",
        },
      });
    }
    if (pushRows.length) {
      await supabase.from("user_notifications").upsert(pushRows, {
        onConflict: "notification_id,user_id,channel",
        ignoreDuplicates: true,
      });
    }
  }
}

async function emitNotification(
  event: NotificationEventType,
  matchId: string,
  opts: {
    inning?: number;
    over?: number;
    payload?: any;
    context?: Partial<NotificationContext>;
    dedupeKey?: string;
  } = {},
): Promise<string | null> {
  const dedupe = opts.dedupeKey ??
    `${matchId}:${event}:${opts.inning ?? "x"}:${opts.over ?? "x"}`;

  const { data: existing } = await supabase
    .from("match_notifications")
    .select("id")
    .eq("dedupe_key", dedupe)
    .maybeSingle();

  if (existing?.id) return existing.id;

  const ctx = await fetchMatchContext(matchId, {
    inning: opts.inning ?? null,
    over: opts.over ?? null,
    ...(opts.context || {}),
  });

  const rendered = renderNotification(event, ctx);
  if (!rendered) return null;

  const nowIso = new Date().toISOString();

  const { data: row, error: nErr } = await supabase
    .from("match_notifications")
    .insert({
      match_id: matchId,
      inning: opts.inning ?? null,
      over: opts.over ?? null,
      event_type: event,
      title: rendered.title,
      body: rendered.body,
      payload: opts.payload ?? rendered.payload,
      status: "SENT",
      dedupe_key: dedupe,
      event_at: nowIso,
      sent_at: nowIso,
    })
    .select("id")
    .maybeSingle();

  if (nErr || !row?.id) {
    console.error("[notifications] insert failed", { matchId, event, nErr });
    return null;
  }

  await fanoutNotification(row.id, matchId, opts.payload ?? rendered.payload);
  return row.id;
}

async function safeEmitNotification(
  event: NotificationEventType,
  matchId: string,
  opts: {
    inning?: number;
    over?: number;
    payload?: any;
    context?: Partial<NotificationContext>;
    dedupeKey?: string;
  } = {},
) {
  try {
    return await emitNotification(event, matchId, opts);
  } catch (err) {
    console.error("[notifications] emit failed", { matchId, event, err });
    return null;
  }
}

async function emitBallNotifications(args: {
  matchId: string;
  inningNumber: number;
  overNumber: number;
  ballInOver: number;
  prevInning: number | null;
  prevDisplay: string | null;
}) {
  const { matchId, inningNumber, overNumber, ballInOver, prevInning, prevDisplay } =
    args;

  // Live start (first ball)
  if (prevDisplay !== "LIVE") {
    await safeEmitNotification("LIVE_START", matchId, { inning: inningNumber });
  }

  // Over milestones (completed over)
  if (ballInOver === 6) {
    if (overNumber === 6) {
      await safeEmitNotification("OVER_6", matchId, {
        inning: inningNumber,
        over: overNumber,
      });
    } else if (overNumber === 10) {
      await safeEmitNotification("OVER_10", matchId, {
        inning: inningNumber,
        over: overNumber,
      });
    } else if (overNumber === 15) {
      await safeEmitNotification("OVER_15", matchId, {
        inning: inningNumber,
        over: overNumber,
      });
    }
  }

  // Inning change (first ball of new inning)
  if (prevInning && inningNumber > prevInning) {
    await safeEmitNotification("INNINGS_END", matchId, {
      inning: prevInning,
    });
    await safeEmitNotification("PRE_INNINGS2", matchId, {
      inning: inningNumber,
    });
  }
}

// ======================= PLAYERS UPSERT (SAFE) =======================
// Never overwrite an existing player name/team_key with null.
// Always update last_seen/updated_at.

async function upsertPlayer(
  roPlayerKey: string | null | undefined,
  name?: string | null,
  teamKey?: string | null,
) {
  if (!roPlayerKey) return;

  const nowIso = new Date().toISOString();

  // Only include name/teamKey fields if they are present
  const row: any = {
    ro_player_key: String(roPlayerKey),
    ro_last_seen_at: nowIso,
    updated_at: nowIso,
  };

  if (name && String(name).trim()) row.ro_player_name = String(name).trim();
  if (teamKey && String(teamKey).trim()) row.ro_team_key = String(teamKey).trim();

  await supabase.from("players").upsert(row, {
    onConflict: "ro_player_key",
    ignoreDuplicates: false,
  });
}


// Resolve player name from the local players table (seeded via snapshots)
async function lookupPlayerName(roPlayerKey: string | null | undefined) {
  if (!roPlayerKey) return null;
  const { data, error } = await supabase
    .from("players")
    .select("ro_player_name")
    .eq("ro_player_key", roPlayerKey)
    .maybeSingle();
  if (error) {
    console.error("lookupPlayerName failed", { roPlayerKey, error });
    return null;
  }
  return data?.ro_player_name ?? null;
}


async function handleBallEvent(body: any) {
  const data = body?.data || body;
  const roMatchKey = extractMatchKey(body) || extractMatchKey(data);
  if (!roMatchKey) throw new ApiError("Missing match key", 400);

  // Roanuz push shape: { ball: { ball_key, is_delete, detail: {...}, batting_order }, matchkey, ... }
  const ball = data?.ball || data;
  const detail = ball?.detail || data?.detail || data?.ball?.detail || null;

  const ballKey = String(detail?.key ?? ball?.ball_key ?? data?.ball_key ?? "");
  if (!ballKey) throw new ApiError("Missing ball_key", 400);

  const isDeleted = ball?.is_delete === true;
  const matchId = await findOrCreateMatch(roMatchKey, data);

  // ---- Delete ----
  if (isDeleted) {
    const { error: delErr } = await supabase
      .from("ball_events")
      .update({ ro_is_deleted: true })
      .eq("match_id", matchId)
      .eq("ro_ball_key", ballKey);

    if (delErr) throw new ApiError(`Failed to mark ball deleted: ${delErr.message}`, 500);

    // Still update last payload + status for visibility
    await supabase
      .from("matches")
      .update({
        updated_at: new Date().toISOString(),
        ro_last_payload: data,
      })
      .eq("id", matchId);

    return success({ success: true, matchId, roMatchKey, ballKey, isDeleted: true });
  }

  // Fetch previous match row (for derived fields and fallbacks)
  const { data: prevRow, error: prevErr } = await supabase
    .from("matches")
    .select(
      "ro_score_runs, ro_score_wickets, ro_score_overs, ro_target_runs, ro_current_inning, ro_competition_type, ro_competition_name",
    )
    .eq("id", matchId)
    .maybeSingle();
  if (prevErr) {
    throw new ApiError(`Failed to read match snapshot: ${prevErr.message}`, 500);
  }

  // ---- Over / Ball-in-over ----
  // detail.overs = [overNumber, ballInOver] (example: [12, 6] means 12.6)
  const oversArr = Array.isArray(detail?.overs) ? detail.overs : null;
  const overNumber = Number(
    oversArr?.[0] ?? ball?.over ?? ball?.over_number ?? data?.over_number ?? 0,
  );
  const ballInOverRaw = Number(
    oversArr?.[1] ?? ball?.ball_in_over ?? data?.ball_in_over ?? 0,
  );
  // Normalize to 1-6 so we never store 0 and avoid client-side jumps
  const ballInOver = Math.max(
    1,
    Math.min(6, Number.isFinite(ballInOverRaw) ? ballInOverRaw : 1),
  );

  // ---- Inning number (CRITICAL FIX) ----
  // For limited-overs, match innings order is ball.batting_order (1 or 2)
  // detail.innings like "b_1" is team innings index, not match innings (both teams can have "_1").
  const inningNumber = (() => {
    const bo = Number(
      ball?.batting_order ?? data?.ball?.batting_order ?? NaN,
    );
    if (Number.isFinite(bo) && bo > 0) return bo;

    // Fallback: Test-like suffix a_2/b_2 (only useful when present)
    const inn = String(detail?.innings ?? "");
    const m = inn.match(/_(\d+)$/);
    const n = Number(m?.[1] ?? NaN);
    if (Number.isFinite(n) && n > 0) return n;

    return 1;
  })();

  // Close relevant player markets on first legal ball of an innings
  if (ballInOver === 1) {
    await closePlayerMarketsOnFirstBall(matchId, inningNumber);
  }

  const subBallNumber = Number(ball?.sub_ball_number ?? 0);

  // ---- Runs (PER BALL) ----
  // In detail push: batsman.runs is runs off bat for that delivery; team_score.extras is extras for that delivery.
  // Runs: prefer detailed fields, fallback to generic detail.runs node
  const runsNode = detail?.runs || detail?.run || null;
  const batsmanRuns = Number(
    detail?.batsman?.runs ??
      runsNode?.batsman ??
      runsNode?.batsmen ??
      runsNode?.batter ??
      0,
  );
  const extrasRuns = Number(
    detail?.team_score?.extras ??
      runsNode?.extras ??
      0,
  );
  const totalRuns = Number(
    detail?.team_score?.runs ??
      runsNode?.total ??
      batsmanRuns + extrasRuns,
  );

  // ---- Players ----
  const strikerKey =
    detail?.batsman?.player_key ??
    detail?.batsman?.key ??
    detail?.batsman?.id ??
    detail?.batsman_id ??
    detail?.batsman_key ??
    detail?.batsman?.player_id ??
    detail?.striker?.player_key ??
    detail?.striker?.key ??
    detail?.striker?.id ??
    detail?.striker_id ??
    detail?.striker_key ??
    null;

  const nonStrikerKey =
    detail?.non_striker?.player_key ??
    detail?.non_striker?.key ??
    detail?.non_striker?.id ??
    detail?.non_striker_id ??
    detail?.non_striker_key ??
    detail?.nonStrikerKey ??
    detail?.non_striker?.player_id ??
    null;

  const bowlerKey =
    detail?.bowler?.player_key ??
    detail?.bowler?.key ??
    detail?.bowler?.id ??
    detail?.bowler_id ??
    detail?.bowler_key ??
    detail?.bowler?.player_id ??
    null;

  // Seed players (names in players table) for this match
  await ensurePlayersForMatch(roMatchKey, [strikerKey, nonStrikerKey, bowlerKey]);

  const strikerNameFinal =
    (await lookupPlayerName(strikerKey)) ??
    (strikerKey ? String(strikerKey) : null);

  const nonStrikerNameFinal =
    (await lookupPlayerName(nonStrikerKey)) ??
    (nonStrikerKey ? String(nonStrikerKey) : null);

  const bowlerNameFinal =
    (await lookupPlayerName(bowlerKey)) ??
    (bowlerKey ? String(bowlerKey) : null);

  // ---- Wicket ----
  const wicket = detail?.wicket ?? null;
  const wicketKind = wicket?.kind ?? wicket?.type ?? null;
  const wicketPlayerOut =
    wicket?.player_out?.name ??
    wicket?.batsman?.name ??
    wicket?.player_name ??
    null;

  const wicketFielder =
    (Array.isArray(detail?.fielders) && detail.fielders[0]?.name)
      ? detail.fielders[0].name
      : wicket?.fielder?.name ?? null;

  // ---- Legal delivery heuristic ----
  // Normalize ball_type / extra_type to catch variants like "no ball", "no-ball", "wide ball"
  const rawBallType = String(detail?.ball_type ?? detail?.extra_type ?? "")
    .toLowerCase()
    .replace(/[-\s]+/g, "_");

  const extraType = (() => {
    if (!rawBallType || rawBallType === "normal") return null;
    if (rawBallType.startsWith("wide")) return "wide";
    if (
      rawBallType === "no_ball" ||
      rawBallType === "noball" ||
      rawBallType === "nb"
    ) {
      return "no_ball";
    }
    if (rawBallType === "bye") return "bye";
    if (
      rawBallType === "leg_bye" ||
      rawBallType === "legbye" ||
      rawBallType === "lb"
    ) {
      return "leg_bye";
    }
    return rawBallType;
  })();
  const isLegalDelivery = !(
    extraType === "wide" || extraType === "no_ball"
  );

  const normalizedBall: any = {
    match_id: matchId,
    ro_ball_key: ballKey,

    ro_inning_number: inningNumber,
    ro_over_number: overNumber,
    ro_ball_in_over: ballInOver,
    ro_sub_ball_number: subBallNumber,

    ro_batsman_runs: batsmanRuns,
    ro_extras_runs: extrasRuns,
    ro_total_runs: totalRuns,

    ro_is_wicket: !!(detail?.team_score?.is_wicket || wicket),
    ro_wicket_kind: wicketKind,
    ro_wicket_player_out: wicketPlayerOut,
    ro_wicket_fielder: wicketFielder,

    ro_extra_type: extraType,
    ro_is_boundary: detail?.batsman?.is_four === true || batsmanRuns === 4,
    ro_is_six: detail?.batsman?.is_six === true || batsmanRuns === 6,
    ro_is_legal_delivery: isLegalDelivery,

    ro_batsman_key: strikerKey ? String(strikerKey) : null,
    ro_bowler_key: bowlerKey ? String(bowlerKey) : null,
    ro_non_striker_key: nonStrikerKey ? String(nonStrikerKey) : null,

    ro_batsman_name: strikerNameFinal,
    ro_non_striker_name: nonStrikerNameFinal,
    ro_bowler_name: bowlerNameFinal,

    ro_commentary: detail?.comment ?? null,
    ro_event_type: String(data?.match_push_kind ?? "Ball"),

    ro_raw_data: data,
    ro_is_deleted: false,
  };

  const { error: upsertErr } = await supabase
    .from("ball_events")
    .upsert(normalizedBall, {
      onConflict: "match_id,ro_ball_key",
      ignoreDuplicates: false,
    });

  if (upsertErr) {
    throw new ApiError(`Failed to upsert ball: ${upsertErr.message}`, 500);
  }

  // Fire-and-forget background processing so webhook responds immediately
  const sideEffects = (async () => {
    // Pulse-suspend Match Winner on legal deliveries, reopen after odds refresh/timeout
    if (normalizedBall.ro_is_legal_delivery !== false && roMatchKey) {
      const seq = `${inningNumber}-${overNumber}-${ballInOver}-${Date.now()}`;
      _mwLatestSeq[matchId] = seq;
      await suspendMatchWinner(matchId);
      reopenMatchWinnerWithOdds(matchId, roMatchKey, seq);
    }

    // ---- Match update: score + inning + overs ----
    function parseDisplayScore(
      s: string,
    ): { runs?: number; wickets?: number; overs?: number } {
      const str = String(s || "").trim();
      if (!str) return {};

      // common: "110/3 in 12.6 overs"
      const m1 = str.match(
        /(\d+)\s*\/\s*(\d+)\s*in\s*([\d.]+)\s*overs?/i,
      );
      if (m1) {
        const runs = Number(m1[1]);
        const wickets = Number(m1[2]);
        const overs = Number(m1[3]);
        return {
          runs: Number.isFinite(runs) ? runs : undefined,
          wickets: Number.isFinite(wickets) ? wickets : undefined,
          overs: Number.isFinite(overs) ? overs : undefined,
        };
      }

      // fallback: "110/3 (12.6)" or other minimal variants
      const m2 = str.match(
        /(\d+)\s*\/\s*(\d+).*?([\d.]+)\s*(?:ov|overs|\))/i,
      );
      if (m2) {
        const runs = Number(m2[1]);
        const wickets = Number(m2[2]);
        const overs = Number(m2[3]);
        return {
          runs: Number.isFinite(runs) ? runs : undefined,
          wickets: Number.isFinite(wickets) ? wickets : undefined,
          overs: Number.isFinite(overs) ? overs : undefined,
        };
      }

      return {};
    }

    // Fill batting/bowling team keys from detail.batting_team: "a" or "b"
    // We need home/away keys from matches row.
    let homeKey: string | null = null;
    let awayKey: string | null = null;
    let prevInning: number | null = null;
    let prevDisplay: string | null = null;
    let prevTarget: number | null = null;

    {
      const { data: mrow, error: mErr } = await supabase
        .from("matches")
        .select(
          "ro_team_home_key, ro_team_away_key, ro_current_inning, display_status, ro_target_runs, ro_competition_type, ro_competition_name",
        )
        .eq("id", matchId)
        .maybeSingle();

      if (mErr) {
        throw new ApiError(
          `Failed to read match team keys: ${mErr.message}`,
          500,
        );
      }

      homeKey = mrow?.ro_team_home_key
        ? String(mrow.ro_team_home_key)
        : null;
      awayKey = mrow?.ro_team_away_key
        ? String(mrow.ro_team_away_key)
        : null;
      prevInning = Number.isFinite(Number(mrow?.ro_current_inning))
        ? Number(mrow?.ro_current_inning)
        : null;
      prevDisplay = (mrow?.display_status || null) as string | null;
      prevTarget = Number.isFinite(Number(mrow?.ro_target_runs))
        ? Number(mrow?.ro_target_runs)
        : null;
    }

    // Build base match update (including previous target if any)
    const matchUpdate: any = {
      updated_at: new Date().toISOString(),
      ro_current_inning: inningNumber,
      ro_last_payload: data,
      ro_status: "live",
    };

    // ✅ Preserve existing target if already set
    if (prevTarget && prevTarget > 0) {
      matchUpdate.ro_target_runs = prevTarget;
    }

    if (detail?.display_score) {
      const ds = String(detail.display_score);
      matchUpdate.display_score = ds;

      const parsed = parseDisplayScore(ds);
      if (Number.isFinite(parsed.runs as number)) {
        matchUpdate.ro_score_runs = parsed.runs;
      }
      if (Number.isFinite(parsed.wickets as number)) {
        matchUpdate.ro_score_wickets = parsed.wickets;
      }
      if (Number.isFinite(parsed.overs as number)) {
        matchUpdate.ro_score_overs = parsed.overs;
      }
    }

    // batting/bowling team keys based on "a"/"b"
    const battingTeamAb = String(detail?.batting_team ?? "").toLowerCase();
    if (battingTeamAb === "a") {
      if (homeKey) matchUpdate.ro_batting_team_key = homeKey;
      if (awayKey) matchUpdate.ro_bowling_team_key = awayKey;
    } else if (battingTeamAb === "b") {
      if (awayKey) matchUpdate.ro_batting_team_key = awayKey;
      if (homeKey) matchUpdate.ro_bowling_team_key = homeKey;
    }

    // current players (optional but useful)
    if (strikerKey) matchUpdate.ro_striker_key = String(strikerKey);
    if (nonStrikerKey) matchUpdate.ro_non_striker_key = String(nonStrikerKey);
    if (bowlerKey) matchUpdate.ro_bowler_key = String(bowlerKey);

    matchUpdate.display_status = computeDisplayStatus(
      matchUpdate.ro_status,
      undefined,
      undefined,
      "LIVE",
    );

    // ✅ Target derivation as soon as second innings is underway
    if (inningNumber >= 2) {
      let ensuredTarget = await deriveTargetIfMissing(
        matchId,
        inningNumber,
        matchUpdate.ro_target_runs ?? prevTarget,
      );

      if (!ensuredTarget || ensuredTarget <= 0) {
        // Provider snapshot fallback on first ball(s) of second innings
        try {
          const snap = await fetchRoanuzMatchSnapshot(roMatchKey);
          const { target: snapTarget, firstInningsTotal } = extractTargetFromSnapshot(snap);
          if (Number.isFinite(snapTarget) && snapTarget! > 0) {
            ensuredTarget = snapTarget!;
          } else if (Number.isFinite(firstInningsTotal) && firstInningsTotal! > 0) {
            ensuredTarget = firstInningsTotal! + 1;
          }
        } catch (err) {
          console.error("[target-fallback] snapshot fetch failed", {
            matchId,
            roMatchKey,
            err,
          });
        }
      }

      if (!ensuredTarget || ensuredTarget <= 0) {
        const computed = await computeTargetFromBallEvents(matchId);
        if (computed && computed > 0) ensuredTarget = computed;
      }

      if (ensuredTarget && ensuredTarget > 0) {
        matchUpdate.ro_target_runs = ensuredTarget;
      }
    }

    // Required runs/balls from detail (if present)
    const { runs: reqRunsDetail, balls: reqBallsDetail } = extractRequiredFromDetail(detail);
    if (Number.isFinite(reqRunsDetail as number)) matchUpdate.ro_required_runs = reqRunsDetail;
    if (Number.isFinite(reqBallsDetail as number)) matchUpdate.ro_required_balls = reqBallsDetail;

    // Derive required runs/balls from parsed score when target and overs are known
    const parsedRuns = toNum(matchUpdate.ro_score_runs ?? prevRow?.ro_score_runs, null);
    const targetForReq = matchUpdate.ro_target_runs ?? prevTarget ?? null;
    const parsedOvers = toNum(matchUpdate.ro_score_overs ?? prevRow?.ro_score_overs, null);
    const oversCap = oversLimitFromCompetition(
      (prevRow as any)?.ro_competition_type,
      (prevRow as any)?.ro_competition_name,
    ) ?? 20;
    if (
      targetForReq != null &&
      parsedRuns != null &&
      parsedRuns <= targetForReq &&
      Number.isFinite(parsedOvers) &&
      inningNumber >= 2
    ) {
      const runsNeeded = Math.max(0, targetForReq - parsedRuns);
      const whole = Math.floor(parsedOvers);
      const frac = Math.round((parsedOvers - whole) * 10); // 16.4 => ball index 4
      const ballsBowled = whole * 6 + frac;
      const ballsRemaining = Math.max(0, oversCap * 6 - ballsBowled);
      matchUpdate.ro_required_runs = runsNeeded;
      matchUpdate.ro_required_balls = ballsRemaining;
    }

    // ---- Recompute live score from ball_events to avoid stale provider score ----
    let aggRuns = matchUpdate.ro_score_runs ?? prevRow?.ro_score_runs ?? null;
    let aggWkts = matchUpdate.ro_score_wickets ?? prevRow?.ro_score_wickets ?? null;
    let aggLegalBalls: number | null = null;
    try {
      const { data: inningBalls, error: aggErr } = await supabase
        .from("ball_events")
        .select(
          "ro_total_runs, ro_is_wicket, ro_is_legal_delivery",
        )
        .eq("match_id", matchId)
        .eq("ro_inning_number", inningNumber)
        .or(
          "ro_is_deleted.is.null,ro_is_deleted.eq.false",
        );

      if (!aggErr && Array.isArray(inningBalls)) {
        let runs = 0;
        let wkts = 0;
        let legal = 0;
        for (const b of inningBalls) {
          runs += Number(b.ro_total_runs ?? 0);
          if (b.ro_is_wicket) wkts += 1;
          if (b.ro_is_legal_delivery !== false) legal += 1;
        }
        aggRuns = runs;
        aggWkts = wkts;
        aggLegalBalls = legal;
        const overNum = Math.floor(legal / 6);
        const ballNum = legal % 6;
        matchUpdate.ro_score_runs = runs;
        matchUpdate.ro_score_wickets = wkts;
        matchUpdate.ro_score_overs = Number(`${overNum}.${ballNum}`);
      }
    } catch (err) {
      console.error("[score-aggregate] failed", { matchId, err });
    }

    const { error: muErr } = await supabase
      .from("matches")
      .update(matchUpdate)
      .eq("id", matchId);
    if (muErr) {
      throw new ApiError(`Failed to update match: ${muErr.message}`, 500);
    }

    // ---- Session projections (backend-driven) ----
    // ---- Session projections (backend-driven)
    const runsForProj =
      aggRuns ??
      toNum(matchUpdate.ro_score_runs ?? prevRow?.ro_score_runs, null);
    const wktsForProj =
      aggWkts ??
      toNum(matchUpdate.ro_score_wickets ?? prevRow?.ro_score_wickets, null);
    const oversForProj = (() => {
      if (aggLegalBalls != null) return aggLegalBalls / 6;
      const ov = toNum(matchUpdate.ro_score_overs ?? prevRow?.ro_score_overs, null);
      if (Number.isFinite(ov)) {
        const whole = Math.floor(ov);
        const fracBall = Math.round((ov - whole) * 10);
        return whole + Math.max(0, Math.min(5, fracBall)) / 6;
      }
      return null;
    })();

    if (
      Number.isFinite(runsForProj) &&
      Number.isFinite(wktsForProj) &&
      Number.isFinite(oversForProj)
    ) {
      await upsertSessionProjections({
        matchId,
        inningNumber,
        runs: runsForProj as number,
        wickets: wktsForProj as number,
        oversDecimal: oversForProj as number,
      });
    }

    // ---- Instance market pipeline ----
    await settleInstanceMarkets(
      matchId,
      inningNumber,
      overNumber,
      ballInOver,
      normalizedBall,
    );
    await closeStaleInstanceMarkets(
      matchId,
      inningNumber,
      overNumber,
      ballInOver,
    );
    await scheduleNextBallMarket(
      matchId,
      inningNumber,
      overNumber,
      ballInOver,
    );

    await settleNextOverMarketsIfOverComplete(
      matchId,
      inningNumber,
      overNumber,
      ballInOver,
    );
    await createNextOverMarketsIfOverComplete(
      matchId,
      inningNumber,
      overNumber,
      ballInOver,
    );

    // Commented out legacy projection markets (now replaced by session_markets)
    // await ensureProjectionMarkets(matchId, inningNumber, overNumber, ballInOver);
    // if (ballInOver === 6) {
    //   const completedOverHuman = overNumber + 1;
    //   await settleProjectionMarkets(matchId, inningNumber, completedOverHuman);
    // }

    // Wicket method pipeline
    if (normalizedBall.ro_is_wicket) {
      await createNextWicketMethodMarket(
        matchId,
        inningNumber,
        overNumber,
      );
    } else {
      // ensure a market exists early in the innings
      await createNextWicketMethodMarket(
        matchId,
        inningNumber,
        overNumber,
      );
    }

    // ---- Notification pipeline (non-blocking) ----
    await emitBallNotifications({
      matchId,
      inningNumber,
      overNumber,
      ballInOver,
      prevInning,
      prevDisplay,
    });

    // Inning-end settlements and second-innings market creation
    if (ballInOver === 6) {
      await settleInningPlayerMarkets(matchId, inningNumber);
      // if inning 1 ended, prepare inning 2 markets
      if (inningNumber === 1) {
        await ensureInnings2Markets(matchId, data, { homeKey, awayKey });
      }
    }

    // ---- Kick off live odds refresh (non-blocking, debounced per match) ----
    const now = Date.now();
    const last = _oddsPollLast[matchId] || 0;
    const MIN_GAP_MS = 10_000;
    if (roMatchKey && now - last > MIN_GAP_MS) {
      _oddsPollLast[matchId] = now;
      (async () => {
        try {
          await syncMatchWinnerOddsFromLiveApi(matchId, roMatchKey);
        } catch (err) {
          console.error("[live-odds-refresh] failed", {
            matchId,
            roMatchKey,
            err,
          });
        }
      })();
    }
  })();

  sideEffects.catch((err) => {
    console.error("[ball-side-effects] failed (background)", {
      matchId,
      roMatchKey,
      ballKey,
      err,
    });
  });

  return success({ success: true, matchId, roMatchKey, ballKey });
}


// ======================= NON-BALL UPDATE =======================
async function handleNonBallUpdate(body: any) {
  const data = body?.data || body;
  const roMatchKey = extractMatchKey(body) || extractMatchKey(data);
  if (!roMatchKey) {
    return { success: true, skipped: true, reason: "no_match_key" };
  }

  const matchId = await findOrCreateMatch(roMatchKey, data);
  const pushKind = String(body?.match_push_kind ?? data?.match_push_kind ?? "").toLowerCase();

  // Fetch previous display_status to avoid downgrading LIVE to UPCOMING during pauses/breaks
  const { data: prevRow } = await supabase
    .from("matches")
    .select(
      "display_status, ro_status, toss_won_by, elected_to, toss_recorded_at, ro_current_inning, ro_target_runs"
    )
    .eq("id", matchId)
    .maybeSingle();
  const prevDisplay = (prevRow?.display_status || null) as "UPCOMING" | "LIVE" | "FINISHED" | null;
  const everLive = prevDisplay === "LIVE" || String(prevRow?.ro_status || "").toLowerCase().includes("live");

  // Snapshot sync (push-driven, single fetch)
  const snapshot = await fetchRoanuzMatchSnapshot(roMatchKey);
  // Ensure squad players are cached (names for keys)
  await ensurePlayersForMatch(roMatchKey, []);

  // If this is a non-ball push, log a commentary row (ordered after latest ball)
  const kindRaw = pushKind;
  if (kindRaw && kindRaw !== "ball") {
    const mapped = mapNonBallEventType(kindRaw);
    const nowIso = new Date().toISOString();

    const { data: lastBall } = await supabase
      .from("ball_events")
      .select("ro_inning_number, ro_over_number, ro_ball_in_over, ro_sub_ball_number")
      .eq("match_id", matchId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const inning = Number(lastBall?.ro_inning_number ?? snapshot?.live?.inning_number ?? 1);
    const over = Number(lastBall?.ro_over_number ?? snapshot?.live?.current_over ?? 0);
    const ball = Number(lastBall?.ro_ball_in_over ?? 0);
    const subBall = Number(lastBall?.ro_sub_ball_number ?? 0) + 99; // ensure it appears after balls

    await supabase.from("ball_events").insert({
      match_id: matchId,
      ro_inning_number: inning,
      ro_over_number: over,
      ro_ball_in_over: ball,
      ro_sub_ball_number: subBall,
      ro_is_deleted: false,
      ro_is_wicket: false,
      ro_total_runs: 0,
      ro_batsman_runs: 0,
      ro_extras_runs: 0,
      ro_is_boundary: false,
      ro_is_six: false,
      ro_is_legal_delivery: false,
      ro_event_type: mapped?.type ?? kindRaw,
      ro_commentary: mapped?.text ?? kindRaw,
      ro_raw_data: data,
      created_at: nowIso,
    });
  }

  // Create pre-start player markets when lineups/toss available and before first ball
  const hasStarted = !!snapshot?.live?.recent_overs?.length || !!snapshot?.live?.current_over;
  if (!hasStarted) {
    const homeKey = snapshot?.match?.team_a?.key || snapshot?.team_a?.key || null;
    const awayKey = snapshot?.match?.team_b?.key || snapshot?.team_b?.key || null;
    const tossWinner = snapshot?.match?.toss?.winner || snapshot?.toss?.winner || null;
    const tossDecision = (snapshot?.match?.toss?.decision || snapshot?.toss?.decision || "bat").toLowerCase();
    const battingFirstKey = tossDecision === "bat" ? tossWinner : tossWinner === homeKey ? awayKey : homeKey;
    const bowlingFirstKey = battingFirstKey === homeKey ? awayKey : homeKey;

    await ensureBestPlayerMarketsPreStart(
      matchId,
      snapshot,
      { homeKey, awayKey },
      { home: snapshot?.match?.team_a?.name || "Home", away: snapshot?.match?.team_b?.name || "Away" },
      { battingFirstKey, bowlingFirstKey },
    );
  }

  // Update match state fields
  const status = snapshot?.status || data?.match?.status || data?.status || "";
  const update: any = {
    updated_at: new Date().toISOString(),
    ro_last_payload: snapshot,
  };

  // If match finished, settle player markets
  if (isFinishedStatus(status)) {
    await settleInningPlayerMarkets(matchId, 1).catch(() => null);
    await settleInningPlayerMarkets(matchId, 2).catch(() => null);
    await settleMatchPlayerMarkets(matchId).catch(() => null);
  }

  // Prefer toss info from push payload; fallback to snapshot
  const tossPayload = extractTossInfo(data);
  const tossSnap = extractTossInfo(snapshot);
  const tossWinner = tossPayload.winner || tossSnap.winner;
  const tossDecision = tossPayload.decision || tossSnap.decision;

  if (tossWinner) {
    update.toss_won_by = tossWinner;
    update.ro_toss_won_by = tossWinner;
    update.toss_recorded_at = new Date().toISOString();
  }
  if (tossDecision) {
    update.elected_to = tossDecision;
    update.ro_toss_decision = tossDecision;
    if (!update.toss_recorded_at) update.toss_recorded_at = new Date().toISOString();
  }

  let computedDisplayStatus: "UPCOMING" | "LIVE" | "FINISHED" | undefined;
  const statusForCompute = status || prevRow?.ro_status || null;
  const statusString = status || statusForCompute || snapshot?.match_state || snapshot?.play_status || "";
  const finishedNow = isFinishedStatus(statusString);

  if (status) update.ro_status = status; // only overwrite when provider sends a value

  if (finishedNow) {
    computedDisplayStatus = "FINISHED";
    update.display_status = "FINISHED";
  } else if (everLive) {
    // Once live, stay live until an explicit finished signal
    computedDisplayStatus = "LIVE";
    update.display_status = "LIVE";
  } else if (statusForCompute) {
    computedDisplayStatus = computeDisplayStatus(statusForCompute, snapshot?.match_state, snapshot?.play_status, prevDisplay);
    update.display_status = computedDisplayStatus;
  } else if (prevDisplay) {
    update.display_status = prevDisplay;
  }

  if (snapshot?.match_state) update.ro_match_state = snapshot.match_state;
  if (snapshot?.play_status) update.ro_play_status = snapshot.play_status;
  if (snapshot?.innings) update.ro_innings_summary = snapshot.innings;

  // Target if present; fallback to innings summary first-innings total + 1
  const { target: snapTarget, firstInningsTotal } = extractTargetFromSnapshot(snapshot);
  const { runs: snapReqRuns, balls: snapReqBalls } = extractRequiredFromSnapshot(snapshot);
  const prevTarget = Number.isFinite(Number(prevRow?.ro_target_runs)) ? Number(prevRow?.ro_target_runs) : null;
  const inningFromSnapshot = Number(snapshot?.current_inning ?? snapshot?.inning ?? prevRow?.ro_current_inning ?? 1);

  if (Number.isFinite(snapTarget) && snapTarget! > 0) {
    update.ro_target_runs = Number(snapTarget);
  } else if (Number.isFinite(firstInningsTotal) && firstInningsTotal! > 0) {
    // Use first-innings runs from snapshot; target is runs + 1
    update.ro_target_runs = Number(firstInningsTotal) + 1;
  } else if (inningFromSnapshot >= 2) {
    const computed = await deriveTargetIfMissing(matchId, inningFromSnapshot, prevTarget);
    if (computed && computed > 0) update.ro_target_runs = computed;
  } else if (prevTarget && prevTarget > 0) {
    update.ro_target_runs = prevTarget;
  }

  if (Number.isFinite(snapReqRuns)) update.ro_required_runs = Number(snapReqRuns);
  if (Number.isFinite(snapReqBalls)) update.ro_required_balls = Number(snapReqBalls);

  await supabase.from("matches").update(update).eq("id", matchId);

  // If this push is a toss update, settle the Toss market immediately
  if (tossWinner || pushKind === "toss") {
    await settleTossMarket(matchId, tossWinner);
    await safeEmitNotification("TOSS_RESULT", matchId, {
      inning: 1,
      context: { tossWinner, tossDecision },
    });
  }

  if (computedDisplayStatus === "LIVE" && prevDisplay !== "LIVE") {
    await safeEmitNotification("LIVE_START", matchId, {
      inning: Number(prevRow?.ro_current_inning) || 1,
    });
  }

  if (computedDisplayStatus === "FINISHED" && prevDisplay !== "FINISHED") {
    await safeEmitNotification("MATCH_END", matchId, {
      inning: Number(prevRow?.ro_current_inning) || null,
    });
  }

  if (!roMatchKey) {
    return { success: true, matchId, roMatchKey, updateType: "non_ball_snapshot" };
  }

   if (computedDisplayStatus === "FINISHED") {
    await settleMatchWinnerMarket(matchId, roMatchKey, snapshot);
    await voidOpenInstanceMarketsForMatch(
      matchId,
      `auto-void: match finished (${statusString || "no status"})`,
    );

    return {
      success: true,
      matchId,
      roMatchKey,
      updateType: "non_ball_snapshot",
    };
  }

  if (computedDisplayStatus === "UPCOMING") {
    await priceMatchWinnerFromPreOdds(matchId, roMatchKey);
  } else {
    await syncMatchWinnerOddsFromLiveApi(matchId, roMatchKey);
  }

  return {
    success: true,
    matchId,
    roMatchKey,
    updateType: "non_ball_snapshot",
  };

}

// ======================= ODDS HELPERS =======================

function extractProbabilitiesFromOddsPayload(payload: any): Record<string, number> {
  const probMap: Record<string, number> = {};

  const percentages =
    payload?.match?.result_prediction?.automatic?.percentage ||
    payload?.result_prediction?.automatic?.percentage ||
    null;

  if (Array.isArray(percentages)) {
    for (const item of percentages) {
      const teamKey = item?.team_key ?? item?.teamKey ?? item?.key ?? null;
      const valRaw = Number(item?.value);
      if (!teamKey || !Number.isFinite(valRaw)) continue;
      const prob = valRaw > 1 ? valRaw / 100 : valRaw;
      probMap[String(teamKey)] = Number(prob.toFixed(6));
    }
  }

  if (Object.keys(probMap).length < 2) {
    const decimalOdds =
      payload?.match?.bet_odds?.automatic?.decimal ||
      payload?.bet_odds?.automatic?.decimal ||
      null;

    if (Array.isArray(decimalOdds)) {
      for (const item of decimalOdds) {
        const teamKey = item?.team_key ?? item?.teamKey ?? item?.key ?? null;
        const oddsVal = Number(item?.value ?? item?.odds ?? item?.decimal ?? item);
        if (!teamKey || !Number.isFinite(oddsVal) || oddsVal <= 1.01) continue;
        if (probMap[teamKey] == null) {
          const implied = Number((1 / oddsVal).toFixed(6));
          probMap[String(teamKey)] = implied;
        }
      }
    }
  }

  const entries = Object.entries(probMap).filter(([, v]) => Number.isFinite(v as number));
  if (entries.length >= 2) {
    const sum = entries.reduce((s, [, v]) => s + (v as number), 0);
    if (sum > 0) {
      for (const [k, v] of entries) {
        probMap[k] = Number(((v as number) / sum).toFixed(6));
      }
    }
  }

  return probMap;
}

async function applyMatchWinnerOddsFromProbabilities(
  matchId: string,
  probabilities: Record<string, number>,
  rawOddsPayload: any,
) {
  const { data: market } = await supabase
    .from("markets")
    .select("id")
    .eq("match_id", matchId)
    .eq("market_name", "Match Winner")
    .maybeSingle();

  if (!market?.id) return;

  const { data: runners } = await supabase
    .from("market_runners")
    .select("id, ro_team_key, runner_name")
    .eq("market_id", market.id);

  if (!runners || runners.length < 2) return;

  const getProbForRunner = (runner: any) => {
    if (runner.ro_team_key && probabilities[runner.ro_team_key] != null) {
      return probabilities[runner.ro_team_key];
    }
    const rn = normKey(runner.runner_name);
    for (const [k, v] of Object.entries(probabilities)) {
      if (normKey(k) === rn) return v;
    }
    return null;
  };

  let probA = getProbForRunner(runners[0]);
  let probB = getProbForRunner(runners[1]);

  if (!Number.isFinite(probA) || !Number.isFinite(probB)) return;
  const total = Number(probA) + Number(probB);
  if (total <= 0) return;

  probA = Number((Number(probA) / total).toFixed(6));
  probB = Number((Number(probB) / total).toFixed(6));

  const runnerAIsTop = isTopTeam(runners[0].ro_team_key, runners[0].runner_name);
  const runnerBIsTop = isTopTeam(runners[1].ro_team_key, runners[1].runner_name);

  const { backA, backB } = computeHouseOdds(probA, probB, runnerAIsTop, runnerBIsTop);

  const backARounded = Number(backA.toFixed(2));
  const backBRounded = Number(backB.toFixed(2));

  const nowIso = new Date().toISOString();

  const updates = [
    {
      id: runners[0].id,
      probability: probA,
      back_odds: backARounded,
      lay_odds: Number((backARounded + 0.02).toFixed(2)),
      updated_at: nowIso,
    },
    {
      id: runners[1].id,
      probability: probB,
      back_odds: backBRounded,
      lay_odds: Number((backBRounded + 0.02).toFixed(2)),
      updated_at: nowIso,
    },
  ];

  for (const u of updates) {
    await supabase.from("market_runners").update(u).eq("id", u.id);
  }

  await supabase
    .from("markets")
    .update({
      market_status: "OPEN",
      updated_at: nowIso,
      ro_odds_data: rawOddsPayload,
    })
    .eq("id", market.id);
}

// ======================= ODDS SYNC (LIVE) =======================

async function syncMatchWinnerOddsFromLiveApi(matchId: string, roMatchKey: string) {
  try {
    const livePayload = await fetchRoanuzLiveMatchOdds(roMatchKey);
    if (!livePayload) {
      console.warn("[syncMatchWinnerOddsFromLiveApi] skip: live odds not ready", { matchId, roMatchKey });
      return;
    }

    const probabilities = extractProbabilitiesFromOddsPayload(livePayload);
    if (Object.keys(probabilities).length < 2) {
      console.warn("[syncMatchWinnerOddsFromLiveApi] skip: insufficient probabilities", { matchId, roMatchKey });
      return;
    }

    await applyMatchWinnerOddsFromProbabilities(matchId, probabilities, livePayload);
  } catch (err: any) {
    if (err?.status === 404) {
      console.warn("[syncMatchWinnerOddsFromLiveApi] skip 404 live odds", { matchId, roMatchKey });
      return;
    }
    console.error("[syncMatchWinnerOddsFromLiveApi] failed", { matchId, roMatchKey, err });
  }
}

// Pulse-suspend Match Winner on every legal ball, then reopen after odds refresh or timeout
async function suspendMatchWinner(matchId: string) {
  await supabase
    .from("markets")
    .update({ market_status: "SUSPENDED", updated_at: new Date().toISOString() })
    .eq("match_id", matchId)
    .eq("market_name", "Match Winner")
    .eq("market_status", "OPEN");
}

async function reopenMatchWinnerWithOdds(matchId: string, roMatchKey: string, seq: string) {
  const nowIso = new Date().toISOString();
  const timeoutMs = 1500; // faster pulse
  const minSuspendMs = 400; // visible blink

  const oddsPromise = (async () => {
    try {
      await syncMatchWinnerOddsFromLiveApi(matchId, roMatchKey);
    } catch (err) {
      console.error("[match-winner-pulse] odds refresh failed", { matchId, roMatchKey, err });
    }
  })();

  const timeoutPromise = new Promise((resolve) => setTimeout(resolve, timeoutMs));
  const minSuspend = new Promise((resolve) => setTimeout(resolve, minSuspendMs));

  await Promise.all([Promise.race([oddsPromise, timeoutPromise]), minSuspend]);

  // If a newer ball arrived, skip reopen
  if (_mwLatestSeq[matchId] !== seq) return;

  await supabase
    .from("markets")
    .update({ market_status: "OPEN", updated_at: nowIso })
    .eq("match_id", matchId)
    .eq("market_name", "Match Winner")
    .in("market_status", ["SUSPENDED", "OPEN"]);
}

// ======================= PRE-MATCH / MODEL PRICING =======================

// ======================= HOUSE ODDS FROM WIN% =======================
const TOP_KEYS = new Set([
  "aus", "australia", "australiawomen", "ausw",
  "ind", "india", "indiawomen", "indw",
  "nz", "newzealand", "newzealandwomen", "nzw",
  "eng", "england", "englandwomen", "engw",
  "sa", "rsa", "southafrica", "southafricawomen", "rsaw",
]);

function normKey(val: string | null | undefined) {
  return String(val || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isTopTeam(key: string | null | undefined, name?: string | null | undefined) {
  const k = normKey(key);
  const n = normKey(name);
  return TOP_KEYS.has(k) || TOP_KEYS.has(n);
}

type Anchor = { pct: number; top: number; nonTop: number };
const ANCHORS: Anchor[] = [
  { pct: 40, top: 1.60, nonTop: 1.78 },
  { pct: 50, top: 1.42, nonTop: 1.65 },
  { pct: 60, top: 1.35, nonTop: 1.42 },
  { pct: 70, top: 1.28, nonTop: 1.34 },
  { pct: 80, top: 1.22, nonTop: 1.25 },
  { pct: 85, top: 1.15, nonTop: 1.20 },
  { pct: 90, top: 1.08, nonTop: 1.10 },
  { pct: 95, top: 1.04, nonTop: 1.08 },
  { pct: 100, top: 1.04, nonTop: 1.08 },
];

function interpolateOdds(winPct: number, isTop: boolean) {
  const list = ANCHORS;
  const p = Math.max(0, Math.min(100, winPct));
  const first = list[0];
  if (p <= first.pct) return isTop ? first.top : first.nonTop;
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1];
    const curr = list[i];
    if (p <= curr.pct) {
      const t = (p - prev.pct) / (curr.pct - prev.pct || 1);
      const oPrev = isTop ? prev.top : prev.nonTop;
      const oCurr = isTop ? curr.top : curr.nonTop;
      return oPrev + t * (oCurr - oPrev);
    }
  }
  const last = list[list.length - 1];
  return isTop ? last.top : last.nonTop;
}

function computeHouseOdds(probA: number, probB: number, teamAIsTop: boolean, teamBIsTop: boolean) {
  // Simple model: price each side directly as 1/p (decimal odds) with a floor to avoid divide-by-zero.
  const MIN_ODDS = 1.01;
  const price = (p: number) => {
    const clamped = Math.max(p, 0.0001); // avoid zero
    return Math.max(MIN_ODDS, Number((1 / clamped).toFixed(2)));
  };

  return { backA: price(probA), backB: price(probB) };
}

async function priceMatchWinnerFromPreOdds(matchId: string, roMatchKey: string) {
  try {
    const pre = await fetchRoanuzPreMatchOdds(roMatchKey);
    if (!pre) {
      console.warn("[priceMatchWinnerFromPreOdds] skip: pre-match odds not ready", { matchId, roMatchKey });
      return;
    }
    const { data: matchRow } = await supabase
      .from("matches")
      .select("id, display_status, ro_status, ro_match_state, ro_play_status")
      .eq("id", matchId)
      .maybeSingle();

    const statusForDisplay = computeDisplayStatus(
      matchRow?.ro_status,
      matchRow?.ro_match_state,
      matchRow?.ro_play_status,
      (matchRow?.display_status as any) ?? null,
    );
    if (statusForDisplay === "FINISHED") {
      console.warn("[priceMatchWinnerFromPreOdds] skip: match finished", { matchId, roMatchKey });
      return;
    }

    const probabilities = extractProbabilitiesFromOddsPayload(pre);
    if (Object.keys(probabilities).length < 2) {
      console.warn("[priceMatchWinnerFromPreOdds] skip: insufficient probabilities", { matchId, roMatchKey });
      return;
    }

    await applyMatchWinnerOddsFromProbabilities(matchId, probabilities, pre);

    const insights = await fetchRoanuzMatchInsights(roMatchKey).catch(() => null); // optional
    await supabase
      .from("matches")
      .update({ updated_at: new Date().toISOString(), ro_last_payload: { pre, insights } })
      .eq("id", matchId);
  } catch (err: any) {
    if (err?.status === 404) {
      // Roanuz returns 404 for completed or not-yet-prepared matches; treat as soft skip
      console.warn("[priceMatchWinnerFromPreOdds] skip 404 pre-odds", {
        matchId,
        roMatchKey,
        message: err?.message,
      });
      return;
    }
    console.error("[priceMatchWinnerFromPreOdds] failed", err);
  }
}

// ======================= INSTANCE MARKETS =======================
async function createNextBallMarketIfNeeded(matchId: string, inning: number, over: number, ballInOver: number) {
  const nextBallNumber = ballInOver + 1;

  // if over complete, next ball is 1 of next over — handled by next-over market
  if (nextBallNumber > 6) return;

  // ensure not exists
  const { data: existing } = await supabase
    .from("instance_markets")
    .select("id")
    .eq("match_id", matchId)
    .eq("instance_type", "NEXT_BALL")
    .eq("ro_inning_number", inning)
    .eq("ro_over_number", over)
    .eq("ro_ball_number", nextBallNumber)
    .maybeSingle();

  if (existing?.id) return;

  const closeTime = new Date(Date.now() + 30_000).toISOString();

  const { data: market, error: mErr } = await supabase
    .from("instance_markets")
    .insert({
      match_id: matchId,
      instance_type: "NEXT_BALL",
      market_title: `Ball ${over}.${nextBallNumber} - What will happen?`,
      ro_inning_number: inning,
      ro_over_number: over,
      ro_ball_number: nextBallNumber,
      open_time: new Date().toISOString(),
      close_time: closeTime,
      market_status: "OPEN",
    })
    .select("id")
    .single();

  if (mErr || !market?.id) {
    console.error("Failed to create NEXT_BALL market:", mErr);
    return;
  }

  const outcomes = [
    { outcome_name: "0 Runs", outcome_type: "RUNS", outcome_value: "0", back_odds: 2.5 },
    { outcome_name: "1-3 Runs", outcome_type: "RUNS", outcome_value: "1-3", back_odds: 1.8 },
    { outcome_name: "4 Runs", outcome_type: "RUNS", outcome_value: "4", back_odds: 5.0 },
    { outcome_name: "6 Runs", outcome_type: "RUNS", outcome_value: "6", back_odds: 8.0 },
    { outcome_name: "Wicket", outcome_type: "WICKET", outcome_value: "wicket", back_odds: 10.0 },
    { outcome_name: "Wide/No Ball", outcome_type: "EXTRA", outcome_value: "extra", back_odds: 3.0 },
  ].map((o) => ({
    market_id: market.id,
    outcome_name: o.outcome_name,
    outcome_type: o.outcome_type,
    outcome_value: o.outcome_value,
    back_odds: o.back_odds,
    probability: Number((1 / o.back_odds).toFixed(6)),
    created_at: new Date().toISOString(),
  }));

  await supabase.from("instance_outcomes").insert(outcomes);
}

async function settleInstanceMarkets(
  matchId: string,
  inning: number,
  over: number,
  ballNumber: number,
  normalizedBall: any,
) {
  // settle markets that correspond to THIS delivered ball
  const { data: markets } = await supabase
    .from("instance_markets")
    .select("id, instance_type")
    .eq("match_id", matchId)
    .eq("ro_inning_number", inning)
    .eq("ro_over_number", over)
    .eq("ro_ball_number", ballNumber)
    .eq("market_status", "OPEN");

  if (!markets?.length) return;

  const runs = Number(normalizedBall.ro_batsman_runs || 0);
  const extras = Number(normalizedBall.ro_extras_runs || 0);
  const isWicket = !!normalizedBall.ro_is_wicket;

  let winningOutcome = "";
  let resultData: any = {};

  // only NEXT_BALL right now
  if (isWicket) {
    winningOutcome = "Wicket";
    resultData = { type: "wicket", kind: normalizedBall.ro_wicket_kind || null };
  } else if (extras > 0) {
    winningOutcome = "Wide/No Ball";
    resultData = { type: "extra", extra_type: normalizedBall.ro_extra_type || null };
  } else if (runs === 0) {
    winningOutcome = "0 Runs";
    resultData = { type: "runs", value: 0 };
  } else if (runs >= 1 && runs <= 3) {
    winningOutcome = "1-3 Runs";
    resultData = { type: "runs", value: runs };
  } else if (runs === 4) {
    winningOutcome = "4 Runs";
    resultData = { type: "runs", value: 4 };
  } else if (runs === 6) {
    winningOutcome = "6 Runs";
    resultData = { type: "runs", value: 6 };
  }

  for (const m of markets) {
    await supabase.from("instance_markets").update({
      market_status: "SETTLED",
      winning_outcome: winningOutcome,
      result_data: resultData,
      settle_time: new Date().toISOString(),
    }).eq("id", m.id);

    await settleMarketBets(m.id, winningOutcome);
  }

  // If wicket fell, also settle NEXT_WICKET_METHOD markets
  if (isWicket) {
    await settleNextWicketMethodMarkets(matchId, inning, normalizedBall.ro_wicket_kind);
  }
}

async function settleMatchWinnerMarket(
  matchId: string,
  roMatchKey?: string | null,
  snapshot?: any | null,
) {
  const { data: market } = await supabase
    .from("markets")
    .select("id, market_status")
    .eq("match_id", matchId)
    .eq("market_name", "Match Winner")
    .maybeSingle();

  if (!market?.id) return;
  if (market.market_status === "SETTLED") return;

  let roKey = roMatchKey || null;

  if (!roKey) {
    const { data: mrow, error: mErr } = await supabase
      .from("matches")
      .select("ro_match_key")
      .eq("id", matchId)
      .maybeSingle();
    if (mErr) {
      console.error("[settleMatchWinnerMarket] failed to read match row", {
        matchId,
        error: mErr,
      });
      return;
    }
    roKey = mrow?.ro_match_key || null;
  }

  let snap: any = snapshot || null;
  if (!snap && roKey) {
    try {
      snap = await fetchRoanuzMatchSnapshot(roKey);
    } catch (err) {
      console.error("[settleMatchWinnerMarket] snapshot fetch failed", {
        matchId,
        roMatchKey: roKey,
        err,
      });
      return;
    }
  }

  if (!snap) return;

  const winnerCandidates = [
    snap?.winner,
    snap?.match?.winner,
    snap?.match?.result?.winner,
    snap?.match?.result?.winner_team,
    snap?.result?.winner,
    snap?.result?.winner_team,
    snap?.winning_team,
    snap?.team_won,
  ];

    const winnerRaw =
    winnerCandidates.find((x) => typeof x === "string" && x.length > 0) || null;

  if (!winnerRaw) {
    console.warn("[settleMatchWinnerMarket] no winner field in snapshot", {
      matchId,
      roMatchKey: roKey,
    });
    return;
  }

  // 🔧 NEW: map "a"/"b" to real team key/name
  const winnerStr = String(winnerRaw).toLowerCase().trim();

  let normWinner: string;

  if (winnerStr === "a" || winnerStr === "b") {
    const { data: mrow, error: mErr2 } = await supabase
      .from("matches")
      .select("ro_team_home_key, ro_team_home_name, ro_team_away_key, ro_team_away_name")
      .eq("id", matchId)
      .maybeSingle();

    if (mErr2 || !mrow) {
      console.error("[settleMatchWinnerMarket] failed to read match teams", {
        matchId,
        error: mErr2,
      });
      return;
    }

    const isHome = winnerStr === "a";
    const teamKey = isHome ? mrow.ro_team_home_key : mrow.ro_team_away_key;
    const teamName = isHome ? mrow.ro_team_home_name : mrow.ro_team_away_name;

    normWinner = normalizeTeamKey(String(teamKey || teamName));
  } else {
    normWinner = normalizeTeamKey(String(winnerRaw));
  }

  const { data: runners, error: rErr } = await supabase
    .from("market_runners")
    .select("id, runner_name, ro_team_key")
    .eq("market_id", market.id);


  if (rErr || !runners?.length) {
    console.error("[settleMatchWinnerMarket] runners lookup failed", {
      matchId,
      marketId: market.id,
      error: rErr,
    });
    return;
  }

  const winningRunner =
    runners.find(
      (r: any) =>
        r.ro_team_key && normalizeTeamKey(r.ro_team_key) === normWinner,
    ) ||
    runners.find(
      (r: any) => normalizeTeamKey(r.runner_name) === normWinner,
    ) ||
    null;

  if (!winningRunner) {
    console.warn("[settleMatchWinnerMarket] no matching runner for winner", {
      matchId,
      roMatchKey: roKey,
      winnerRaw,
      runners: runners.map((r: any) => ({
        name: r.runner_name,
        key: r.ro_team_key,
      })),
    });
    return;
  }

  const winningOutcome = winningRunner.runner_name;
  const nowIso = new Date().toISOString();

  await supabase
    .from("markets")
    .update({
      market_status: "SETTLED",
      winning_outcome: winningOutcome,
      settle_time: nowIso,
      close_time: nowIso,
      updated_at: nowIso,
    })
    .eq("id", market.id);

  await settleMarketBets(market.id, winningOutcome);
}

async function voidMarketBets(marketId: string, reason: string) {
  const { data: bets } = await supabase
    .from("bets")
    .select("id, user_id, stake, odds, bet_type, liability")
    .eq("market_id", marketId)
    .eq("bet_status", "OPEN");

  if (!bets?.length) return;

  const nowIso = new Date().toISOString();

  for (const b of bets) {
    const stake = Number(b.stake ?? 0);
    const odds = Number(b.odds ?? 0);
    const betType = (b.bet_type || "BACK") as "BACK" | "LAY";
    const requiredAmount =
      betType === "LAY"
        ? Number(b.liability ?? stake * Math.max(0, odds - 1))
        : stake;

    const { data: claimed, error: claimErr } = await supabase
      .from("bets")
      .update({
        bet_status: "VOID",
        winning_outcome: null,
        payout: requiredAmount,
        settled_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", b.id)
      .eq("bet_status", "OPEN")
      .select("id")
      .maybeSingle();

    if (claimErr) throw new ApiError(claimErr.message);
    if (!claimed) continue;

    const { data: userRow, error: userErr } = await supabase
      .from("users")
      .select("balance, exposure")
      .eq("id", b.user_id)
      .single();

    if (userErr || !userRow) {
      console.error("[voidMarketBets] missing user row", {
        betId: b.id,
        userId: b.user_id,
        userErr,
      });
      continue;
    }

    const balanceBefore = Number(userRow.balance ?? 0);
    const exposureBefore = Number(userRow.exposure ?? 0);
    const exposureAfter = Math.max(
      0,
      Number((exposureBefore - requiredAmount).toFixed(2)),
    );
    const balanceAfter = Number(
      (balanceBefore + requiredAmount).toFixed(2),
    );

    await supabase
      .from("users")
      .update({ balance: balanceAfter, exposure: exposureAfter })
      .eq("id", b.user_id);

    await supabase.from("wallet_transactions").insert({
      user_id: b.user_id,
      amount: requiredAmount,
      type: "BET_VOID",
      description:
        reason || "Bet void – market closed after match finished",
      reference_id: b.id,
      reference_type: "bet",
      balance_before: balanceBefore,
      balance_after: balanceAfter,
    });
  }
}

async function voidOpenInstanceMarketsForMatch(
  matchId: string,
  reason: string,
) {
  const { data: markets, error } = await supabase
    .from("instance_markets")
    .select("id")
    .eq("match_id", matchId)
    .eq("market_status", "OPEN");

  if (error) {
    console.error("[voidOpenInstanceMarketsForMatch] load failed", {
      matchId,
      error,
    });
    return;
  }

  if (!markets?.length) return;

  const nowIso = new Date().toISOString();

  for (const m of markets) {
    await supabase
      .from("instance_markets")
      .update({
        market_status: "SETTLED",
        winning_outcome: null,
        result_data: { reason },
        settle_time: nowIso,
      })
      .eq("id", m.id);

    await voidMarketBets(m.id, reason);
  }
}

// async function settleMarketBets(marketId: string, winningOutcome: string) {
//   const { data: bets } = await supabase
//     .from("bets")
//     .select("id, user_id, runner_name, stake, odds, bet_type, potential_payout, liability")
//     .eq("market_id", marketId)
//     .eq("bet_status", "OPEN");

//   if (!bets?.length) return;

//   const nowIso = new Date().toISOString();

//   for (const b of bets) {
//   const isWin = b.runner_name === winningOutcome;
//   const stake = Number(b.stake ?? 0);
//   const odds = Number(b.odds ?? 0);
//   const betType = (b.bet_type || "BACK") as "BACK" | "LAY";

//   const requiredAmount =
//     betType === "LAY" ? Number(b.liability ?? stake * Math.max(0, odds - 1)) : stake;

//   const profit = isWin
//     ? Number(
//         b.potential_payout ??
//           (betType === "LAY" ? stake : stake * Math.max(0, odds - 1)),
//       )
//     : 0;

//   const credit = isWin ? Number((profit + requiredAmount).toFixed(2)) : 0;

//   console.log("[settleMarketBets] candidate", {
//     betId: b.id,
//     userId: b.user_id,
//     runner_name: b.runner_name,
//     winningOutcome,
//     isWin,
//     stake,
//     odds,
//     betType,
//     requiredAmount,
//     profit,
//     credit,
//   });

//   const { data: claimed, error: claimErr } = await supabase
//     .from("bets")
//     .update({
//       bet_status: isWin ? "WON" : "LOST",
//       winning_outcome: winningOutcome,
//       payout: profit,
//       settled_at: nowIso,
//       updated_at: nowIso,
//     })
//     .eq("id", b.id)
//     .eq("bet_status", "OPEN")
//     .select("id")
//     .maybeSingle();

//   if (claimErr) {
//     console.error("[settleMarketBets] bet claim failed", { betId: b.id, claimErr });
//     throw new ApiError(claimErr.message);
//   }
//   if (!claimed) {
//     console.log("[settleMarketBets] bet already claimed, skipping", { betId: b.id });
//     continue;
//   }

//   const { data: userRow, error: userErr } = await supabase
//     .from("users")
//     .select("balance, exposure")
//     .eq("id", b.user_id)
//     .single();

//   if (userErr || !userRow) {
//     console.error("[settleMarketBets] missing user row", { betId: b.id, userId: b.user_id, userErr });
//     continue;
//   }

//   const balanceBefore = Number(userRow.balance ?? 0);
//   const exposureBefore = Number(userRow.exposure ?? 0);
//   const exposureAfter = Math.max(0, Number((exposureBefore - requiredAmount).toFixed(2)));
//   const balanceAfter = isWin
//     ? Number((balanceBefore + credit).toFixed(2))
//     : balanceBefore;

//   const { error: userUpdateErr } = await supabase
//     .from("users")
//     .update({ balance: balanceAfter, exposure: exposureAfter })
//     .eq("id", b.user_id);

//   if (userUpdateErr) {
//     console.error("[settleMarketBets] user update failed", {
//       betId: b.id,
//       userId: b.user_id,
//       userUpdateErr,
//     });
//     continue;
//   }

//   const { error: walletErr } = await supabase.from("wallet_transactions").insert({
//     user_id: b.user_id,
//     amount: credit,
//     type: isWin ? "BET_WON" : "BET_LOST",
//     description: `Instance bet ${isWin ? "won" : "lost"}: ${winningOutcome}`,
//     reference_id: b.id,
//     reference_type: "bet",
//     balance_before: balanceBefore,
//     balance_after: balanceAfter,
//   });

//   if (walletErr) {
//     console.error("[settleMarketBets] wallet insert failed", {
//       betId: b.id,
//       userId: b.user_id,
//       walletErr,
//     });
//   }
// }

// }
async function settleMarketBets(marketId: string, winningOutcome: string) {
  console.log("🔍 [DEBUG settleMarketBets] START", { marketId, winningOutcome });

  // Look for ALL bets (OPEN and already settled)
  const { data: bets, error: fetchError } = await supabase
    .from("bets")
    .select("id, user_id, runner_name, stake, odds, bet_type, potential_payout, bet_status, payout")
    .eq("market_id", marketId)
    .in("bet_status", ["OPEN", "WON", "LOST"]);

  console.log("🔍 [DEBUG settleMarketBets] ALL bets found:", {
    count: bets?.length || 0,
    betStatuses: bets?.map(b => ({ id: b.id, status: b.bet_status, payout: b.payout }))
  });

  if (fetchError) {
    console.error("❌ [DEBUG settleMarketBets] Fetch error:", fetchError);
    throw new ApiError(fetchError.message, 500);
  }

  if (!bets?.length) {
    console.log("⚠️ [DEBUG settleMarketBets] No bets found at all");
    return;
  }

  const nowIso = new Date().toISOString();

  for (const b of bets) {
    console.log("\n🔍 [DEBUG settleMarketBets] Processing bet:", {
      betId: b.id,
      userId: b.user_id,
      runnerName: b.runner_name,
      currentStatus: b.bet_status,
      alreadyPaid: b.payout,
      winningOutcome,
      stake: b.stake,
      odds: b.odds,
    });

    // Skip if already settled WITH payout
    if (b.bet_status !== "OPEN" && b.payout != null) {
      console.log("⚠️ [DEBUG settleMarketBets] Bet already settled with payout, skipping");
      continue;
    }

    const isWin = b.runner_name === winningOutcome;
    const stake = Number(b.stake ?? 0);
    const odds = Number(b.odds ?? 0);
    const betType = (b.bet_type || "BACK") as "BACK" | "LAY";

    const requiredAmount = stake;
    
    // FIXED: Always calculate profit, don't rely on potential_payout
    const profit = isWin
      ? Number((stake * Math.max(0, odds - 1)).toFixed(2))
      : 0;
      
    const credit = isWin ? Number((profit + requiredAmount).toFixed(2)) : 0;

    console.log("🔍 [DEBUG settleMarketBets] Calculations:", {
      isWin,
      requiredAmount,
      profit,
      credit,
      potential_payout: b.potential_payout
    });

    // ========== UPDATE BET (only if OPEN or payout null) ==========
    if (b.bet_status === "OPEN" || (b.bet_status !== "OPEN" && b.payout == null)) {
      console.log("🔍 [DEBUG settleMarketBets] Updating bet status...");
      
      const updateResult = await supabase
        .from("bets")
        .update({
          bet_status: isWin ? "WON" : "LOST",
          winning_outcome: winningOutcome,
          payout: profit,
          settled_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", b.id)
        .eq("user_id", b.user_id)
        .select("id, bet_status, payout")
        .single();

      console.log("🔍 [DEBUG settleMarketBets] Bet update result:", {
        success: !!updateResult.data,
        data: updateResult.data,
        error: updateResult.error,
      });

      if (updateResult.error) {
        console.error("❌ [DEBUG settleMarketBets] Bet update FAILED:", updateResult.error);
        continue;
      }

      if (!updateResult.data) {
        console.error("❌ [DEBUG settleMarketBets] Bet not found");
        continue;
      }

      console.log("✅ [DEBUG settleMarketBets] Bet updated successfully");
    }

    // ========== UPDATE USER BALANCE (only if WON and payout > 0) ==========
    if (isWin && profit > 0) {
      console.log("🔍 [DEBUG settleMarketBets] Updating user balance...");
      
      const { data: userRow, error: userErr } = await supabase
        .from("users")
        .select("balance, exposure")
        .eq("id", b.user_id)
        .single();

      if (userErr || !userRow) {
        console.error("❌ [DEBUG settleMarketBets] User fetch failed:", {
          userId: b.user_id,
          error: userErr?.message
        });
        continue;
      }

      console.log("🔍 [DEBUG settleMarketBets] User before update:", {
        balanceBefore: userRow.balance,
        exposureBefore: userRow.exposure
      });

      const balanceBefore = Number(userRow.balance ?? 0);
      const exposureBefore = Number(userRow.exposure ?? 0);
      const exposureAfter = Math.max(0, Number((exposureBefore - requiredAmount).toFixed(2)));
      const balanceAfter = Number((balanceBefore + credit).toFixed(2));

      console.log("🔍 [DEBUG settleMarketBets] User after calculations:", {
        exposureAfter,
        balanceAfter
      });

      const { error: userUpdateErr } = await supabase
        .from("users")
        .update({ 
          balance: balanceAfter, 
          exposure: exposureAfter 
        })
        .eq("id", b.user_id);

      if (userUpdateErr) {
        console.error("❌ [DEBUG settleMarketBets] User update failed:", {
          userId: b.user_id,
          error: userUpdateErr.message
        });
        continue;
      }

      console.log("✅ [DEBUG settleMarketBets] User balance updated");

      // ========== CREATE WALLET TRANSACTION ==========
      console.log("🔍 [DEBUG settleMarketBets] Creating wallet transaction...");
      
      const { error: walletErr } = await supabase.from("wallet_transactions").insert({
        user_id: b.user_id,
        amount: credit,
        type: "BET_WON",
        description: `Instance bet won: ${winningOutcome}`,
        reference_id: b.id,
        reference_type: "bet",
        balance_before: balanceBefore,
        balance_after: balanceAfter,
      });

      if (walletErr) {
        console.error("❌ [DEBUG settleMarketBets] Wallet transaction failed:", {
          betId: b.id,
          userId: b.user_id,
          error: walletErr.message
        });
      } else {
        console.log("✅ [DEBUG settleMarketBets] Wallet transaction created");
      }
    } else if (!isWin) {
      console.log("⚠️ [DEBUG settleMarketBets] Bet lost, no wallet update needed");
    } else {
      console.log("⚠️ [DEBUG settleMarketBets] Bet won but profit = 0, check odds/stake");
    }

    console.log("✅ [DEBUG settleMarketBets] Bet processing COMPLETE");
  }

  console.log("🏁 [DEBUG settleMarketBets] END - All bets processed");
}

// Close any lingering OPEN NEXT_BALL markets that are already in the past
async function closeStaleInstanceMarkets(
  matchId: string,
  inning: number,
  over: number,
  ballNumber: number,
) {
  const { data: openMarkets } = await supabase
    .from("instance_markets")
    .select("id, ro_over_number, ro_ball_number")
    .eq("match_id", matchId)
    .eq("instance_type", "NEXT_BALL")
    .eq("ro_inning_number", inning)
    .eq("market_status", "OPEN");

  if (!openMarkets?.length) return;

  const nowIso = new Date().toISOString();
  for (const m of openMarkets) {
    const mOver = Number(m.ro_over_number ?? 0);
    const mBall = Number(m.ro_ball_number ?? 0);

    const isPast =
      mOver < over ||
      (mOver === over && mBall <= ballNumber);

    if (isPast) {
      await supabase
        .from("instance_markets")
        .update({
          market_status: "CLOSED",
          settle_time: nowIso,
          winning_outcome: null,
          result_data: { reason: "auto-close-past-ball" },
        })
        .eq("id", m.id);
    }
  }
}

// ======================= OVER MARKETS =======================
async function createNextOverMarketIfOverComplete(matchId: string, inning: number, over: number, ballInOver: number) {
  if (ballInOver !== 6) return;

  const nextOver = Number(over) + 1;

  const { data: existing } = await supabase
    .from("instance_markets")
    .select("id")
    .eq("match_id", matchId)
    .eq("instance_type", "OVER_RUNS")
    .eq("ro_inning_number", inning)
    .eq("ro_over_number", nextOver)
    .eq("market_status", "OPEN")
    .maybeSingle();

  if (existing?.id) return;

  const closeTime = new Date(Date.now() + 45_000).toISOString();

  const { data: market, error: mErr } = await supabase
    .from("instance_markets")
    .insert({
      match_id: matchId,
      instance_type: "OVER_RUNS",
      market_title: `Over ${nextOver} - Total runs?`,
      ro_inning_number: inning,
      ro_over_number: nextOver,
      ro_ball_number: 0, // not a ball, this is an over market
      open_time: new Date().toISOString(),
      close_time: closeTime,
      market_status: "OPEN",
    })
    .select("id")
    .single();

  if (mErr || !market?.id) {
    console.error("Failed to create OVER_RUNS market:", mErr);
    return;
  }

  const outcomes = [
    { outcome_name: "0-5 Runs", outcome_type: "RANGE", outcome_value: "0-5", back_odds: 2.2 },
    { outcome_name: "6-9 Runs", outcome_type: "RANGE", outcome_value: "6-9", back_odds: 2.0 },
    { outcome_name: "10-14 Runs", outcome_type: "RANGE", outcome_value: "10-14", back_odds: 2.8 },
    { outcome_name: "15+ Runs", outcome_type: "RANGE", outcome_value: "15+", back_odds: 4.0 },
    { outcome_name: "Wicket in over", outcome_type: "FLAG", outcome_value: "wicket", back_odds: 2.5 },
  ].map((o) => ({
    market_id: market.id,
    outcome_name: o.outcome_name,
    outcome_type: o.outcome_type,
    outcome_value: o.outcome_value,
    back_odds: o.back_odds,
    probability: Number((1 / o.back_odds).toFixed(6)),
    created_at: new Date().toISOString(),
  }));

  await supabase.from("instance_outcomes").insert(outcomes);
}

async function settleOverMarketsIfOverComplete(matchId: string, inning: number, over: number, ballInOver: number) {
  if (ballInOver !== 6) return;

  const { data: markets } = await supabase
    .from("instance_markets")
    .select("id")
    .eq("match_id", matchId)
    .eq("instance_type", "OVER_RUNS")
    .eq("ro_inning_number", inning)
    .eq("ro_over_number", over)
    .eq("market_status", "OPEN");

  if (!markets?.length) return;

  // minimal compute: sum runs for that over (only 6 legal balls typically)
  const { data: balls } = await supabase
    .from("ball_events")
    .select("ro_total_runs, ro_is_wicket")
    .eq("match_id", matchId)
    .eq("ro_inning_number", inning)
    .eq("ro_over_number", over)
    .eq("ro_is_deleted", false);

  const overRuns = (balls || []).reduce((s: number, b: any) => s + Number(b.ro_total_runs || 0), 0);
  const hasWicket = (balls || []).some((b: any) => !!b.ro_is_wicket);

  const winning =
    hasWicket ? "Wicket in over"
      : overRuns <= 5 ? "0-5 Runs"
      : overRuns <= 9 ? "6-9 Runs"
      : overRuns <= 14 ? "10-14 Runs"
      : "15+ Runs";

  for (const m of markets) {
    await supabase.from("instance_markets").update({
      market_status: "SETTLED",
      winning_outcome: winning,
      result_data: { overRuns, hasWicket },
      settle_time: new Date().toISOString(),
    }).eq("id", m.id);

    await settleMarketBets(m.id, winning);
  }
}
// ======================= MARKETS: PRE-MATCH =======================
async function ensureTossMarket(matchId: string, teams: any) {
  const { data: existingMarket } = await supabase
    .from("markets")
    .select("id")
    .eq("match_id", matchId)
    .eq("market_name", "Toss")
    .maybeSingle();

  // If we already have a Toss market, ensure runners exist; otherwise create it.
  if (existingMarket?.id) {
    const { data: existingRunners } = await supabase
      .from("market_runners")
      .select("id")
      .eq("market_id", existingMarket.id);

    if (existingRunners?.length && existingRunners.length >= 2) return;
    // If runners missing, we'll seed them against the existing market id.
  }

  // Fallback: if teams not provided, load from matches row
  let teamsInput = teams;
  if (!teamsInput?.a || !teamsInput?.b) {
    const { data: mrow } = await supabase
      .from("matches")
      .select("ro_team_home_key, ro_team_home_name, ro_team_away_key, ro_team_away_name")
      .eq("id", matchId)
      .maybeSingle();
    if (mrow) {
      teamsInput = {
        a: { key: mrow.ro_team_home_key, name: mrow.ro_team_home_name || "Home" },
        b: { key: mrow.ro_team_away_key, name: mrow.ro_team_away_name || "Away" },
      };
    }
  }

  let marketId = existingMarket?.id as string | undefined;

  if (!marketId) {
    const { data: market, error: marketError } = await supabase
      .from("markets")
      .insert({
        match_id: matchId,
        market_type: "pre_match",
        market_name: "Toss",
        odds_source: "roanuz",
        market_status: "OPEN",
        open_time: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (marketError || !market?.id) {
      console.error("Failed to create Toss market:", marketError);
      return;
    }
    marketId = market.id;
  }

  const runners: any[] = [];
  if (teamsInput?.a) {
    runners.push({
      market_id: marketId,
      runner_name: teamsInput.a.name || "Home",
      ro_team_key: teamsInput.a.key,
      back_odds: 1.9,
      lay_odds: null,
      metadata: { is_home: true },
    });
  }
  if (teamsInput?.b) {
    runners.push({
      market_id: marketId,
      runner_name: teamsInput.b.name || "Away",
      ro_team_key: teamsInput.b.key,
      back_odds: 1.9,
      lay_odds: null,
      metadata: { is_away: true },
    });
  }
  if (runners.length) {
    await supabase.from("market_runners").upsert(runners, {
      onConflict: "market_id,ro_team_key",
      ignoreDuplicates: false,
    });
  }
}

async function settleTossMarket(matchId: string, tossWinnerRaw: string | null | undefined) {
  if (!tossWinnerRaw) return;

  const { data: market } = await supabase
    .from("markets")
    .select("id, market_status")
    .eq("match_id", matchId)
    .eq("market_name", "Toss")
    .maybeSingle();

  if (!market?.id) return;
  if (market.market_status && market.market_status !== "OPEN") return;

  const { data: runners } = await supabase
    .from("market_runners")
    .select("id, runner_name, ro_team_key")
    .eq("market_id", market.id);

  if (!runners?.length) {
    // If runners missing, try to seed quickly then retry
    await ensureTossMarket(matchId, null);
    const { data: retryRunners } = await supabase
      .from("market_runners")
      .select("id, runner_name, ro_team_key")
      .eq("market_id", market.id);
    if (!retryRunners?.length) return;
    runners.splice(0, runners.length, ...retryRunners);
  }

  const normWinner = normalizeTeamKey(tossWinnerRaw);

  const winningRunner =
    runners.find((r: any) => r.ro_team_key && normalizeTeamKey(r.ro_team_key) === normWinner) ||
    runners.find((r: any) => normalizeTeamKey(r.runner_name) === normWinner) ||
    null;

  if (!winningRunner) return;

  const winningOutcome = winningRunner.runner_name;

  // Update market status; keep payload minimal to avoid column drift issues
  await supabase
    .from("markets")
    .update({
      market_status: "SETTLED",
      winning_outcome: winningOutcome,
      settle_time: new Date().toISOString(),
      close_time: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", market.id);

  await settleMarketBets(market.id, winningOutcome);
}

// ======================= INSTANCE MARKETS: NEXT BALL (single window) =======================

async function createNextBallMarket(matchId: string, inning: number, over: number, ballNum: number) {
  if (ballNum < 1 || ballNum > 6) return;

  const { data: existing } = await supabase
    .from("instance_markets")
    .select("id, market_status")
    .eq("match_id", matchId)
    .eq("instance_type", "NEXT_BALL")
    .eq("ro_inning_number", inning)
    .eq("ro_over_number", over)
    .eq("ro_ball_number", ballNum)
    .maybeSingle();

  const closeTime = new Date(Date.now() + 20_000).toISOString();

  // If it exists and isn't settled yet, reopen and extend the window
  if (existing?.id && existing.market_status !== "SETTLED") {
    await supabase
      .from("instance_markets")
      .update({
        market_status: "OPEN",
        close_time: closeTime,
        open_time: new Date().toISOString(),
        winning_outcome: null,
        result_data: null,
        metadata: { source: "auto-next-ball" },
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    return;
  }

  const { data: market, error: mErr } = await supabase
    .from("instance_markets")
    .insert({
      match_id: matchId,
      instance_type: "NEXT_BALL",
      market_title: `Ball ${over}.${ballNum} - What will happen?`,
      ro_inning_number: inning,
      ro_over_number: over,
      ro_ball_number: ballNum,
      open_time: new Date().toISOString(),
      close_time: closeTime,
      market_status: "OPEN",
      metadata: { source: "auto-next-ball" },
    })
    .select("id")
    .single();

  if (mErr || !market?.id) {
    console.error("Failed to create NEXT_BALL market:", mErr);
    return;
  }

  const outcomes = [
    { outcome_name: "0 Runs", outcome_type: "RUNS", outcome_value: "0", back_odds: 2.5 },
    { outcome_name: "1-3 Runs", outcome_type: "RUNS", outcome_value: "1-3", back_odds: 1.8 },
    { outcome_name: "4 Runs", outcome_type: "RUNS", outcome_value: "4", back_odds: 5.0 },
    { outcome_name: "6 Runs", outcome_type: "RUNS", outcome_value: "6", back_odds: 8.0 },
    { outcome_name: "Wicket", outcome_type: "WICKET", outcome_value: "wicket", back_odds: 10.0 },
    { outcome_name: "Wide/No Ball", outcome_type: "EXTRA", outcome_value: "extra", back_odds: 3.0 },
  ].map((o) => ({
    market_id: market.id,
    outcome_name: o.outcome_name,
    outcome_type: o.outcome_type,
    outcome_value: o.outcome_value,
    back_odds: o.back_odds,
    probability: Number((1 / o.back_odds).toFixed(6)),
    created_at: new Date().toISOString(),
  }));

  await supabase.from("instance_outcomes").insert(outcomes);
}

async function scheduleNextBallMarket(matchId: string, inning: number, over: number, ballInOver: number) {
  // Create market two balls ahead of the current delivery.
  let targetOver = over;
  let targetBall = ballInOver + 2;

  // roll over across overs if we cross 6
  while (targetBall > 6) {
    targetOver += 1;
    targetBall -= 6;
  }

  await createNextBallMarket(matchId, inning, targetOver, targetBall);
}

// ======================= NEXT OVER MARKETS (UI expects instance_type === "NEXT_OVER") =======================

type NextOverKind = "RUNS_GT8" | "BOUNDARIES_COUNT" | "WICKET_FALL";
type NextWicketKind = "NEXT_WICKET_METHOD";
const PROJECTION_TARGET_OVERS = [6, 10, 15, 20];

function nextOverTitle(kind: NextOverKind, overDisplay: number) {
  if (kind === "RUNS_GT8") return `Over ${overDisplay}: Runs > 8?`;
  if (kind === "BOUNDARIES_COUNT") return `Over ${overDisplay}: Boundaries count`;
  return `Over ${overDisplay}: Wicket?`;
}

// ======================= SESSION PROJECTIONS (BACKEND-DRIVEN) =======================
function roundProjection(val: number) {
  const half = Math.round(val * 2) / 2;
  const endsWithZero = Math.abs(half % 1) < 1e-6;
  const adjusted = endsWithZero ? half + 0.5 : half;
  return Number(adjusted.toFixed(1));
}

function computeProjectionLine(
  runs: number,
  wickets: number,
  oversDecimal: number,
  targetOver: number,
) {
  const crr = oversDecimal > 0 ? runs / oversDecimal : 10;
  const baseRate = 10;
  let raw = runs;

  const addSpan = (start: number, end: number, rate: number) => {
    if (rate <= 0 || targetOver <= start) return;
    const segStart = Math.max(oversDecimal, start);
    const segEnd = Math.min(targetOver, end);
    const span = segEnd - segStart;
    if (span > 0) raw += span * rate;
  };

  // Powerplay: current rate up to 6
  addSpan(0, 6, crr);
  // 6-10: baseline 10 rpo
  addSpan(6, 10, baseRate);

  const threshold15 = 9 + 3 / 6; // 9.3 overs ≈ 9.5 decimal
  const threshold20 = 14 + 3 / 6; // 14.3 overs ≈ 14.5 decimal

  const rate15 = oversDecimal >= threshold15 && crr > 10 && wickets < 4 ? crr : baseRate;
  const rate20 = oversDecimal >= threshold20 && crr > 10 && wickets < 6 ? crr : baseRate;

  addSpan(10, 15, rate15);
  addSpan(15, 20, rate20);

  if (targetOver > 20) {
    addSpan(20, targetOver, baseRate);
  }

  const remainingOvers = Math.max(0, targetOver - oversDecimal);
  const wicketReduction = wickets * remainingOvers;
  const adjusted = Math.max(runs, raw - wicketReduction);
  const line = roundProjection(adjusted);

  let mode: "current-rate" | "baseline-10rpo" | "hybrid-6-then-10rpo" = "baseline-10rpo";
  if (targetOver <= 6) mode = "current-rate";
  else if (targetOver <= 10) mode = oversDecimal < 6 ? "hybrid-6-then-10rpo" : "current-rate";
  else if (targetOver <= 15) mode = rate15 === crr ? "current-rate" : "baseline-10rpo";
  else if (targetOver <= 20) mode = rate20 === crr ? "current-rate" : "baseline-10rpo";

  return {
    line,
    mode,
    crr: Number.isFinite(crr) ? Number(crr.toFixed(2)) : null,
    wicketReduction: Number(wicketReduction.toFixed(2)),
    remainingOvers,
  };
}

async function upsertSessionProjections(params: {
  matchId: string;
  inningNumber: number;
  runs: number;
  wickets: number;
  oversDecimal: number;
}) {
  const { matchId, inningNumber, runs, wickets, oversDecimal } = params;
  const nowIso = new Date().toISOString();

  for (const target of PROJECTION_TARGET_OVERS) {
    const proj = computeProjectionLine(runs, wickets, oversDecimal, target);
    const remaining = Math.max(0, target - oversDecimal);
    const status =
      oversDecimal >= target ? "SETTLED" : remaining <= 2 ? "CLOSED" : "OPEN";

    const payload: any = {
      match_id: matchId,
      inning: inningNumber,
      target_over: target,
      projected_line: proj.line,
      mode: proj.mode,
      runs,
      wickets,
      overs_decimal: Number(oversDecimal.toFixed(3)),
      crr: proj.crr,
      wicket_reduction: proj.wicketReduction,
      status,
      updated_at: nowIso,
    };

    if (status === "CLOSED") payload.close_time = nowIso;
    if (status === "OPEN") payload.close_time = null;
    if (status === "SETTLED") payload.settle_time = nowIso;

    await supabase.from("session_markets").upsert(payload, {
      onConflict: "match_id, inning, target_over",
    });

    // Keep underlying OVER_PROJECTION instance market aligned for betting window
    const { data: im } = await supabase
      .from("instance_markets")
      .select("id, market_status")
      .eq("match_id", matchId)
      .eq("instance_type", "OVER_PROJECTION")
      .eq("ro_inning_number", inningNumber)
      .eq("ro_over_number", target - 1) // stored as target_over - 1
      .maybeSingle();

    if (im?.id) {
      const desiredStatus = status; // OPEN until <=2 overs, then CLOSED/SETTLED handled upstream
      const updates: any = { market_status: desiredStatus, updated_at: nowIso };
      if (desiredStatus === "CLOSED") updates.close_time = nowIso;
      if (desiredStatus === "OPEN") updates.close_time = null;
      await supabase.from("instance_markets").update(updates).eq("id", im.id);
    }
  }
}
async function createNextOverMarketsIfOverComplete(matchId: string, inning: number, over: number, ballInOver: number) {
  if (ballInOver !== 6) return;

  const targetOver = Number(over) + 1; // 0-index over → next over index
  const overDisplay = targetOver + 1;

  // Ensure we create 3 binary markets for the SAME target_over
  const kinds: NextOverKind[] = ["RUNS_GT8", "BOUNDARIES_COUNT", "WICKET_FALL"];

  for (const kind of kinds) {
    const { data: existing } = await supabase
      .from("instance_markets")
      .select("id")
      .eq("match_id", matchId)
      .eq("instance_type", "NEXT_OVER")
      .eq("ro_inning_number", inning)
      .eq("ro_over_number", targetOver)
      .eq("metadata->>kind", kind)
      .eq("market_status", "OPEN")
      .maybeSingle();

    if (existing?.id) continue;

    const closeTime = new Date(Date.now() + 45_000).toISOString();

    const { data: market, error: mErr } = await supabase
      .from("instance_markets")
      .insert({
        match_id: matchId,
        instance_type: "NEXT_OVER",
        market_title: nextOverTitle(kind, overDisplay),
        ro_inning_number: inning,
        ro_over_number: targetOver,
        ro_ball_number: 0, // over market
        open_time: new Date().toISOString(),
        close_time: closeTime,
        market_status: "OPEN",
        metadata: { target_over: targetOver, kind },
      })
      .select("id")
      .single();

    if (mErr || !market?.id) {
      console.error("Failed to create NEXT_OVER market:", kind, mErr);
      continue;
    }

    // Outcomes per proposition (binary yes/no)
    let outcomes: any[] = [];

    if (kind === "RUNS_GT8") {
      outcomes = [
        { outcome_name: "Yes", outcome_type: "FLAG", outcome_value: "yes", back_odds: 2.1 },
        { outcome_name: "No", outcome_type: "FLAG", outcome_value: "no", back_odds: 1.75 },
      ];
    } else if (kind === "BOUNDARIES_COUNT") {
      outcomes = [
        { outcome_name: "No boundary", outcome_type: "BOUNDARY_COUNT", outcome_value: "0", back_odds: 2.0 },
        { outcome_name: "One boundary", outcome_type: "BOUNDARY_COUNT", outcome_value: "1", back_odds: 2.4 },
        { outcome_name: "Two boundaries", outcome_type: "BOUNDARY_COUNT", outcome_value: "2", back_odds: 3.0 },
        { outcome_name: "More than 2", outcome_type: "BOUNDARY_COUNT", outcome_value: ">2", back_odds: 4.5 },
      ];
    } else {
      outcomes = [
        { outcome_name: "Yes", outcome_type: "FLAG", outcome_value: "yes", back_odds: 2.5 },
        { outcome_name: "No", outcome_type: "FLAG", outcome_value: "no", back_odds: 1.55 },
      ];
    }

    const rows = outcomes.map((o) => ({
      market_id: market.id,
      outcome_name: o.outcome_name,
      outcome_type: o.outcome_type,
      outcome_value: o.outcome_value,
      back_odds: o.back_odds,
      probability: Number((1 / o.back_odds).toFixed(6)),
      created_at: new Date().toISOString(),
    }));

    await supabase.from("instance_outcomes").insert(rows);
  }
}

async function settleNextOverMarketsIfOverComplete(matchId: string, inning: number, over: number, ballInOver: number) {
  if (ballInOver !== 6) return;

  // Settle NEXT_OVER markets FOR THIS completed over
  const targetOver = Number(over);

  const { data: markets } = await supabase
    .from("instance_markets")
    .select("id, market_title, metadata")
    .eq("match_id", matchId)
    .eq("instance_type", "NEXT_OVER")
    .eq("ro_inning_number", inning)
    .eq("ro_over_number", targetOver)
    .eq("market_status", "OPEN");

  if (!markets?.length) return;

  const { data: balls } = await supabase
    .from("ball_events")
    .select("ro_total_runs, ro_is_wicket, ro_batsman_runs")
    .eq("match_id", matchId)
    .eq("ro_inning_number", inning)
    .eq("ro_over_number", targetOver)
    .eq("ro_is_deleted", false);

  const overRuns = (balls || []).reduce((s: number, b: any) => s + Number(b.ro_total_runs || 0), 0);
  const hasWicket = (balls || []).some((b: any) => !!b.ro_is_wicket);
  const boundaries =
    (balls || []).filter((b: any) => {
      const r = Number(b.ro_batsman_runs || 0);
      return r === 4 || r === 6;
    }).length;

  for (const m of markets) {
    const kind = (m.metadata as any)?.kind as NextOverKind | undefined;

    let winningOutcome = "";
    const resultData: any = { overRuns, hasWicket, boundaries };

    if (kind === "RUNS_GT8") {
      winningOutcome = overRuns > 8 ? "Yes" : "No";
    } else if (kind === "BOUNDARIES_COUNT") {
      if (boundaries === 0) winningOutcome = "No boundary";
      else if (boundaries === 1) winningOutcome = "One boundary";
      else if (boundaries === 2) winningOutcome = "Two boundaries";
      else winningOutcome = "More than 2";
    } else if (kind === "WICKET_FALL") {
      winningOutcome = hasWicket ? "Yes" : "No";
    } else {
      // fallback by title keywords
      const title = (m.market_title || "").toLowerCase();
      if (title.includes("wicket")) {
        winningOutcome = hasWicket ? "Yes" : "No";
      } else if (title.includes("bound")) {
        if (boundaries === 0) winningOutcome = "No boundary";
        else if (boundaries === 1) winningOutcome = "One boundary";
        else if (boundaries === 2) winningOutcome = "Two boundaries";
        else winningOutcome = "More than 2";
      } else {
        winningOutcome = overRuns > 8 ? "Yes" : "No";
      }
    }

    await supabase.from("instance_markets").update({
      market_status: "SETTLED",
      winning_outcome: winningOutcome,
      result_data: resultData,
      settle_time: new Date().toISOString(),
    }).eq("id", m.id);

    await settleMarketBets(m.id, winningOutcome);
  }
}

// ======================= PROJECTION MARKETS (RUNS AFTER N OVERS) =======================
async function getInningRuns(matchId: string, inning: number) {
  const { data: balls } = await supabase
    .from("ball_events")
    .select("ro_total_runs")
    .eq("match_id", matchId)
    .eq("ro_inning_number", inning)
    .eq("ro_is_deleted", false);

  return (balls || []).reduce((s: number, b: any) => s + Number(b.ro_total_runs || 0), 0);
}

function projectedLineForTarget(currentRuns: number, currentOver: number, currentBall: number, targetOver: number) {
  const legalBalls = currentOver * 6 + currentBall;
  const oversBowled = legalBalls / 6;
  const rr = oversBowled > 0 ? currentRuns / oversBowled : 8; // fallback 8 rpo
  const projection = rr * targetOver;
  // round to nearest 2 runs to keep line tidy
  return Math.max(0, Math.round(projection / 2) * 2);
}

async function ensureProjectionMarkets(
  matchId: string,
  inning: number,
  currentOver: number,
  currentBall: number,
) {
  const runsSoFar = await getInningRuns(matchId, inning);

  for (const target of PROJECTION_TARGET_OVERS) {
    // Create if missing
    const { data: existing } = await supabase
      .from("instance_markets")
      .select("id, market_status, metadata")
      .eq("match_id", matchId)
      .eq("instance_type", "OVER_PROJECTION")
      .eq("ro_inning_number", inning)
      .eq("ro_over_number", target - 1)
      .maybeSingle();

    const line = projectedLineForTarget(runsSoFar, currentOver, currentBall, target);
    const closeNow = currentOver + 1 >= target - 2; // close 2 overs before target

    if (!existing) {
      const { data: market, error: mErr } = await supabase
        .from("instance_markets")
        .insert({
          match_id: matchId,
          instance_type: "OVER_PROJECTION",
          market_title: `Runs after ${target} overs ≥ ${line}?`,
          ro_inning_number: inning,
          ro_over_number: target - 1,
          ro_ball_number: 0,
          open_time: new Date().toISOString(),
          close_time: new Date(Date.now() + 60_000).toISOString(),
          market_status: closeNow ? "CLOSED" : "OPEN",
          metadata: { kind: "PROJECTION", target_over: target, line },
        })
        .select("id")
        .single();

      if (mErr || !market?.id) {
        console.error("Failed to create OVER_PROJECTION market:", mErr);
        continue;
      }

      const outcomes = [
        { outcome_name: "Yes", outcome_type: "FLAG", outcome_value: "yes", back_odds: 1.9 },
        { outcome_name: "No", outcome_type: "FLAG", outcome_value: "no", back_odds: 1.9 },
      ].map((o) => ({
        market_id: market.id,
        outcome_name: o.outcome_name,
        outcome_type: o.outcome_type,
        outcome_value: o.outcome_value,
        back_odds: o.back_odds,
        probability: Number((1 / o.back_odds).toFixed(6)),
        created_at: new Date().toISOString(),
      }));

      await supabase.from("instance_outcomes").insert(outcomes);
    } else {
      // update line + status if needed
      const meta = existing.metadata || {};
      const needsLine = Number(meta.line) !== line;
      const needsClose = closeNow && existing.market_status === "OPEN";
      if (needsLine || needsClose) {
        await supabase
          .from("instance_markets")
          .update({
            market_status: needsClose ? "CLOSED" : existing.market_status,
            metadata: { ...meta, line },
            market_title: `Runs after ${target} overs ≥ ${line}?`,
            close_time: needsClose ? new Date().toISOString() : existing.close_time,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      }
    }
  }
}

async function settleProjectionMarkets(
  matchId: string,
  inning: number,
  completedOver: number,
) {
  // completedOver is 1-based human
  const targetsToSettle = PROJECTION_TARGET_OVERS.filter((t) => t === completedOver);
  if (!targetsToSettle.length) return;

  const runsToDate = await getInningRuns(matchId, inning);

  for (const target of targetsToSettle) {
    const { data: markets } = await supabase
      .from("instance_markets")
      .select("id, metadata, market_status")
      .eq("match_id", matchId)
      .eq("instance_type", "OVER_PROJECTION")
      .eq("ro_inning_number", inning)
      .eq("ro_over_number", target - 1)
      .in("market_status", ["OPEN", "CLOSED"]);

    if (!markets?.length) continue;

    for (const m of markets) {
      const line = Number((m as any)?.metadata?.line ?? 0);
      const winningOutcome = runsToDate >= line ? "Yes" : "No";
      await supabase
        .from("instance_markets")
        .update({
          market_status: "SETTLED",
          winning_outcome: winningOutcome,
          result_data: { runs: runsToDate, line, target_over: target },
          settle_time: new Date().toISOString(),
        })
        .eq("id", (m as any).id);
      await settleMarketBets((m as any).id, winningOutcome);
    }
  }
}

// ======================= NEXT WICKET METHOD MARKET =======================

const WICKET_OUTCOMES = [
  "Caught",
  "Bowled",
  "LBW",
  "Run Out",
  "Stumped",
  "Other",
] as const;

function mapWicketKind(kindRaw: string | null | undefined): typeof WICKET_OUTCOMES[number] {
  const k = String(kindRaw || "").toLowerCase();
  if (!k) return "Other";
  if (k.includes("catch")) return "Caught";
  if (k.includes("bowled")) return "Bowled";
  if (k === "lbw" || k.includes("leg before")) return "LBW";
  if (k.includes("run out")) return "Run Out";
  if (k.includes("stump")) return "Stumped";
  if (k.includes("hit wicket")) return "Other";
  if (k.includes("retired") || k.includes("obstruct")) return "Other";
  return "Other";
}

async function createNextWicketMethodMarket(matchId: string, inning: number, currentOver: number) {
  // Avoid duplicates
  const { data: existing } = await supabase
    .from("instance_markets")
    .select("id")
    .eq("match_id", matchId)
    .eq("instance_type", "NEXT_WICKET_METHOD")
    .eq("ro_inning_number", inning)
    .eq("market_status", "OPEN")
    .maybeSingle();

  if (existing?.id) return;

  // If inning already has 10 wickets, don't create
  const { data: wicketCountRows } = await supabase
    .from("ball_events")
    .select("id", { count: "exact" })
    .eq("match_id", matchId)
    .eq("ro_inning_number", inning)
    .eq("ro_is_wicket", true)
    .eq("ro_is_deleted", false);

  const wicketCount = (wicketCountRows as any)?.length ?? 0;
  if (wicketCount >= 10) return;

  const closeTime = new Date(Date.now() + 30_000).toISOString();

  const { data: market, error: mErr } = await supabase
    .from("instance_markets")
    .insert({
      match_id: matchId,
      instance_type: "NEXT_WICKET_METHOD",
      market_title: "Next wicket dismissal",
      ro_inning_number: inning,
      ro_over_number: currentOver,
      ro_ball_number: 0,
      open_time: new Date().toISOString(),
      close_time: closeTime,
      market_status: "OPEN",
      metadata: { kind: "method", target_inning: inning },
    })
    .select("id")
    .single();

  if (mErr || !market?.id) {
    console.error("Failed to create NEXT_WICKET_METHOD market:", mErr);
    return;
  }

  const rows = WICKET_OUTCOMES.map((name) => ({
    market_id: market.id,
    outcome_name: name,
    outcome_type: "WICKET_METHOD",
    outcome_value: name.toLowerCase().replace(/\\s+/g, "_"),
    back_odds: name === "Other" ? 8.0 : 3.5,
    probability: name === "Other" ? Number((1 / 8).toFixed(6)) : Number((1 / 3.5).toFixed(6)),
    created_at: new Date().toISOString(),
  }));

  await supabase.from("instance_outcomes").insert(rows);
}

async function settleNextWicketMethodMarkets(matchId: string, inning: number, wicketKind: string | null | undefined) {
  const { data: markets } = await supabase
    .from("instance_markets")
    .select("id")
    .eq("match_id", matchId)
    .eq("instance_type", "NEXT_WICKET_METHOD")
    .eq("ro_inning_number", inning)
    .eq("market_status", "OPEN");

  if (!markets?.length) return;

  const winningOutcome = mapWicketKind(wicketKind);
  const resultData = { wicketKind, normalized: winningOutcome };
  const nowIso = new Date().toISOString();

  for (const m of markets) {
    await supabase
      .from("instance_markets")
      .update({
        market_status: "SETTLED",
        winning_outcome: winningOutcome,
        result_data: resultData,
        settle_time: nowIso,
      })
      .eq("id", m.id);

    await settleMarketBets(m.id, winningOutcome);
  }
}

async function voidOpenNextWicketMarkets(matchId: string, inning: number, reason: string) {
  const { data: markets } = await supabase
    .from("instance_markets")
    .select("id")
    .eq("match_id", matchId)
    .eq("instance_type", "NEXT_WICKET_METHOD")
    .eq("ro_inning_number", inning)
    .eq("market_status", "OPEN");

  if (!markets?.length) return;
  const nowIso = new Date().toISOString();

  for (const m of markets) {
    await supabase
      .from("instance_markets")
      .update({
        market_status: "SETTLED",
        winning_outcome: "Other",
        result_data: { reason },
        settle_time: nowIso,
      })
      .eq("id", m.id);

    await settleMarketBets(m.id, "Other");
  }
}

// ======================= CRON PRICING =======================
async function priceUpcomingMatches(horizonHours = 72) {
  const now = new Date();
  const horizon = new Date(now.getTime() + horizonHours * 60 * 60 * 1000).toISOString();

  const { data: matches } = await supabase
    .from("matches")
    .select(
      "id, ro_match_key, ro_start_time, display_status, ro_team_home_key, ro_team_home_name, ro_team_away_key, ro_team_away_name"
    )
    .or("display_status.eq.UPCOMING,display_status.is.null")
    .lte("ro_start_time", horizon);

  if (!matches?.length) return;

  for (const m of matches) {
    if (!m.ro_match_key) continue;
    // Ensure market exists; runners may already exist. No fallback odds are applied beyond Roanuz.
    await ensureMatchWinnerMarket(m.id, {
      a: { key: m.ro_team_home_key, name: m.ro_team_home_name },
      b: { key: m.ro_team_away_key, name: m.ro_team_away_name },
    });
    await priceMatchWinnerFromPreOdds(m.id, m.ro_match_key);
  }
}

async function emitStartingSoonNotifications(windowMinutes = 5) {
  const now = new Date();
  const startIso = now.toISOString();
  const endIso = new Date(now.getTime() + windowMinutes * 60 * 1000).toISOString();

  const { data: matches } = await supabase
    .from("matches")
    .select("id, ro_start_time, start_time, display_status")
    .eq("display_status", "UPCOMING")
    .or(
      `and(ro_start_time.gte.${startIso},ro_start_time.lte.${endIso}),` +
        `and(start_time.gte.${startIso},start_time.lte.${endIso})`
    );

  if (!matches?.length) return;

  for (const m of matches) {
    await safeEmitNotification("START_MINUS5", m.id, { inning: 1 });
  }
}

// ======================= MAIN SERVE =======================
serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const url = new URL(req.url);
    const queryMode = (url.searchParams.get("mode") || "").toLowerCase();

    const body = await req.json().catch(() => ({}));
    const bodyMode = typeof body.mode === "string" ? body.mode.toLowerCase() : "";
    const mode = queryMode || bodyMode || "ingest_roanuz";

    const isService = isServiceRoleRequest(req);
    const hasCron = CRON_SECRET &&
      (req.headers.get("x-cron-secret") === CRON_SECRET ||
        req.headers.get("x-cron-key") === CRON_SECRET);

    if (!isService && !hasCron) {
      await requireUser(req, ["SUPER_ADMIN", "ADMIN", "AGENT", "USER"]);
    }

    if (mode === "cron_pre") {
      const url = new URL(req.url);
      const hrs = Number(url.searchParams.get("horizon_hours"));
      const horizon = Number.isFinite(hrs) && hrs > 0 ? hrs : 72; // default 72h
      await priceUpcomingMatches(horizon);
      await emitStartingSoonNotifications(5);
      return success({ success: true, mode });
    }

    if (mode === "ingest_roanuz" || mode === "ingest_roanuz_webhook") {
      const data = body?.data || body;
      const kind = String(data?.match_push_kind ?? body?.match_push_kind ?? "").toLowerCase();

      // Ball present either as data.ball or as top-level data fields with ball_key
      const hasBall = kind === "ball" && !!(data?.ball || data?.ball_key || body?.ball_key);

      if (hasBall) {
        const result = await handleBallEvent(body);
        return success(result);
      }

      const result = await handleNonBallUpdate(body);
      return success(result);
    }

    return error("Unknown mode", 400);
  } catch (err: any) {
    console.error("[cricket-engine] error:", err);
    if (err instanceof ApiError) return error(err.message, err.status);
    return error(err?.message || "Internal server error", 500);
  }
});
