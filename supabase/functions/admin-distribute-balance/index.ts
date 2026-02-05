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

    if (userRow.balance < amount) {
      throw new ApiError("Insufficient balance");
    }

    const targetUser = await fetchManagedUser(
      userId,
      userRow,
      "id, username, balance, created_by"
    );

    const adminBalanceAfter = Number((userRow.balance - amount).toFixed(2));
    const userBalanceAfter = Number((targetUser.balance + amount).toFixed(2));

    const { error: adminUpdateError } = await supabase
      .from("users")
      .update({ balance: adminBalanceAfter })
      .eq("id", userRow.id);

    if (adminUpdateError) {
      throw new ApiError(adminUpdateError.message);
    }

    const { error: userUpdateError } = await supabase
      .from("users")
      .update({ balance: userBalanceAfter })
      .eq("id", targetUser.id);

    if (userUpdateError) {
      throw new ApiError(userUpdateError.message);
    }

    await supabase.from("wallet_transactions").insert([
      {
        user_id: userRow.id,
        amount: -amount,
        type: "TRANSFER_OUT",
        description: `Balance distributed to ${targetUser.username}`,
        reference_id: targetUser.id,
        reference_type: "user",
        balance_before: userRow.balance,
        balance_after: adminBalanceAfter,
      },
      {
        user_id: targetUser.id,
        amount,
        type: "TRANSFER_IN",
        description: `Balance received from ${userRow.username}`,
        reference_id: userRow.id,
        reference_type: "user",
        balance_before: targetUser.balance,
        balance_after: userBalanceAfter,
      },
    ]);

    return success({
      success: true,
      user: { id: targetUser.id, balance: String(userBalanceAfter) },
      adminBalance: String(adminBalanceAfter),
    });
  } catch (err) {
    if (err instanceof ApiError) {
      return error(err.message, err.status);
    }

    console.error("ADMIN DISTRIBUTE BALANCE ERROR:", err);
    return error("Internal server error", 500);
  }
});
