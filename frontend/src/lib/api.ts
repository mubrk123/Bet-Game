// api.ts (DB-driven, Roanuz webhook compatible)
// - No heavy derivations
// - No SportsMonk-era "home/away" semantics in the UI mapping (use teamA/teamB)
// - Matches + ball_events are treated as the source of truth
// - Avoid select("*") to prevent pulling ro_last_payload etc.
// - ball_events ordering uses created_at (stable, cheap, no type pitfalls)

import { supabase } from "./supabase";
import type { Match, Market, Runner } from "./store";

// ============================================================================
// TYPES (DB / API-facing)
// ============================================================================

export interface ApiUser {
  id: string;
  username: string;
  role: "USER" | "ADMIN" | "AGENT" | "SUPER_ADMIN";
  balance: string;
  exposure: string;
  currency: string;
  created_at: string;
}

export interface ApiBallEvent {
  id: string;
  match_id: string;

  ro_inning_number: number;
  ro_over_number: number;
  ro_ball_in_over: number;
  ro_sub_ball_number?: number;

  ro_total_runs: number;
  ro_batsman_runs: number;
  ro_extras_runs: number;

  ro_is_wicket: boolean;
  ro_wicket_kind?: string;
  ro_extra_type?: string;

  ro_batsman_key?: string;
  ro_batsman_name?: string | null;
  ro_bowler_key?: string;
  ro_bowler_name?: string | null;
  ro_commentary?: string | null;

  created_at: string;
}

export interface ApiInstanceOutcome {
  id: string;
  market_id: string;
  name: string;
  odds: number;
  probability?: number;
  outcome_type?: string;
  outcome_value?: string;
}

export interface ApiInstanceMarket {
  id: string;
  match_id: string;
  instance_type: string;
  instanceType?: string;
  market_title: string;
  name: string;

  ro_inning_number: number;
  ro_over_number: number;
  ro_ball_number: number;

  metadata?: Record<string, any> | null;
  result_data?: Record<string, any> | null;

  status: string;
  marketStatus?: string;
  close_time: string;
  closeTime?: string;
  winning_outcome?: string;

  outcomes: ApiInstanceOutcome[];
}

// friendly aliases for components
export type InstanceMarket = ApiInstanceMarket;
export type InstanceOutcome = ApiInstanceOutcome;

export interface ApiBet {
  id: string;
  user_id: string;
  match_id: string;

  bet_type: "BACK" | "LAY";
  bet_category: "PRE_MATCH" | "INSTANCE";

  market_id: string;
  runner_name: string;

  odds: number;
  stake: number;
  potential_payout: number;

  bet_status: "OPEN" | "WON" | "LOST" | "VOID";
  settled_at?: string;
  payout?: number;
  winning_outcome?: string;

  created_at: string;

  // UI-friendly aliases (optional; filled by mapper)
  status?: "OPEN" | "WON" | "LOST" | "VOID" | "PENDING" | "LIVE";
  type?: "BACK" | "LAY";
  createdAt?: string;
  settledAt?: string;
  matchName?: string;
  marketName?: string;
  selectionName?: string;
}

// Casino results (lightweight stubs for UI)
export interface SlotsResult {
  win: number;
  balance?: number;
  result?: any;
  payout?: number;
  newBalance?: number;
  roundId?: string;
  serverSeedHash?: string;
  clientSeed?: string;
  nonce?: number;
}

export interface WalletTransaction {
  id: string;
  user_id: string;
  transaction_type: string;
  amount: number;
  previous_balance: number;
  new_balance: number;
  reference_id?: string;
  reference_type?: string;
  description?: string;
  status: string;
  created_at: string;
}

