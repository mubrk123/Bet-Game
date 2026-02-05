import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  requireUser,
  success,
  error,
  ApiError,
  supabase,
  handlePreflight,
  parseAmount,
} from "../_shared/utils.ts";

type BetType = "BACK" | "LAY";

function getClientIp(req: Request) {
  const raw = req.headers.get("x-forwarded-for") || "";
  if (!raw) return null;
  return raw.split(",")[0]?.trim() || null;
}

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const { userRow } = await requireUser(req);
    const body = await req.json();
    const { market_id, outcome_id, runner_id, type, odds, stake } = body;

    const normalizedStake = parseAmount(stake);
    if (!market_id) throw new ApiError("Market ID required");

    // Instance market bet
    if (outcome_id) {
      return await placeInstanceBet(req, userRow, {
        marketId: market_id,
        outcomeId: outcome_id,
        stake: normalizedStake,
      });
    }

    // Match / exchange bet
    if (!runner_id || !type || odds === undefined) {
      throw new ApiError("Invalid payload");
    }

    return await placeExchangeBet(req, userRow, {
      marketId: market_id,
      runnerId: runner_id,
      type,
      odds: Number(odds),
      stake: normalizedStake,
    });
  } catch (err) {
    if (err instanceof ApiError) return error(err.message, err.status);
    console.error("PLACE BET ERROR:", err);
    return error("Internal server error", 500);
  }
});

async function placeInstanceBet(
  req: Request,
  user: any,
  payload: { marketId: string; outcomeId: string; stake: number },
) {
  const now = new Date();

  // Load market
  const { data: market, error: marketErr } = await supabase
    .from("instance_markets")
    .select("id, match_id, market_status, close_time, ro_over_number, ro_ball_number, ro_inning_number")
    .eq("id", payload.marketId)
    .single();
  if (marketErr || !market) throw new ApiError("Market not found", 404);
  if (market.market_status !== "OPEN") throw new ApiError("Market closed");
  if (market.close_time && new Date(market.close_time) <= now) {
    throw new ApiError("Betting time expired");
  }

  // Load outcome
  const { data: outcome, error: outcomeErr } = await supabase
    .from("instance_outcomes")
    .select("id, outcome_name, back_odds, probability")
    .eq("id", payload.outcomeId)
    .eq("market_id", market.id)
    .single();
  if (outcomeErr || !outcome) throw new ApiError("Invalid outcome", 400);

  const odds = Number(outcome.back_odds ?? 0);
  if (!Number.isFinite(odds) || odds <= 1) throw new ApiError("Invalid odds");

  // Fresh user balance
  const { data: u, error: uErr } = await supabase
    .from("users")
    .select("id, balance, exposure")
    .eq("id", user.id)
    .single();
  if (uErr || !u) throw new ApiError("User not found", 404);

  const balance_before = Number(u.balance ?? 0);
  const exposure_before = Number(u.exposure ?? 0);
  if (balance_before < payload.stake) throw new ApiError("Insufficient balance");

  const balance_after = Number((balance_before - payload.stake).toFixed(2));
  const exposure_after = Number((exposure_before + payload.stake).toFixed(2));

  // Deduct with optimistic lock
  const { data: upd, error: updErr } = await supabase
    .from("users")
    .update({ balance: balance_after, exposure: exposure_after })
    .eq("id", user.id)
    .eq("balance", balance_before)
    .select("id")
    .maybeSingle();
  if (updErr) throw new ApiError(updErr.message);
  if (!upd?.id) throw new ApiError("Balance changed, retry", 409);

  const potential_payout = Number(((odds - 1) * payload.stake).toFixed(2));

  // Create bet in main bets table (consistent with settlement pipeline)
  const { data: bet, error: betErr } = await supabase
    .from("bets")
    .insert({
      user_id: user.id,
      match_id: market.match_id,
      market_id: market.id,
      runner_name: outcome.outcome_name,
      bet_type: "BACK",
      bet_category: "INSTANCE",
      odds,
      stake: payload.stake,
      potential_payout,
      ro_inning_number: market.ro_inning_number,
      ro_over_number: market.ro_over_number,
      ro_ball_number: market.ro_ball_number,
      bet_status: "OPEN",
      ip_address: getClientIp(req),
      user_agent: req.headers.get("user-agent"),
    })
    .select()
    .single();
  if (betErr || !bet) {
    await rollbackUser(user.id, balance_before, exposure_before);
    throw new ApiError(betErr?.message || "Bet insert failed");
  }

  const { error: wErr } = await supabase.from("wallet_transactions").insert({
    user_id: user.id,
    amount: -payload.stake,
    type: "BET_PLACED",
    description: `Instance bet: ${outcome.outcome_name}`,
    reference_id: bet.id,
    reference_type: "bet",
    balance_before,
    balance_after,
    ip_address: getClientIp(req),
    user_agent: req.headers.get("user-agent"),
  });
  if (wErr) {
    await rollbackUser(user.id, balance_before, exposure_before);
    await supabase.from("bets").delete().eq("id", bet.id);
    throw new ApiError("Wallet transaction failed");
  }

  return success({ bet, message: "Bet placed" });
}

