import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function requireEnv(name: string): string {
  const val = Deno.env.get(name);
  if (!val) throw new Error(`Missing env var ${name}`);
  return val;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const USERNAME = requireEnv("USERNAME"); // e.g. superadmin
const PASSWORD = requireEnv("PASSWORD"); // strong password
const CURRENCY = Deno.env.get("CURRENCY") ?? "INR";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function main() {
  const email = `${USERNAME}@local.user`;

  // 1) Auth user
  const { data: auth, error: authErr } = await supabase.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { username: USERNAME },
  });
  if (authErr || !auth?.user) {
    throw new Error(`Auth create failed: ${authErr?.message}`);
  }

  // 2) App user row
  const { error: dbErr } = await supabase.from("users").insert({
    id: auth.user.id,
    username: USERNAME,
    email,
    password_hash: "supabase_auth",
    role: "SUPER_ADMIN",
    balance: 0,
    exposure: 0,
    currency: CURRENCY,
    created_by: null,
  });
  if (dbErr) {
    // rollback auth user to avoid orphan
    await supabase.auth.admin.deleteUser(auth.user.id);
    throw new Error(`DB insert failed: ${dbErr.message}`);
  }

  console.log("SUPER_ADMIN created", {
    id: auth.user.id,
    username: USERNAME,
    email,
    currency: CURRENCY,
  });
}

main().catch((err) => {
  console.error(err);
  Deno.exit(1);
});
