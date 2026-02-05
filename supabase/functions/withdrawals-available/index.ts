import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireUser, success, error, ApiError, handlePreflight } from "../_shared/utils.ts";

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const { userRow } = await requireUser(req);
    const maxWithdrawable = Math.max(
      Number(userRow.balance) - Number(userRow.exposure || 0),
      0
    );

    return success({ maxWithdrawable });
  } catch (err) {
    if (err instanceof ApiError) {
      return error(err.message, err.status);
    }
    console.error("WITHDRAWAL AVAILABLE ERROR:", err);
    return error("Internal server error", 500);
  }
});
