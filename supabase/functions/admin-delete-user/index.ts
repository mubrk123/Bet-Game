import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  requireUser,
  success,
  error,
  ApiError,
  supabase,
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

    if (!targetId) throw new ApiError("User ID required");

    const targetUser = await fetchManagedUser(targetId, userRow, "id, created_by, auth_user_id");

    // Disallow deleting admins/super-admins from here
    const { data: roleRow } = await supabase
      .from("users")
      .select("role")
      .eq("id", targetUser.id)
      .single();

    if (!roleRow || roleRow.role !== "USER") {
      throw new ApiError("Only regular users can be deleted by admin", 403);
    }

    const { error: delErr } = await supabase.from("users").delete().eq("id", targetUser.id);
    if (delErr) throw new ApiError(delErr.message);

    if (targetUser.auth_user_id) {
      await adminSupabase.auth.admin.deleteUser(targetUser.auth_user_id).catch((e) => {
        console.error("Failed to delete auth user", e?.message || e);
      });
    }

    return success({ success: true, deletedId: targetUser.id });
  } catch (err) {
    if (err instanceof ApiError) return error(err.message, err.status);
    console.error("ADMIN DELETE USER ERROR", err);
    return error("Internal server error", 500);
  }
});
