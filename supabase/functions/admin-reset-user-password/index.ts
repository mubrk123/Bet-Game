import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  requireUser,
  success,
  error,
  ApiError,
  handlePreflight,
  fetchManagedUser,
  adminSupabase,
} from "../_shared/utils.ts";

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const { userRow } = await requireUser(req, ["ADMIN", "SUPER_ADMIN"]);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const url = new URL(req.url);
    const pathId = url.pathname.split("/").pop();
    const targetId = String(body.userId || body.id || pathId || "").trim();
    const newPassword = String(body.password || body.newPassword || "").trim();

    if (!targetId) throw new ApiError("User ID required");
    if (!newPassword || newPassword.length < 6) {
      throw new ApiError("Password must be at least 6 characters");
    }

    const targetUser = await fetchManagedUser(targetId, userRow, "id, auth_user_id, role");
    if (targetUser.role !== "USER") {
      throw new ApiError("Only regular users can be reset by admin", 403);
    }

    if (!targetUser.auth_user_id) {
      throw new ApiError("Auth user not linked", 400);
    }

    const { error: resetErr } = await adminSupabase.auth.admin.updateUserById(
      targetUser.auth_user_id,
      { password: newPassword }
    );

    if (resetErr) throw new ApiError(resetErr.message);

    return success({ success: true });
  } catch (err) {
    if (err instanceof ApiError) return error(err.message, err.status);
    console.error("ADMIN RESET USER PASSWORD ERROR", err);
    return error("Internal server error", 500);
  }
});
