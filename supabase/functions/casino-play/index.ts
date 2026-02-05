import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireUser, success, error, ApiError, parseAmount, handlePreflight } from "../_shared/utils.ts";
import { supabase } from "../_shared/utils.ts";
import {
  GameSlug,
  getOrCreateGame,
  debitUser,
  creditUser,
  randomFloat,
  hashSeed,
} from "../_shared/casino.ts";

interface PlayPayload {
  game: GameSlug;
  betAmount: number;
  clientSeed?: string;
  // game-specific fields
  crashCashout?: number;
  dicePrediction?: "high" | "low";
  diceTarget?: number;
  andarBaharChoice?: "andar" | "bahar";
  teenPattiChoice?: "player" | "dealer" | "tie";
  lucky7Bet?: "low" | "seven" | "high";
  rouletteBetType?: string;
  rouletteBetValue?: string;
  hiLoGuess?: "higher" | "lower";
  dragonTigerBet?: "dragon" | "tiger" | "tie";
  plinkoRisk?: "low" | "medium" | "high";
  plinkoRows?: number;
  minesCount?: number;
  minesTilesToReveal?: number;
}

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const { userRow } = await requireUser(req);
    const body = (await req.json()) as PlayPayload;

    const betAmount = parseAmount(body.betAmount);
    const clientSeed = body.clientSeed || crypto.randomUUID();
    const serverSeed = crypto.randomUUID();
    const serverSeedHash = await hashSeed(serverSeed);

    // Ensure game exists
    const game = await getOrCreateGame(body.game, body.game, body.game);

    // Debit user upfront
    const { balance_after: balanceAfterDebit } = await debitUser(
      userRow.id,
      betAmount,
      `${body.game} wager`,
      game.id,
      "casino_game"
    );
    let balanceAfterCredit: number | null = null;

    // Dispatch to specific game
    const result = await playGame(body, betAmount, clientSeed, serverSeed);

    // Credit if win
    if (result.payout > 0) {
      const credit = await creditUser(
        userRow.id,
        result.payout,
        `${body.game} win`,
        game.id,
        "casino_game"
      );
      balanceAfterCredit = credit.balance_after;
    }

    // Record round + bet
    const { data: round } = await supabase
      .from("casino_rounds")
      .insert({
        game_id: game.id,
        server_seed: serverSeed,
        server_seed_hash: serverSeedHash,
        client_seed: clientSeed,
        nonce: 0,
        result: result.result,
        multiplier: result.multiplier,
        status: "COMPLETED",
        completed_at: new Date().toISOString(),
      })
      .select()
      .single();

    await supabase.from("casino_bets").insert({
      user_id: userRow.id,
      round_id: round.id,
      game_id: game.id,
      bet_amount: betAmount,
      bet_choice: result.choice ?? null,
      payout: result.payout,
      profit: Number((result.payout - betAmount).toFixed(2)),
      is_win: result.payout > 0,
    });

    const finalBalance =
      typeof balanceAfterCredit === "number" ? balanceAfterCredit : balanceAfterDebit;

    return success({
      ...result,
      roundId: round.id,
      serverSeedHash,
      clientSeed,
      newBalance: finalBalance,
    });
  } catch (err) {
    if (err instanceof ApiError) {
      return error(err.message, err.status);
    }
    console.error("CASINO PLAY ERROR:", err);
    return error("Internal server error", 500);
  }
});

async function playGame(
  body: PlayPayload,
  betAmount: number,
  clientSeed: string,
  serverSeed: string
) {
  switch (body.game) {
    case "slots":
      return playSlots(betAmount, clientSeed, serverSeed);
    case "crash":
      return playCrash(betAmount, body.crashCashout ?? 1.5, clientSeed, serverSeed);
    case "dice":
      return playDice(
        betAmount,
        body.dicePrediction || "high",
        body.diceTarget ?? 50,
        clientSeed,
        serverSeed
      );
    case "andar_bahar":
      return playAndarBahar(betAmount, body.andarBaharChoice || "andar", clientSeed, serverSeed);
    case "teen_patti":
      return playTeenPatti(betAmount, clientSeed, serverSeed);
    case "lucky_7":
      return playLucky7(betAmount, body.lucky7Bet || "low", clientSeed, serverSeed);
    case "roulette":
      return playRoulette(
        betAmount,
        body.rouletteBetType || "straight",
        body.rouletteBetValue || "0",
        clientSeed,
        serverSeed
      );
    case "blackjack":
      return playBlackjack(betAmount, clientSeed, serverSeed);
    case "hi_lo":
      return playHiLo(betAmount, body.hiLoGuess || "higher", clientSeed, serverSeed);
    case "dragon_tiger":
      return playDragonTiger(betAmount, body.dragonTigerBet || "dragon", clientSeed, serverSeed);
    case "plinko":
      return playPlinko(betAmount, body.plinkoRisk || "medium", body.plinkoRows || 16, clientSeed, serverSeed);
    case "wheel":
      return playWheel(betAmount, clientSeed, serverSeed);
    case "mines":
      return playMines(
        betAmount,
        body.minesCount || 5,
        body.minesTilesToReveal || 3,
        clientSeed,
        serverSeed
      );
    default:
      throw new ApiError("Unsupported game");
  }
}

