// import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// export const corsHeaders = {
//   "Access-Control-Allow-Origin": "*",
//   "Access-Control-Allow-Headers":
//     "authorization, x-client-info, apikey, content-type",
//   "Access-Control-Allow-Methods": "*",
// };

// const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
// const DEV_BYPASS = Deno.env.get("DEV_SUPABASE_BYPASS_AUTH") === "true";

// export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
//   auth: {
//     persistSession: false,
//     autoRefreshToken: false,
//   },
// });

// export function handlePreflight(req: Request) {
//   if (req.method === "OPTIONS") {
//     return new Response("ok", { headers: corsHeaders });
//   }
//   return null;
// }

// export class ApiError extends Error {
//   status: number;

//   constructor(message: string, status = 400) {
//     super(message);
//     this.status = status;
//   }
// }

// export function error(message: string, status = 400) {
//   return new Response(JSON.stringify({ success: false, error: message }), {
//     status,
//     headers: {
//       "Content-Type": "application/json",
//       ...corsHeaders,
//     },
//   });
// }

// export function success(data: any) {
//   return new Response(JSON.stringify({ success: true, data }), {
//     headers: {
//       "Content-Type": "application/json",
//       ...corsHeaders,
//     },
//   });
// }

// function getAuthToken(req: Request) {
//   const authHeader = req.headers.get("Authorization") || "";
//   if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
//   return authHeader.replace(/bearer\s+/i, "").trim();
// }

// export function createSupabaseForRequest(req: Request) {
//   const token = getAuthToken(req);
//   const apiKeyHeader =
//     req.headers.get("apikey") || SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY;

//   return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
//     global: {
//       headers: {
//         ...(token ? { Authorization: `Bearer ${token}` } : {}),
//         apikey: apiKeyHeader,
//       },
//     },
//     auth: {
//       persistSession: false,
//       autoRefreshToken: false,
//     },
//   });
// }

// export async function requireUser(
//   req: Request,
//   roles?: Array<"USER" | "ADMIN" | "AGENT" | "SUPER_ADMIN">
// ) {
//   if (DEV_BYPASS) {
//     const fakeUserId = "dev-superadmin";
//     const userRow = {
//       id: fakeUserId,
//       username: "dev-superadmin",
//       role: "SUPER_ADMIN" as const,
//       balance: 0,
//       exposure: 0,
//       currency: "INR",
//       created_by: null,
//     };

//     const authUser = {
//       id: fakeUserId,
//       email: "dev-superadmin@local.user",
//     };

//     return { authUser, userRow };
//   }

//   const token = getAuthToken(req);
//   if (!token) {
//     throw new ApiError("Unauthorized", 401);
//   }

//   const {
//     data: { user },
//     error: authError,
//   } = await supabase.auth.getUser(token);

//   if (authError || !user) {
//     throw new ApiError("Unauthorized", 401);
//   }

//   const { data: userRow, error: fetchError } = await supabase
//     .from("users")
//     .select("id, username, role, balance, exposure, currency, created_by")
//     .eq("id", user.id)
//     .single();

//   if (fetchError || !userRow) {
//     throw new ApiError("User not found", 404);
//   }

//   if (roles?.length && !roles.includes(userRow.role)) {
//     throw new ApiError("Forbidden", 403);
//   }

//   return { authUser: user, userRow };
// }

// export function parseAmount(input: unknown) {
//   const value = Number(input);
//   if (!Number.isFinite(value) || value <= 0) {
//     throw new ApiError("Invalid amount");
//   }
//   return Number(value.toFixed(2));
// }

// export async function ensureUsernameAvailable(username: string) {
//   const { data } = await supabase
//     .from("users")
//     .select("id")
//     .eq("username", username)
//     .maybeSingle();

//   if (data) {
//     throw new ApiError("Username already exists");
//   }
// }

