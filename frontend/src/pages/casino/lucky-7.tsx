import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Shield,
  Sparkles,
  Menu,
  X,
  HelpCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Link } from "wouter";
import { useStore } from "@/lib/store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const QUICK_BETS = [10, 50, 100, 500, 1000] as const;

const SLIDER_MIN = 10;
const SLIDER_MAX = 1000;
const SLIDER_STEP = 10;

type BetChoice = "low" | "seven" | "high";
type Outcome = BetChoice;

type Suit = "spades" | "hearts" | "diamonds" | "clubs";

function vibrate(pattern: number | number[]) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      // @ts-ignore
      navigator.vibrate(pattern);
    }
  } catch {
    // ignore
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function toNum(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function formatINR(n: number) {
  try {
    return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  } catch {
    return String(n.toFixed(2));
  }
}

function computeOutcome(cardValue: number): Outcome {
  if (cardValue === 7) return "seven";
  if (cardValue < 7) return "low";
  return "high";
}

function rankFromValue(v: number): string {
  const value = clamp(Math.floor(v || 0), 1, 13);
  if (value === 1) return "A";
  if (value === 11) return "J";
  if (value === 12) return "Q";
  if (value === 13) return "K";
  return String(value);
}

function suitFromSeed(seed: number): Suit {
  const i = Math.abs(seed) % 4;
  return ["spades", "hearts", "diamonds", "clubs"][i] as Suit;
}

function suitGlyph(s: Suit) {
  if (s === "spades") return "♠";
  if (s === "hearts") return "♥";
  if (s === "diamonds") return "♦";
  return "♣";
}

function isRedSuit(s: Suit) {
  return s === "hearts" || s === "diamonds";
}

export default function Lucky7Game() {
  const [betAmount, setBetAmount] = useState("100");
  const [bet, setBet] = useState<BetChoice>("high");

  const [isPlaying, setIsPlaying] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const [flipped, setFlipped] = useState(false); // flip card to reveal
  const [phase, setPhase] = useState<"idle" | "shuffling" | "reveal">("idle");

  const [result, setResult] = useState<{
    card: string; // display string (rank+suit)
    cardValue: number;
    suit: Suit;
    rank: string;
    outcome: Outcome;
    isWin: boolean;
    payout: number;
  } | null>(null);

  const [history, setHistory] = useState<Outcome[]>([]);
  const [totemPulse, setTotemPulse] = useState(false);
  const [showQuickBubbles, setShowQuickBubbles] = useState(false);
  const quickBubbleTimer = useRef<number | null>(null);

  const { currentUser, setCurrentUser } = useStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ✅ FULLSCREEN MODE
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const amountNum = clamp(toNum(betAmount, 0), SLIDER_MIN, SLIDER_MAX);
  const multiplier = bet === "seven" ? 5 : 2;
  const potentialWin = Math.max(0, amountNum) * multiplier;

  // Nebula starfield
  const stars = useMemo(() => {
    const rand = (min: number, max: number) => min + Math.random() * (max - min);
    return Array.from({ length: 56 }).map((_, i) => ({
      id: i,
      x: rand(0, 100),
      y: rand(0, 100),
      s: rand(1.0, 2.6),
      o: rand(0.18, 0.8),
      d: rand(1.1, 4.9),
    }));
  }, []);

  const ambience = useMemo(() => {
    if (bet === "low") {
      return {
        halo:
          "bg-[radial-gradient(circle_at_50%_18%,rgba(59,130,246,0.28),transparent_60%)]",
        tint:
          "bg-[radial-gradient(circle_at_70%_88%,rgba(56,189,248,0.20),transparent_60%)]",
        glow: "shadow-[0_0_44px_rgba(59,130,246,0.24)]",
        accent: "text-sky-200",
        chip: "bg-sky-500/10 border-sky-400/20 text-sky-200",
        btn:
          "bg-sky-500/18 border-sky-400/25 text-sky-200 shadow-[0_0_26px_rgba(56,189,248,0.16)]",
      };
    }
    if (bet === "high") {
      return {
        halo:
          "bg-[radial-gradient(circle_at_50%_18%,rgba(244,63,94,0.26),transparent_60%)]",
        tint:
          "bg-[radial-gradient(circle_at_30%_88%,rgba(239,68,68,0.18),transparent_60%)]",
        glow: "shadow-[0_0_44px_rgba(244,63,94,0.24)]",
        accent: "text-rose-200",
        chip: "bg-rose-500/10 border-rose-400/20 text-rose-200",
        btn:
          "bg-rose-500/18 border-rose-400/25 text-rose-200 shadow-[0_0_26px_rgba(244,63,94,0.16)]",
      };
    }
    return {
      halo:
        "bg-[radial-gradient(circle_at_50%_18%,rgba(250,204,21,0.24),transparent_60%)]",
      tint:
        "bg-[radial-gradient(circle_at_50%_88%,rgba(245,158,11,0.18),transparent_60%)]",
      glow: "shadow-[0_0_46px_rgba(250,204,21,0.24)]",
      accent: "text-amber-200",
      chip: "bg-amber-500/10 border-amber-400/20 text-amber-200",
      btn:
        "bg-amber-500/16 border-amber-400/25 text-amber-200 shadow-[0_0_28px_rgba(250,204,21,0.18)]",
    };
  }, [bet]);

  const playMutation = useMutation({
    mutationFn: async () => {
      const amount = toNum(betAmount, 0);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid bet amount");
      return await api.playLucky7(amount, bet);
    },
    onMutate: () => {
      setIsPlaying(true);
      setPhase("shuffling");
      setFlipped(false);
      setResult(null);
      vibrate(10);
    },
    onSuccess: (data: any) => {
      // We FIRST keep shuffle going, then reveal like a real card game
      window.setTimeout(() => {
        // ✅ Defensive parse
        const cardValue = clamp(toNum(data?.cardValue, 0), 1, 13);

        const outcome: Outcome =
          (data?.outcome as Outcome) || computeOutcome(cardValue);

        const isWin = Boolean(data?.isWin);
        const payout = toNum(data?.payout, 0);
        const lost = toNum(data?.betAmount, amountNum);

        // If backend sends a string like "K♠" keep it.
        // Otherwise generate a proper rank+suit so user sees a real card ALWAYS.
        const rank = rankFromValue(cardValue);
        const suit = suitFromSeed(
          toNum(data?.cardValue, 7) * 97 + toNum(data?.payout, 0) * 13 + Date.now()
        );
        const displayCard =
          typeof data?.card === "string" && data.card.trim().length > 0
            ? data.card
            : `${rank}${suitGlyph(suit)}`;

        setResult({
          card: displayCard,
          cardValue,
          suit,
          rank,
          outcome,
          isWin,
          payout,
        });

        setHistory((prev) => [outcome, ...prev].slice(0, 10));

        // Switch phase -> reveal, then flip
        setPhase("reveal");
        window.setTimeout(() => setFlipped(true), 120);

        setIsPlaying(false);

        // Toasts
        if (isWin) {
          vibrate([25, 30, 25]);
          toast({
            title: `${displayCard} — You Win`,
            description: `+₹${formatINR(payout)}`,
            className: "bg-green-600 text-white border-none",
          });
        } else {
          vibrate(18);
          toast({
            title: `${displayCard} — ${String(outcome).toUpperCase()}`,
            description: `Lost ₹${formatINR(lost)}`,
            variant: "destructive",
          });
        }

        // Balance safe update
        const newBalance = toNum(data?.newBalance, currentUser?.balance ?? 0);
        if (currentUser && Number.isFinite(newBalance)) {
          setCurrentUser({
            ...currentUser,
            balance: newBalance,
          });
        }

        queryClient.invalidateQueries({ queryKey: ["casino-history"] });
      }, 950); // shuffle time
    },
    onError: (error: any) => {
      setIsPlaying(false);
      setPhase("idle");
      toast({
        title: "Game Failed",
        description: error?.message ?? "Something went wrong",
        variant: "destructive",
      });
    },
  });

  const handlePlay = () => {
    if (!currentUser) {
      toast({ title: "Please login", variant: "destructive" });
      return;
    }
    playMutation.mutate();
  };

  const pulseTotem = () => {
    setTotemPulse(true);
    window.setTimeout(() => setTotemPulse(false), 320);
  };

  const onSelectBet = (next: BetChoice) => {
    setBet(next);
    pulseTotem();
    vibrate(6);
  };

  const showBubbles = () => {
    setShowQuickBubbles(true);
    if (quickBubbleTimer.current) window.clearTimeout(quickBubbleTimer.current);
    quickBubbleTimer.current = window.setTimeout(() => setShowQuickBubbles(false), 1500);
  };

  useEffect(() => {
    return () => {
      if (quickBubbleTimer.current) window.clearTimeout(quickBubbleTimer.current);
    };
  }, []);

  const stageOutcome = result?.outcome ?? null;

  const historyIcon = (o: Outcome) => {
    if (o === "low") return <ArrowDown className="w-3.5 h-3.5" />;
    if (o === "high") return <ArrowUp className="w-3.5 h-3.5" />;
    return <span className="text-[11px] font-bold leading-none">7</span>;
  };

  const historyChipClass = (o: Outcome) => {
    if (o === "low") return "bg-sky-500/10 border-sky-400/20 text-sky-200";
    if (o === "high") return "bg-rose-500/10 border-rose-400/20 text-rose-200";
    return "bg-amber-500/10 border-amber-400/20 text-amber-200";
  };

  const revealSuit = result?.suit ?? "spades";
  const revealRank = result?.rank ?? "7";
  const suitChar = suitGlyph(revealSuit);
  const suitRed = isRedSuit(revealSuit);

  return (
    <div className="fixed inset-0 w-full h-[100dvh] overflow-hidden bg-black">
      {/* keyframes for REAL shuffle */}
      <style>{`
        @keyframes cardFloat {
          0% { transform: translateY(0px); }
          50% { transform: translateY(-6px); }
          100% { transform: translateY(0px); }
        }
        @keyframes shuffleA {
          0% { transform: translate3d(0,0,0) rotate(-2deg); opacity: 0.9; }
          30% { transform: translate3d(-18px,-10px,0) rotate(-8deg); opacity: 1; }
          70% { transform: translate3d(16px,8px,0) rotate(6deg); opacity: 1; }
          100% { transform: translate3d(0,0,0) rotate(-2deg); opacity: 0.9; }
        }
        @keyframes shuffleB {
          0% { transform: translate3d(0,0,0) rotate(2deg); opacity: 0.85; }
          30% { transform: translate3d(20px,-6px,0) rotate(10deg); opacity: 1; }
          70% { transform: translate3d(-14px,10px,0) rotate(-6deg); opacity: 1; }
          100% { transform: translate3d(0,0,0) rotate(2deg); opacity: 0.85; }
        }
        @keyframes shuffleC {
          0% { transform: translate3d(0,0,0) rotate(0deg); opacity: 0.75; }
          35% { transform: translate3d(10px,14px,0) rotate(7deg); opacity: 0.95; }
          75% { transform: translate3d(-12px,-10px,0) rotate(-7deg); opacity: 0.95; }
          100% { transform: translate3d(0,0,0) rotate(0deg); opacity: 0.75; }
        }
      `}</style>

      {/* Nebula background */}
      <div className="absolute inset-0 bg-gradient-to-b from-violet-950 via-slate-950 to-black" />
      <div className="absolute inset-0 opacity-80 bg-[radial-gradient(ellipse_at_top,rgba(124,58,237,0.35),transparent_60%)]" />
      <div className="absolute inset-0 opacity-70 bg-[radial-gradient(circle_at_75%_65%,rgba(14,165,233,0.18),transparent_60%)]" />
      <div className="absolute inset-0 opacity-60 bg-[radial-gradient(circle_at_25%_70%,rgba(244,63,94,0.14),transparent_60%)]" />

      {/* ambience shift */}
      <div className={cn("absolute inset-0 transition-opacity duration-300", ambience.halo)} />
      <div className={cn("absolute inset-0 transition-opacity duration-300", ambience.tint)} />

      {/* stars */}
      <div className="absolute inset-0">
        {stars.map((s) => (
          <span
            key={s.id}
            className="absolute rounded-full bg-white/70 animate-pulse"
            style={{
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: `${s.s}px`,
              height: `${s.s}px`,
              opacity: s.o,
              animationDuration: `${s.d}s`,
            }}
          />
        ))}
      </div>

      {/* Foreground */}
      <div
        className={cn(
          "relative z-10 h-full w-full px-4",
          "pt-[max(12px,env(safe-area-inset-top))]",
          "pb-[max(12px,env(safe-area-inset-bottom))]"
        )}
      >
        {/* ✅ Full responsive width (NO MISALIGN) */}
        <div className="mx-auto w-full max-w-[520px] h-full grid grid-rows-[auto_1fr_auto] gap-3">
          {/* HUD */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <Link href="/casino">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10"
                >
                  <ArrowLeft className="w-5 h-5 text-white/90" />
                </Button>
              </Link>

              <div className="pt-0.5">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-white/5 border border-white/10">
                    <Sparkles className="w-4 h-4 text-white/80" />
                  </span>
                  <h1 className="text-xl font-heading font-bold tracking-wide text-white">
                    LUCKY 7
                  </h1>
                </div>
                <p className="text-xs text-white/60 mt-0.5">
                  Predict below 7, exact 7, or above 7
                </p>
              </div>
            </div>

            {/* right */}
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "inline-flex items-center gap-2 rounded-2xl px-3 py-1.5 border backdrop-blur-md",
                    ambience.chip
                  )}
                >
                  <Shield className="w-4 h-4" />
                  <span className="text-xs font-semibold">Fair</span>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setMenuOpen(true)}
                  className="h-10 w-10 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10"
                >
                  <Menu className="w-5 h-5 text-white/85" />
                </Button>
              </div>

              <div className="flex items-center gap-1.5">
                {Array.from({ length: 8 }).map((_, i) => {
                  const o = history[i];
                  return (
                    <div
                      key={i}
                      className={cn(
                        "h-7 w-7 rounded-xl border backdrop-blur-md flex items-center justify-center text-white/80",
                        o ? historyChipClass(o) : "bg-white/5 border-white/10"
                      )}
                      title={o ? o.toUpperCase() : "—"}
                    >
                      {o ? historyIcon(o) : <span className="text-[10px] opacity-50">•</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* STAGE */}
          <div className="relative min-h-0 flex items-center justify-center">
            {/* Totem */}
            <div className="absolute top-1 left-1/2 -translate-x-1/2">
              <div
                className={cn(
                  "relative select-none transition-transform duration-200",
                  totemPulse ? "scale-[1.06]" : "scale-100"
                )}
              >
                <div
                  className={cn(
                    "px-4 py-1.5 rounded-2xl border backdrop-blur-md",
                    "bg-white/5 border-white/10",
                    ambience.glow
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn("text-xl font-black tracking-widest drop-shadow", ambience.accent)}
                    >
                      7
                    </span>
                    <span className="text-[10px] text-white/60 font-medium tracking-wide">
                      TOTEM
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* BIG ALTAR */}
            <Card className="w-full bg-white/5 border-white/10 backdrop-blur-xl rounded-3xl overflow-hidden">
              <div className="p-4">
                <div className="flex flex-col items-center justify-center">
                  {/* ✅ BIG CARD CENTERED */}
                  <div className="w-full flex items-center justify-center mt-1">
                    <div className="[perspective:1300px]">
                      <div
                        className="relative"
                        style={{
                          width: "clamp(210px, 66vw, 270px)",
                          height: "clamp(300px, 84vw, 360px)",
                        }}
                      >
                        {/* Outer frame */}
                        <div className="absolute inset-0 rounded-[26px] border border-amber-400/35 shadow-[0_0_55px_rgba(250,204,21,0.10)]" />

                        {/* 3D flip wrapper */}
                        <div
                          className={cn(
                            "absolute inset-[10px] rounded-[18px]",
                            "[transform-style:preserve-3d]",
                            "transition-transform duration-700 ease-out"
                          )}
                          style={{
                            transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
                          }}
                        >
                          {/* BACK FACE (DECK ART + REAL SHUFFLE) */}
                          <div
                            className={cn(
                              "absolute inset-0 rounded-[18px] overflow-hidden border border-white/10",
                              "bg-gradient-to-b from-slate-900/70 via-slate-950/85 to-black/95",
                              "[backface-visibility:hidden]"
                            )}
                          >
                            {/* inner glow */}
                            <div className="absolute inset-0 opacity-70 bg-[radial-gradient(circle_at_20%_10%,rgba(255,255,255,0.06),transparent_40%)]" />
                            <div className="absolute inset-0 opacity-70 bg-[radial-gradient(circle_at_80%_85%,rgba(124,58,237,0.14),transparent_55%)]" />

                            {/* Deck emblem */}
                            <div
                              className="absolute inset-0 flex items-center justify-center"
                              style={{ animation: "cardFloat 2.8s ease-in-out infinite" }}
                            >
                              <div className="relative">
                                <div className="absolute -inset-10 blur-2xl opacity-50 bg-[radial-gradient(circle_at_center,rgba(250,204,21,0.14),transparent_60%)]" />
                                <div className="h-20 w-20 rounded-full border border-white/10 bg-white/5 flex items-center justify-center shadow-[0_0_30px_rgba(124,58,237,0.18)]">
                                  <Sparkles className="w-8 h-8 text-white/85" />
                                </div>
                              </div>
                            </div>

                            <div className="absolute bottom-6 left-0 right-0 text-center">
                              <div className="text-[11px] uppercase tracking-[0.35em] text-white/65">
                                Arcana Deck
                              </div>
                            </div>

                            {/* ✅ REAL SHUFFLE: moving cards */}
                            {phase === "shuffling" && (
                              <div className="absolute inset-0 flex items-center justify-center">
                                <div className="relative w-[180px] h-[220px]">
                                  <div
                                    className="absolute inset-0 rounded-[18px] border border-white/10 bg-white/5"
                                    style={{ animation: "shuffleC 0.55s ease-in-out infinite" }}
                                  />
                                  <div
                                    className="absolute inset-0 rounded-[18px] border border-white/10 bg-white/5"
                                    style={{ animation: "shuffleB 0.45s ease-in-out infinite" }}
                                  />
                                  <div
                                    className="absolute inset-0 rounded-[18px] border border-amber-400/25 bg-white/5 shadow-[0_0_24px_rgba(250,204,21,0.12)]"
                                    style={{ animation: "shuffleA 0.38s ease-in-out infinite" }}
                                  />
                                  <div className="absolute -bottom-10 left-0 right-0 text-center text-xs text-white/70">
                                    Shuffling deck…
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* FRONT FACE (REAL CARD) */}
                          <div
                            className={cn(
                              "absolute inset-0 rounded-[18px] overflow-hidden border border-white/10",
                              "bg-gradient-to-b from-white/95 via-white/90 to-white/85",
                              "[transform:rotateY(180deg)] [backface-visibility:hidden]"
                            )}
                          >
                            <div className="absolute inset-0 opacity-80 bg-[radial-gradient(circle_at_20%_15%,rgba(0,0,0,0.08),transparent_45%)]" />
                            <div className="absolute inset-0 opacity-70 bg-[radial-gradient(circle_at_80%_85%,rgba(0,0,0,0.06),transparent_55%)]" />

                            {/* card content */}
                            <div className="relative h-full w-full p-4">
                              <div className="flex items-start justify-between">
                                <div
                                  className={cn(
                                    "text-2xl font-black leading-none",
                                    suitRed ? "text-rose-600" : "text-slate-900"
                                  )}
                                >
                                  <div>{revealRank}</div>
                                  <div className="text-xl">{suitChar}</div>
                                </div>

                                <div
                                  className={cn(
                                    "text-2xl font-black leading-none rotate-180",
                                    suitRed ? "text-rose-600" : "text-slate-900"
                                  )}
                                >
                                  <div>{revealRank}</div>
                                  <div className="text-xl">{suitChar}</div>
                                </div>
                              </div>

                              <div className="absolute inset-0 flex items-center justify-center">
                                <div
                                  className={cn(
                                    "text-[78px] font-black tracking-tight",
                                    suitRed ? "text-rose-600/90" : "text-slate-900/90"
                                  )}
                                  style={{
                                    textShadow: "0 14px 28px rgba(0,0,0,0.18)",
                                  }}
                                >
                                  {suitChar}
                                </div>
                              </div>

                              <div className="absolute bottom-4 left-0 right-0 text-center text-[11px] uppercase tracking-[0.35em] text-slate-800/60">
                                {result?.isWin ? "WIN" : "LOSE"}
                              </div>
                            </div>

                            {/* glow on win */}
                            {result?.isWin && (
                              <div className="absolute inset-0 pointer-events-none opacity-70 bg-[radial-gradient(circle_at_center,rgba(34,197,94,0.20),transparent_55%)]" />
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Multipliers */}
                  <div className="mt-4 w-full rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md px-4 py-3">
                    <div className="flex items-center justify-between text-sm font-mono">
                      <span
                        className={cn(
                          "flex items-center gap-2 transition-colors",
                          stageOutcome === "low" ? "text-sky-200" : "text-white/70"
                        )}
                      >
                        <ArrowDown className="w-4 h-4" />
                        Low <span className="text-white/45">(2x)</span>
                      </span>

                      <span
                        className={cn(
                          "transition-colors font-extrabold",
                          stageOutcome === "seven" ? "text-amber-200" : "text-white/70"
                        )}
                      >
                        7 <span className="text-white/45">(5x)</span>
                      </span>

                      <span
                        className={cn(
                          "flex items-center gap-2 transition-colors",
                          stageOutcome === "high" ? "text-rose-200" : "text-white/70"
                        )}
                      >
                        High <span className="text-white/45">(2x)</span>
                        <ArrowUp className="w-4 h-4" />
                      </span>
                    </div>
                  </div>

                  {/* Result strip */}
                  <div className="mt-3 w-full">
                    {result ? (
                      <div
                        className={cn(
                          "rounded-2xl px-4 py-3 text-center border backdrop-blur-md",
                          result.isWin
                            ? "bg-green-500/10 border-green-400/20 text-green-200"
                            : "bg-rose-500/10 border-rose-400/20 text-rose-200"
                        )}
                      >
                        <span className="text-sm font-semibold">
                          {result.isWin
                            ? `You won ₹${formatINR(result.payout)}`
                            : `Outcome: ${String(result.outcome).toUpperCase()}`}
                        </span>
                      </div>
                    ) : (
                      <div className="rounded-2xl px-4 py-3 text-center border border-white/10 bg-white/5 text-white/45">
                        <span className="text-sm">Pick your bet and draw a card.</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* CONTROLS */}
          <div className="relative">
            <div className="rounded-[2.2rem] border border-white/10 bg-white/5 backdrop-blur-xl px-4 pt-4 pb-4">
              {/* Bet buttons */}
              <div className="grid grid-cols-3 gap-2">
                <Button
                  variant="ghost"
                  onClick={() => onSelectBet("low")}
                  disabled={isPlaying}
                  className={cn(
                    "h-[72px] rounded-2xl border backdrop-blur-md",
                    bet === "low"
                      ? "bg-sky-500/18 border-sky-400/25 text-sky-200 shadow-[0_0_26px_rgba(56,189,248,0.16)]"
                      : "bg-white/5 border-white/10 text-white/80 hover:bg-white/10"
                  )}
                >
                  <div className="flex flex-col items-center justify-center leading-none">
                    <div className="flex items-center gap-2">
                      <ArrowDown className="w-4 h-4" />
                      <span className="text-lg font-black tracking-wide">LOW</span>
                    </div>
                    <span className="text-xs opacity-80 mt-1">2x</span>
                  </div>
                </Button>

                <Button
                  variant="ghost"
                  onClick={() => onSelectBet("seven")}
                  disabled={isPlaying}
                  className={cn(
                    "h-[72px] rounded-2xl border backdrop-blur-md",
                    bet === "seven"
                      ? ambience.btn
                      : "bg-white/5 border-white/10 text-white/90 hover:bg-white/10"
                  )}
                >
                  <div className="flex flex-col items-center justify-center leading-none">
                    <span className="text-3xl font-black">7</span>
                    <span className="text-xs opacity-80 mt-1">5x</span>
                  </div>
                </Button>

                <Button
                  variant="ghost"
                  onClick={() => onSelectBet("high")}
                  disabled={isPlaying}
                  className={cn(
                    "h-[72px] rounded-2xl border backdrop-blur-md",
                    bet === "high"
                      ? "bg-rose-500/18 border-rose-400/25 text-rose-200 shadow-[0_0_26px_rgba(244,63,94,0.16)]"
                      : "bg-white/5 border-white/10 text-white/80 hover:bg-white/10"
                  )}
                >
                  <div className="flex flex-col items-center justify-center leading-none">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-black tracking-wide">HIGH</span>
                      <ArrowUp className="w-4 h-4" />
                    </div>
                    <span className="text-xs opacity-80 mt-1">2x</span>
                  </div>
                </Button>
              </div>

              {/* Stake slider */}
              <div className="mt-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-white/60">Stake</div>
                  <div className="text-xs text-white/70">
                    <span className="font-semibold text-white/90">₹{formatINR(amountNum)}</span>
                    <span className="opacity-60"> • Potential</span>{" "}
                    <span className="font-semibold text-white/90">
                      ₹{formatINR(potentialWin)}
                    </span>
                  </div>
                </div>

                <div
                  className="relative mt-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-3"
                  onClick={showBubbles}
                >
                  {/* Quick select bubbles */}
                  <div
                    className={cn(
                      "absolute -top-10 left-1/2 -translate-x-1/2 flex items-center gap-2 transition-all",
                      showQuickBubbles
                        ? "opacity-100 translate-y-0"
                        : "opacity-0 translate-y-1 pointer-events-none"
                    )}
                  >
                    {QUICK_BETS.map((amt) => (
                      <button
                        key={amt}
                        className="rounded-2xl border border-white/10 bg-white/10 px-3 py-1 text-xs text-white/85 hover:bg-white/15"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setBetAmount(String(amt));
                          vibrate(8);
                          setShowQuickBubbles(false);
                        }}
                        disabled={isPlaying}
                      >
                        ₹{amt}
                      </button>
                    ))}
                  </div>

                  <input
                    type="range"
                    min={SLIDER_MIN}
                    max={SLIDER_MAX}
                    step={SLIDER_STEP}
                    value={amountNum}
                    onChange={(e) => setBetAmount(e.target.value)}
                    disabled={isPlaying}
                    className="w-full accent-white"
                  />

                  <div className="mt-2 flex items-center justify-between text-[11px] text-white/40">
                    <span>₹{SLIDER_MIN}</span>
                    <span>₹{SLIDER_MAX}</span>
                  </div>
                </div>
              </div>

              {/* Draw button */}
              <Button
                className={cn(
                  "mt-3 w-full h-14 rounded-2xl text-base font-bold tracking-wide border border-white/10",
                  "bg-gradient-to-r from-amber-500/90 to-yellow-500/70 hover:from-amber-500 hover:to-yellow-500",
                  "text-black shadow-[0_0_30px_rgba(250,204,21,0.18)]"
                )}
                onClick={handlePlay}
                disabled={isPlaying || amountNum <= 0}
              >
                {isPlaying ? "Shuffling…" : `Draw Card (₹${formatINR(amountNum)})`}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Hamburger overlay */}
      {menuOpen && (
        <div className="absolute inset-0 z-50">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-4 top-4 w-[290px] rounded-3xl border border-white/10 bg-white/10 backdrop-blur-xl p-3">
            <div className="flex items-center justify-between px-2 py-1">
              <div className="text-sm font-semibold text-white/90">Game Menu</div>
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10"
                onClick={() => setMenuOpen(false)}
              >
                <X className="w-4 h-4 text-white/85" />
              </Button>
            </div>

            <div className="mt-2 space-y-2">
              <Link href="/casino">
                <Button className="w-full rounded-2xl" variant="secondary">
                  Exit Game
                </Button>
              </Link>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-white/75">
                <div className="flex items-center gap-2 font-semibold text-white/90 mb-1">
                  <HelpCircle className="w-4 h-4" />
                  Rules
                </div>
                <div>
                  Low = A–6 (2x) • Seven = 7 (5x) • High = 8–K (2x)
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-white/75">
                <div className="font-semibold text-white/90 mb-1">Provably Fair</div>
                <div>Results are generated server-side and stored in your history.</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
