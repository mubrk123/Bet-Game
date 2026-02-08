import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  supabase,
  error,
  success,
  ApiError,
  handlePreflight,
  requireUser,
} from "../_shared/utils.ts";

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    await requireUser(req, ["SUPER_ADMIN"]);

    // ✅ Step 5: only settle FINISHED matches that are not yet settled
    const { data: finishedMatches, error: fetchError } = await supabase
      .from("matches")
      .select("id, home_team, away_team, score_details, status, updated_at")
      .eq("status", "FINISHED")
      .is("settled_at", null);

    if (fetchError) {
      throw new ApiError(fetchError.message);
    }

    const results: any[] = [];
    for (const match of finishedMatches || []) {
      const res = await settleMatchWinner(match);
      results.push({ matchId: match.id, ...res });

      // ✅ mark match as settled so it won't be processed again
      await supabase
        .from("matches")
        .update({ settled_at: new Date().toISOString() })
        .eq("id", match.id)
        .is("settled_at", null);
    }

    return success({ ok: true, settledMatches: results });
  } catch (err) {
    if (err instanceof ApiError) {
      return error(err.message, err.status);
    }
    console.error("AUTO SETTLE ERROR:", err);
    return error("Internal server error", 500);
  }
});

async function settleMatchWinner(match: any) {
  const { data: markets, error: marketError } = await supabase
    .from("markets")
    .select("id, name, status, match_id")
    .eq("match_id", match.id)
    .order("created_at", { ascending: true });

  if (marketError || !markets?.length) {
    return { settled: 0, reason: "no market" };
  }

  const mainMarket = markets[0];
  const { data: runners, error: runnerError } = await supabase
    .from("runners")
    .select("id, name")
    .eq("market_id", mainMarket.id);

  if (runnerError || !runners?.length) {
    return { settled: 0, reason: "no runners" };
  }

  const { winningRunnerId, outcome, winnerName } = pickWinner(match, runners);

  await supabase
    .from("markets")
    .update({ status: "CLOSED" })
    .eq("match_id", match.id);

  let settled = 0;
  if (!winningRunnerId && outcome === "VOID") {
    settled += await voidMarketBets(mainMarket.id);
  } else if (winningRunnerId) {
    settled += await settleMarketBets(mainMarket.id, winningRunnerId, winnerName);
  }

  settled += await voidInstanceBets(match.id);

  return { settled, outcome };
}

function pickWinner(match: any, runners: any[]) {
  const norm = (s: any) =>
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

  const homeKey = norm(match.ro_team_home_key || match.homeTeamKey);
  const awayKey = norm(match.ro_team_away_key || match.awayTeamKey);
  const homeName = match.ro_team_home_name || match.homeTeam || match.team_home || null;
  const awayName = match.ro_team_away_name || match.awayTeam || match.team_away || null;

  const innings: any[] = Array.isArray(match.ro_innings_summary) ? match.ro_innings_summary : [];

  const scoreToRuns = (score: any) => {
    const n = Number(score);
    if (Number.isFinite(n)) return n;
    const m = String(score || "").match(/(\d+)/);
    return m?.[1] ? Number(m[1]) : null;
  };

  let homeRuns: number | null = null;
  let awayRuns: number | null = null;

  for (const inn of innings) {
    const teamKey = norm(inn.team_key || inn.team || inn.batting_team);
    const runs = scoreToRuns(
      inn.score?.runs ?? inn.runs ?? inn.total ?? inn.score_details,
    );
    if (!Number.isFinite(runs)) continue;
    if (teamKey && homeKey && teamKey === homeKey) homeRuns = runs;
    else if (teamKey && awayKey && teamKey === awayKey) awayRuns = runs;
    else if (teamKey === "a" && homeRuns == null) homeRuns = runs;
    else if (teamKey === "b" && awayRuns == null) awayRuns = runs;
  }

  // If innings summary missing, fallback to stored target as first-innings score
  if (homeRuns == null && awayRuns == null && Number.isFinite(match.ro_target_runs)) {
    if (norm(match.ro_batting_team_key) === awayKey) homeRuns = Number(match.ro_target_runs);
    else if (norm(match.ro_batting_team_key) === homeKey) awayRuns = Number(match.ro_target_runs);
  }

  if (homeRuns == null || awayRuns == null) return { winningRunnerId: null, winnerName: null, outcome: "VOID" };

  let winnerName: string | null = null;
  if (homeRuns > awayRuns) winnerName = homeName;
  else if (awayRuns > homeRuns) winnerName = awayName;
  else return { winningRunnerId: null, winnerName: null, outcome: "VOID" }; // tie/NR

  const winningRunner =
    runners.find((r) => norm(r.name) === norm(winnerName)) ||
    runners.find((r) => norm(r.runner_name) === norm(winnerName)) ||
    runners.find((r) => norm(r.ro_team_key) === norm(winnerName)) ||
    null;

  return {
    winningRunnerId: winningRunner?.id || null,
    winnerName,
    outcome: winningRunner ? "WIN" : "VOID",
  };
}