// export async function createAuthUser(username: string, password: string) {
//   const email = `${username}@local.user`;
//   const { data, error: createError } = await supabase.auth.admin.createUser({
//     email,
//     password,
//     email_confirm: true,
//     user_metadata: { username },
//   });

//   if (createError || !data.user) {
//     throw new ApiError(createError?.message || "Failed to create auth user");
//   }

//   return { authUser: data.user, email };
// }

// export async function removeAuthUser(userId: string) {
//   await supabase.auth.admin.deleteUser(userId);
// }

// export async function fetchManagedUser<T extends string = string>(
//   userId: string,
//   requester: {
//     id: string;
//     role: "USER" | "ADMIN" | "AGENT" | "SUPER_ADMIN";
//   },
//   columns: T =
//     "id, username, role, balance, exposure, currency, created_by" as T
// ): Promise<Record<string, any>> {
//   const { data, error } = await supabase
//     .from("users")
//     .select(columns)
//     .eq("id", userId)
//     .single();

//   if (error || !data) {
//     throw new ApiError("User not found", 404);
//   }

//   if (requester.role === "ADMIN" && data.created_by !== requester.id) {
//     throw new ApiError("Forbidden", 403);
//   }

//   return data;
// }

import { createClient } from "npm:@supabase/supabase-js@2.92.0";


// ---------- CORS ----------

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "*",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const DEV_BYPASS = Deno.env.get("DEV_SUPABASE_BYPASS_AUTH") === "true";

console.log("[utils] loaded", {
  SUPABASE_URL,
  HAS_SERVICE_ROLE: !!SUPABASE_SERVICE_ROLE_KEY,
  HAS_ANON: !!SUPABASE_ANON_KEY,
  DEV_BYPASS,
});

// Admin client (service role) – DB + auth.admin
export const adminSupabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);
// Backwards-compatible alias used across functions
export const supabase = adminSupabase;

export function handlePreflight(req: Request) {
  if (req.method === "OPTIONS") {
    console.log("[handlePreflight] OPTIONS", {
      origin: req.headers.get("origin"),
      acrh: req.headers.get("access-control-request-headers"),
      acrm: req.headers.get("access-control-request-method"),
    });

    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }
  return null;
}

// ---------- Error helpers ----------

