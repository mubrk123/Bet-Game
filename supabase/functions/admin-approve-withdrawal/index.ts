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
    const url = new URL(req.url);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
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

    const adminId = request.admin_id || userRow.id;
    const { data: adminRow, error: adminFetchError } = await supabase
      .from("users")
      .select("id, username, balance, role")
      .eq("id", adminId)
      .maybeSingle();

    if (adminFetchError || !adminRow) {
      throw new ApiError("Admin not found for this request", 404);
    }

    const adminBalanceBefore = Number(adminRow.balance || 0);
    const adminBalanceAfter = Number((adminBalanceBefore + request.amount).toFixed(2));

    const { error: updateAdminError } = await supabase
      .from("users")
      .update({ balance: adminBalanceAfter })
      .eq("id", adminRow.id);

    if (updateAdminError) {
      throw new ApiError(updateAdminError.message);
    }

    const { error: updateError } = await supabase
      .from("withdrawal_requests")
      .update({
        status: "APPROVED",
        processed_by: userRow.id,
        processed_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updateError) {
      // roll back admin credit if request update fails
      await supabase.from("users").update({ balance: adminBalanceBefore }).eq("id", adminRow.id);
      throw new ApiError(updateError.message);
    }

    await supabase.from("wallet_transactions").insert({
      user_id: adminRow.id,
      amount: request.amount,
      type: "ADMIN_CREDIT",
      description: `Withdrawal from ${targetUser.username}`,
      reference_id: id,
      reference_type: "withdrawal_request",
      balance_before: adminBalanceBefore,
      balance_after: adminBalanceAfter,
      source_user_id: targetUser.id,
    });

    return success({
      success: true,
      adminBalance: String(adminBalanceAfter),
      message: "Withdrawal approved",
    });
  } catch (err) {
    if (err instanceof ApiError) {
      return error(err.message, err.status);
    }
    console.error("APPROVE WITHDRAWAL ERROR:", err);
    return error("Internal server error", 500);
  }
});
