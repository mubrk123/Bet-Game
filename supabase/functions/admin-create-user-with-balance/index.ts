import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  requireUser,
  success,
  error,
  ApiError,
  supabase,
  parseAmount,
  ensureUsernameAvailable,
  createAuthUser,
  removeAuthUser,
  handlePreflight,
} from "../_shared/utils.ts";

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const { userRow } = await requireUser(req, ["ADMIN", "SUPER_ADMIN"]);
    const body = await req.json();

    const username = String(body.username || "").trim();
    const password = String(body.password || "").trim();
    const balance = parseAmount(body.balance ?? 0);

    if (!username || !password) {
      throw new ApiError("Username and password are required");
    }

    await ensureUsernameAvailable(username);

    if (userRow.balance < balance) {
      throw new ApiError("Insufficient balance");
    }

    const { authUser, email } = await createAuthUser(username, password);

    try {
      const { data: newUser, error: insertError } = await supabase
        .from("users")
        .insert({
          id: authUser.id,
          username,
          email,
          password_hash: "supabase_auth",
          role: "USER",
          balance,
          exposure: 0,
          currency: userRow.currency,
          created_by: userRow.id,
        })
        .select()
        .single();

      if (insertError || !newUser) {
        throw new ApiError(insertError?.message || "Failed to create user");
      }

      const newAdminBalance = Number((userRow.balance - balance).toFixed(2));

      const { error: adminUpdateError } = await supabase
        .from("users")
        .update({ balance: newAdminBalance })
        .eq("id", userRow.id);

      if (adminUpdateError) {
        throw new ApiError(adminUpdateError.message);
      }

      await supabase.from("wallet_transactions").insert([
        {
          user_id: userRow.id,
          amount: -balance,
          type: "TRANSFER_OUT",
          description: `Balance distributed to ${username}`,
          reference_id: newUser.id,
          reference_type: "user",
          balance_before: userRow.balance,
          balance_after: newAdminBalance,
        },
        {
          user_id: newUser.id,
          amount: balance,
          type: "TRANSFER_IN",
          description: `Initial balance from ${userRow.username}`,
          reference_id: userRow.id,
          reference_type: "user",
          balance_before: 0,
          balance_after: balance,
        },
      ]);

      return success({ user: newUser });
    } catch (err) {
      await removeAuthUser(authUser.id);
      throw err;
    }
  } catch (err) {
    if (err instanceof ApiError) {
      return error(err.message, err.status);
    }

    console.error("ADMIN CREATE USER ERROR:", err);
    return error("Internal server error", 500);
  }
});
