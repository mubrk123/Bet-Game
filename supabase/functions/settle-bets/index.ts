import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  requireUser,
  success,
  error,
  ApiError,
  supabase,
  handlePreflight,
} from "../_shared/utils.ts";

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    await requireUser(req, ["ADMIN", "SUPER_ADMIN"]);
    const body = await req.json();
    const marketId = String(body.marketId || body.market_id || "").trim();
    const winningRunnerId = String(
      body.winningRunnerId || body.winning_runner_id || ""
    ).trim();

    if (!marketId || !winningRunnerId) {
      throw new ApiError("marketId and winningRunnerId are required");
    }

    const { data: market, error: marketError } = await supabase
      .from("markets")
      .select("id, match_id, name, status")
      .eq("id", marketId)
      .maybeSingle();

    if (marketError || !market) {
      throw new ApiError("Market not found", 404);
    }

    const { data: runner, error: runnerError } = await supabase
      .from("runners")
      .select("id, name")
      .eq("id", winningRunnerId)
      .eq("market_id", marketId)
      .maybeSingle();

    if (runnerError || !runner) {
      throw new ApiError("Winning runner not found", 404);
    }

    const { data: openBets, error: betsError } = await supabase
      .from("bets")
      .select("*")
      .eq("market_id", marketId)
      .eq("status", "OPEN");

    if (betsError) {
      throw new ApiError(betsError.message);
    }

    const settled: any[] = [];

    for (const bet of openBets || []) {
      const requiredAmount =
        bet.type === "BACK" ? Number(bet.stake) : Number(bet.liability);
      const isWin =
        bet.runner_id === winningRunnerId
          ? bet.type === "BACK"
          : bet.type === "LAY";

      const { balanceBefore, exposureBefore } = await getUserState(bet.user_id);
      let balanceAfter = balanceBefore;
      let exposureAfter = exposureBefore;

      if (isWin) {
        const payout = Number(
          (Number(bet.stake) + Number(bet.potential_profit)).toFixed(2)
        );
        balanceAfter = Number((balanceBefore + payout).toFixed(2));
        exposureAfter = Math.max(
          0,
          Number((exposureAfter - requiredAmount).toFixed(2))
        );

        await supabase
          .from("users")
          .update({ balance: balanceAfter, exposure: exposureAfter })
          .eq("id", bet.user_id);

        await supabase
          .from("bets")
          .update({
            status: "WON",
            winning_runner: runner.name,
            settled_at: new Date().toISOString(),
          })
          .eq("id", bet.id);

        await supabase.from("wallet_transactions").insert({
          user_id: bet.user_id,
          amount: payout,
          type: "BET_WON",
          description: `Bet won: ${market.name}`,
          reference_id: bet.id,
          reference_type: "bet",
          balance_before: balanceBefore,
          balance_after: balanceAfter,
        });

        settled.push({ betId: bet.id, status: "WON", payout });
      } else {
        exposureAfter = Math.max(
          0,
          Number((exposureAfter - requiredAmount).toFixed(2))
        );

        await supabase
          .from("users")
          .update({ exposure: exposureAfter })
          .eq("id", bet.user_id);

        await supabase
          .from("bets")
          .update({
            status: "LOST",
            winning_runner: runner.name,
            settled_at: new Date().toISOString(),
          })
          .eq("id", bet.id);

        await supabase.from("wallet_transactions").insert({
          user_id: bet.user_id,
          amount: 0,
          type: "BET_LOST",
          description: `Bet lost: ${market.name}`,
          reference_id: bet.id,
          reference_type: "bet",
          balance_before: balanceBefore,
          balance_after: balanceBefore,
        });

        settled.push({ betId: bet.id, status: "LOST", payout: 0 });
      }
    }

    await supabase.from("markets").update({ status: "CLOSED" }).eq("id", marketId);

    return success({ settled, marketId, winningRunnerId });
  } catch (err) {
    if (err instanceof ApiError) {
      return error(err.message, err.status);
    }
    console.error("SETTLE BETS ERROR:", err);
    return error("Internal server error", 500);
  }
});

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
