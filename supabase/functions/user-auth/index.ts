import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { handlePreflight, success } from "../_shared/utils.ts";

// Simple health/auth ping; actual auth handled via Supabase Auth directly.
serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  return success({ ok: true, message: "Use Supabase Auth for login" });
});
