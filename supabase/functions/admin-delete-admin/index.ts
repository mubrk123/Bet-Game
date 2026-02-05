import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  requireUser,
  success,
  error,
  ApiError,
  supabase,
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

    if (!targetId) throw new ApiError("Admin ID required");

    const { data: adminRow, error: fetchError } = await supabase
      .from("users")
      .select("id, role, auth_user_id")
      .eq("id", targetId)
      .single();

    if (fetchError || !adminRow) throw new ApiError("Admin not found", 404);
    if (adminRow.role !== "ADMIN") throw new ApiError("Only admins can be deleted", 403);

    const { error: delErr } = await supabase.from("users").delete().eq("id", adminRow.id);
    if (delErr) throw new ApiError(delErr.message);

    if (adminRow.auth_user_id) {
      await adminSupabase.auth.admin.deleteUser(adminRow.auth_user_id).catch((e) => {
        console.error("Failed to delete admin auth user", e?.message || e);
      });
    }

    return success({ success: true, deletedId: adminRow.id });
  } catch (err) {
    if (err instanceof ApiError) return error(err.message, err.status);
    console.error("SUPERADMIN DELETE ADMIN ERROR", err);
    return error("Internal server error", 500);
  }
});
