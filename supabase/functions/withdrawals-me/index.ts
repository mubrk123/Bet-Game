import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireUser, success, error, ApiError, supabase, handlePreflight } from "../_shared/utils.ts";

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const { userRow } = await requireUser(req);

    const { data, error: fetchError } = await supabase
      .from("withdrawal_requests")
      .select("*")
      .eq("user_id", userRow.id)
      .order("created_at", { ascending: false });

    if (fetchError) {
      throw new ApiError(fetchError.message);
    }

    return success({ requests: data || [] });
  } catch (err) {
    if (err instanceof ApiError) {
      return error(err.message, err.status);
    }
    console.error("WITHDRAWALS ME ERROR:", err);
    return error("Internal server error", 500);
  }
});
