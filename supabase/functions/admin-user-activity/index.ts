import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  requireUser,
  success,
  error,
  ApiError,
  supabase,
  handlePreflight,
  fetchManagedUser,
} from "../_shared/utils.ts";

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const { userRow } = await requireUser(req, ["ADMIN", "SUPER_ADMIN"]);
    const body = await req.json();
    const userId = String(body.userId || "").trim();

    if (!userId) {
      throw new ApiError("User ID required");
    }

    await fetchManagedUser(userId, userRow, "id, created_by");

    const { data: bets } = await supabase
      .from("bets")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    const { data: instanceBets } = await supabase
      .from("instance_bets")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    const { data: casinoBets } = await supabase
      .from("casino_bets")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    const { data: transactions } = await supabase
      .from("wallet_transactions")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    const totalBets = bets?.length ?? 0;
    const betsWon = bets?.filter((b) => b.status === "WON").length ?? 0;
    const betsLost = bets?.filter((b) => b.status === "LOST").length ?? 0;
    const totalBetAmount = (bets || []).reduce(
      (sum, b) => sum + Number(b.stake || 0),
      0
    );
    const totalWinnings = (bets || []).reduce((sum, b) => {
      if (b.status === "WON") {
        return sum + Number(b.potential_profit || 0);
      }
      return sum;
    }, 0);

    const totalCasinoBets = casinoBets?.length ?? 0;
    const casinoWon = casinoBets?.filter((b) => b.is_win).length ?? 0;
    const casinoLost = casinoBets?.filter((b) => b.is_win === false).length ?? 0;
    const totalCasinoWagered = (casinoBets || []).reduce(
      (sum, b) => sum + Number(b.bet_amount || 0),
      0
    );
    const totalCasinoWinnings = (casinoBets || []).reduce((sum, b) => {
      if (b.is_win) {
        return sum + Number(b.profit || 0);
      }
      return sum;
    }, 0);

    return success({
      summary: {
        totalBets,
        betsWon,
        betsLost,
        totalBetAmount,
        totalWinnings,
        totalCasinoBets,
        casinoWon,
        casinoLost,
        totalCasinoWagered,
        totalCasinoWinnings,
      },
      bets: bets || [],
      instanceBets: instanceBets || [],
      casinoBets: casinoBets || [],
      transactions: transactions || [],
    });
  } catch (err) {
    if (err instanceof ApiError) {
      return error(err.message, err.status);
    }

    console.error("ADMIN USER ACTIVITY ERROR:", err);
    return error("Internal server error", 500);
  }
});