// --- Game Implementations (simplified, provably fair style using serverSeed + clientSeed + nonce as RNG) ---

function prng(serverSeed: string, clientSeed: string, nonce: number) {
  const data = new TextEncoder().encode(`${serverSeed}:${clientSeed}:${nonce}`);
  return crypto.subtle.digest("SHA-256", data).then((buf) => {
    const hex = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    // take first 52 bits for float
    const int = parseInt(hex.slice(0, 13), 16);
    return int / 0x1_0000_0000_0000;
  });
}

async function playSlots(bet: number, clientSeed: string, serverSeed: string) {
  const reels = 5;
  const symbolsPerReel = 3;
  const multiplierTable = [0, 0.5, 1, 2, 5, 10];

  const symbols: number[][] = [];
  let hits = 0;
  for (let r = 0; r < reels; r++) {
    const row: number[] = [];
    for (let s = 0; s < symbolsPerReel; s++) {
      const roll = await prng(serverSeed, clientSeed, r * symbolsPerReel + s);
      const symbol = Math.floor(roll * multiplierTable.length);
      row.push(symbol);
      if (symbol === 5) hits++;
    }
    symbols.push(row);
  }

  const multiplier = hits >= 2 ? multiplierTable[5] : hits === 1 ? multiplierTable[3] : 0;
  const payout = Number((bet * multiplier).toFixed(2));

  return {
    result: { reels: symbols, symbols, multiplier, isWin: payout > 0 },
    multiplier,
    payout,
    profit: Number((payout - bet).toFixed(2)),
  };
}

// async function playCrash(
//   bet: number,
//   cashoutMultiplier: number,
//   clientSeed: string,
//   serverSeed: string
// ) {
//   const roll = await prng(serverSeed, clientSeed, 0);
//   const crashPoint = Math.max(1.01, Number((1 / (1 - roll)).toFixed(2)));
//   const isWin = cashoutMultiplier <= crashPoint;
//   const payout = isWin ? Number((bet * cashoutMultiplier).toFixed(2)) : 0;

//   return {
//     result: { crashPoint, cashoutMultiplier, isWin },
//     multiplier: isWin ? cashoutMultiplier : 0,
//     payout,
//     profit: Number((payout - bet).toFixed(2)),
//   };
// }

async function playCrash(
  bet: number,
  cashoutMultiplier: number,
  clientSeed: string,
  serverSeed: string
) {
  // Realistic crash point algorithm (same as popular crash games like Stake, Roobet)
  const roll = await prng(serverSeed, clientSeed, 0);
  
  // Convert to a value between 0 and 1
  const normalizedRoll = roll;
  
  // Standard crash game formula: crash point = max(1, e - h * r)
  // Where e is the house edge (0.99), h is a scaling factor, r is random
  // This creates a fair distribution with occasional high multipliers
  const houseEdge = 0.99;
  const maxMultiplier = 1000; // Maximum possible multiplier
  const crashPoint = Math.max(1.01, houseEdge / (1 - normalizedRoll));
  
  // Cap at maximum multiplier
  const cappedCrashPoint = Math.min(crashPoint, maxMultiplier);
  
  // Round to 2 decimal places
  const finalCrashPoint = Math.round(cappedCrashPoint * 100) / 100;
  
  const isWin = cashoutMultiplier <= finalCrashPoint;
  const payout = isWin ? Number((bet * cashoutMultiplier).toFixed(2)) : 0;

  return {
    result: { crashPoint: finalCrashPoint, cashoutMultiplier, isWin },
    multiplier: isWin ? cashoutMultiplier : 0,
    payout,
    profit: Number((payout - bet).toFixed(2)),
  };
}
async function playDice(
  bet: number,
  prediction: "high" | "low",
  target: number,
  clientSeed: string,
  serverSeed: string
) {
  const roll = await prng(serverSeed, clientSeed, 0);
  const diceRoll = Math.floor(roll * 100) + 1; // 1-100
  const isWin = prediction === "high" ? diceRoll > target : diceRoll < target;
  const multiplier = Number((100 / Math.max(1, prediction === "high" ? 100 - target : target)).toFixed(2));
  const payout = isWin ? Number((bet * multiplier).toFixed(2)) : 0;

  return {
    result: { roll: diceRoll, prediction, target, isWin, multiplier },
    multiplier: isWin ? multiplier : 0,
    payout,
    profit: Number((payout - bet).toFixed(2)),
  };
}

