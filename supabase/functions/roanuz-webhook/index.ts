import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { handlePreflight, success, error } from "../_shared/utils.ts";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") || "";
const ROANUZ_WEBHOOK_SECRET = Deno.env.get("ROANUZ_WEBHOOK_SECRET") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

function extractSignature(req: Request): string {
  const headers = [
    "cricketapi-secret-key",
    "x-webhook-secret",
    "x-roanuz-secret",
    "x-signature",
  ];
  
  for (const header of headers) {
    const value = req.headers.get(header);
    if (value) return value;
  }
  
  // Check URL params as fallback
  const url = new URL(req.url);
  return url.searchParams.get("secret") || url.searchParams.get("auth") || "";
}

async function parseRoanuzBody(req: Request): Promise<any> {
  const encoding = req.headers.get("content-encoding") || "";
  const raw = await req.arrayBuffer();
  
  // Handle gzip compression
  if (encoding.includes("gzip") || 
      (raw.byteLength >= 2 && 
       new Uint8Array(raw)[0] === 0x1f && 
       new Uint8Array(raw)[1] === 0x8b)) {
    try {
      const stream = new Response(raw).body?.pipeThrough(
        new DecompressionStream("gzip")
      );
      const decompressed = await new Response(stream).arrayBuffer();
      const text = new TextDecoder().decode(decompressed);
      return JSON.parse(text);
    } catch (e) {
      console.error("Failed to decompress gzip:", e);
      throw new Error("Invalid gzip payload");
    }
  }
  
  // Parse regular JSON
  try {
    const text = new TextDecoder().decode(raw);
    return JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse JSON:", e);
    throw new Error("Invalid JSON payload");
  }
}

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    // Only accept POST requests
    if (req.method !== "POST") {
      return error("Method not allowed", 405);
    }
    
    // Verify webhook secret
    if (!ROANUZ_WEBHOOK_SECRET) {
      return error("Server missing ROANUZ_WEBHOOK_SECRET", 500);
    }
    
    const signature = extractSignature(req);
    if (signature !== ROANUZ_WEBHOOK_SECRET) {
      return error("Unauthorized", 401);
    }
    
    // Parse request body
    const body = await parseRoanuzBody(req);
    if (!body || typeof body !== "object") {
      console.warn("Non-object payload received:", body);
      return success({ forwarded: false, reason: "invalid_payload" });
    }
    
    // Log received payload (for debugging)
    console.log("[roanuz-webhook] Received payload:", JSON.stringify(body).slice(0, 500));
    
    // Forward to cricket-engine
    const engineUrl = `${SUPABASE_URL}/functions/v1/cricket-engine`;
    const response = await fetch(engineUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "X-Trigger-Source": "roanuz-webhook",
        ...(CRON_SECRET ? { "X-Cron-Secret": CRON_SECRET } : {}),
      },
      body: JSON.stringify(body),
    });
    
    const responseText = await response.text();
    
    if (!response.ok) {
      console.error("[roanuz-webhook] Engine failed:", response.status, responseText);
      return error(`Engine failed: ${response.status}`, response.status);
    }
    
    // Parse engine response
    let engineResponse: any;
    try {
      engineResponse = JSON.parse(responseText);
    } catch {
      engineResponse = responseText;
    }
    
    return success({
      forwarded: true,
      engine_response: engineResponse,
    });
    
  } catch (err: any) {
    console.error("[roanuz-webhook] error:", err);
    return error(err?.message || "Internal server error", 500);
  }
});