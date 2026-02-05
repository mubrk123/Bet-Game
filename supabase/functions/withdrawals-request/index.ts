import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireUser, success, error, ApiError, supabase, parseAmount, handlePreflight } from "../_shared/utils.ts";

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const { userRow } = await requireUser(req);
    const body = await req.json();
    const amount = parseAmount(body.amount);

    if (userRow.balance < amount) {
      throw new ApiError("Insufficient balance");
    }

    const balance_after = Number((userRow.balance - amount).toFixed(2));

    const { data: request, error: insertError } = await supabase
      .from("withdrawal_requests")
      .insert({
        user_id: userRow.id,
        admin_id: userRow.created_by ?? null,
        amount,
        status: "REQUESTED",
        notes: body.notes ?? null,
      })
      .select()
      .single();

    if (insertError || !request) {
      throw new ApiError(insertError?.message || "Failed to create request");
    }

    const { error: updateError } = await supabase
      .from("users")
      .update({ balance: balance_after })
      .eq("id", userRow.id);

    if (updateError) {
      throw new ApiError(updateError.message);
    }

    await supabase.from("wallet_transactions").insert({
      user_id: userRow.id,
      amount: -amount,
      type: "WITHDRAWAL",
      description: "Withdrawal requested",
      reference_id: request.id,
      reference_type: "withdrawal_request",
      balance_before: userRow.balance,
      balance_after,
    });

    return success({ request });
  } catch (err) {
    if (err instanceof ApiError) {
      return error(err.message, err.status);
    }
    console.error("WITHDRAWAL REQUEST ERROR:", err);
    return error("Internal server error", 500);
  }
});