// ============================================================================
// DB SELECT PROJECTIONS (keep them small; avoid ro_last_payload)
// ============================================================================
const MATCH_SELECT = `id,ro_match_key,sport,ro_competition_name,ro_competition_type,
ro_team_home_key,ro_team_home_name,ro_team_away_key,ro_team_away_name,
home_team_banner,away_team_banner,ro_start_time,display_status,display_score,
ro_status,ro_match_state,ro_play_status,
ro_score_runs,ro_score_wickets,ro_score_overs,ro_current_inning,ro_target_runs,
ro_batting_team_key,ro_bowling_team_key,ro_venue_name,ro_venue_city,
toss_won_by,elected_to,ro_toss_won_by,ro_toss_decision,toss_recorded_at,
updated_at,created_at`;

 const BALL_EVENTS_SELECT = `id,match_id,ro_ball_key,ro_inning_number,ro_over_number,ro_ball_in_over,ro_sub_ball_number,
ro_total_runs,ro_batsman_runs,ro_extras_runs,ro_is_wicket,ro_wicket_kind,ro_extra_type,
ro_batsman_key,ro_batsman_name,ro_bowler_key,ro_bowler_name,ro_commentary,created_at`;

// Convert raw match row into UI-friendly shape expected by the store/pages.
// No derived math; just copy DB fields.
function mapToUiMatch(row: any): Match {
  // --- Toss (convert a/b -> team name for UI) ---
  const rawTossWinner = row.toss_won_by || row.ro_toss_won_by || null;

  let tossWinnerUi: string | null = rawTossWinner;

  if (rawTossWinner) {
    const v = String(rawTossWinner).toLowerCase();

    // Roanuz insights commonly uses a/b for teams
    if (v === "a") tossWinnerUi = row.ro_team_home_name || null;
    else if (v === "b") tossWinnerUi = row.ro_team_away_name || null;

    // Sometimes toss winner may be a team_key (zim/oma etc.)
    else if (v === String(row.ro_team_home_key || "").toLowerCase())
      tossWinnerUi = row.ro_team_home_name || null;
    else if (v === String(row.ro_team_away_key || "").toLowerCase())
      tossWinnerUi = row.ro_team_away_name || null;
  }

  const rawTossDecision = row.elected_to || row.ro_toss_decision || null;

  return {
    id: row.id,
    sport: row.sport || "cricket",
    league: row.ro_competition_name || "Cricket",

    // Keep old names (just UI labels; DB is source of truth)
    homeTeam: row.ro_team_home_name,
    awayTeam: row.ro_team_away_name,
    homeTeamKey: row.ro_team_home_key || null,
    awayTeamKey: row.ro_team_away_key || null,
    homeTeamBanner: row.home_team_banner || null,
    awayTeamBanner: row.away_team_banner || null,

    startTime: row.ro_start_time,
    status: (row.display_status || "UPCOMING") as Match["status"],
    statusNote: row.ro_status || row.ro_play_status || row.ro_match_state || null,

    // DB-driven only (no formatting)
    scoreDetails: row.display_score || undefined,
    runs: row.ro_score_runs != null ? Number(row.ro_score_runs) : null,
    wickets: row.ro_score_wickets != null ? Number(row.ro_score_wickets) : null,
    overs: row.ro_score_overs != null ? Number(row.ro_score_overs) : null,
    currentInning: row.ro_current_inning != null ? Number(row.ro_current_inning) : null,
    targetRuns: row.ro_target_runs != null ? Number(row.ro_target_runs) : null,
    battingTeamKey: row.ro_batting_team_key || null,
    bowlingTeamKey: row.ro_bowling_team_key || null,
    currentOver:
      row.ro_score_overs != null
        ? Math.floor(Number(row.ro_score_overs))
        : row.current_over ?? null,
    currentBall:
      row.ro_score_overs != null
        ? Math.round((Number(row.ro_score_overs) % 1) * 10)
        : row.current_ball ?? null,

    // ✅ Toss fields fixed for UI display
    toss_won_by: tossWinnerUi,
    elected_to: rawTossDecision,
    toss_decision: rawTossDecision,
    tossDecision: rawTossDecision,
    toss_recorded_at: row.toss_recorded_at || null,

    updatedAt: row.updated_at,
    venue: row.ro_venue_name || row.ro_venue_city || undefined,

    markets: (row.markets || []).map(mapToUiMarket),
  };
}