async function playAndarBahar(
  bet: number,
  choice: "andar" | "bahar",
  clientSeed: string,
  serverSeed: string
) {
  const normalizedChoice: "andar" | "bahar" = choice === "bahar" ? "bahar" : "andar";
  const multiplier = 1.9;
  const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const suits = ["S", "H", "D", "C"];

  const baseDeck: string[] = [];
  for (const r of ranks) {
    for (const s of suits) {
      baseDeck.push(`${r}${s}`);
    }
  }

  // Deterministic RNG tied to seeds + nonce
  let nonce = 0;
  const rng = async () => {
    const roll = await prng(serverSeed, clientSeed, nonce);
    nonce += 1;
    return roll;
  };

  // Fisher-Yates shuffle using deterministic RNG
  const deck = [...baseDeck];
  for (let i = deck.length - 1; i > 0; i--) {
    const roll = await rng();
    const j = Math.floor(roll * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  const jokerCard = deck[0];
  const remaining = deck.slice(1);
  const jokerRank = jokerCard.slice(0, -1);
  const jokerSuit = jokerCard.slice(-1);

  const andarCards: string[] = [];
  const baharCards: string[] = [];

  let winningSide: "andar" | "bahar" | null = null;
  // Traditional variant: first card to andar if joker is black, bahar if red
  let nextSide: "andar" | "bahar" = jokerSuit === "S" || jokerSuit === "C" ? "andar" : "bahar";
  let cardCount = 0;

  for (const card of remaining) {
    if (nextSide === "andar") {
      andarCards.push(card);
    } else {
      baharCards.push(card);
    }

    cardCount += 1;

    const rank = card.slice(0, -1);
    if (rank === jokerRank) {
      winningSide = nextSide;
      break;
    }

    nextSide = nextSide === "andar" ? "bahar" : "andar";
  }

  // Fallback: if somehow no winner found, default to last side dealt
  if (!winningSide) {
    winningSide = nextSide === "andar" ? "bahar" : "andar";
  }

  const isWin = winningSide === normalizedChoice;
  const payout = isWin ? Number((bet * multiplier).toFixed(2)) : 0;

  const roundResult = {
    jokerCard,
    andarCards,
    baharCards,
    winningSide,
    cardCount,
  };

  return {
    ...roundResult,
    result: roundResult, // persisted to casino_rounds
    choice: normalizedChoice,
    isWin,
    multiplier: isWin ? multiplier : 0,
    betAmount: bet,
    payout,
    profit: Number((payout - bet).toFixed(2)),
    nonce,
  };
}

async function playTeenPatti(bet: number, clientSeed: string, serverSeed: string) {
  const roll = await prng(serverSeed, clientSeed, 0);
  const isWin = roll > 0.5;
  const multiplier = isWin ? 2.0 : 0;
  const payout = isWin ? Number((bet * multiplier).toFixed(2)) : 0;

  return {
    result: { playerCards: [], dealerCards: [], winner: isWin ? "player" : "dealer" },
    multiplier,
    payout,
    profit: Number((payout - bet).toFixed(2)),
  };
}

async function playLucky7(
  bet: number,
  betChoice: "low" | "seven" | "high",
  clientSeed: string,
  serverSeed: string
) {
  const roll = await prng(serverSeed, clientSeed, 0);
  const cardValue = Math.floor(roll * 13) + 1; // 1-13
  const outcome = cardValue === 7 ? "seven" : cardValue < 7 ? "low" : "high";
  const isWin = outcome === betChoice;
  const multiplier = betChoice === "seven" ? 11 : 2;
  const payout = isWin ? Number((bet * multiplier).toFixed(2)) : 0;

  return {
    result: { card: "", cardValue, outcome, bet: betChoice },
    multiplier: isWin ? multiplier : 0,
    payout,
    profit: Number((payout - bet).toFixed(2)),
  };
}

async function playRoulette(
  bet: number,
  betType: string,
  betValue: string,
  clientSeed: string,
  serverSeed: string
) {
  const roll = await prng(serverSeed, clientSeed, 0);
  const number = Math.floor(roll * 37); // 0-36
  const color = number === 0 ? "green" : number % 2 === 0 ? "black" : "red";

  let isWin = false;
  let multiplier = 0;

  if (betType === "straight" && betValue === String(number)) {
    isWin = true;
    multiplier = 35;
  } else if (betType === "color" && betValue === color) {
    isWin = true;
    multiplier = 2;
  }

  const payout = isWin ? Number((bet * multiplier).toFixed(2)) : 0;

  return {
    result: { number, color, betType, betValue, multiplier, isWin },
    multiplier: isWin ? multiplier : 0,
    payout,
    profit: Number((payout - bet).toFixed(2)),
  };
}

async function playBlackjack(bet: number, clientSeed: string, serverSeed: string) {
  const roll = await prng(serverSeed, clientSeed, 0);
  const playerWin = roll > 0.45; // simple win chance
  const isPush = !playerWin && roll > 0.35;
  let payout = 0;
  let multiplier = 0;
  if (playerWin) {
    multiplier = 2;
    payout = Number((bet * multiplier).toFixed(2));
  } else if (isPush) {
    multiplier = 1;
    payout = bet;
  }

  return {
    result: { playerCards: [], dealerCards: [], playerValue: 20, dealerValue: 18, isWin: playerWin, isPush },
    multiplier,
    payout,
    profit: Number((payout - bet).toFixed(2)),
  };
}

async function playHiLo(
  bet: number,
  guess: "higher" | "lower",
  clientSeed: string,
  serverSeed: string
) {
  const roll = await prng(serverSeed, clientSeed, 0);
  const firstCard = Math.floor(roll * 13) + 1;
  const secondCard = Math.floor((await prng(serverSeed, clientSeed, 1)) * 13) + 1;
  const isWin = guess === "higher" ? secondCard > firstCard : secondCard < firstCard;
  const multiplier = 2;
  const payout = isWin ? Number((bet * multiplier).toFixed(2)) : 0;

  return {
    result: { firstCard: String(firstCard), nextCard: String(secondCard), guess, isWin, multiplier },
    multiplier: isWin ? multiplier : 0,
    payout,
    profit: Number((payout - bet).toFixed(2)),
  };
}

async function playDragonTiger(
  bet: number,
  choice: "dragon" | "tiger" | "tie",
  clientSeed: string,
  serverSeed: string
) {
  const dragon = Math.floor((await prng(serverSeed, clientSeed, 0)) * 13) + 1;
  const tiger = Math.floor((await prng(serverSeed, clientSeed, 1)) * 13) + 1;
  const winner = dragon === tiger ? "tie" : dragon > tiger ? "dragon" : "tiger";
  const isWin = winner === choice;
  const multiplier = choice === "tie" ? 8 : 2;
  const payout = isWin ? Number((bet * multiplier).toFixed(2)) : 0;

  return {
    result: { dragonCard: String(dragon), tigerCard: String(tiger), winner, bet: choice },
    multiplier: isWin ? multiplier : 0,
    payout,
    profit: Number((payout - bet).toFixed(2)),
  };
}

async function playPlinko(
  bet: number,
  risk: "low" | "medium" | "high",
  rows: number,
  clientSeed: string,
  serverSeed: string
) {
  const roll = await prng(serverSeed, clientSeed, 0);
  const slot = Math.floor(roll * rows);
  const baseMultiplier = risk === "high" ? 5 : risk === "medium" ? 2 : 1.2;
  const multiplier = Number((baseMultiplier * (slot / rows + 0.5)).toFixed(2));
  const payout = Number((bet * multiplier).toFixed(2));

  return {
    result: { path: [], slot, multiplier, isWin: payout > 0 },
    multiplier,
    payout,
    profit: Number((payout - bet).toFixed(2)),
  };
}

async function playWheel(
  bet: number,
  clientSeed: string,
  serverSeed: string
) {
  const roll = await prng(serverSeed, clientSeed, 0);
  const segment = Math.floor(roll * 12);
  const multiplier = [2, 3, 5, 10, 15, 20, 25, 2, 3, 5, 10, 50][segment];
  const payout = Number((bet * multiplier).toFixed(2));

  return {
    result: { segment, label: String(segment), multiplier, isWin: payout > 0 },
    multiplier,
    payout,
    profit: Number((payout - bet).toFixed(2)),
  };
}

async function playMines(
  bet: number,
  mineCount: number,
  tilesToReveal: number,
  clientSeed: string,
  serverSeed: string
) {
  const gridSize = 25;
  const tiles: number[] = [];
  let multiplier = 1;
  let hitMine = false;

  for (let i = 0; i < tilesToReveal; i++) {
    const roll = await prng(serverSeed, clientSeed, i);
    const tileIndex = Math.floor(roll * gridSize);
    tiles.push(tileIndex);
    if (i < mineCount) {
      multiplier += 0.5;
    } else if (tileIndex % mineCount === 0) {
      hitMine = true;
      break;
    } else {
      multiplier += 0.2;
    }
  }

  const payout = hitMine ? 0 : Number((bet * multiplier).toFixed(2));

  return {
    result: {
      minePositions: [],
      revealedTiles: tiles,
      hitMine,
      multiplier,
      isWin: !hitMine,
      payout,
    },
    multiplier: hitMine ? 0 : multiplier,
    payout,
    profit: Number((payout - bet).toFixed(2)),
  };
}
