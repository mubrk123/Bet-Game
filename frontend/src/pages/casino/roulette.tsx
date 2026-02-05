// @ts-nocheck
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Shield, Zap, Repeat, Plus, Palette, Play, Pause } from "lucide-react";
// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Link } from "wouter";
import { useStore } from "@/lib/store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const QUICK_BETS = [10, 50, 100, 500, 1000];

// Standard European wheel order (single zero)
const ROULETTE_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

const RED_NUMBERS = [
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
];

type BetType = { type: string; value: string; label: string; payout: number };

const BET_OPTIONS: BetType[] = [
  { type: "color", value: "red", label: "Red", payout: 2 },
  { type: "color", value: "black", label: "Black", payout: 2 },
  { type: "oddeven", value: "odd", label: "Odd", payout: 2 },
  { type: "oddeven", value: "even", label: "Even", payout: 2 },
  { type: "highlow", value: "low", label: "1-18", payout: 2 },
  { type: "highlow", value: "high", label: "19-36", payout: 2 },
  { type: "dozen", value: "1st", label: "1st 12", payout: 3 },
  { type: "dozen", value: "2nd", label: "2nd 12", payout: 3 },
  { type: "dozen", value: "3rd", label: "3rd 12", payout: 3 },
];

type ThemeKey = "classic" | "neon" | "vip";
const THEMES: Record<
  ThemeKey,
  {
    label: string;
    wheelCard: string;
    glow: string;
    primaryBtn: string;
    primaryBtnHover: string;
    chipBorder: string;
    accentText: string;
  }
> = {
  classic: {
    label: "Classic",
    wheelCard: "bg-gradient-to-br from-emerald-950/70 via-green-950/60 to-emerald-900/40 border-emerald-500/25",
    glow: "shadow-[0_0_45px_rgba(16,185,129,0.15)]",
    primaryBtn: "from-emerald-600 to-green-600",
    primaryBtnHover: "hover:from-emerald-700 hover:to-green-700",
    chipBorder: "border-emerald-500/20",
    accentText: "text-emerald-200",
  },
  neon: {
    label: "Neon",
    wheelCard: "bg-gradient-to-br from-fuchsia-950/50 via-slate-950/70 to-cyan-950/40 border-cyan-400/25",
    glow: "shadow-[0_0_55px_rgba(34,211,238,0.18)]",
    primaryBtn: "from-cyan-500 to-fuchsia-600",
    primaryBtnHover: "hover:from-cyan-600 hover:to-fuchsia-700",
    chipBorder: "border-cyan-400/20",
    accentText: "text-cyan-200",
  },
  vip: {
    label: "VIP",
    wheelCard: "bg-gradient-to-br from-zinc-950/70 via-amber-950/25 to-zinc-950/80 border-amber-400/20",
    glow: "shadow-[0_0_50px_rgba(251,191,36,0.14)]",
    primaryBtn: "from-amber-500 to-yellow-600",
    primaryBtnHover: "hover:from-amber-600 hover:to-yellow-700",
    chipBorder: "border-amber-400/20",
    accentText: "text-amber-200",
  },
};

function isRed(n: number) {
  return RED_NUMBERS.includes(n);
}

function clampNumberString(v: string, min: number, max: number) {
  const n = parseFloat(v);
  if (Number.isNaN(n)) return "";
  return String(Math.min(max, Math.max(min, n)));
}

function safeVibrate(pattern: number | number[]) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      // @ts-ignore
      navigator.vibrate(pattern);
    }
  } catch {
    // ignore
  }
}

function matrixToAngle(transform: string) {
  // transform like "matrix(a, b, c, d, e, f)"
  if (!transform || transform === "none") return 0;
  const match = transform.match(/matrix\(([^)]+)\)/);
  if (!match) return 0;
  const parts = match[1].split(",").map((p) => parseFloat(p.trim()));
  const [a, b] = parts;
  const angle = Math.round((Math.atan2(b, a) * 180) / Math.PI);
  return (angle + 360) % 360;
}

function buildConicGradient() {
  const seg = 360 / ROULETTE_ORDER.length;
  const stops: string[] = [];
  for (let i = 0; i < ROULETTE_ORDER.length; i++) {
    const n = ROULETTE_ORDER[i];
    const start = i * seg;
    const end = (i + 1) * seg;
    const color =
      n === 0 ? "rgba(34,197,94,0.95)" : isRed(n) ? "rgba(220,38,38,0.95)" : "rgba(17,24,39,0.95)";
    stops.push(`${color} ${start}deg ${end}deg`);
  }
  return `conic-gradient(from -90deg, ${stops.join(",")})`;
}