function mapToUiMarket(market: any): Market {
  const runners: Runner[] = (market.market_runners || []).map((r: any) => ({
    id: r.id,
    marketId: r.market_id,
    name: r.runner_name,
    backOdds: Number(r.back_odds ?? 0),
    layOdds: r.lay_odds == null ? null : Number(r.lay_odds),
    volume: Number(r.total_matched ?? 0),
  }));

  const status =
    market.market_status === "OPEN"
      ? "OPEN"
      : market.market_status === "SUSPENDED"
        ? "SUSPENDED"
        : "CLOSED";

  return {
    id: market.id,
    matchId: market.match_id,
    name: market.market_name,
    status,
    runners,
  };
}

function mapToUiInstanceMarket(market: any): ApiInstanceMarket {
  return {
    id: market.id,
    match_id: market.match_id,
    instance_type: market.instance_type,
    instanceType: market.instance_type,
    market_title: market.market_title,
    name: market.market_title,

    ro_inning_number: market.ro_inning_number,
    ro_over_number: Number(market.ro_over_number ?? 0),
    ro_ball_number: market.ro_ball_number,

    metadata: market.metadata || null,
    result_data: market.result_data || null,

    status: market.market_status,
    marketStatus: market.market_status,

    close_time: market.close_time,
    closeTime: market.close_time,
    winning_outcome: market.winning_outcome,

    outcomes: (market.outcomes || []).map((o: any) => ({
      id: o.id,
      market_id: o.market_id,
      name: o.outcome_name,
      odds: Number(o.back_odds ?? 0),
      probability: o.probability ? Number(o.probability) : undefined,
      outcome_type: o.outcome_type,
      outcome_value: o.outcome_value,
    })),
  };
}

// ============================================================================
// API CLIENT
// ============================================================================

class ApiClient {
  private async extractErrorMessage(error: any, fallback: string) {
    // Supabase errors wrap the fetch response under error.context.response
    const resp: any = error?.context?.response;
    if (resp) {
      // Try JSON first
      try {
        const clone = resp.clone ? resp.clone() : resp;
        const json = await clone.json();
        if (json?.error) return String(json.error);
        if (json?.message) return String(json.message);
        if (json?.msg) return String(json.msg);
      } catch {
        // ignore and try text
      }

      try {
        const clone = resp.clone ? resp.clone() : resp;
        const txt = await clone.text();
        if (txt) return txt;
      } catch {
        /* ignore */
      }

      if (resp.status && resp.statusText) {
        return `${resp.status} ${resp.statusText}`;
      }
    }

    if (error?.details) return String(error.details);
    if (error?.message) return String(error.message);
    return fallback;
  }

  // Generic edge-function invoker with friendly errors/unwrapping
  private async invokeFunction<T>(
    name: string,
    body?: Record<string, any>,
  ): Promise<T> {
    const { data, error } = await supabase.functions.invoke(name, { body });

    if (error) {
      const message = await this.extractErrorMessage(error, `Failed to call ${name}`);
      throw new Error(message);
    }

    // Edge functions use { success, data, error }
    if ((data as any)?.success === false) {
      throw new Error((data as any)?.error || `Request failed: ${name}`);
    }

    return (((data as any)?.data ?? data) as T);
  }

  // AUTHENTICATION
  async login(username: string, password: string): Promise<{ user: ApiUser }> {
    const { error } = await supabase.auth.signInWithPassword({
      email: `${username}@local.user`,
      password,
    });

    if (error) throw error;
    return this.getCurrentUser();
  }

  async logout(): Promise<void> {
    await supabase.auth.signOut();
  }