function isSameTeam(runnerName: string, teamName: string) {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9]/g, "");
  return normalize(runnerName) === normalize(teamName);
}

async function settleMarketBets(
  marketId: string,
  winningRunnerId: string,
  winnerName?: string | null,
) {
  const { data: openBets, error } = await supabase
    .from("bets")
    .select("*")
    .eq("market_id", marketId)
    .eq("bet_status", "OPEN");

  if (error || !openBets?.length) return 0;

  let count = 0;
  for (const bet of openBets) {
    const requiredAmount =
      bet.bet_type === "BACK" ? Number(bet.stake) : Number(bet.liability);

    const isWin =
      bet.runner_id === winningRunnerId
        ? bet.bet_type === "BACK"
        : bet.bet_type === "LAY";

    // ✅ CLAIM FIRST: only one process can settle this bet
    const newStatus = isWin ? "WON" : "LOST";

    const { data: claimed, error: claimErr } = await supabase
      .from("bets")
      .update({
        bet_status: newStatus,
        winning_outcome: winnerName || bet.runner_name || "WINNER",
        settled_at: new Date().toISOString(),
      })
      .eq("id", bet.id)
      .eq("bet_status", "OPEN")
      .select("id")
      .maybeSingle();

    if (claimErr) throw new ApiError(claimErr.message);

    // Someone else settled it already
    if (!claimed) continue;

    const { balanceBefore, exposureBefore } = await getUserState(bet.user_id);
    let balanceAfter = balanceBefore;
    const exposureAfter = Math.max(0, exposureBefore - requiredAmount);

    if (isWin) {
      const profit = Number(bet.potential_payout ?? 0);
      const payout = Number((Number(bet.stake) + profit).toFixed(2));
      balanceAfter = Number((balanceBefore + payout).toFixed(2));

      await supabase
        .from("users")
        .update({ balance: balanceAfter, exposure: exposureAfter })
        .eq("id", bet.user_id);

      await supabase.from("wallet_transactions").insert({
        user_id: bet.user_id,
        amount: payout,
        type: "BET_WON",
        description: `Bet won: ${bet.runner_name || "Match"}`,
        reference_id: bet.id,
        reference_type: "bet",
        balance_before: balanceBefore,
        balance_after: balanceAfter,
      });
    } else {
      await supabase
        .from("users")
        .update({ exposure: exposureAfter })
        .eq("id", bet.user_id);

      await supabase.from("wallet_transactions").insert({
        user_id: bet.user_id,
        amount: 0,
        type: "BET_LOST",
        description: `Bet lost: ${bet.runner_name || "Match"}`,
        reference_id: bet.id,
        reference_type: "bet",
        balance_before: balanceBefore,
        balance_after: balanceBefore,
      });
    }

    count++;
  }

  await supabase.from("markets").update({ status: "CLOSED" }).eq("id", marketId);
  return count;
}

