import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  requireUser,
  success,
  error,
  ApiError,
  supabase,
  ensureUsernameAvailable,
  createAuthUser,
  handlePreflight,
} from "../_shared/utils.ts";

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const { userRow } = await requireUser(req, ["SUPER_ADMIN"]);
    const body = await req.json();

    const username = String(body.username || "").trim();
    const password = String(body.password || "").trim();
    const balance = body.balance ? Number(body.balance) : 0;

    if (!username || !password) {
      throw new ApiError("Username and password are required");
    }

    await ensureUsernameAvailable(username);

    const { authUser, email } = await createAuthUser(username, password);

    const { data: newAdmin, error: insertError } = await supabase
      .from("users")
      .insert({
        id: authUser.id,
        username,
        email,
        password_hash: "supabase_auth",
        role: "ADMIN",
        balance: Number(balance.toFixed(2)),
        exposure: 0,
        currency: userRow.currency,
        created_by: userRow.id,
      })
      .select()
      .single();

    if (insertError || !newAdmin) {
      throw new ApiError(insertError?.message || "Failed to create admin");
    }

    if (balance > 0) {
      await supabase.from("wallet_transactions").insert({
        user_id: newAdmin.id,
        amount: Number(balance.toFixed(2)),
        type: "ADMIN_CREDIT",
        description: `Initial admin balance from ${userRow.username}`,
        reference_id: userRow.id,
        reference_type: "user",
        balance_before: 0,
        balance_after: Number(balance.toFixed(2)),
      });
    }

    return success({ admin: newAdmin });
  } catch (err) {
    if (err instanceof ApiError) {
      return error(err.message, err.status);
    }

    console.error("SUPER ADMIN CREATE ERROR:", err);
    return error("Internal server error", 500);
  }
});
