import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireUser, success, error, ApiError, supabase, handlePreflight } from "../_shared/utils.ts";

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const { userRow } = await requireUser(req, ["ADMIN", "SUPER_ADMIN"]);

    let userIds: string[] | null = null;
    if (userRow.role === "ADMIN") {
      const { data: users } = await supabase
        .from("users")
        .select("id")
        .eq("created_by", userRow.id);
      userIds = (users || []).map((u) => u.id);
      if (!userIds.length) {
        return success({ requests: [] });
      }
    }

    const query = supabase
      .from("deposit_requests")
      .select("*")
      .eq("status", "REQUESTED")
      .order("created_at", { ascending: false });

    if (userIds) {
      query.in("user_id", userIds);
    }

    const { data, error: fetchError } = await query;

    if (fetchError) {
      throw new ApiError(fetchError.message);
    }

    return success({ requests: data || [] });
  } catch (err) {
    if (err instanceof ApiError) {
      return error(err.message, err.status);
    }
    console.error("PENDING DEPOSITS ERROR:", err);
    return error("Internal server error", 500);
  }
});
