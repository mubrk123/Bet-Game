import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  handlePreflight,
  success,
  error,
  ApiError,
  isServiceRoleRequest,
  requireUser,
} from "../_shared/utils.ts";

const PROJECT = Deno.env.get("ROANUZ_PROJECT_KEY") || "";
const API_KEY = Deno.env.get("ROANUZ_API_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

async function getToken(): Promise<string> {
  if (!API_KEY || !PROJECT) {
    throw new ApiError("Roanuz credentials missing", 500);
  }
  
  const resp = await fetch(
    `https://api.sports.roanuz.com/v5/core/${PROJECT}/auth/`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: API_KEY }),
    }
  );
  
  const json = await resp.json().catch(() => ({}));
  const token = json?.data?.token;
  
  if (!resp.ok || !token) {
    throw new ApiError(
      `Roanuz auth failed: ${json?.error?.msg || resp.statusText}`,
      resp.status
    );
  }
  
  return token;
}

async function fetchMatchKeys(token: string, status: string): Promise<string[]> {
  const url = `https://api.sports.roanuz.com/v5/cricket/${PROJECT}/fixtures/?status=${status}`;
  const resp = await fetch(url, { headers: { "rs-token": token } });
  const json = await resp.json().catch(() => ({}));
  
  if (!resp.ok) {
    throw new ApiError(`Failed to fetch ${status} fixtures`, resp.status);
  }
  
  const keys: string[] = [];
  const days = json?.data?.month?.days || [];
  
  for (const day of days) {
    for (const match of day?.matches || []) {
      if (match?.key) keys.push(String(match.key));
    }
  }
  
  return Array.from(new Set(keys));
}

async function subscribeMatch(token: string, matchKey: string, endpoint: string) {
  const url = `https://api.sports.roanuz.com/v5/cricket/${PROJECT}/match/${matchKey}/${endpoint}/`;
  
  console.log(`Subscribing to ${matchKey} for ${endpoint}`);
  
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "rs-token": token,
    },
    body: JSON.stringify({ method: "web_hook" }),
  });
  
  const text = await resp.text();
  
  // Success or already subscribed
  if (resp.status === 202 || resp.status === 200) {
    return { success: true, already: false };
  }
  
  if (resp.status === 400 && text.includes("already subscribed")) {
    return { success: true, already: true };
  }
  
  return { 
    success: false, 
    status: resp.status, 
    error: text.slice(0, 200) 
  };
}

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    if (!PROJECT || !API_KEY) {
      throw new ApiError("Roanuz credentials not configured", 500);
    }
    
    const isService = isServiceRoleRequest(req);
    const hasCron = CRON_SECRET && 
      (req.headers.get("x-cron-secret") === CRON_SECRET ||
       req.headers.get("x-cron-key") === CRON_SECRET);

    if (!isService && !hasCron) {
      await requireUser(req, ["SUPER_ADMIN"]);
    }
    
    const url = new URL(req.url);
    const statuses = (url.searchParams.get("statuses") || "live,upcoming").split(",");
    const endpoints = (url.searchParams.get("endpoints") || "updates-subscribe,detail-updates-subscribe").split(",");
    const limit = parseInt(url.searchParams.get("limit") || "0");
    
    console.log(`Auto-subscribe: statuses=${statuses}, endpoints=${endpoints}`);
    
    // Get auth token
    const token = await getToken();
    
    // Collect all match keys
    const allKeys = new Set<string>();
    
    for (const status of statuses) {
      try {
        const keys = await fetchMatchKeys(token, status.trim());
        console.log(`Status "${status}" found ${keys.length} matches`);
        keys.forEach(key => allKeys.add(key));
      } catch (err) {
        console.warn(`Failed to fetch status "${status}":`, err.message);
      }
    }
    
    const keysArray = Array.from(allKeys);
    if (limit > 0 && keysArray.length > limit) {
      keysArray.length = limit;
    }
    
    console.log(`Subscribing to ${keysArray.length} matches`);
    
    // Subscribe to each match
    const results = {
      total: keysArray.length,
      successful: 0,
      already_subscribed: 0,
      failed: 0,
      failures: [] as Array<{ match: string; endpoint: string; error: string }>,
    };
    
    for (const matchKey of keysArray) {
      for (const endpoint of endpoints) {
        try {
          const result = await subscribeMatch(token, matchKey, endpoint.trim());
          
          if (result.success) {
            results.successful++;
            if (result.already) results.already_subscribed++;
          } else {
            results.failed++;
            results.failures.push({
              match: matchKey,
              endpoint: endpoint.trim(),
              error: result.error || `HTTP ${result.status}`,
            });
          }
          
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (err: any) {
          results.failed++;
          results.failures.push({
            match: matchKey,
            endpoint: endpoint.trim(),
            error: err.message,
          });
        }
      }
    }
    
    return success(results);
    
  } catch (err: any) {
    console.error("[roanuz-auto-subscribe] error:", err);
    if (err instanceof ApiError) {
      return error(err.message, err.status);
    }
    return error(err.message || "Internal server error", 500);
  }
});