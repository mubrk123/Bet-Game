import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  supabase,
  handlePreflight,
  error,
  success,
  requireUser,
  ApiError,
} from "../_shared/utils.ts";

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    await requireUser(req, ["ADMIN", "SUPER_ADMIN"]);

    const { data, error: fetchError } = await supabase
      .from("bets")
      .select("*")
      .order("created_at", { ascending: false });

    if (fetchError) {
      throw new ApiError(fetchError.message);
    }

    return success({ bets: data || [] });
  } catch (err) {
    if (err instanceof ApiError) {
      return error(err.message, err.status);
    }
    console.error("[admin-bets] error", err);
    return error("Internal server error", 500);
  }
});
