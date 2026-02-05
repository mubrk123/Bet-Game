#!/usr/bin/env node
import { io } from "socket.io-client";

/**
 * Roanuz WebSocket subscriber -> Supabase ingest endpoint.
 * - Authenticates with Roanuz using ROANUZ_API_KEY / ROANUZ_PROJECT_KEY
 * - Subscribes to all LIVE matches (pulled from fixtures)
 * - For every on_match_update, posts payload to cricket-engine?mode=ingest_roanuz
 */

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY || "";
const CRON_SECRET = process.env.CRON_SECRET || "";

const ROANUZ_PROJECT_KEY =
  process.env.ROANUZ_PROJECT_KEY || "RS_P_2016114787192279052";
const ROANUZ_API_KEY = process.env.ROANUZ_API_KEY || "";

const INTERVAL_MS = Number(process.env.INTERVAL_MS || "4000"); // not used for WS, kept for future
const REFRESH_MATCHES_EVERY_MS = Number(
  process.env.REFRESH_MATCHES_EVERY_MS || "10000",
);

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ROANUZ_API_KEY) {
  console.error(
    "[runner] Missing SUPABASE_URL / SERVICE_ROLE_KEY / ROANUZ_API_KEY",
  );
  process.exit(1);
}

const INGEST_URL =
  `${SUPABASE_URL}/functions/v1/cricket-engine?mode=ingest_roanuz`;

let rsToken = "";
let rsTokenExpires = 0;

async function fetchRoanuzToken() {
  const resp = await fetch(
    `https://api.sports.roanuz.com/v5/core/${ROANUZ_PROJECT_KEY}/auth/`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: ROANUZ_API_KEY }),
    },
  );
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || !json?.data?.token) {
    throw new Error(
      `Roanuz auth failed ${resp.status}: ${json?.error?.msg || "unknown"}`,
    );
  }
  rsToken = json.data.token;
  rsTokenExpires = Math.floor(json.data.expires || 0) * 1000;
  console.log("[runner] got rs-token, expires", new Date(rsTokenExpires).toISOString());
}

async function ensureToken() {
  const soon = Date.now() + 5 * 60 * 1000;
  if (!rsToken || rsTokenExpires < soon) {
    await fetchRoanuzToken();
  }
}

async function fetchLiveMatchKeys() {
  await ensureToken();
  const url =
    `https://api.sports.roanuz.com/v5/cricket/${ROANUZ_PROJECT_KEY}/fixtures/`;
  const resp = await fetch(url, { headers: { "rs-token": rsToken } });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`fixtures failed ${resp.status}`);

  const liveStatuses = new Set(["live", "started", "in_play", "innings_break"]);
  const out = [];
  const days = json?.data?.month?.days || [];
  for (const d of days) {
    for (const m of d.matches || []) {
      if (liveStatuses.has(String(m.status || "").toLowerCase())) {
        out.push(m.key);
      }
    }
  }
  return out;
}

async function postIngest(matchKey, payload) {
  // Fetch live odds; fallback to pre-match if unavailable
  let odds = null;
  try {
    await ensureToken();
    let res = await fetch(
      `https://api.sports.roanuz.com/v5/cricket/${ROANUZ_PROJECT_KEY}/match/${matchKey}/live-match-odds/`,
      { headers: { "rs-token": rsToken } },
    );
    if (res.status === 404) {
      res = await fetch(
        `https://api.sports.roanuz.com/v5/cricket/${ROANUZ_PROJECT_KEY}/match/${matchKey}/pre-match-odds/`,
        { headers: { "rs-token": rsToken } },
      );
    }
    const json = await res.json().catch(() => null);
    if (json?.data) odds = json.data;
  } catch (e) {
    console.warn("[runner] odds fetch failed", matchKey, e.message);
  }

  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "x-cron-secret": CRON_SECRET,
    },
    body: JSON.stringify({
      matchKey,
      match: payload,
      odds,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    console.warn("[runner] ingest failed", matchKey, res.status, txt.slice(0, 200));
  }
}

const activeMatches = new Set();
let socket = null;

async function subscribeMatches(matchKeys) {
  if (!socket || !socket.connected) return;
  for (const key of matchKeys) {
    if (activeMatches.has(key)) continue;
    socket.emit("connect_to_match", { token: rsToken, match_key: key });
    activeMatches.add(key);
    console.log("[runner] subscribed", key);
  }
}

function setupSocket() {
  socket = io("https://socket.sports.roanuz.com", {
    path: "/v5/websocket",
    transports: ["websocket"],
  });

  socket.on("connect", () => {
    console.log("[runner] socket connected");
  });

  socket.on("disconnect", (reason) => {
    console.warn("[runner] socket disconnected", reason);
    activeMatches.clear();
  });

  socket.on("connect_error", (err) => {
    console.warn("[runner] socket error", err.message);
  });

  socket.on("on_match_update", async (payload) => {
    // payload is already JSON for v5 socket
    const matchKey = payload?.key || payload?.match_key;
    if (!matchKey) return;
    await postIngest(matchKey, payload);

    const status = String(payload?.status || "").toLowerCase();
    if (["completed", "result", "closed"].includes(status)) {
      activeMatches.delete(matchKey);
    }
  });
}

async function main() {
  await ensureToken();
  setupSocket();

  // immediate subscribe
  try {
    const keys = await fetchLiveMatchKeys();
    await subscribeMatches(keys);
    console.log("[runner] live matches", keys.length);
  } catch (e) {
    console.warn("[runner] initial refresh error", e.message);
  }

  // initial subscribe loop
  setInterval(async () => {
    try {
      const keys = await fetchLiveMatchKeys();
      await subscribeMatches(keys);
      console.log("[runner] live matches", keys.length);
    } catch (e) {
      console.warn("[runner] refresh loop error", e.message);
    }
  }, REFRESH_MATCHES_EVERY_MS);
}

main().catch((e) => {
  console.error("[runner] fatal", e);
  process.exit(1);
});
