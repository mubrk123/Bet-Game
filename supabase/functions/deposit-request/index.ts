import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireUser, success, error, ApiError, supabase, parseAmount, handlePreflight } from "../_shared/utils.ts";

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const { userRow } = await requireUser(req);
    const body = await req.json();
    const amount = parseAmount(body.amount);

    const { data: request, error: insertError } = await supabase
      .from("deposit_requests")
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

    return success({ request, message: "Deposit request created" });
  } catch (err) {
    if (err instanceof ApiError) {
      return error(err.message, err.status);
    }
    console.error("DEPOSIT REQUEST ERROR:", err);
    return error("Internal server error", 500);
  }
});
