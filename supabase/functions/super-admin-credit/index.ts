import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  requireUser,
  success,
  error,
  ApiError,
  supabase,
  parseAmount,
  handlePreflight,
} from "../_shared/utils.ts";

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const { userRow } = await requireUser(req, ["SUPER_ADMIN"]);
    const body = await req.json();

    const adminId = String(body.adminId || "").trim();
    const amount = parseAmount(body.amount);

    if (!adminId) {
      throw new ApiError("Admin ID required");
    }

    const { data: adminUser, error: adminError } = await supabase
      .from("users")
      .select("id, username, balance")
      .eq("id", adminId)
      .eq("role", "ADMIN")
      .single();

    if (adminError || !adminUser) {
      throw new ApiError("Admin not found", 404);
    }

    const balanceAfter = Number((adminUser.balance + amount).toFixed(2));

    const { error: updateError } = await supabase
      .from("users")
      .update({ balance: balanceAfter })
      .eq("id", adminUser.id);

    if (updateError) {
      throw new ApiError(updateError.message);
    }

    await supabase.from("wallet_transactions").insert({
      user_id: adminUser.id,
      amount,
      type: "ADMIN_CREDIT",
      description: `Balance added by ${userRow.username}`,
      reference_id: userRow.id,
      reference_type: "user",
      balance_before: adminUser.balance,
      balance_after: balanceAfter,
    });

    return success({ admin: { ...adminUser, balance: balanceAfter } });
  } catch (err) {
    if (err instanceof ApiError) {
      return error(err.message, err.status);
    }

    console.error("SUPER ADMIN CREDIT ERROR:", err);
    return error("Internal server error", 500);
  }
});
