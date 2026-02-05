import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  requireUser,
  success,
  error,
  ApiError,
  supabase,
  parseAmount,
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
    const amount = parseAmount(body.amount);

    if (!userId) {
      throw new ApiError("User ID required");
    }

    const targetUser = await fetchManagedUser(
      userId,
      userRow,
      "id, username, balance, created_by"
    );

    if (targetUser.balance < amount) {
      throw new ApiError("Insufficient balance");
    }

    const balanceAfter = Number((targetUser.balance - amount).toFixed(2));

    const { error: updateError } = await supabase
      .from("users")
      .update({ balance: balanceAfter })
      .eq("id", targetUser.id);

    if (updateError) {
      throw new ApiError(updateError.message);
    }

    await supabase.from("wallet_transactions").insert({
      user_id: targetUser.id,
      amount: -amount,
      type: "ADMIN_DEBIT",
      description: `Debit by ${userRow.username}`,
      reference_id: userRow.id,
      reference_type: "user",
      balance_before: targetUser.balance,
      balance_after: balanceAfter,
    });

    return success({ user: { ...targetUser, balance: balanceAfter } });
  } catch (err) {
    if (err instanceof ApiError) {
      return error(err.message, err.status);
    }

    console.error("ADMIN DEBIT USER ERROR:", err);
    return error("Internal server error", 500);
  }
});
