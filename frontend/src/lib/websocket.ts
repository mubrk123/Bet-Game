import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type {
  MatchScoreUpdate,
  BallResult,
  MarketUpdate,
  BetSettlement,
  WalletUpdate,
} from "@shared/realtime";

type EventCallback<T> = (data: T) => void;

type RealtimeEventType =
  | "match:score"
  | "match:ball"
  | "markets:update"
  | "bet:settled"
  | "wallet:update";

class SupabaseRealtimeClient {
  private channels = new Map<string, RealtimeChannel>();
  private listeners = new Map<RealtimeEventType, Set<EventCallback<any>>>();
  private connected = false;

  connect() {
    this.connected = true;
    console.log("[Realtime] Supabase realtime ready");
  }

  getConnectionStatus() {
    return this.connected;
  }

  on<T>(event: RealtimeEventType, callback: EventCallback<T>) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    this.listeners.get(event)!.add(callback as EventCallback<any>);

    return () => {
      this.listeners.get(event)?.delete(callback as EventCallback<any>);
    };
  }

  private emit(event: RealtimeEventType, data: any) {
    this.listeners.get(event)?.forEach((cb) => cb(data));
  }

  subscribeToMatch(matchId: string) {
    if (this.channels.has(matchId)) return;

    const emitMarketsUpdate = async () => {
      const { data } = await supabase
        .from("instance_markets")
        .select("id, market_title, market_status, close_time, ro_over_number, ro_ball_number, ro_inning_number, outcomes:instance_outcomes (*)")
        .eq("match_id", matchId);

      const update: MarketUpdate = {
        matchId,
        markets: (data || []).map((m: any) => ({
          id: m.id,
          name: m.market_title,
          status: m.market_status,
          closeTime: Date.parse(m.close_time),
          overNumber: Number(m.ro_over_number ?? 0),
          ballNumber: m.ro_ball_number,
          outcomes: Array.isArray(m.outcomes)
            ? m.outcomes.map((o: any) => ({
                id: o.id,
                name: o.outcome_name,
                odds: o.back_odds,
              }))
            : [],
        })),
        timestamp: Date.now(),
      } as MarketUpdate;

      this.emit("markets:update", update);
    };

    const channel = supabase
      .channel(`match:${matchId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "ball_events",
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => {
          const row = payload.new as any;

          // Build outcome label similar to frontend helper
          const extrasRuns = Number(row.ro_extras_runs ?? 0);
          const totalRuns = Number(row.ro_total_runs ?? extrasRuns + Number(row.ro_batsman_runs ?? 0));
          const extraType = (row.ro_extra_type || "").toLowerCase();
          let outcome = row.ro_event_type as string | undefined;
          if (extrasRuns > 0 || extraType) {
            if (extraType.includes("wide")) outcome = totalRuns > 1 ? `Wd+${totalRuns}` : "Wd";
            else if (extraType.includes("no")) outcome = totalRuns > 1 ? `Nb+${totalRuns}` : "Nb";
          } else if (row.ro_is_wicket) {
            outcome = "W";
          } else if (row.ro_is_six) {
            outcome = "6";
          } else if (row.ro_is_boundary) {
            outcome = "4";
          } else if (totalRuns === 0) {
            outcome = "0";
          } else {
            outcome = String(totalRuns);
          }

          const data: BallResult = {
            matchId: row.match_id,
            inning: Number(row.ro_inning_number ?? 1),
            over: Number(row.ro_over_number ?? 0),
            ball: Number(row.ro_ball_in_over ?? 0),
            subBall: Number(row.ro_sub_ball_number ?? 0),
            runsScored: Number(row.ro_batsman_runs ?? 0),
            extras: extrasRuns,
            totalRuns,
            isWicket: !!row.ro_is_wicket,
            isBoundary: !!row.ro_is_boundary,
            isSix: !!row.ro_is_six,
            isExtra: extrasRuns > 0 || !!row.ro_extra_type,
            batsmanName: row.ro_batsman_name || row.ro_batsman_key || null,
            bowlerName: row.ro_bowler_name || row.ro_bowler_key || null,
            isLegal: row.ro_is_legal_delivery ?? true,
            outcome,
            timestamp: Date.parse(row.created_at),
          };

          this.emit("match:ball", data);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "matches",
          filter: `id=eq.${matchId}`,
        },
        (payload) => {
          const row = payload.new as any;

          const data: MatchScoreUpdate = {
            matchId: row.id,
            homeTeam: row.ro_team_home_name,
            awayTeam: row.ro_team_away_name,
            status: row.display_status,
            scoreDetails:
              row.display_score ||
              buildScoreDetailsFromInnings(row.ro_innings_summary) ||
              undefined,
            currentOver: Number(row.ro_score_overs ?? 0),
            currentBall: Math.round(((Number(row.ro_score_overs ?? 0) || 0) % 1) * 10),
            currentInning: row.ro_current_inning,
            targetRuns: row.ro_target_runs ?? null,
            innings: Array.isArray(row.ro_innings_summary) ? row.ro_innings_summary : undefined,
            roStatusRaw: row.ro_status ?? null,
            roPlayStatus: row.ro_play_status ?? null,
            toss_won_by: row.toss_won_by || row.ro_toss_won_by || null,
            elected_to: row.elected_to || row.ro_toss_decision || null,
            tossDecision: row.elected_to || row.ro_toss_decision || null,
            timestamp: Date.now(),
          };

          this.emit("match:score", data);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "instance_markets",
          filter: `match_id=eq.${matchId}`,
        },
        async () => {
          await emitMarketsUpdate();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "instance_markets",
          filter: `match_id=eq.${matchId}`,
        },
        async () => {
          await emitMarketsUpdate();
        }
      )
      .subscribe();

    this.channels.set(matchId, channel);
  }

  unsubscribeFromMatch(matchId: string) {
    const channel = this.channels.get(matchId);
    if (channel) {
      supabase.removeChannel(channel);
      this.channels.delete(matchId);
    }
  }

  subscribeToUser(userId?: string) {
    if (!userId) return;
    const key = `user:${userId}`;
    if (this.channels.has(key)) return;

    const channel = supabase
      .channel(key)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "instance_bets",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as any;

          const data: BetSettlement = {
            betId: row.id,
            matchId: row.match_id,
            marketId: row.market_id,
            userId: row.user_id,
            outcome: row.outcome_id,
            winningOutcome: row.winning_outcome,
            status: row.status,
            stake: Number(row.stake),
            payout: Number(row.payout ?? 0),
            timestamp: Date.now(),
          };

          this.emit("bet:settled", data);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "wallet_transactions",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as any;

          const data: WalletUpdate = {
            userId: row.user_id,
            change: Number(row.amount),
            reason: row.description,
            timestamp: Date.now(),
          };

          this.emit("wallet:update", data);
        }
      )
      .subscribe();

    this.channels.set(key, channel);
  }

  unsubscribe(key: string) {
    const channel = this.channels.get(key);
    if (channel) {
      supabase.removeChannel(channel);
      this.channels.delete(key);
    }
  }
}

function buildScoreDetailsFromInnings(innings: any): string | null {
  if (!Array.isArray(innings) || innings.length === 0) return null;
  const lines = innings
    .filter((i: any) => i?.runs != null)
    .map((i: any, idx: number) => {
      const team =
        i?.team?.name ||
        i?.team_name ||
        i?.teamName ||
        i?.teamKey ||
        `Innings ${i?.number ?? idx + 1}`;
      const wk = i?.wickets != null ? `/${i.wickets}` : "";
      const ov =
        i?.overs != null
          ? ` (${i.overs} ov)`
          : i?.balls != null
            ? ` (${(Number(i.balls) / 6).toFixed(1)} ov)`
            : "";
      return `${team}: ${i?.runs}${wk}${ov}`;
    });
  return lines.length ? lines.join(" | ") : null;
}

function buildScoreDetailsFromLive(live: any): string | null {
  if (!live || !live.score) return null;
  const s = live.score;
  const runs = s.runs ?? s.team_runs ?? s.score;
  const wk = s.wickets ?? s.wickets_fallen;
  const ov =
    Array.isArray(s.overs) && s.overs.length >= 2
      ? `${s.overs[0]}.${s.overs[1]}`
      : s.overs ??
        (Number.isFinite(s.balls) ? `${Math.floor(s.balls / 6)}.${s.balls % 6}` : null);
  if (runs == null) return null;
  const wkPart = wk != null ? `/${wk}` : "";
  const ovPart = ov != null ? ` (${ov})` : "";
  return `${runs}${wkPart}${ovPart}`;
}

export const wsClient = new SupabaseRealtimeClient();

export function useWebSocket() {
  return wsClient;
}