export class ApiError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function error(message: string, status = 400) {
  console.error("[error response]", { message, status });
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

export function success(data: any) {
  return new Response(JSON.stringify({ success: true, data }), {
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

// ---------- Auth helpers ----------

function getAuthHeader(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
  return authHeader;
}

/**
 * Allow service role calls (e.g., scheduled invocations) to bypass user auth.
 * Checks both Authorization bearer and apikey headers for the service role key.
 */

export function isServiceRoleRequest(req: Request) {
  const bearer = getAuthHeader(req);
  const token = bearer ? bearer.replace(/bearer\s+/i, "").trim() : "";
  const apiKey = req.headers.get("apikey") || "";
  const serviceHeader =
    req.headers.get("x-service-role-key") ||
    req.headers.get("x-service-role") ||
    "";
  const cronSecret = Deno.env.get("CRON_SECRET") || "";
  const cronHeader =
    req.headers.get("x-cron-secret") ||
    req.headers.get("x-cron-key") ||
    req.headers.get("x-job-secret") ||
    "";

  const serviceMatch =
    !!SUPABASE_SERVICE_ROLE_KEY &&
    (token === SUPABASE_SERVICE_ROLE_KEY ||
      apiKey === SUPABASE_SERVICE_ROLE_KEY ||
      serviceHeader === SUPABASE_SERVICE_ROLE_KEY);

  const cronMatch = !!cronSecret && cronHeader === cronSecret;

  return serviceMatch || cronMatch;
}

/**
 * Client that uses ANON key and forwards Authorization header.
 * This is what we use for auth.getUser().
 */
function createAuthClient(req: Request) {
  const authHeader = getAuthHeader(req);

  console.log("[createAuthClient]", {
    hasAuthHeader: !!authHeader,
  });

  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function requireUser(
  req: Request,
  roles?: Array<"USER" | "ADMIN" | "AGENT" | "SUPER_ADMIN">
) {
  console.log("[requireUser] start", {
    DEV_BYPASS,
    rolesRequested: roles,
    method: req.method,
    path: new URL(req.url).pathname,
  });

  // DEV BYPASS (optional, controlled by project config var)
  if (DEV_BYPASS) {
    console.log("[requireUser] DEV_BYPASS active – returning fake SUPER_ADMIN");
    const fakeUserId = "dev-superadmin";

    const userRow = {
      id: fakeUserId,
      username: "dev-superadmin",
      role: "SUPER_ADMIN" as const,
      balance: 0,
      exposure: 0,
      currency: "INR",
      created_by: null,
    };

    const authUser = {
      id: fakeUserId,
      email: "dev-superadmin@local.user",
    };

    return { authUser, userRow };
  }

  const authHeader = getAuthHeader(req);
  if (!authHeader) {
    console.warn("[requireUser] No bearer token in Authorization header");
    throw new ApiError("Unauthorized: missing token", 401);
  }

  const authClient = createAuthClient(req);

  // ✅ Let Supabase Auth use the Authorization header directly
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();

  console.log("[requireUser] auth.getUser result", {
    hasUser: !!user,
    authError: authError ? authError.message : null,
  });

  if (authError || !user) {
    throw new ApiError(
      "Unauthorized: " + (authError?.message ?? "auth failed"),
      401
    );
  }

  // Use admin client for DB (bypasses RLS)
  const { data: userRow, error: userError } = await adminSupabase
    .from("users")
    .select("id, username, role, balance, exposure, currency, created_by")
    .eq("id", user.id)
    .single();

  console.log("[requireUser] DB user row", {
    found: !!userRow,
    userError: userError ? userError.message : null,
  });

  if (userError || !userRow) {
    throw new ApiError("User not found", 404);
  }

  if (roles && !roles.includes(userRow.role)) {
    console.warn("[requireUser] role forbidden", {
      required: roles,
      actual: userRow.role,
    });
    throw new ApiError("Forbidden", 403);
  }

  console.log("[requireUser] success", {
    id: user.id,
    role: userRow.role,
  });

  return { authUser: user, userRow };
}

// ---------- Misc helpers ----------

export function parseAmount(input: unknown) {
  const value = Number(input);
  if (!Number.isFinite(value) || value <= 0) {
    throw new ApiError("Invalid amount");
  }
  return Number(value.toFixed(2));
}

export async function ensureUsernameAvailable(username: string) {
  const { data } = await adminSupabase
    .from("users")
    .select("id")
    .eq("username", username)
    .maybeSingle();

  if (data) {
    throw new ApiError("Username already exists");
  }
}

export async function createAuthUser(username: string, password: string) {
  const email = `${username}@local.user`;
  const { data, error: createError } =
    await adminSupabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username },
    });

  if (createError || !data.user) {
    throw new ApiError(createError?.message || "Failed to create auth user");
  }

  return { authUser: data.user, email };
}

export async function removeAuthUser(userId: string) {
  await adminSupabase.auth.admin.deleteUser(userId);
}

export async function fetchManagedUser<T extends string = string>(
  userId: string,
  requester: {
    id: string;
    role: "USER" | "ADMIN" | "AGENT" | "SUPER_ADMIN";
  },
  columns: T =
    "id, username, role, balance, exposure, currency, created_by" as T
): Promise<Record<string, any>> {
  const { data, error } = await adminSupabase
    .from("users")
    .select(columns)
    .eq("id", userId)
    .single();

  if (error || !data) {
    throw new ApiError("User not found", 404);
  }

  const createdBy = (data as any).created_by;
  if (requester.role === "ADMIN" && createdBy !== requester.id) {
    throw new ApiError("Forbidden", 403);
  }

  return data;
}
