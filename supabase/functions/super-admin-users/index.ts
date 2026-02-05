// import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
// import { requireUser, success, error, ApiError, supabase, handlePreflight } from "../_shared/utils.ts";

// serve(async (req) => {
//   const preflight = handlePreflight(req);
//   if (preflight) return preflight;

//   try {
//     await requireUser(req, ["SUPER_ADMIN"]);

//     const { data, error: fetchError } = await supabase
//       .from("users")
//       .select("id, username, role, balance, exposure, currency, created_at")
//       .eq("role", "ADMIN")
//       .order("created_at", { ascending: false });

//     if (fetchError) {
//       throw new ApiError(fetchError.message);
//     }

//     return success({ admins: data || [] });
//   } catch (err) {
//     if (err instanceof ApiError) {
//       return error(err.message, err.status);
//     }

//     console.error("SUPER ADMIN USERS ERROR:", err);
//     return error("Internal server error", 500);
//   }
// });
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  requireUser,
  success,
  error,
  ApiError,
  adminSupabase,
  handlePreflight,
} from "../_shared/utils.ts";

serve(async (req) => {
  // CORS preflight
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  console.log("[super-admin-users] request", {
    method: req.method,
    url: req.url,
    origin: req.headers.get("origin"),
    hasAuth: !!req.headers.get("authorization"),
    hasApikey: !!req.headers.get("apikey"),
  });

  try {
    const { authUser, userRow } = await requireUser(req, ["SUPER_ADMIN"]);

    console.log("[super-admin-users] authed", {
      authUserId: authUser.id,
      role: userRow.role,
    });

    const { data, error: fetchError } = await adminSupabase
      .from("users")
      .select(
        "id, username, role, balance, exposure, currency, created_by, created_at"
      )
      .in("role", ["ADMIN", "AGENT"])
      .order("created_at", { ascending: false });

    if (fetchError) {
      console.error("[super-admin-users] DB error", fetchError);
      throw new ApiError(fetchError.message, 500);
    }

    console.log("[super-admin-users] returning admins", {
      count: data?.length ?? 0,
    });

    return success({ admins: data || [] });
  } catch (err: any) {
    if (err instanceof ApiError) {
      console.error("[super-admin-users] ApiError", {
        message: err.message,
        status: err.status,
      });
      return error(err.message, err.status);
    }

    console.error("[super-admin-users] Unexpected error", err);
    return error("Internal server error", 500);
  }
});