async function voidMarketBets(marketId: string) {
  const { data: openBets, error } = await supabase
    .from("bets")
    .select("*")
    .eq("market_id", marketId)
    .eq("bet_status", "OPEN");

  if (error || !openBets?.length) return 0;

  let count = 0;
  for (const bet of openBets) {
    const requiredAmount =
      bet.bet_type === "BACK" ? Number(bet.stake) : Number(bet.liability);

    // ✅ CLAIM FIRST: only one process can void this bet
    const { data: claimed, error: claimErr } = await supabase
      .from("bets")
      .update({
        bet_status: "VOID",
        settled_at: new Date().toISOString(),
      })
      .eq("id", bet.id)
      .eq("bet_status", "OPEN")
      .select("id")
      .maybeSingle();

    if (claimErr) throw new ApiError(claimErr.message);
    if (!claimed) continue;

    const { balanceBefore, exposureBefore } = await getUserState(bet.user_id);

    const balanceAfter = Number((balanceBefore + requiredAmount).toFixed(2));
    const exposureAfter = Math.max(
      0,
      Number((exposureBefore - requiredAmount).toFixed(2))
    );

    await supabase
      .from("users")
      .update({ balance: balanceAfter, exposure: exposureAfter })
      .eq("id", bet.user_id);

    await supabase.from("wallet_transactions").insert({
      user_id: bet.user_id,
      amount: requiredAmount,
      type: "BET_VOID",
      description: `Bet void: ${bet.runner_name || "Match"}`,
      reference_id: bet.id,
      reference_type: "bet",
      balance_before: balanceBefore,
      balance_after: balanceAfter,
    });

    count++;
  }

  await supabase.from("markets").update({ status: "CLOSED" }).eq("id", marketId);
  return count;
}

async function voidInstanceBets(matchId: string) {
  await supabase
    .from("instance_markets")
    .update({ status: "CLOSED", settled_outcome: "VOID" })
    .eq("match_id", matchId);

  const { data: openBets, error } = await supabase
    .from("instance_bets")
    .select("*")
    .eq("match_id", matchId)
    .eq("status", "OPEN");

  if (error || !openBets?.length) return 0;

  let count = 0;
  for (const bet of openBets) {
    // ✅ CLAIM FIRST: only one process can void this instance bet
    const { data: claimed, error: claimErr } = await supabase
      .from("instance_bets")
      .update({
        status: "VOID",
        winning_outcome: "VOID",
        settled_at: new Date().toISOString(),
      })
      .eq("id", bet.id)
      .eq("status", "OPEN")
      .select("id")
      .maybeSingle();

    if (claimErr) throw new ApiError(claimErr.message);
    if (!claimed) continue;

    const { balanceBefore, exposureBefore } = await getUserState(bet.user_id);

    const balanceAfter = Number((balanceBefore + Number(bet.stake)).toFixed(2));
    const exposureAfter = Math.max(
      0,
      Number((exposureBefore - Number(bet.stake)).toFixed(2))
    );

    await supabase
      .from("users")
      .update({ balance: balanceAfter, exposure: exposureAfter })
      .eq("id", bet.user_id);

    await supabase.from("wallet_transactions").insert({
      user_id: bet.user_id,
      amount: Number(bet.stake),
      type: "BET_VOID",
      description: `Instance bet void: ${bet.outcome_name || "Outcome"}`,
      reference_id: bet.id,
      reference_type: "instance_bet",
      balance_before: balanceBefore,
      balance_after: balanceAfter,
    });

    count++;
  }

  return count;
}

async function getUserState(userId: string) {
  const { data, error } = await supabase
    .from("users")
    .select("balance, exposure")
    .eq("id", userId)
    .single();

  if (error || !data) throw new ApiError("User not found", 404);

  return {
    balanceBefore: Number(data.balance),
    exposureBefore: Number(data.exposure || 0),
  };
}
