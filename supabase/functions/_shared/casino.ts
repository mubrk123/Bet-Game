import { ApiError, supabase } from "./utils.ts";

export type GameSlug =
  | "slots"
  | "crash"
  | "dice"
  | "andar_bahar"
  | "teen_patti"
  | "lucky_7"
  | "roulette"
  | "blackjack"
  | "hi_lo"
  | "dragon_tiger"
  | "plinko"
  | "wheel"
  | "mines";

export async function getOrCreateGame(
  slug: GameSlug,
  name: string,
  type: string
) {
  const { data } = await supabase
    .from("casino_games")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (data) return data;

  const { data: created, error } = await supabase
    .from("casino_games")
    .insert({
      name,
      slug,
      type,
      description: `${name} game`,
      min_bet: 1,
      max_bet: 100000,
      house_edge: 0.02,
      is_active: true,
      sort_order: 0,
    })
    .select()
    .single();

  if (error || !created) {
    throw new ApiError(error?.message || "Failed to create casino game");
  }

  return created;
}

export function randomFloat() {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 0xffffffff;
}

export async function hashSeed(seed: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(seed);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function debitUser(
  userId: string,
  amount: number,
  description: string,
  reference_id: string,
  reference_type: string
) {
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("balance, exposure")
    .eq("id", userId)
    .single();

  if (userError || !user) {
    throw new ApiError("User not found", 404);
  }

  if (user.balance < amount) {
    throw new ApiError("Insufficient balance");
  }

  const balance_after = Number((user.balance - amount).toFixed(2));

  const { error: updateError } = await supabase
    .from("users")
    .update({ balance: balance_after })
    .eq("id", userId);

  if (updateError) {
    throw new ApiError(updateError.message);
  }

  await supabase.from("wallet_transactions").insert({
    user_id: userId,
    amount: -amount,
    type: "CASINO_BET",
    description,
    reference_id,
    reference_type,
    balance_before: user.balance,
    balance_after,
  });

  return { balance_before: user.balance, balance_after };
}

export async function creditUser(
  userId: string,
  amount: number,
  description: string,
  reference_id: string,
  reference_type: string
) {
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("balance")
    .eq("id", userId)
    .single();

  if (userError || !user) {
    throw new ApiError("User not found", 404);
  }

  const balance_after = Number((user.balance + amount).toFixed(2));

  const { error: updateError } = await supabase
    .from("users")
    .update({ balance: balance_after })
    .eq("id", userId);

  if (updateError) {
    throw new ApiError(updateError.message);
  }

  await supabase.from("wallet_transactions").insert({
    user_id: userId,
    amount,
    type: amount >= 0 ? "CASINO_WIN" : "CASINO_BET",
    description,
    reference_id,
    reference_type,
    balance_before: user.balance,
    balance_after,
  });

  return { balance_before: user.balance, balance_after };
}
