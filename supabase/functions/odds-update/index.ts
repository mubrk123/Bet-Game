// // supabase/functions/odds-update/index.ts
// import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// import { corsHeaders } from "../_shared/utils.ts";
// import { updateMatchWinnerOdds } from "../_shared/odds_engine.ts";

// const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// const CRON_SECRET =
//   Deno.env.get("CRON_SECRET") || Deno.env.get("X_CRON_SECRET") || "";

// function hasCronSecret(req: Request) {
//   if (!CRON_SECRET) return false;
//   const h = req.headers.get("x-cron-secret") || "";
//   return h === CRON_SECRET;
// }

// function ok(data: any) {
//   return new Response(JSON.stringify({ success: true, data }), {
//     headers: { ...corsHeaders, "Content-Type": "application/json" },
//   });
// }
// function bad(message: string, status = 400) {
//   return new Response(JSON.stringify({ success: false, error: message }), {
//     status,
//     headers: { ...corsHeaders, "Content-Type": "application/json" },
//   });
// }

// async function matchNeedsPrematchFix(supabase: any, matchId: string) {
//   // If Match Winner exists with proper odds, do not rewrite prematch.
//   const { data: market } = await supabase
//     .from("markets")
//     .select("id")
//     .eq("match_id", matchId)
//     .eq("name", "Match Winner")
//     .maybeSingle();

//   if (!market?.id) return true;

//   const { data: runners } = await supabase
//     .from("runners")
//     .select("back_odds,lay_odds")
//     .eq("market_id", market.id);

//   if (!runners?.length) return true;

//   // Consider “missing” if any runner has no odds or odds ~1.9 default on both
//   const nums = runners.map((r: any) => Number(r.back_odds));
//   const anyMissing = nums.some((x: number) => !Number.isFinite(x) || x <= 1.01);
//   if (anyMissing) return true;

//   const nearDefault = nums.every((x: number) => Math.abs(x - 1.9) < 0.01);
//   return nearDefault; // rewrite only if still default-ish
// }

// Deno.serve(async (req) => {
//   if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

//   try {
//     if (!hasCronSecret(req)) return bad("Forbidden (missing cron secret)", 403);

//     const url = new URL(req.url);
//     const matchId = url.searchParams.get("matchId"); // optional
//     const windowHours = Number(url.searchParams.get("windowHours") || "48");

//     const now = new Date();
//     const toIso = new Date(now.getTime() + windowHours * 3600 * 1000).toISOString();

//     const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
//       auth: { persistSession: false, autoRefreshToken: false },
//     });

//     let q = supabase
//       .from("matches")
//       .select("id,status,start_time,home_team,away_team,match_type,league,score_details,current_over,current_ball,current_inning,last_ball_runs,last_ball_wicket,metadata,total_overs,toss_won_by,elected_to")
//       .in("status", ["UPCOMING", "LIVE"])
//       .lte("start_time", toIso);

//     if (matchId) q = q.eq("id", matchId);

//     const { data: matches, error } = await q.limit(300);
//     if (error) throw error;

//     const results: any[] = [];
//     let updated = 0;

//     for (const m of matches ?? []) {
//       try {
//         const status = String(m.status ?? "").toUpperCase();

//         if (status === "UPCOMING") {
//           // Do NOT keep rewriting prematch; only fill if missing/default-ish
//           const needs = await matchNeedsPrematchFix(supabase, String(m.id));
//           if (!needs) {
//             results.push({ matchId: String(m.id), updated: false, reason: "prematch_ok_skip" });
//             continue;
//           }
//         }

//         const r = await updateMatchWinnerOdds(supabase, m);
//         results.push(r);
//         if (r.updated) updated++;
//       } catch (e: any) {
//         results.push({
//           matchId: String(m.id),
//           updated: false,
//           error: String(e?.message ?? e),
//         });
//       }
//     }

//     return ok({
//       scanned: matches?.length ?? 0,
//       updated,
//       results,
//     });
//   } catch (err: any) {
//     console.error("[odds-update] error", err);
//     return bad(err?.message || "Internal error", 500);
//   }
// });

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  adminSupabase as supabase,
  handlePreflight,
  success,
  error,
} from "../_shared/utils.ts";

import { updateOddsForMatchFromBallEvents } from "../_shared/odds_engine.ts";

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const body = await req.json().catch(() => ({}));
    const matchId = String(body.matchId || body.match_id || "").trim();
    const debug = !!body.debug;
    const force = !!body.force;

    if (!matchId) {
      return error("matchId is required", 400);
    }

    const result = await updateOddsForMatchFromBallEvents(supabase, matchId, { debug, force });
    return success(result);
  } catch (e) {
    console.error("[odds-update] error", e);
    return error(String(e?.message || e), 500);
  }
});
