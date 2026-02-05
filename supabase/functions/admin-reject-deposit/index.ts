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
      .from("deposit_requests")
      .select("*")
      .eq("id", id)
      .eq("status", "REQUESTED")
      .maybeSingle();

    if (fetchError || !request) {
      throw new ApiError("Request not found", 404);
    }

    await fetchManagedUser(request.user_id, userRow, "id, created_by");

    const { error: updateRequestError } = await supabase
      .from("deposit_requests")
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

    return success({ success: true });
  } catch (err) {
    if (err instanceof ApiError) {
      return error(err.message, err.status);
    }
    console.error("REJECT DEPOSIT ERROR:", err);
    return error("Internal server error", 500);
  }
});
