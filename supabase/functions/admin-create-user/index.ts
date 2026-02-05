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
    const { userRow } = await requireUser(req, ["ADMIN", "SUPER_ADMIN"]);
    const body = await req.json();

    const username = String(body.username || "").trim();
    const password = String(body.password || "").trim();
    const role = body.role || "USER";
    const balance = body.balance ? Number(body.balance) : 0;

    if (!username || !password) {
      throw new ApiError("Username and password are required");
    }

    if (!["USER", "ADMIN", "AGENT"].includes(role)) {
      throw new ApiError("Invalid role");
    }

    if (role === "ADMIN" && userRow.role !== "SUPER_ADMIN") {
      throw new ApiError("Forbidden", 403);
    }

    await ensureUsernameAvailable(username);

    if (userRow.role === "ADMIN" && balance > userRow.balance) {
      throw new ApiError("Insufficient balance");
    }

    const normalizedBalance = Number(balance.toFixed(2));
    const { authUser, email } = await createAuthUser(username, password);

    const { data: newUser, error: insertError } = await supabase
      .from("users")
      .insert({
        id: authUser.id,
        username,
        email,
        password_hash: "supabase_auth",
        role,
        balance: normalizedBalance,
        exposure: 0,
        currency: userRow.currency,
        created_by: userRow.id,
      })
      .select()
      .single();

    if (insertError || !newUser) {
      throw new ApiError(insertError?.message || "Failed to create user");
    }

    if (normalizedBalance > 0) {
      if (userRow.role === "ADMIN") {
        const adminBalanceAfter = Number(
          (userRow.balance - normalizedBalance).toFixed(2)
        );

        await supabase
          .from("users")
          .update({ balance: adminBalanceAfter })
          .eq("id", userRow.id);

        await supabase.from("wallet_transactions").insert([
          {
            user_id: userRow.id,
            amount: -normalizedBalance,
            type: "TRANSFER_OUT",
            description: `Balance distributed to ${username}`,
            reference_id: newUser.id,
            reference_type: "user",
            balance_before: userRow.balance,
            balance_after: adminBalanceAfter,
          },
          {
            user_id: newUser.id,
            amount: normalizedBalance,
            type: "TRANSFER_IN",
            description: `Initial balance from ${userRow.username}`,
            reference_id: userRow.id,
            reference_type: "user",
            balance_before: 0,
            balance_after: normalizedBalance,
          },
        ]);
      } else {
        await supabase.from("wallet_transactions").insert({
          user_id: newUser.id,
          amount: normalizedBalance,
          type: "ADMIN_CREDIT",
          description: `Initial balance from ${userRow.username}`,
          reference_id: userRow.id,
          reference_type: "user",
          balance_before: 0,
          balance_after: normalizedBalance,
        });
      }
    }

    return success({ user: newUser });
  } catch (err) {
    if (err instanceof ApiError) {
      return error(err.message, err.status);
    }

    console.error("ADMIN CREATE USER ERROR:", err);
    return error("Internal server error", 500);
  }
});
