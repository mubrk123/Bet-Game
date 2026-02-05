import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  supabase,
  handlePreflight,
  success,
  error,
  ApiError,
} from "../_shared/utils.ts";
import { mapRoanuzStatus } from "../cricket-engine/roanuz.ts";

const PROJECT_KEY = Deno.env.get("ROANUZ_PROJECT_KEY") ||
  Deno.env.get("ROANUZ_PROJECTID") ||
  "RS_P_2016114787192279052";
const API_KEY = Deno.env.get("ROANUZ_API_KEY") ||
  Deno.env.get("ROANUZ_APIKEY") ||
  "";

if (!API_KEY) {
  console.warn("[roanuz-fixtures] ROANUZ_API_KEY is not set");
}

async function getToken(): Promise<string> {
  if (!API_KEY) throw new ApiError("ROANUZ_API_KEY missing", 500);

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

async function fetchFixtures(token: string, month?: string) {
  const url = new URL(
    `https://api.sports.roanuz.com/v5/cricket/${PROJECT_KEY}/fixtures/`,
  );
  if (month) url.searchParams.set("month", month);
  const resp = await fetch(url.toString(), { headers: { "rs-token": token } });
  const json = await resp.json().catch(() => null);
  if (!resp.ok) {
    throw new ApiError(
      `Roanuz fixtures error ${resp.status}: ${json?.error?.msg || "unknown"}`,
      resp.status,
    );
  }
  return json?.data;
}

type FlatFixture = {
  key: string;
  name: string;
  short_name: string;
  sub_title: string | null;
  status: string;
  start_at: number;
  tournament?: { name?: string; key?: string };
  teams?: { a?: { name?: string; key?: string }; b?: { name?: string; key?: string } };
  venue?: { name?: string; city?: string };
  format?: string | null;
  season_key?: string;
  series_key?: string;
};

// Very small country map for common international sides; fall back to initials avatar.
const countryCodeMap: Record<string, string> = {
  india: "in",
  ind: "in",
  australia: "au",
  aus: "au",
  pakistan: "pk",
  pak: "pk",
  "bangladesh": "bd",
  ban: "bd",
  sri_lanka: "lk",
  srilanka: "lk",
  sl: "lk",
  afghanistan: "af",
  afg: "af",
  "new_zealand": "nz",
  newzealand: "nz",
  nz: "nz",
  "south_africa": "za",
  sa: "za",
  england: "gb",
  eng: "gb",
  "west_indies": "jm", // no single code; use Jamaica flag as compromise
  wi: "jm",
  usa: "us",
  unitedstates: "us",
  ireland: "ie",
  ire: "ie",
  scotland: "gb-sct",
  sco: "gb-sct",
  netherlands: "nl",
  ned: "nl",
  zimbabwe: "zw",
  zim: "zw",
  nepal: "np",
  nep: "np",
  uae: "ae",
  oman: "om",
  namibia: "na",
  nam: "na",
  png: "pg",
  "papua_new_guinea": "pg",
  hongkong: "hk",
  hk: "hk",
  canada: "ca",
  can: "ca",
  kenya: "ke",
  ken: "ke",
};

function normalizeName(name?: string | null) {
  return (name || "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function flagForTeam(name?: string | null): string | null {
  const norm = normalizeName(name);
  if (!norm) return null;
  const code = countryCodeMap[norm];
  if (code) {
    // flagcdn uses lowercase country codes; regions like gb-sct also work
    return `https://flagcdn.com/${code}.svg`;
  }
  return null;
}

function flattenFixtures(data: any): FlatFixture[] {
  const out: FlatFixture[] = [];
  const month = data?.month;
  const days = Array.isArray(month?.days) ? month.days : [];
  for (const d of days) {
    const matches = Array.isArray(d?.matches) ? d.matches : [];
    for (const m of matches) {
      out.push(m as FlatFixture);
    }
  }
  return out;
}

function mapFixtureToRow(fx: FlatFixture) {
  const status = mapRoanuzStatus(fx.status);
  const displayStatus = status === "FINISHED" ? "FINISHED" :
                       status === "LIVE" ? "LIVE" : "UPCOMING";
  
  const bannerFor = (name: string | null | undefined) => {
    const flag = flagForTeam(name);
    if (flag) return flag;
    return name
      ? `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(
          name,
        )}&backgroundColor=0f172a&fontWeight=700`
      : null;
  };
  
  // CORRECTED: Only includes columns that exist in your database
  return {
    // REMOVED: id: fx.key (let database generate UUID with gen_random_uuid())
    ro_match_key: fx.key,
    // REMOVED: external_id (doesn't exist in your table)
    
    // Roanuz identifiers
    ro_series_key: fx.series_key || null,
    ro_season_key: fx.season_key || null,
    
    // Match info
    sport: "cricket",
    ro_competition_name: fx.tournament?.name ?? "Unknown League",
    ro_competition_type: fx.format?.toLowerCase().includes("t20") ? "t20" :
                        fx.format?.toLowerCase().includes("odi") ? "odi" :
                        fx.format?.toLowerCase().includes("test") ? "test" : "cricket",
    
    // Teams with Roanuz keys
    ro_team_home_key: fx.teams?.a?.key || null,
    ro_team_home_name: fx.teams?.a?.name ?? "Team A",
    ro_team_away_key: fx.teams?.b?.key || null,
    ro_team_away_name: fx.teams?.b?.name ?? "Team B",
    
    // Banners (optional)
    home_team_banner: bannerFor(fx.teams?.a?.name),
    away_team_banner: bannerFor(fx.teams?.b?.name),
    
    // Timing
    ro_start_time: fx.start_at ? new Date(fx.start_at * 1000).toISOString() : null,
    // REMOVED: start_time (doesn't exist in your table)
    
    // Status
    ro_status: fx.status || "not_started",
    display_status: displayStatus,
    // REMOVED: status (doesn't exist in your table)
    
    // Venue
    ro_venue_name: fx.venue?.name ?? null,
    ro_venue_city: fx.venue?.city ?? null,
    // REMOVED: venue (doesn't exist in your table)
    
    // REMOVED: match_type (doesn't exist in your table)
    
    // Initialize score fields
    ro_score_runs: 0,
    ro_score_wickets: 0,
    ro_score_overs: 0,
    ro_current_inning: 1,
    
    // Raw Roanuz data
    ro_last_payload: {
      fixture: {
        key: fx.key,
        name: fx.name,
        status: fx.status,
        tournament: fx.tournament,
        teams: fx.teams,
        venue: fx.venue,
        format: fx.format
      }
    },
    
    // REMOVED: metadata (doesn't exist in your table)
    
    // System fields
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

async function createMatchWinnerMarket(matchId: string, teams: any) {
  const { data: existingMarket } = await supabase
    .from("markets")
    .select("id")
    .eq("match_id", matchId)
    .eq("market_name", "Match Winner")
    .maybeSingle();

  if (!existingMarket) {
    const { data: market, error: marketError } = await supabase
      .from("markets")
      .insert({
        match_id: matchId,
        market_type: "pre_match",
        market_name: "Match Winner",
        odds_source: "roanuz",
        market_status: "OPEN",
        open_time: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (marketError || !market) {
      console.error("Failed to create market:", marketError);
      return;
    }

    // Create runners
    const runners: Array<{
      market_id: string;
      runner_name: string;
      ro_team_key: string | null;
      back_odds: number;
      lay_odds: number;
      metadata: Record<string, any>;
    }> = [];
    
    if (teams?.a) {
      runners.push({
        market_id: market.id,
        runner_name: teams.a.name || "Home",
        ro_team_key: teams.a.key,
        back_odds: 1.85,
        lay_odds: 1.95,
        metadata: { is_home: true }
      });
    }
    
    if (teams?.b) {
      runners.push({
        market_id: market.id,
        runner_name: teams.b.name || "Away",
        ro_team_key: teams.b.key,
        back_odds: 1.85,
        lay_odds: 1.95,
        metadata: { is_away: true }
      });
    }
    
    if (runners.length > 0) {
      await supabase.from("market_runners").insert(runners);
    }
  }
}

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const url = new URL(req.url);
    const month = url.searchParams.get("month") || undefined;

    // Get token
    const token = await getToken();
    
    // Fetch fixtures
    const data = await fetchFixtures(token, month);
    const fixtures = flattenFixtures(data);

    console.log(`[roanuz-fixtures] Found ${fixtures.length} fixtures`);

    // Map to new schema
    const rows = fixtures.map(mapFixtureToRow);

    // Upsert matches with CORRECTED schema
    const { data: upserted, error: upsertErr } = await supabase
      .from("matches")
      .upsert(rows, { 
        onConflict: "ro_match_key",
        ignoreDuplicates: false
      })
      .select("*");

    if (upsertErr) {
      throw new ApiError(`Failed to upsert matches: ${upsertErr.message}`, 500);
    }

    // Create markets for each match
    let marketsCreated = 0;
    if (upserted) {
      for (const match of upserted) {
        try {
          await createMatchWinnerMarket(match.id, {
            a: { key: match.ro_team_home_key, name: match.ro_team_home_name },
            b: { key: match.ro_team_away_key, name: match.ro_team_away_name }
          });
          marketsCreated++;
        } catch (error) {
          console.warn(`Failed to create market for match ${match.id}:`, error);
        }
      }
    }

    return success({
      success: true,
      matches_imported: upserted?.length || 0,
      markets_created: marketsCreated,
      message: `Successfully imported ${upserted?.length || 0} matches with new Roanuz schema`,
      sample: upserted?.slice(0, 3) || []
    });
  } catch (err) {
    if (err instanceof ApiError) {
      return error(err.message, err.status);
    }
    console.error("[roanuz-fixtures] unexpected error:", err);
    return error("Internal server error", 500);
  }
});