/**
 * One-off Roanuz odds seeder.
 *
 * Usage:  node scripts/manual-roanuz-odds.js
 *
 * Needs .env at repo root with:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ROANUZ_API_KEY
 *   ROANUZ_PROJECT_KEY
 */

import fs from "fs";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\n/)
    .filter(Boolean)
    .map((line) => line.split(/=(.+)/))
    .map(([k, v]) => [k, v?.replace(/^"|"$/g, "")])
);

const SUPABASE_URL = env.SUPABASE_URL;
const SRK = env.SUPABASE_SERVICE_ROLE_KEY;
const ROANUZ_API_KEY = env.ROANUZ_API_KEY;
const ROANUZ_PROJECT_KEY = env.ROANUZ_PROJECT_KEY;

if (!SUPABASE_URL || !SRK || !ROANUZ_API_KEY || !ROANUZ_PROJECT_KEY) {
  console.error("Missing env vars. Check .env");
  process.exit(1);
}

const headersBase = { apikey: SRK, Authorization: `Bearer ${SRK}` };

async function authRoanuz() {
  const res = await fetch(
    `https://api.sports.roanuz.com/v5/core/${ROANUZ_PROJECT_KEY}/auth/`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: ROANUZ_API_KEY }),
    }
  );
  if (!res.ok) {
    throw new Error(`Roanuz auth failed ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return json?.data?.token;
}

async function fetchMatches() {
  const url = `${SUPABASE_URL}/rest/v1/matches?select=id,home_team,away_team,metadata&sport=eq.cricket&status=in.(UPCOMING,LIVE)`;
  const res = await fetch(url, { headers: headersBase });
  if (!res.ok) {
    throw new Error(`matches fetch ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function fetchMarketId(matchId) {
  const url = `${SUPABASE_URL}/rest/v1/markets?select=id&match_id=eq.${encodeURIComponent(
    matchId
  )}&name=eq.Match%20Winner`;
  const res = await fetch(url, { headers: headersBase });
  const js = await res.json();
  return js?.[0]?.id;
}

async function fetchRunners(marketId) {
  const url = `${SUPABASE_URL}/rest/v1/runners?select=id,name,metadata&market_id=eq.${marketId}`;
  const res = await fetch(url, { headers: headersBase });
  return res.json();
}

async function updateRunner(id, back) {
  const lay = Number((back + 0.08).toFixed(2));
  const res = await fetch(`${SUPABASE_URL}/rest/v1/runners?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      ...headersBase,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ back_odds: back, lay_odds: lay }),
  });
  if (!res.ok) {
    console.error("update fail", id, res.status, await res.text());
  }
}

function oddsMapFromPayload(payload) {
  const arr =
    payload?.match?.bet_odds?.automatic?.decimal ||
    payload?.bet_odds?.automatic?.decimal ||
    [];
  const m = new Map();
  for (const o of arr) {
    const tk = o?.team_key;
    const val = Number(o?.value);
    if (tk && Number.isFinite(val) && val > 1) m.set(String(tk), val);
  }
  return m;
}

async function main() {
  const token = await authRoanuz();
  console.log("Roanuz token ok");

  const matches = await fetchMatches();
  let updated = 0;
  let skipped = 0;

  for (const match of matches) {
    if (!String(match.id).startsWith("a-rz--")) {
      skipped++;
      continue;
    }

    const marketId = await fetchMarketId(match.id);
    if (!marketId) {
      skipped++;
      continue;
    }

    const runners = await fetchRunners(marketId);
    const meta = match.metadata || {};
    const teamAKey = meta?.roanuz?.team_a_key || meta?.roanuz?.teamAKey || null;
    const teamBKey = meta?.roanuz?.team_b_key || meta?.roanuz?.teamBKey || null;

    const resOdds = await fetch(
      `https://api.sports.roanuz.com/v5/cricket/${ROANUZ_PROJECT_KEY}/match/${match.id}/pre-match-odds/`,
      { headers: { "rs-token": token } }
    );
    if (!resOdds.ok) {
      console.error("odds fetch failed", match.id, resOdds.status);
      skipped++;
      continue;
    }

    const payload = await resOdds.json().catch(() => ({}));
    const map = oddsMapFromPayload(payload?.data || payload);
    if (map.size === 0) {
      console.error("no odds map", match.id);
      skipped++;
      continue;
    }

    for (const r of runners) {
      let key = r.metadata?.roanuz_team_key || null;
      if (!key) {
        if (r.name === match.home_team) key = teamAKey;
        else if (r.name === match.away_team) key = teamBKey;
      }
      if (!key) continue;
      const back = map.get(String(key));
      if (back) {
        await updateRunner(r.id, Number(back));
        updated++;
      }
    }
  }

  console.log("Done. runners updated", updated, "skipped", skipped);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
