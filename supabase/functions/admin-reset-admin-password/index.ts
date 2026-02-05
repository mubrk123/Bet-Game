import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  requireUser,
  success,
  error,
  ApiError,
  handlePreflight,
  adminSupabase,
} from "../_shared/utils.ts";

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const { userRow } = await requireUser(req, ["SUPER_ADMIN"]);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const url = new URL(req.url);
    const pathId = url.pathname.split("/").pop();
    const targetId = String(body.adminId || body.id || pathId || "").trim();
    const newPassword = String(body.password || body.newPassword || "").trim();

    if (!targetId) throw new ApiError("Admin ID required");
    if (!newPassword || newPassword.length < 6) {
      throw new ApiError("Password must be at least 6 characters");
    }

    const { data: adminRow, error: fetchError } = await adminSupabase
      .from("users")
      .select("id, role, auth_user_id")
      .eq("id", targetId)
      .single();

    if (fetchError || !adminRow) throw new ApiError("Admin not found", 404);
    if (adminRow.role !== "ADMIN") throw new ApiError("Only admins can be reset", 403);
    if (!adminRow.auth_user_id) throw new ApiError("Auth user not linked", 400);

    const { error: resetErr } = await adminSupabase.auth.admin.updateUserById(
      adminRow.auth_user_id,
      { password: newPassword }
    );

    if (resetErr) throw new ApiError(resetErr.message);

    return success({ success: true });
  } catch (err) {
    if (err instanceof ApiError) return error(err.message, err.status);
    console.error("SUPERADMIN RESET ADMIN PASSWORD ERROR", err);
    return error("Internal server error", 500);
  }
});