function formatINR(n: number) {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
  } catch {
    return `₹${n.toFixed(2)}`;
  }
}

type SpinOutcome = {
  number: number;
  color: "red" | "black" | "green";
  isWin: boolean;
  payout: number;
  betAmount: number;
  newBalance: number;
};

function RouletteWheel({
  theme,
  isSpinning,
  targetNumber,
  turbo,
}: {
  theme: ThemeKey;
  isSpinning: boolean;
  targetNumber?: number | null;
  turbo: boolean;
}) {
  const wheelRef = useRef<HTMLDivElement | null>(null);
  const ballRef = useRef<HTMLDivElement | null>(null);

  const [isAnimating, setIsAnimating] = useState(false);
  const [isBallAnimating, setIsBallAnimating] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [ballRotation, setBallRotation] = useState(0);
  const [settleKey, setSettleKey] = useState(0);

  const segmentAngle = 360 / ROULETTE_ORDER.length;
  const gradient = useMemo(() => buildConicGradient(), []);

  const idxMap = useMemo(() => {
    const m = new Map<number, number>();
    ROULETTE_ORDER.forEach((n, i) => m.set(n, i));
    return m;
  }, []);

  const themeCfg = THEMES[theme];

  useEffect(() => {
    if (isSpinning) {
      setIsAnimating(true);
      setIsBallAnimating(true);
      setSettleKey((k) => k + 1);

      // subtle kick
      safeVibrate([12, 20, 12]);
      return;
    }

    // stop animations when parent says spin ended
    setIsAnimating(false);
    setIsBallAnimating(false);
  }, [isSpinning]);

  useEffect(() => {
    if (!isSpinning) return;
    if (targetNumber === null || targetNumber === undefined) return;

    const mySettleKey = settleKey;
    const settleDelay = turbo ? 250 : 850;
    const settleDuration = turbo ? 650 : 1100;

    const settleTimer = window.setTimeout(() => {
      if (mySettleKey !== settleKey) return;

      const wheelEl = wheelRef.current;
      const ballEl = ballRef.current;

      // freeze current wheel rotation from animation
      let current = 0;
      if (wheelEl) {
        const computed = window.getComputedStyle(wheelEl);
        current = matrixToAngle(computed.transform);
      }

      let currentBall = 0;
      if (ballEl) {
        const computedB = window.getComputedStyle(ballEl);
        currentBall = matrixToAngle(computedB.transform);
      }

      setIsAnimating(false);
      setIsBallAnimating(false);

      // Set immediate frozen state
      setRotation(current);
      setBallRotation(currentBall);

      // Then transition to target
      const targetIdx = idxMap.get(targetNumber) ?? 0;
      const desired = (360 - (targetIdx * segmentAngle) % 360) % 360; // rotate wheel so target is at pointer (top)
      const delta = (desired - (current % 360) + 360) % 360;
      const extraTurns = turbo ? 3 : 5; // feel
      const final = current + extraTurns * 360 + delta;

      // Ball settles near pointer with slight offset toward the result segment
      const ballDesired = (targetIdx * segmentAngle + 6) % 360;
      const ballDelta = (ballDesired - (currentBall % 360) + 360) % 360;
      const ballFinal = currentBall + (turbo ? 2 : 3) * 360 + ballDelta;

      // near-end haptic
      window.setTimeout(() => safeVibrate([8, 20, 10]), Math.max(0, settleDuration - 220));

      // next frame to ensure transition applies
      requestAnimationFrame(() => {
        setRotation(final);
        setBallRotation(ballFinal);
      });
    }, settleDelay);

    return () => window.clearTimeout(settleTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSpinning, targetNumber, turbo, idxMap, segmentAngle, settleKey]);

  return (
    <div className={cn("relative mx-auto w-[320px] max-w-full", themeCfg.glow)}>
      <div className="relative aspect-square w-full">
        {/* Pointer */}
        <div className="absolute left-1/2 top-1 z-20 -translate-x-1/2">
          <div className="h-0 w-0 border-l-[10px] border-r-[10px] border-t-[16px] border-l-transparent border-r-transparent border-t-white/90 drop-shadow" />
        </div>

        {/* Ball orbit (separate rotator) */}
        <div
          ref={ballRef}
          className={cn(
            "absolute inset-0 z-10 rounded-full",
            isBallAnimating ? "animate-spin" : ""
          )}
          style={{
            animationDuration: turbo ? "450ms" : "700ms",
            transform: `rotate(${ballRotation}deg)`,
            transition: isBallAnimating ? undefined : `transform ${turbo ? 650 : 1100}ms cubic-bezier(0.12, 0.9, 0.12, 1)`,
          }}
        >
          <div className="absolute left-1/2 top-3 -translate-x-1/2">
            <div className="h-3.5 w-3.5 rounded-full bg-white shadow-[0_0_18px_rgba(255,255,255,0.55)]" />
          </div>
        </div>

        {/* Wheel */}
        <div className="absolute inset-0 rounded-full bg-black/30 p-3">
          <div className="absolute inset-3 rounded-full bg-gradient-to-b from-white/10 to-white/0" />
          <div
            ref={wheelRef}
            className={cn(
              "absolute inset-4 rounded-full",
              isAnimating ? "animate-spin" : ""
            )}
            style={{
              animationDuration: turbo ? "650ms" : "900ms",
              transform: `rotate(${rotation}deg)`,
              transition: isAnimating ? undefined : `transform ${turbo ? 650 : 1100}ms cubic-bezier(0.12, 0.9, 0.12, 1)`,
            }}
          >
            {/* segments */}
            <div
              className="absolute inset-0 rounded-full border border-white/10 shadow-inner"
              style={{ backgroundImage: gradient }}
            />

            {/* numbers */}
            <div className="absolute inset-0">
              {ROULETTE_ORDER.map((n, i) => {
                const ang = i * segmentAngle;
                return (
                  <div
                    key={n}
                    className="absolute left-1/2 top-1/2"
                    style={{
                      transform: `rotate(${ang}deg) translateY(-42.5%) rotate(${-ang}deg)`,
                      transformOrigin: "center",
                    }}
                  >
                    <div className="w-6 text-center text-[10px] font-semibold text-white/85 drop-shadow">
                      {n}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* inner ring */}
            <div className="absolute inset-[18%] rounded-full bg-gradient-to-br from-slate-950/80 to-slate-900/40 border border-white/10 shadow-[inset_0_0_40px_rgba(0,0,0,0.55)]" />
          </div>

          {/* hub */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="rounded-full bg-black/35 px-4 py-2 border border-white/10 backdrop-blur">
              <div className="text-xs text-white/70 text-center">
                {isSpinning ? "Spinning…" : "Place your bet"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RouletteGame() {
  const [betAmount, setBetAmount] = useState("100");
  const [selectedBet, setSelectedBet] = useState<BetType>(BET_OPTIONS[0]);
  const [isSpinning, setIsSpinning] = useState(false);

  const [result, setResult] = useState<{
    number: number;
    color: "red" | "black" | "green";
    isWin: boolean;
    payout: number;
  } | null>(null);

  const [pendingNumber, setPendingNumber] = useState<number | null>(null);

  // UI upgrades
  const [theme, setTheme] = useState<ThemeKey>("classic");
  const [turbo, setTurbo] = useState(false);
  const [history, setHistory] = useState<Array<{ number: number; color: "red" | "black" | "green" }>>([]);

  // Templates
  const [lastBetTemplate, setLastBetTemplate] = useState<{ amount: string; bet: BetType } | null>(null);

  // Autoplay
  const [autoOn, setAutoOn] = useState(false);
  const [autoRounds, setAutoRounds] = useState("10");
  const [autoLeft, setAutoLeft] = useState(0);
  const [stopOnWin, setStopOnWin] = useState(true);
  const [stopLoss, setStopLoss] = useState("0"); // INR
  const [stopProfit, setStopProfit] = useState("0"); // INR
  const autoStartBalanceRef = useRef<number | null>(null);

  const { currentUser, setCurrentUser } = useStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const themeCfg = THEMES[theme];

  const playMutation = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(betAmount);
      if (isNaN(amount) || amount <= 0) throw new Error("Invalid bet amount");
      return await api.playRoulette(amount, selectedBet.type, selectedBet.value);
    },
    onMutate: () => {
      setIsSpinning(true);
      setResult(null);
      setPendingNumber(null);

      setLastBetTemplate({ amount: betAmount, bet: selectedBet });

      // start haptics
      safeVibrate(10);
    },
    onSuccess: (data) => {
      // We already have the number; let the wheel "settle" to it while we keep suspense.
      setPendingNumber(data.number);

      const spinMs = turbo ? 850 : 2200;

      window.setTimeout(() => {
        setIsSpinning(false);
        setPendingNumber(null);

        const nextResult = {
          number: data.number,
          color: data.color,
          isWin: data.isWin,
          payout: data.payout,
        };

        setResult(nextResult);

        // update local history (for stats)
        setHistory((prev) => {
          const next = [{ number: data.number, color: data.color as any }, ...prev];
          return next.slice(0, 20);
        });

        if (data.isWin) {
          toast({
            title: `${data.number} ${String(data.color).toUpperCase()} - You Win!`,
            description: `+₹${data.payout.toFixed(2)}`,
            className: "bg-green-600 text-white border-none",
          });
          safeVibrate([20, 40, 20]);
        } else {
          toast({
            title: `${data.number} ${String(data.color).toUpperCase()}`,
            description: `Lost ₹${data.betAmount.toFixed(2)}`,
            variant: "destructive",
          });
          safeVibrate([18, 40, 18]);
        }

        setCurrentUser({
          ...currentUser!,
          balance: data.newBalance,
        });

        queryClient.invalidateQueries({ queryKey: ["casino-history"] });

        // Autoplay stop conditions
        if (autoOn && autoStartBalanceRef.current !== null) {
          const startBal = autoStartBalanceRef.current;
          const newBal = data.newBalance;
          const profit = newBal - startBal;
          const loss = startBal - newBal;

          const sl = parseFloat(stopLoss) || 0;
          const sp = parseFloat(stopProfit) || 0;

          const shouldStop =
            (stopOnWin && data.isWin) ||
            (sl > 0 && loss >= sl) ||
            (sp > 0 && profit >= sp);

          if (shouldStop) {
            setAutoOn(false);
            setAutoLeft(0);
            autoStartBalanceRef.current = null;

            toast({
              title: "Autoplay stopped",
              description: stopOnWin && data.isWin
                ? "Stopped on win"
                : sl > 0 && loss >= sl
                  ? `Stop loss hit (${formatINR(sl)})`
                  : sp > 0 && profit >= sp
                    ? `Stop profit hit (${formatINR(sp)})`
                    : "Stopped",
            });
          }
        }
      }, spinMs);
    },
    onError: (error: any) => {
      setIsSpinning(false);
      setPendingNumber(null);
      setAutoOn(false);
      setAutoLeft(0);
      autoStartBalanceRef.current = null;

      toast({
        title: "Game Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const potentialWin = useMemo(() => {
    const amt = parseFloat(betAmount);
    if (Number.isNaN(amt) || amt <= 0) return 0;
    return amt * selectedBet.payout;
  }, [betAmount, selectedBet.payout]);

  const handlePlay = () => {
    if (!currentUser) {
      toast({ title: "Please login", variant: "destructive" });
      return;
    }
    if (autoOn) return;
    playMutation.mutate();
  };

  const startAutoplay = () => {
    if (!currentUser) {
      toast({ title: "Please login", variant: "destructive" });
      return;
    }
    const rounds = Math.max(1, Math.min(200, parseInt(autoRounds || "0", 10) || 0));
    if (!rounds) {
      toast({ title: "Invalid autoplay rounds", variant: "destructive" });
      return;
    }
    autoStartBalanceRef.current = currentUser.balance;
    setAutoLeft(rounds);
    setAutoOn(true);
    toast({ title: "Autoplay started", description: `${rounds} rounds` });
  };

  const stopAutoplayNow = () => {
    setAutoOn(false);
    setAutoLeft(0);
    autoStartBalanceRef.current = null;
    toast({ title: "Autoplay stopped" });
  };

  // Autoplay driver: fire next spin when idle
  useEffect(() => {
    if (!autoOn) return;
    if (!currentUser) return;
    if (isSpinning || playMutation.isPending) return;

    if (autoLeft <= 0) {
      setAutoOn(false);
      autoStartBalanceRef.current = null;
      return;
    }

    // reduce left and spin
    setAutoLeft((n) => Math.max(0, n - 1));
    playMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOn, autoLeft, isSpinning, playMutation.isPending, currentUser]);

  const stats = useMemo(() => {
    const h = history.slice(0, 20);
    const reds = h.filter((x) => x.color === "red").length;
    const blacks = h.filter((x) => x.color === "black").length;
    const greens = h.filter((x) => x.color === "green").length;

    const odds = h.filter((x) => x.number !== 0 && x.number % 2 === 1).length;
    const evens = h.filter((x) => x.number !== 0 && x.number % 2 === 0).length;

    const freq = new Map<number, number>();
    h.forEach((x) => freq.set(x.number, (freq.get(x.number) ?? 0) + 1));

    const sortedHot = [...freq.entries()].sort((a, b) => b[1] - a[1]);
    const hot = sortedHot.slice(0, 3).map(([n]) => n);

    // cold = numbers least seen among those that have appeared in last 20 (simple & honest)
    const sortedCold = [...freq.entries()].sort((a, b) => a[1] - b[1]);
    const cold = sortedCold.slice(0, 3).map(([n]) => n);

    return { reds, blacks, greens, odds, evens, hot, cold, total: h.length };
  }, [history]);

  const betBtnClass = (opt: BetType) => {
    const active = selectedBet.type === opt.type && selectedBet.value === opt.value;

    if (!active) {
      return "bg-white/[0.02] hover:bg-white/[0.05] border-white/12";
    }

    if (opt.value === "red") return "bg-red-600/90 hover:bg-red-700 border-red-300/30 shadow-[0_0_20px_rgba(220,38,38,0.22)]";
    if (opt.value === "black") return "bg-slate-900 hover:bg-slate-950 border-white/15 shadow-[0_0_20px_rgba(0,0,0,0.35)]";

    return cn(
      "border-white/15 shadow-[0_0_20px_rgba(34,197,94,0.18)]",
      theme === "neon"
        ? "bg-cyan-500/20 hover:bg-cyan-500/25"
        : theme === "vip"
          ? "bg-amber-500/15 hover:bg-amber-500/20"
          : "bg-emerald-500/15 hover:bg-emerald-500/20"
    );
  };

  const applyLast = () => {
    if (!lastBetTemplate) return;
    setBetAmount(lastBetTemplate.amount);
    setSelectedBet(lastBetTemplate.bet);
    safeVibrate(8);
  };

  const doubleLast = () => {
    if (!lastBetTemplate) return;
    const amt = parseFloat(lastBetTemplate.amount);
    if (Number.isNaN(amt) || amt <= 0) return;
    setBetAmount(String(Math.min(1000000, amt * 2)));
    setSelectedBet(lastBetTemplate.bet);
    safeVibrate([8, 12, 8]);
  };

  return (
    <AppShell hideHeader hideBottomNav>
      <div className="flex flex-col gap-6 pb-20 md:pb-6 max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link href="/casino">
            <Button variant="ghost" size="icon" disabled={isSpinning || playMutation.isPending}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-heading font-bold flex items-center gap-2">
              <span className="text-2xl">🎰</span>
              Roulette
            </h1>
            <p className="text-sm text-muted-foreground">European roulette with single zero</p>
          </div>

          {/* Theme toggle */}
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
              <Palette className="w-4 h-4" />
              Theme
            </div>
            <div className="flex gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/10">
              {(["classic", "neon", "vip"] as ThemeKey[]).map((k) => (
                <Button
                  key={k}
                  size="sm"
                  variant={theme === k ? "default" : "ghost"}
                  className={cn("h-8 px-2 text-xs rounded-lg", theme === k ? "bg-white/10" : "opacity-80")}
                  onClick={() => setTheme(k)}
                  disabled={isSpinning || playMutation.isPending}
                >
                  {THEMES[k].label}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* Wheel + Results */}
        <Card className={cn("p-6 border", themeCfg.wheelCard, themeCfg.glow)}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className={cn("text-sm font-semibold", themeCfg.accentText)}>Live Wheel</div>
              <div className="text-xs text-white/60">
                {turbo ? "Turbo mode" : "Cinematic mode"} • {autoOn ? `Autoplay (${autoLeft} left)` : "Manual"}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={turbo ? "default" : "outline"}
                size="sm"
                className={cn(
                  "h-9 rounded-xl",
                  turbo ? cn("bg-white/10 border-white/10") : "bg-transparent"
                )}
                onClick={() => setTurbo((v) => !v)}
                disabled={isSpinning || playMutation.isPending}
                data-testid="btn-turbo"
              >
                <Zap className="w-4 h-4 mr-1" />
                Turbo
              </Button>

              {!autoOn ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-xl bg-transparent"
                  onClick={startAutoplay}
                  disabled={isSpinning || playMutation.isPending}
                  data-testid="btn-autoplay-start"
                >
                  <Play className="w-4 h-4 mr-1" />
                  Auto
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-xl bg-transparent"
                  onClick={stopAutoplayNow}
                  data-testid="btn-autoplay-stop"
                >
                  <Pause className="w-4 h-4 mr-1" />
                  Stop
                </Button>
              )}
            </div>
          </div>

          <div className="mt-5">
            <RouletteWheel theme={theme} isSpinning={isSpinning} targetNumber={pendingNumber ?? undefined} turbo={turbo} />
          </div>

          {/* Result banner */}
          <div className="mt-5">
            {result ? (
              <div
                className={cn(
                  "text-center py-3 rounded-xl border backdrop-blur",
                  result.isWin
                    ? "bg-green-500/15 text-green-200 border-green-500/25"
                    : "bg-red-500/10 text-red-200 border-red-500/25"
                )}
              >
                {result.isWin ? (
                  <div className="font-semibold">🎉 You Won ₹{result.payout.toFixed(2)}!</div>
                ) : (
                  <div className="font-semibold">
                    {result.number} {String(result.color).toUpperCase()}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center text-xs text-white/50">
                {isSpinning ? "The ball is running…" : "Spin to start"}
              </div>
            )}
          </div>

          {/* Last numbers + stats */}
          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-white/80">Last Numbers</div>
              <div className="text-xs text-white/55">{stats.total ? `Showing ${stats.total}` : "No spins yet"}</div>
            </div>

            <div className="flex gap-2 flex-wrap">
              {history.slice(0, 12).map((x, i) => (
                <div
                  key={`${x.number}-${i}`}
                  className={cn(
                    "h-8 min-w-8 px-2 rounded-xl flex items-center justify-center text-xs font-semibold border",
                    themeCfg.chipBorder,
                    x.color === "green"
                      ? "bg-green-600/25 text-green-100"
                      : x.color === "red"
                        ? "bg-red-600/25 text-red-100"
                        : "bg-slate-900/40 text-white/85"
                  )}
                >
                  {x.number}
                </div>
              ))}
              {!history.length && (
                <div className="text-xs text-white/45">Your recent results will appear here.</div>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="text-xs text-white/55">Red / Black</div>
                <div className="text-sm font-semibold text-white/85">
                  {stats.reds} / {stats.blacks}
                  {stats.greens ? <span className="text-green-300"> • {stats.greens}G</span> : null}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="text-xs text-white/55">Odd / Even</div>
                <div className="text-sm font-semibold text-white/85">
                  {stats.odds} / {stats.evens}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="text-xs text-white/55">Hot</div>
                <div className="text-sm font-semibold text-white/85">
                  {stats.hot.length ? stats.hot.join(", ") : "—"}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="text-xs text-white/55">Cold</div>
                <div className="text-sm font-semibold text-white/85">
                  {stats.cold.length ? stats.cold.join(", ") : "—"}
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Betting */}
        <Card className="p-6">
          <div className="space-y-5">
            <div>
              <label className="text-sm font-medium mb-2 block">Select Bet</label>
              <div className="grid grid-cols-3 gap-2">
                {BET_OPTIONS.map((opt) => (
                  <Button
                    key={`${opt.type}-${opt.value}`}
                    variant="outline"
                    className={cn("h-12 flex flex-col text-xs rounded-2xl", betBtnClass(opt))}
                    onClick={() => setSelectedBet(opt)}
                    disabled={isSpinning || autoOn}
                    data-testid={`btn-bet-${opt.value}`}
                  >
                    <span className="font-bold">{opt.label}</span>
                    <span className="opacity-70">{opt.payout}x</span>
                  </Button>
                ))}
              </div>

              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 rounded-2xl"
                  onClick={applyLast}
                  disabled={!lastBetTemplate || isSpinning || autoOn}
                  data-testid="btn-repeat-last"
                >
                  <Repeat className="w-4 h-4 mr-2" />
                  Repeat Last Bet
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 rounded-2xl"
                  onClick={doubleLast}
                  disabled={!lastBetTemplate || isSpinning || autoOn}
                  data-testid="btn-double-last"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Double Last Bet
                </Button>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Bet Amount</label>
              <Input
                type="number"
                value={betAmount}
                onChange={(e) => setBetAmount(clampNumberString(e.target.value, 1, 1000000))}
                disabled={isSpinning || autoOn}
                data-testid="input-bet-amount"
              />
              <div className="flex gap-2 mt-2 flex-wrap">
                {QUICK_BETS.map((amount) => (
                  <Button
                    key={amount}
                    variant="outline"
                    size="sm"
                    onClick={() => setBetAmount(amount.toString())}
                    disabled={isSpinning || autoOn}
                    className="rounded-xl"
                    data-testid={`btn-quick-bet-${amount}`}
                  >
                    ₹{amount}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex justify-between text-sm text-muted-foreground">
              <span>
                Payout: {selectedBet.payout}x ({selectedBet.label})
              </span>
              <span>Potential Win: ₹{potentialWin.toFixed(2)}</span>
            </div>

            <Button
              className={cn(
                "w-full h-14 text-lg rounded-2xl bg-gradient-to-r",
                themeCfg.primaryBtn,
                themeCfg.primaryBtnHover
              )}
              onClick={handlePlay}
              disabled={isSpinning || !betAmount || autoOn}
              data-testid="btn-play"
            >
              {isSpinning ? "Spinning..." : `Spin (₹${betAmount})`}
            </Button>

            {/* Autoplay settings (front-end only) */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white/85">Autoplay Settings</div>
                  <div className="text-xs text-white/55">No backend changes — just repeated spins with safety stops.</div>
                </div>
                <div className="text-xs text-white/60">
                  {autoOn ? `${autoLeft} left` : "Idle"}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="col-span-2 sm:col-span-1">
                  <label className="text-xs text-white/60">Rounds</label>
                  <Input
                    type="number"
                    value={autoRounds}
                    onChange={(e) => setAutoRounds(clampNumberString(e.target.value, 1, 200))}
                    disabled={autoOn || isSpinning}
                    className="mt-1"
                    data-testid="input-auto-rounds"
                  />
                </div>

                <div className="col-span-2 sm:col-span-1 flex items-end gap-2">
                  <Button
                    type="button"
                    variant={stopOnWin ? "default" : "outline"}
                    className={cn("flex-1 rounded-xl", stopOnWin ? "bg-white/10" : "bg-transparent")}
                    onClick={() => setStopOnWin((v) => !v)}
                    disabled={autoOn || isSpinning}
                    data-testid="btn-stop-on-win"
                  >
                    Stop on Win
                  </Button>
                </div>

                <div>
                  <label className="text-xs text-white/60">Stop Loss (₹)</label>
                  <Input
                    type="number"
                    value={stopLoss}
                    onChange={(e) => setStopLoss(clampNumberString(e.target.value, 0, 1000000) || "0")}
                    disabled={autoOn || isSpinning}
                    className="mt-1"
                    data-testid="input-stop-loss"
                  />
                </div>
                <div>
                  <label className="text-xs text-white/60">Stop Profit (₹)</label>
                  <Input
                    type="number"
                    value={stopProfit}
                    onChange={(e) => setStopProfit(clampNumberString(e.target.value, 0, 1000000) || "0")}
                    disabled={autoOn || isSpinning}
                    className="mt-1"
                    data-testid="input-stop-profit"
                  />
                </div>

                <div className="col-span-2 flex gap-2 mt-1">
                  {!autoOn ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1 rounded-2xl bg-transparent"
                      onClick={startAutoplay}
                      disabled={isSpinning}
                      data-testid="btn-autoplay-start-2"
                    >
                      <Play className="w-4 h-4 mr-2" />
                      Start Autoplay
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1 rounded-2xl bg-transparent"
                      onClick={stopAutoplayNow}
                      data-testid="btn-autoplay-stop-2"
                    >
                      <Pause className="w-4 h-4 mr-2" />
                      Stop Autoplay
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Fairness card */}
        <Card className="p-4 flex items-center gap-3 bg-primary/5 border-primary/20">
          <Shield className="w-5 h-5 text-primary" />
          <div className="text-sm">
            <p className="font-medium text-primary">Provably Fair</p>
            <p className="text-muted-foreground">Every result can be verified</p>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
