// supabase/functions/cricket-roanuz-odds/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { supabase, handlePreflight, success, error, ApiError } from "../_shared/utils.ts";
import { updateMatchWinnerOddsFromRoanuz } from "../cricket-engine/index.ts";

const PROJECT_KEY = Deno.env.get("ROANUZ_PROJECT_KEY") || "";
const API_KEY = Deno.env.get("ROANUZ_API_KEY") || "";

async function getToken(): Promise<string> {
  const resp = await fetch(
    `https://api.sports.roanuz.com/v5/core/${PROJECT_KEY}/auth/`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: API_KEY }),
    },
  );
  const json = await resp.json().catch(() => null);
  const token = json?.data?.token;
  if (!resp.ok || !token) {
    throw new ApiError(
      `Roanuz auth failed ${resp.status}: ${json?.error?.msg || "unknown"}`,
      resp.status,
    );
  }
  return token;
}

async function fetchPrematchOdds(token: string, matchKey: string) {
  const url =
    `https://api.sports.roanuz.com/v5/cricket/${PROJECT_KEY}/match/${matchKey}/pre-match-odds/`;
  const resp = await fetch(url, { headers: { "rs-token": token } });
  const json = await resp.json().catch(() => null);
  if (!resp.ok) return null;
  return json?.data || null;
}

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    if (!PROJECT_KEY || !API_KEY) throw new ApiError("Missing Roanuz env", 500);
    const token = await getToken();

    const { data: matches, error: mErr } = await supabase
      .from("matches")
      .select("id, metadata, home_team, away_team")
      .eq("sport", "cricket")
      .in("status", ["UPCOMING", "LIVE"])
      .like("id", "a-rz--%");
    if (mErr) throw new ApiError(mErr.message, 500);

    let updated = 0;
    for (const m of matches || []) {
      const oddsPayload = await fetchPrematchOdds(token, m.id);
      if (!oddsPayload) continue;
      try {
        await updateMatchWinnerOddsFromRoanuz(
          m.id,
          m.id,
          oddsPayload,
          oddsPayload?.match?.teams || {},
        );
        updated += 1;
      } catch (e) {
        console.warn("[roanuz-odds] per-match fail", m.id, e);
      }
    }

    return success({ updated });
  } catch (err) {
    if (err instanceof ApiError) return error(err.message, err.status);
    console.error("[roanuz-odds] unexpected", err);
    return error("Internal server error", 500);
  }
});
