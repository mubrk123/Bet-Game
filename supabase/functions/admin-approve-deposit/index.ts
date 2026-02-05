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
      .from("deposit_requests")
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
    const adminBalanceAfter = Number((adminBalanceBefore - request.amount).toFixed(2));
    if (adminBalanceAfter < 0) {
      throw new ApiError("Admin has insufficient balance");
    }

    const balance_after = Number((targetUser.balance + request.amount).toFixed(2));

    const { error: updateAdminError } = await supabase
      .from("users")
      .update({ balance: adminBalanceAfter })
      .eq("id", adminRow.id);

    if (updateAdminError) {
      throw new ApiError(updateAdminError.message);
    }

    const { error: updateUserError } = await supabase
      .from("users")
      .update({ balance: balance_after })
      .eq("id", targetUser.id);

    if (updateUserError) {
      // roll back admin deduction if user update fails
      await supabase.from("users").update({ balance: adminBalanceBefore }).eq("id", adminRow.id);
      throw new ApiError(updateUserError.message);
    }

    const { error: updateRequestError } = await supabase
      .from("deposit_requests")
      .update({
        status: "APPROVED",
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
      description: "Deposit approved",
      reference_id: id,
      reference_type: "deposit_request",
      balance_before: targetUser.balance,
      balance_after,
      source_user_id: adminRow.id,
    });

    await supabase.from("wallet_transactions").insert({
      user_id: adminRow.id,
      amount: -request.amount,
      type: "ADMIN_DEBIT",
      description: `Deposit to ${targetUser.username}`,
      reference_id: id,
      reference_type: "deposit_request",
      balance_before: adminBalanceBefore,
      balance_after: adminBalanceAfter,
      source_user_id: targetUser.id,
    });

    return success({ success: true, message: "Deposit approved" });
  } catch (err) {
    if (err instanceof ApiError) {
      return error(err.message, err.status);
    }
    console.error("APPROVE DEPOSIT ERROR:", err);
    return error("Internal server error", 500);
  }
});