  async getCurrentUser(): Promise<{ user: ApiUser }> {
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session) throw new Error("Not authenticated");

    const { data, error } = await supabase
      .from("users")
      .select("id, username, role, balance, exposure, currency, created_at")
      .eq("id", session.session.user.id)
      .single();

    if (error) throw error;

    return {
      user: {
        id: data.id,
        username: data.username,
        role: data.role,
        balance: String(data.balance),
        exposure: String(data.exposure),
        currency: data.currency,
        created_at: data.created_at,
      },
    };
  }

  // ==========================================================================
  // MATCHES (DB-driven)
  // ==========================================================================

  async getCurrentCricketMatches(): Promise<{ matches: Match[] }> {
    const { data, error } = await supabase
      .from("matches")
      .select(`${MATCH_SELECT}, markets:markets (id, match_id, market_name, market_status, created_at, market_runners (*))`)
      // Show cricket rows; also include legacy rows where sport is null
      .or("sport.eq.cricket,sport.is.null")
      .order("ro_start_time", { ascending: true });

    if (error) throw error;
    return { matches: (data || []).map(mapToUiMatch) };
  }

  async getLiveMatches(): Promise<{ matches: Match[] }> {
    const { data, error } = await supabase
      .from("matches")
      .select(`${MATCH_SELECT}, markets:markets (id, match_id, market_name, market_status, created_at, market_runners (*))`)
      .eq("display_status", "LIVE")
      .order("ro_start_time", { ascending: true });

    if (error) throw error;
    return { matches: (data || []).map(mapToUiMatch) };
  }

  async getMatch(matchId: string): Promise<{ match: Match }> {
    const { data, error } = await supabase
      .from("matches")
      .select(`${MATCH_SELECT}, markets:markets (id, match_id, market_name, market_status, created_at, market_runners (*))`)
      .eq("id", matchId)
      .single();

    if (error) throw error;
    return { match: mapToUiMatch(data) };
  }

  // Match details = match row + last N balls (pure DB)
  async getMatchDetails(matchId: string): Promise<{ match: Match; events: ApiBallEvent[] }> {
    const { data: matchData, error: matchError } = await supabase
      .from("matches")
      .select(MATCH_SELECT)
      .eq("id", matchId)
      .single();

    if (matchError) throw matchError;

    // Cheapest + safest ordering: created_at
    const { data: eventsData, error: eventsError } = await supabase
      .from("ball_events")
      .select(BALL_EVENTS_SELECT)
      .eq("match_id", matchId)
      .eq("ro_is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(40);

    if (eventsError) throw eventsError;

    // Map player keys to names from players table
    const keys = Array.from(
      new Set(
        (eventsData || [])
          .flatMap((row: any) => [row.ro_batsman_key, row.ro_non_striker_key, row.ro_bowler_key])
          .filter(Boolean)
          .map(String),
      ),
    );
    let nameMap: Record<string, string> = {};
    if (keys.length) {
      const { data: players, error: pErr } = await supabase
        .from("players")
        .select("ro_player_key, ro_player_name")
        .in("ro_player_key", keys);
      if (pErr) {
        console.error("players lookup failed", pErr);
      } else {
        nameMap = Object.fromEntries(
          (players || [])
            .filter((p: any) => p?.ro_player_key)
            .map((p: any) => [String(p.ro_player_key), p.ro_player_name || String(p.ro_player_key)]),
        );
      }
    }

    const events: ApiBallEvent[] = (eventsData || []).map((row: any) => ({
      id: row.id,
      match_id: row.match_id,

      ro_inning_number: Number(row.ro_inning_number ?? 1),
      ro_over_number: Number(row.ro_over_number ?? 0),
      ro_ball_in_over: Number(row.ro_ball_in_over ?? 0),
      ro_sub_ball_number: row.ro_sub_ball_number ?? undefined,

      ro_total_runs: Number(row.ro_total_runs ?? 0),
      ro_batsman_runs: Number(row.ro_batsman_runs ?? 0),
      ro_extras_runs: Number(row.ro_extras_runs ?? 0),

      ro_is_wicket: !!row.ro_is_wicket,
      ro_wicket_kind: row.ro_wicket_kind ?? undefined,
      ro_extra_type: row.ro_extra_type ?? undefined,

      ro_batsman_key: row.ro_batsman_key ?? undefined,
      ro_batsman_name: row.ro_batsman_name ?? nameMap[row.ro_batsman_key] ?? null,
      ro_bowler_key: row.ro_bowler_key ?? undefined,
      ro_bowler_name: row.ro_bowler_name ?? nameMap[row.ro_bowler_key] ?? null,
      ro_commentary: row.ro_commentary ?? null,

      created_at: row.created_at,
    }));

    // Return chronological order for UI rendering (oldest → newest)
    return { match: mapToUiMatch(matchData), events: events.reverse() };
  }

  async getRealtimeUpdate(matchId: string) {
  const { data, error } = await supabase
    .from("matches")
    .select(MATCH_SELECT)
    .eq("id", matchId)
    .single();
  if (error) throw error;

  return {
    matchId: data.id,

    homeTeam: data.ro_team_home_name,
    awayTeam: data.ro_team_away_name,
    status: data.display_status,
    statusNote: data.ro_status || data.ro_play_status || data.ro_match_state || null,

    // DB-driven
    scoreDetails: data.display_score,
    runs: Number(data.ro_score_runs ?? 0),
    wickets: Number(data.ro_score_wickets ?? 0),
    overs: data.ro_score_overs != null ? Number(data.ro_score_overs) : 0,
    currentInning: Number(data.ro_current_inning ?? 1),
    targetRuns: data.ro_target_runs ? Number(data.ro_target_runs) : null,
    toss_won_by: data.toss_won_by || data.ro_toss_won_by || null,
    tossDecision: data.elected_to || data.ro_toss_decision || null,
    elected_to: data.elected_to || data.ro_toss_decision || null,

    battingTeamKey: data.ro_batting_team_key,
    bowlingTeamKey: data.ro_bowling_team_key,

    updatedAt: data.updated_at,
  };
}

  async getAllLiveEvents(): Promise<{ matches: Match[] }> {
    return this.getLiveMatches();
  }

  async getLiveSports(): Promise<{ sports: Array<{ key: string; name: string; count: number }> }> {
    const { data, error } = await supabase
      .from("matches")
      .select("sport, display_status")
      .in("display_status", ["LIVE", "UPCOMING"]);

    if (error) throw error;

    const counts = (data || []).reduce<Record<string, number>>((acc, row: any) => {
      const key = row.sport || "other";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const sports = Object.entries(counts).map(([key, count]) => ({
      key,
      name: key.toUpperCase(),
      count,
    }));

    return { sports };
  }

  // ==========================================================================
  // MARKETS
  // ==========================================================================

  async getMatchMarkets(matchId: string): Promise<{ markets: Market[] }> {
    const { data, error } = await supabase
      .from("markets")
      .select(`id, match_id, market_name, market_status, created_at, market_runners (*)`)
      .eq("match_id", matchId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return { markets: (data || []).map(mapToUiMarket) };
  }

  async getInstanceMarkets(matchId: string, statuses?: string[]): Promise<{ markets: ApiInstanceMarket[] }> {
    const { data, error } = await supabase
      .from("instance_markets")
      .select(`*, outcomes:instance_outcomes (*)`)
      .eq("match_id", matchId)
      .order("ro_inning_number")
      .order("ro_over_number")
      .order("ro_ball_number")
      .order("created_at");

    if (error) throw error;

    if (statuses && statuses.length > 0) {
      // apply status filter in JS to avoid changing indexes/policies
      const filtered = (data || []).filter((m: any) => statuses.includes(m.market_status));
      return { markets: filtered.map(mapToUiInstanceMarket) };
    }

    return { markets: (data || []).map(mapToUiInstanceMarket) };
  }

  // ==========================================================================
  // BETTING
  // ==========================================================================

  async placeMarketBet(payload: {
    marketId: string;
    runnerId: string;
    betType: "BACK" | "LAY";
    odds: number;
    stake: number;
  }) {
    const { data, error } = await supabase.functions.invoke("place-bet", {
      body: {
        market_id: payload.marketId,
        runner_id: payload.runnerId,
        type: payload.betType,
        odds: payload.odds,
        stake: payload.stake,
      },
    });
    if (error) throw error;
    return data;
  }

  async placeInstanceBet(payload: {
    marketId: string;
    outcomeId: string;
    stake: number;
  }) {
    return this.invokeFunction("place-bet", {
      market_id: payload.marketId,
      outcome_id: payload.outcomeId,
      stake: payload.stake,
    });
  }

  async placeBet(payload: {
    matchId: string;
    marketId: string;
    runnerId: string;
    runnerName?: string;
    type: "BACK" | "LAY";
    odds: string | number;
    stake: string | number;
  }) {
    return this.invokeFunction("place-bet", {
      market_id: payload.marketId,
      runner_id: payload.runnerId,
      type: payload.type,
      odds: Number(payload.odds),
      stake: Number(payload.stake),
      runner_name: payload.runnerName,
      match_id: payload.matchId,
    });
  }
async getUserBets(): Promise<{ bets: ApiBet[] }> {
  // 1) Ensure logged in (this throws "Not authenticated" if missing)
  const { user } = await this.getCurrentUser();

  // 2) Fetch bets
  const { data, error } = await supabase
    .from("bets")
    // Select all columns so we stay compatible with older/remote schemas
    // (e.g., some DBs still use type/status/potential_profit instead of bet_type/bet_status/potential_payout)
    .select(`
      *,
      match:matches (*)
    `)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    // ✅ Make the error readable in UI
    console.error("getUserBets failed:", error);

    const msg =
      error.message ||
      (error as any)?.details ||
      "Failed to load bets (check RLS policies on bets table)";
    throw new Error(msg);
  }

  const bets: ApiBet[] = (data || []).map((row: any) => {
    const status = (row.bet_status || row.status || "OPEN") as ApiBet["bet_status"];
    const type = (row.bet_type || row.type || "BACK") as ApiBet["bet_type"];

    const matchName =
      row.match?.ro_team_home_name && row.match?.ro_team_away_name
        ? `${row.match.ro_team_home_name} vs ${row.match.ro_team_away_name}`
        : row.match?.home_team && row.match?.away_team
          ? `${row.match.home_team} vs ${row.match.away_team}`
          : row.match?.ro_competition_name || row.match?.league || "Match";

    const marketName =
      row.market_name ||
      row.market ||
      row.market_title ||
      row.bet_category ||
      "Market";

    return {
      id: row.id,
      user_id: row.user_id,
      match_id: row.match_id,

      bet_type: type,
      bet_category: row.bet_category,
      market_id: row.market_id,
      runner_name: row.runner_name,

      odds: Number(row.odds ?? 0),
      stake: Number(row.stake ?? 0),
      potential_payout: Number(
        row.potential_payout ??
          row.potential_profit ??
          row.potential_return ??
          0,
      ),

      bet_status: status,
      settled_at: row.settled_at ?? undefined,
      payout:
        row.payout != null
          ? Number(row.payout)
          : row.winnings != null
            ? Number(row.winnings)
            : undefined,
      winning_outcome: row.winning_outcome ?? row.winning_runner ?? undefined,

      created_at: row.created_at,

      // UI-friendly aliases used by your MyBets component
      status: status as any,
      type: type as any,
      createdAt: row.created_at,
      settledAt: row.settled_at,
      matchName,
      marketName,
      selectionName: row.runner_name,
    };
  });

  return { bets };
}


  // ==========================================================================
  // WALLET (DB-driven)
  // ==========================================================================

  async getWallet(): Promise<{ balance: number; exposure: number; currency: string }> {
    const { user } = await this.getCurrentUser();

    return {
      balance: parseFloat(user.balance),
      exposure: parseFloat(user.exposure),
      currency: user.currency,
    };
  }

  async getWalletTransactions(): Promise<{ transactions: any[] }> {
   const { user } = await this.getCurrentUser();


    const { data, error } = await supabase
      .from("wallet_transactions")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return { transactions: data || [] };
  }

  // REAL-TIME WALLET UPDATES (FIXED: await getSession)
  async subscribeToWalletUpdates(callback: (transaction: WalletTransaction) => void) {
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session) return null;

    const userId = session.session.user.id;

    return supabase
      .channel(`wallet:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "wallet_transactions",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const transaction = payload.new as any;
          callback({
            id: transaction.id,
            user_id: transaction.user_id,
            transaction_type: transaction.type ?? transaction.transaction_type,
            amount: Number(transaction.amount ?? 0),
            previous_balance: Number(transaction.previous_balance ?? 0),
            new_balance: Number(transaction.new_balance ?? 0),
            reference_id: transaction.reference_id ?? undefined,
            reference_type: transaction.reference_type ?? undefined,
            description: transaction.description ?? undefined,
            status: transaction.status,
            created_at: transaction.created_at,
          });
        },
      )
      .subscribe();
  }

  // ==========================================================================
  // REAL-TIME SUBSCRIPTIONS (DB-driven)
  // ==========================================================================

  subscribeToMatch(matchId: string, callback: (payload: any) => void) {
    return supabase
      .channel(`match:${matchId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "matches",
          filter: `id=eq.${matchId}`,
        },
        callback,
      )
      .subscribe();
  }

  subscribeToInstanceMarkets(matchId: string, callback: (payload: any) => void) {
    return supabase
      .channel(`instance-markets:${matchId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "instance_markets",
          filter: `match_id=eq.${matchId}`,
        },
        callback,
      )
      .subscribe();
  }

  // ==========================================================================
  // ADMIN & SUPER ADMIN (unchanged)
  // ==========================================================================

  async getAdmins(): Promise<{ admins: ApiUser[] }> {
    const data = await this.invokeFunction<{ admins: ApiUser[] }>("super-admin-users");
    return { admins: data.admins || [] };
  }

  async addBalanceToAdmin(adminId: string, amount: number) {
    return this.invokeFunction<{ admin: ApiUser }>("super-admin-credit", {
      adminId,
      amount: Number(amount),
    });
  }

  async createAdmin(payload: { username: string; password: string; balance?: string | number }) {
    const balance = Number(payload.balance || 0);
    return this.invokeFunction<{ admin: ApiUser }>("super-admin-create", {
      username: payload.username,
      password: payload.password,
      balance,
    });
  }

  async getMyUsers(): Promise<{ users: ApiUser[] }> {
    const data = await this.invokeFunction<{ users: ApiUser[] }>("admin-my-users");
    return { users: data.users || [] };
  }

  async getAllBets(): Promise<{ bets: any[] }> {
    return this.invokeFunction<{ bets: any[] }>("admin-bets");
  }

  async createUserWithBalance(payload: { username: string; password: string; balance: string | number }) {
    const balance = Number(payload.balance || 0);
    return this.invokeFunction<{ user: ApiUser }>("admin-create-user-with-balance", {
      username: payload.username,
      password: payload.password,
      balance,
    });
  }

  async distributeBalance(userId: string, amount: number) {
    return this.invokeFunction<{
      success: boolean;
      user: { id: string; balance: string };
      adminBalance: string;
    }>("admin-distribute-balance", { userId, amount: Number(amount) });
  }

  async deleteUser(userId: string) {
    return this.invokeFunction<{ success: boolean }>("admin-delete-user", { userId });
  }

  async deleteAdmin(adminId: string) {
    return this.invokeFunction<{ success: boolean }>("admin-delete-admin", { adminId });
  }

  async resetUserPassword(userId: string, newPassword: string) {
    return this.invokeFunction<{ success: boolean }>("admin-reset-user-password", {
      userId,
      password: newPassword,
    });
  }

  async resetAdminPassword(adminId: string, newPassword: string) {
    return this.invokeFunction<{ success: boolean }>("admin-reset-admin-password", {
      adminId,
      password: newPassword,
    });
  }

  async getUserActivity(userId: string) {
    return this.invokeFunction<{
      summary: any;
      bets: any[];
      instanceBets: any[];
      casinoBets: any[];
      transactions: any[];
    }>("admin-user-activity", { userId });
  }

  // ==========================================================================
  // DEPOSITS / WITHDRAWALS (unchanged)
  // ==========================================================================

  async getWithdrawable(): Promise<{ maxWithdrawable: number }> {
    return this.invokeFunction<{ maxWithdrawable: number }>("withdrawals-available");
  }

  async getMyWithdrawals(): Promise<{ requests: any[] }> {
    const data = await this.invokeFunction<{ requests: any[] }>("withdrawals-me");
    return { requests: data.requests || [] };
  }

  async getMyDepositRequests(): Promise<{ requests: any[] }> {
    const data = await this.invokeFunction<{ requests: any[] }>("deposit-my-requests");
    return { requests: data.requests || [] };
  }

  async getPendingWithdrawals(): Promise<{ requests: any[] }> {
    const data = await this.invokeFunction<{ requests: any[] }>("admin-pending-withdrawals");
    return { requests: data.requests || [] };
  }

  async getPendingDepositRequests(): Promise<{ requests: any[] }> {
    const data = await this.invokeFunction<{ requests: any[] }>("admin-pending-deposits");
    return { requests: data.requests || [] };
  }

  async requestDeposit(amount: number, notes?: string) {
    return this.invokeFunction("deposit-request", { amount: Number(amount), notes });
  }

  async requestWithdrawal(amount: number, notes?: string) {
    // main endpoint; alias exists as withdrawal-request
    return this.invokeFunction("withdrawals-request", { amount: Number(amount), notes });
  }

  async approveWithdrawal(requestId: string) {
    return this.invokeFunction("admin-approve-withdrawal", { requestId });
  }

  async rejectWithdrawal(requestId: string, notes?: string) {
    return this.invokeFunction("admin-reject-withdrawal", { requestId, notes });
  }

  async approveDepositRequest(requestId: string) {
    return this.invokeFunction("admin-approve-deposit", { requestId });
  }

  async rejectDepositRequest(requestId: string, notes?: string) {
    return this.invokeFunction("admin-reject-deposit", { requestId, notes });
  }

  // ==========================================================================
  // CASINO (stubs to satisfy UI; backed by casino-play edge function)
  // ==========================================================================
  async playDragonTiger(amount: number, bet: string): Promise<any> {
    return this.invokeFunction<any>("casino-play", { game: "dragon-tiger", amount, bet });
  }

  async playLucky7(amount: number, bet: string): Promise<any> {
    return this.invokeFunction<any>("casino-play", { game: "lucky-7", amount, bet });
  }

  async playSlots(amount: number): Promise<SlotsResult> {
    return this.invokeFunction<SlotsResult>("casino-play", { game: "slots", amount });
  }

  async playWheelOfFortune(amount: number): Promise<any> {
    return this.invokeFunction<any>("casino-play", { game: "wheel-of-fortune", amount });
  }
}

export const api = new ApiClient();
