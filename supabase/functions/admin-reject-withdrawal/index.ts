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
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const url = new URL(req.url);
    const pathId = url.pathname.split("/").pop();
    const id = String(
      (body.id as string | undefined) ??
        (body.requestId as string | undefined) ??
        (body.request_id as string | undefined) ??
        pathId ??
        ""
    ).trim();
    if (!id) throw new ApiError("Request ID required");

    const { data: request, error: fetchError } = await supabase
      .from("withdrawal_requests")
      .select("*")
      .eq("id", id)
      .eq("status", "REQUESTED")
      .maybeSingle();

    if (fetchError || !request) {
      throw new ApiError("Request not found", 404);
    }

    const targetUser = await fetchManagedUser(
      request.user_id,
      userRow,
      "id, username, balance, created_by"
    );

    if (userRow.role === "ADMIN" && request.admin_id && request.admin_id !== userRow.id) {
      throw new ApiError("Forbidden", 403);
    }

    const balance_after = Number((targetUser.balance + request.amount).toFixed(2));

    const { error: updateUserError } = await supabase
      .from("users")
      .update({ balance: balance_after })
      .eq("id", targetUser.id);

    if (updateUserError) {
      throw new ApiError(updateUserError.message);
    }

    const { error: updateRequestError } = await supabase
      .from("withdrawal_requests")
      .update({
        status: "REJECTED",
        notes: body.notes ?? null,
        processed_by: userRow.id,
        processed_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updateRequestError) {
      throw new ApiError(updateRequestError.message);
    }

    await supabase.from("wallet_transactions").insert({
      user_id: targetUser.id,
      amount: request.amount,
      type: "DEPOSIT",
      description: "Withdrawal rejected - refund",
      reference_id: id,
      reference_type: "withdrawal_request",
      balance_before: targetUser.balance,
      balance_after,
    });

    return success({ success: true });
  } catch (err) {
    if (err instanceof ApiError) {
      return error(err.message, err.status);
    }
    console.error("REJECT WITHDRAWAL ERROR:", err);
    return error("Internal server error", 500);
  }
});