async function placeExchangeBet(
  req: Request,
  user: any,
  payload: {
    marketId: string;
    runnerId: string;
    type: BetType;
    odds: number;
    stake: number;
  },
) {
  if (!["BACK", "LAY"].includes(payload.type)) {
    throw new ApiError("Invalid bet type");
  }

  const { data: runner, error: runnerErr } = await supabase
    .from("market_runners")
    .select("id, market_id, runner_name, back_odds, lay_odds")
    .eq("id", payload.runnerId)
    .single();
  if (runnerErr || !runner) throw new ApiError("Runner not found", 404);

  const marketId = runner.market_id || payload.marketId;
  const { data: market, error: marketErr } = await supabase
    .from("markets")
    .select("id, match_id, market_name, market_status")
    .eq("id", marketId)
    .single();
  if (marketErr || !market) throw new ApiError("Market not found", 404);
  if (market.market_status !== "OPEN") throw new ApiError("Market closed");

  const normalizedOdds = Number(payload.odds);
  if (!Number.isFinite(normalizedOdds) || normalizedOdds <= 1) {
    throw new ApiError("Invalid odds");
  }

  const liability =
    payload.type === "LAY"
      ? Number(((normalizedOdds - 1) * payload.stake).toFixed(2))
      : 0;
  const requiredAmount = payload.type === "BACK" ? payload.stake : liability;
  const potential_payout =
    payload.type === "BACK"
      ? Number((payload.stake * (normalizedOdds - 1)).toFixed(2))
      : Number(payload.stake.toFixed(2));

  const { data: u, error: uErr } = await supabase
    .from("users")
    .select("id, balance, exposure")
    .eq("id", user.id)
    .single();
  if (uErr || !u) throw new ApiError("User not found", 404);

  const balance_before = Number(u.balance ?? 0);
  const exposure_before = Number(u.exposure ?? 0);
  if (balance_before < requiredAmount) throw new ApiError("Insufficient balance");

  const balance_after = Number((balance_before - requiredAmount).toFixed(2));
  const exposure_after = Number((exposure_before + requiredAmount).toFixed(2));

  const { data: upd, error: updErr } = await supabase
    .from("users")
    .update({ balance: balance_after, exposure: exposure_after })
    .eq("id", user.id)
    .eq("balance", balance_before)
    .select("id")
    .maybeSingle();
  if (updErr) throw new ApiError(updErr.message);
  if (!upd?.id) throw new ApiError("Balance changed, retry", 409);

  const { data: bet, error: betErr } = await supabase
    .from("bets")
    .insert({
      user_id: user.id,
      match_id: market.match_id,
      market_id: market.id,
      runner_id: runner.id,
      runner_name: runner.runner_name,
      bet_type: payload.type,
      bet_category: "PRE_MATCH",
      odds: normalizedOdds,
      stake: payload.stake,
      potential_payout,
      bet_status: "OPEN",
      ip_address: getClientIp(req),
      user_agent: req.headers.get("user-agent"),
    })
    .select()
    .single();
  if (betErr || !bet) {
    await rollbackUser(user.id, balance_before, exposure_before);
    throw new ApiError(betErr?.message || "Bet insert failed");
  }

  const { error: wErr } = await supabase.from("wallet_transactions").insert({
    user_id: user.id,
    amount: -requiredAmount,
    type: "BET_PLACED",
    description: `Bet placed: ${market.market_name}`,
    reference_id: bet.id,
    reference_type: "bet",
    balance_before,
    balance_after,
    ip_address: getClientIp(req),
    user_agent: req.headers.get("user-agent"),
  });
  if (wErr) {
    await rollbackUser(user.id, balance_before, exposure_before);
    await supabase.from("bets").delete().eq("id", bet.id);
    throw new ApiError("Wallet transaction failed");
  }

  return success({ bet });
}

async function rollbackUser(userId: string, balance: number, exposure: number) {
  await supabase.from("users").update({ balance, exposure }).eq("id", userId);
}
