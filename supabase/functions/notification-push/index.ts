import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  handlePreflight,
  success,
  error,
  ApiError,
  isServiceRoleRequest,
  adminSupabase as supabase,
} from "../_shared/utils.ts";

// Use FCM HTTP v1 via service account (no legacy server key).
const SERVICE_ACCOUNT_JSON = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id: string;
};

let tokenCache: { accessToken: string; exp: number } | null = null;

function b64url(input: Uint8Array) {
  return btoa(String.fromCharCode(...input))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp > now + 60) return tokenCache.accessToken;

  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = {
    iss: sa.client_email,
    sub: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 55 * 60,
  };
  const payload = b64url(new TextEncoder().encode(JSON.stringify(claims)));
  const signingInput = `${header}.${payload}`;

  const keyData = sa.private_key.replace(/\\n/g, "\n");
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    new TextEncoder().encode(keyData),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${b64url(new Uint8Array(signature))}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || !json.access_token) {
    throw new ApiError(`OAuth token failed: ${json.error || resp.statusText}`, resp.status);
  }

  tokenCache = { accessToken: json.access_token, exp: now + 55 * 60 };
  return json.access_token;
}

async function sendFcmV1(sa: ServiceAccount, token: string, title: string, body: string, data: any) {
  const accessToken = await getAccessToken(sa);
  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  const payload = {
    message: {
      token,
      notification: { title, body },
      data: data || {},
    },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new ApiError(`FCM v1 failed ${resp.status}: ${text.slice(0, 300)}`, resp.status);
  }
}

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const isService = isServiceRoleRequest(req);
    const hasCron = CRON_SECRET &&
      (req.headers.get("x-cron-secret") === CRON_SECRET ||
        req.headers.get("x-cron-key") === CRON_SECRET);

    if (!isService && !hasCron) {
      throw new ApiError("Forbidden", 403);
    }

    if (!SERVICE_ACCOUNT_JSON) {
      throw new ApiError("FCM_SERVICE_ACCOUNT_JSON missing", 500);
    }
    let sa: ServiceAccount;
    try {
      sa = JSON.parse(SERVICE_ACCOUNT_JSON) as ServiceAccount;
    } catch {
      throw new ApiError("FCM_SERVICE_ACCOUNT_JSON invalid JSON", 500);
    }
    if (!sa.client_email || !sa.private_key || !sa.project_id) {
      throw new ApiError("FCM_SERVICE_ACCOUNT_JSON missing required fields", 500);
    }

    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit") || "50");

    // Fetch pending push notifications
    const { data: pending, error: fetchErr } = await supabase
      .from("user_notifications")
      .select("id, user_id, payload, notification_id")
      .eq("channel", "PUSH")
      .eq("status", "QUEUED")
      .limit(limit > 0 ? limit : 50);

    if (fetchErr) throw new ApiError(fetchErr.message, 500);
    if (!pending?.length) return success({ sent: 0 });

    // Fetch titles/bodies
    const notifIds = Array.from(new Set(pending.map((p) => p.notification_id)));
    const { data: nrows, error: nErr } = await supabase
      .from("match_notifications")
      .select("id, title, body")
      .in("id", notifIds);
    if (nErr) throw new ApiError(nErr.message, 500);
    const lookup: Record<string, { title: string; body: string }> = {};
    nrows?.forEach((n) => (lookup[n.id] = { title: n.title, body: n.body }));

    const results = { sent: 0, failed: 0, errors: [] as string[] };

    for (const row of pending) {
      const token = (row.payload as any)?.token;
      if (!token) {
        await supabase
          .from("user_notifications")
          .update({ status: "FAILED", error: "missing token" })
          .eq("id", row.id);
        results.failed++;
        continue;
      }

      const title = lookup[row.notification_id]?.title || (row.payload as any)?.title || "Match update";
      const body = lookup[row.notification_id]?.body || (row.payload as any)?.body || "";
      const data = { ...(row.payload as any), title, body };

      try {
        await sendFcmV1(sa, token, title, body, data);
        await supabase
          .from("user_notifications")
          .update({ status: "SENT", sent_at: new Date().toISOString() })
          .eq("id", row.id);
        results.sent++;
      } catch (err: any) {
        await supabase
          .from("user_notifications")
          .update({ status: "FAILED", error: err?.message || "push failed" })
          .eq("id", row.id);
        results.failed++;
        results.errors.push(`${row.id}: ${err?.message || err}`.slice(0, 200));
      }
    }

    return success(results);
  } catch (err: any) {
    if (err instanceof ApiError) return error(err.message, err.status);
    return error(err?.message || "Internal server error", 500);
  }
});
