import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  requireUser,
  success,
  error,
  ApiError,
  supabase,
  handlePreflight,
} from "../_shared/utils.ts";

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    await requireUser(req, ["SUPER_ADMIN"]);

    const { data, error: fetchError } = await supabase
      .from("users")
      .select(
        "id, username, role, balance, exposure, currency, created_by, created_at"
      )
      .order("created_at", { ascending: false });

    if (fetchError) {
      throw new ApiError(fetchError.message);
    }

    return success({ users: data || [] });
  } catch (err) {
    if (err instanceof ApiError) {
      return error(err.message, err.status);
    }

    console.error("ADMIN USERS ERROR:", err);
    return error("Internal server error", 500);
  }
});
