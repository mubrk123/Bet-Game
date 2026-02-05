#!/usr/bin/env node
/**
 * Auto-subscribe live Roanuz fixtures to webhook delivery.
 *
 * Env:
 *   ROANUZ_API_KEY        (required)
 *   ROANUZ_PROJECT_KEY    (required)
 *   STATUS                (optional, default: "live")
 *
 * Usage:
 *   ROANUZ_API_KEY=... ROANUZ_PROJECT_KEY=... node scripts/roanuz-subscribe-live.js
 *
 * Notes:
 * - Calls /fixtures/?status=<STATUS> and subscribes every returned match.key.
 * - Safe to run repeatedly; duplicate subscribe calls are fine.
 */

const PROJECT = process.env.ROANUZ_PROJECT_KEY;
const API_KEY = process.env.ROANUZ_API_KEY;
const STATUS = process.env.STATUS || "live";

if (!PROJECT || !API_KEY) {
  console.error("Missing ROANUZ_PROJECT_KEY or ROANUZ_API_KEY");
  process.exit(1);
}

async function getToken() {
  const resp = await fetch(
    `https://api.sports.roanuz.com/v5/core/${PROJECT}/auth/`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: API_KEY }),
    },
  );
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || !json?.data?.token) {
    throw new Error(
      `Auth failed ${resp.status}: ${json?.error?.msg || "unknown"}`,
    );
  }
  return json.data.token;
}

async function fetchFixtures(token) {
  const url =
    `https://api.sports.roanuz.com/v5/cricket/${PROJECT}/fixtures/?status=${STATUS}`;
  const resp = await fetch(url, { headers: { "rs-token": token } });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`fixtures ${resp.status}`);
  const days = json?.data?.month?.days || [];
  const keys = [];
  for (const d of days) {
    for (const m of d.matches || []) {
      if (m?.key) keys.push(m.key);
    }
  }
  return Array.from(new Set(keys));
}

async function subscribeMatch(token, matchKey) {
  const resp = await fetch(
    `https://api.sports.roanuz.com/v5/cricket/${PROJECT}/match/subscribe/`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "rs-token": token,
      },
      body: JSON.stringify({ match_key: matchKey }),
    },
  );
  if (resp.status === 200) return { ok: true };
  const txt = await resp.text();
  return { ok: false, status: resp.status, body: txt };
}

async function main() {
  try {
    console.log(`[subscribe] status=${STATUS}`);
    const token = await getToken();
    const fixtures = await fetchFixtures(token);
    console.log(`[subscribe] found ${fixtures.length} fixtures`);

    let ok = 0;
    for (const key of fixtures) {
      const res = await subscribeMatch(token, key);
      if (res.ok) {
        ok++;
        console.log(`[subscribe] subscribed ${key}`);
      } else {
        console.warn(
          `[subscribe] failed ${key} (${res.status || "?"}): ${res.body || ""}`.trim(),
        );
      }
    }
    console.log(`[subscribe] done: ${ok}/${fixtures.length} subscribed`);
  } catch (e) {
    console.error("[subscribe] error", e.message || e);
    process.exit(1);
  }
}

main();
