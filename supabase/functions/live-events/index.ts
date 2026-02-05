import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { supabase, handlePreflight, error, success } from "../_shared/utils.ts";

type RequestBody = {
  sport?: string;
  statuses?: string[];
};

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const body: RequestBody = (await req.json().catch(() => ({}))) as RequestBody;
    const sport = body.sport;
    const statuses =
      body.statuses && Array.isArray(body.statuses) && body.statuses.length > 0
        ? body.statuses
        : ["LIVE", "UPCOMING"];
let query = supabase
  .from("matches")
  .select(
    `
        id,
        sport,
        league,
        home_team,
        away_team,
        start_time,
        status,
        home_team_banner,
        away_team_banner,
        score_details,
        current_over,
        current_ball,
        current_inning,
        target_runs,
        ro_play_status,
        ro_live,
        ro_innings,
        ro_last_payload,
        venue,
        match_type,
        metadata,
        toss_won_by,
        elected_to,
        updated_at,
        markets:markets (
          id,
          match_id,
          name,
          status,
          runners:runners (
            id,
            market_id,
            name,
            back_odds,
            lay_odds,
            volume
          )
        )
      `
  )

      .in("status", statuses)
      .order("start_time", { ascending: false });

    if (sport) {
      query = query.eq("sport", sport);
    }

    const { data, error: fetchError } = await query;
    if (fetchError) {
      console.error("[live-events] fetch error", fetchError);
      return error(fetchError.message, 500);
    }

    const matches = (data || []).map((m) => {
      // --- filter only Roanuz for cricket ---
      const isRoanuz =
        (typeof m.id === "string" && m.id.startsWith("a-rz--")) ||
        (m.metadata && m.metadata.roanuz);
      const isCricket = m.sport === "cricket";

      // Add deterministic banner placeholders if missing (helps UI)
      const bannerFor = (name: string | null | undefined) =>
        name
          ? `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(
              name,
            )}&backgroundColor=0f172a&fontWeight=700`
          : null;

      return {
        ...m,
        home_team_banner: m.home_team_banner || bannerFor(m.home_team),
        away_team_banner: m.away_team_banner || bannerFor(m.away_team),
        __isRoanuz: isRoanuz,
        __isCricket: isCricket,
      };
    });

    const filtered = matches.filter((m) => {
      if (!statuses.includes(m.status)) return false;
      // For cricket, keep only Roanuz-provided rows
      if (m.__isCricket && !m.__isRoanuz) return false;
      return true;
    });

    return success({ matches: filtered });
  } catch (err) {
    console.error("[live-events] error", err);
    return error("Internal server error", 500);
  }
});
