// @ts-nocheck
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Dices, ArrowUp, ArrowDown, Shield, History, Zap, Layers } from "lucide-react";
// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type DiceResult } from "@/lib/api";
import { Link } from "wouter";
import { useStore } from "@/lib/store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ProvablyFairCard } from "@/components/casino/ProvablyFairCard";

const QUICK_BETS = [10, 50, 100, 500, 1000];

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function vibrate(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(pattern);
  }
}

// --- WebAudio mini engine (no assets) ---
function useDiceAudio() {
  const ctxRef = useRef<AudioContext | null>(null);

  const ensure = async () => {
    if (typeof window === "undefined") return;
    if (!ctxRef.current) {
      // @ts-ignore
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      ctxRef.current = new AudioCtx();
    }
    if (ctxRef.current.state === "suspended") {
      await ctxRef.current.resume();
    }
  };

  // “obsidian stone” click
  const thud = async (pan: number) => {
    await ensure();
    const ctx = ctxRef.current!;
    const now = ctx.currentTime;

    const noise = ctx.createBuffer(1, 900, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);

    const src = ctx.createBufferSource();
    src.buffer = noise;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 260 + Math.random() * 90;
    filter.Q.value = 2.2;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(ctx.destination);

    src.start(now);
    src.stop(now + 0.2);
  };

  // crystalline win shimmer
  const shimmer = async (strength: number) => {
    await ensure();
    const ctx = ctxRef.current!;
    const now = ctx.currentTime;

    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const g = ctx.createGain();

    o1.type = "sine";
    o2.type = "sine";
    o1.frequency.value = 520 + strength * 18;
    o2.frequency.value = 1040 + strength * 35;

    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);

    o1.connect(g);
    o2.connect(g);
    g.connect(ctx.destination);

    o1.start(now);
    o2.start(now);
    o1.stop(now + 0.7);
    o2.stop(now + 0.7);
  };

  return { ensure, thud, shimmer };
}

// --- Visual-only dice faces for immersion ---
function dieFace(n: number) {
  // map 1..100 to 1..6
  const v = ((n - 1) % 6) + 1;
  return v;
}

// --- Energy Beam slider (custom, surreal) ---
function EnergyBeamSlider({
  value,
  onChange,
  disabled,
  heat,
}: {
  value: number; // 2..99
  onChange: (v: number) => void;
  disabled?: boolean;
  heat: number[]; // last rolls 1..100
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  const pct = clamp((value - 2) / (99 - 2), 0, 1) * 100;

  const onPointer = (clientX: number) => {
    if (disabled) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = clamp((clientX - r.left) / r.width, 0, 1);
    const v = Math.round(2 + x * (99 - 2));
    onChange(v);
  };

  return (
    <div className="space-y-2">
      <div
        ref={ref}
        className={cn(
          "relative h-12 rounded-2xl border border-white/10 bg-black/35 overflow-hidden select-none",
          disabled ? "opacity-70" : "cursor-pointer"
        )}
        onPointerDown={(e) => onPointer(e.clientX)}
        onPointerMove={(e) => {
          if (e.buttons === 1) onPointer(e.clientX);
        }}
        role="slider"
        aria-valuemin={2}
        aria-valuemax={99}
        aria-valuenow={value}
      >
        {/* energy beam */}
        <div className="absolute inset-0">
          <div className="absolute inset-0 opacity-70"
               style={{
                 background:
                   "radial-gradient(circle at 20% 50%, rgba(120,80,255,0.35), transparent 60%), radial-gradient(circle at 80% 50%, rgba(0,255,200,0.18), transparent 60%)"
               }}
          />
          <div
            className="absolute inset-y-0 left-0"
            style={{
              width: `${pct}%`,
              background:
                "linear-gradient(90deg, rgba(120,80,255,0.0), rgba(120,80,255,0.18), rgba(0,255,200,0.22))",
              filter: "blur(0px)",
            }}
          />
          <div
            className="absolute -inset-x-10 top-0 h-full opacity-50 animate-[beam_1.2s_linear_infinite]"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(255,255,255,0.16), transparent)",
              filter: "blur(6px)",
            }}
          />
        </div>

        {/* Heatmap dots (last 10 rolls) */}
        <div className="absolute inset-0 pointer-events-none">
          {heat.slice(0, 10).map((roll, idx) => {
            const p = clamp((roll - 1) / 99, 0, 1) * 100;
            return (
              <div
                key={`${roll}-${idx}`}
                className="absolute top-1/2 -translate-y-1/2"
                style={{ left: `calc(${p}% - 5px)` }}
              >
                <div className="h-2.5 w-2.5 rounded-full bg-primary/60 shadow-[0_0_12px_rgba(150,110,255,0.35)]" />
              </div>
            );
          })}
        </div>

        {/* handle */}
        <div
          className="absolute top-1/2 -translate-y-1/2"
          style={{ left: `calc(${pct}% - 16px)` }}
        >
          <div className="h-8 w-8 rounded-2xl bg-background/70 border border-white/15 shadow-[0_0_28px_rgba(140,90,255,0.30)] flex items-center justify-center">
            <div className="h-2 w-2 rounded-full bg-primary shadow-[0_0_18px_rgba(140,90,255,0.7)]" />
          </div>
        </div>
      </div>

      <div className="flex justify-between text-xs text-muted-foreground">
        <span>2</span>
        <span>50</span>
        <span>99</span>
      </div>

      <style>{`
        @keyframes beam {
          0% { transform: translateX(-20%); opacity: 0.3; }
          50% { opacity: 0.8; }
          100% { transform: translateX(20%); opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

// --- 3D-ish dice cube (CSS illusion) ---
function DiceCube({
  value,
  tone,
  rolling,
}: {
  value: number | null;
  tone: "light" | "dark";
  rolling: boolean;
}) {
  const face = value ? dieFace(value) : null;

  return (
    <div className={cn("relative w-28 h-28 mx-auto", rolling && "animate-[diceFloat_0.7s_ease-in-out_infinite]")}>
      <div
        className={cn(
          "absolute inset-0 rounded-3xl border",
          "bg-gradient-to-br",
          tone === "dark"
            ? "from-slate-900/80 to-slate-800/30 border-white/10"
            : "from-white/14 to-white/5 border-white/15",
          "shadow-[0_22px_55px_rgba(0,0,0,0.45)]"
        )}
        style={{
          transform: rolling ? "rotateX(18deg) rotateY(-22deg)" : "rotateX(12deg) rotateY(-16deg)",
          transition: "transform 220ms ease",
        }}
      />
      {/* specular highlight */}
      <div
        className="absolute -top-6 left-0 right-0 h-24 rounded-[32px] opacity-50"
        style={{
          background: "linear-gradient(180deg, rgba(255,255,255,0.30), rgba(255,255,255,0))",
          transform: "skewY(-12deg)",
          filter: "blur(1px)",
        }}
      />
      {/* face value */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className={cn(
            "text-5xl font-extrabold font-mono",
            tone === "dark" ? "text-white" : "text-white",
            "drop-shadow-[0_0_18px_rgba(140,90,255,0.20)]"
          )}
        >
          {face ?? "?"}
        </div>
      </div>

      <style>{`
        @keyframes diceFloat {
          0% { transform: translateY(0px); }
          50% { transform: translateY(-6px); }
          100% { transform: translateY(0px); }
        }
      `}</style>
    </div>
  );
}

export default function DiceGame() {
  const [betAmount, setBetAmount] = useState("100");
  const [target, setTarget] = useState(50);
  const [prediction, setPrediction] = useState<"high" | "low">("high");
  const [isRolling, setIsRolling] = useState(false);

  const [lastRoll, setLastRoll] = useState<number | null>(null);
  const [lastGame, setLastGame] = useState<DiceResult | null>(null);
  const [history, setHistory] = useState<DiceResult[]>([]);

  // Surreal upgrades
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [diceCount, setDiceCount] = useState<1 | 2 | 3>(1);
  const [autoMode, setAutoMode] = useState<"off" | "martingale" | "dalembert">("off");
  const [autoRunning, setAutoRunning] = useState(false);

  const holdRef = useRef<{ holding: boolean; ms: number; timer: any }>({ holding: false, ms: 0, timer: null });

  const { currentUser, setCurrentUser } = useStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const audio = useDiceAudio();

  // prewarm audio on first gesture
  useEffect(() => {
    const onFirst = () => {
      audio.ensure().catch(() => {});
      window.removeEventListener("pointerdown", onFirst);
    };
    window.addEventListener("pointerdown", onFirst, { once: true });
    return () => window.removeEventListener("pointerdown", onFirst);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const winChance = prediction === "high" ? 100 - target : target - 1;
  const multiplier = winChance > 0 ? Math.floor((97 / winChance) * 100) / 100 : 0;
  const potentialWin = parseFloat(betAmount || "0") * multiplier;

  const heat = useMemo(() => history.map((h) => h.roll), [history]);

  const rollMutation = useMutation({
    mutationFn: async (amountOverride?: number) => {
      const amount = typeof amountOverride === "number" ? amountOverride : parseFloat(betAmount);
      if (isNaN(amount) || amount <= 0) throw new Error("Invalid bet amount");
      return await api.playDice(amount, prediction, target);
    },
    onMutate: () => {
      setIsRolling(true);
      setLastGame(null);

      // “rattle” start
      vibrate([10, 15, 10]);
    },
    onSuccess: async (data) => {
      // rolling animation: fast random numbers
      let animatedRoll = 0;
      const interval = setInterval(() => {
        animatedRoll = Math.floor(Math.random() * 100) + 1;
        setLastRoll(animatedRoll);
      }, 40);

      // spatial thuds while rolling
      audio.thud(-0.5).catch(() => {});
      setTimeout(() => audio.thud(0.5).catch(() => {}), 120);

      setTimeout(async () => {
        clearInterval(interval);

        setLastRoll(data.roll);
        setIsRolling(false);
        setLastGame(data);

        setHistory((prev) => [data, ...prev].slice(0, 10));

        // Impact: screen shake + chromatic effect
        document.documentElement.classList.add("dice-impact");
        setTimeout(() => document.documentElement.classList.remove("dice-impact"), 220);

        // Haptic impact
        vibrate(18);

        if (data.isWin) {
          audio.shimmer(clamp(multiplier, 1, 20)).catch(() => {});
          vibrate([20, 30, 20, 30, 60]);

          toast({
            title: `Rolled ${data.roll}! You Win!`,
            description: `+₹${data.payout.toFixed(2)}`,
            className: "bg-emerald-600 text-white border-none",
          });
        } else {
          toast({
            title: `Rolled ${data.roll}`,
            description: `Lost ₹${data.betAmount.toFixed(2)}`,
            variant: "destructive",
          });
        }

        setCurrentUser({
          ...currentUser!,
          balance: data.newBalance,
        });

        queryClient.invalidateQueries({ queryKey: ["casino-history"] });

        // Auto strategies (simple client-run loop)
        if (autoRunning) {
          const base = parseFloat(betAmount || "0") || 0;
          let next = base;

          if (autoMode === "martingale") {
            next = data.isWin ? base : base * 2;
          } else if (autoMode === "dalembert") {
            next = data.isWin ? Math.max(1, base - 10) : base + 10;
          }

          setBetAmount(String(Math.round(next)));
          // short pause then continue
          setTimeout(() => {
            rollMutation.mutate(next);
          }, 450);
        }
      }, 900);
    },
    onError: (error: unknown) => {
      setIsRolling(false);
      toast({
        title: "Roll Failed",
        description: error instanceof Error ? error.message : "Something went wrong",
        variant: "destructive",
      });
    },
  });

  const handleRoll = () => {
    if (!currentUser) {
      toast({ title: "Please login", variant: "destructive" });
      return;
    }
    rollMutation.mutate();
  };

  // Hold-to-roll rattle intensity (surreal feel)
  const onHoldStart = () => {
    if (isRolling || !currentUser) return;
    holdRef.current.holding = true;
    holdRef.current.ms = 0;

    holdRef.current.timer = setInterval(() => {
      holdRef.current.ms += 120;
      // stronger as you hold
      const t = clamp(holdRef.current.ms / 1200, 0, 1);
      const pulse = Math.round(8 + t * 18);
      vibrate(pulse);
    }, 120);
  };

  const onHoldEnd = () => {
    if (holdRef.current.timer) clearInterval(holdRef.current.timer);
    holdRef.current.timer = null;
    holdRef.current.holding = false;

    // release => roll
    handleRoll();
  };

  const canRoll = !!currentUser && !isRolling;

  return (
    <AppShell hideHeader hideBottomNav>
      <div className="flex flex-col gap-6 pb-20 md:pb-6 max-w-2xl mx-auto px-4">
        <div className="flex items-center gap-4 pt-2">
          <Link href="/casino">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div className="min-w-0">
            <h1 className="text-2xl font-heading font-extrabold flex items-center gap-2">
              <Dices className={cn("w-6 h-6", theme === "dark" ? "text-violet-400" : "text-cyan-300")} />
              Surreal Dice
            </h1>
            <p className="text-sm text-muted-foreground">Energy beam prediction • cinematic roll</p>
          </div>
        </div>

        <Card
          className={cn(
            "relative p-6 border overflow-hidden",
            theme === "dark"
              ? "bg-gradient-to-br from-slate-950/60 via-violet-950/35 to-slate-900/40 border-white/10"
              : "bg-gradient-to-br from-cyan-950/35 via-slate-900/35 to-emerald-950/25 border-white/10"
          )}
        >
          {/* ambient glows */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-20 -right-20 h-64 w-64 rounded-full bg-violet-500/15 blur-3xl" />
            <div className="absolute -bottom-20 -left-20 h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl" />
          </div>

          {/* Dice display */}
          <div className="relative z-10 flex items-center justify-center py-6">
            <div className="flex items-center gap-3">
              {Array.from({ length: diceCount }).map((_, i) => (
                <div key={i} className="scale-[0.92]">
                  <DiceCube value={lastRoll ? lastRoll + i * 7 : null} tone={theme} rolling={isRolling} />
                </div>
              ))}
            </div>
          </div>

          {lastGame && (
            <div
              className={cn(
                "relative z-10 text-center mb-5 p-4 rounded-2xl border",
                lastGame.isWin
                  ? "bg-emerald-500/12 border-emerald-500/20"
                  : "bg-red-500/12 border-red-500/20"
              )}
            >
              <p className={cn("text-xl font-extrabold", lastGame.isWin ? "text-emerald-300" : "text-red-300")}>
                {lastGame.isWin ? `WIN! +₹${lastGame.payout.toFixed(2)}` : "LOST"}
              </p>
            </div>
          )}

          {/* Prediction buttons */}
          <div className="relative z-10 grid grid-cols-2 gap-4 mb-5">
            <Button
              variant={prediction === "low" ? "default" : "outline"}
              className={cn(
                "h-14 text-base gap-2 rounded-2xl font-bold",
                prediction === "low" ? "bg-red-600 hover:bg-red-700" : ""
              )}
              onClick={() => setPrediction("low")}
              disabled={isRolling}
            >
              <ArrowDown className="w-5 h-5" />
              Under {target}
            </Button>

            <Button
              variant={prediction === "high" ? "default" : "outline"}
              className={cn(
                "h-14 text-base gap-2 rounded-2xl font-bold",
                prediction === "high" ? "bg-emerald-600 hover:bg-emerald-700" : ""
              )}
              onClick={() => setPrediction("high")}
              disabled={isRolling}
            >
              <ArrowUp className="w-5 h-5" />
              Over {target}
            </Button>
          </div>

          {/* Energy Beam slider + heatmap */}
          <div className="relative z-10 mb-5">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-muted-foreground">Target</span>
              <span className="text-muted-foreground">
                {prediction === "high" ? `Win if > ${target}` : `Win if < ${target}`}
              </span>
            </div>

            <EnergyBeamSlider
              value={target}
              onChange={setTarget}
              disabled={isRolling}
              heat={heat}
            />
          </div>

          {/* Stats */}
          <div className="relative z-10 grid grid-cols-3 gap-4 mb-5 p-4 rounded-2xl bg-black/25 border border-white/10">
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">Win Chance</p>
              <p className="text-lg font-extrabold text-primary">{winChance.toFixed(1)}%</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">Multiplier</p>
              <p className="text-lg font-extrabold text-yellow-300">{multiplier.toFixed(2)}x</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">Potential</p>
              <p className="text-lg font-extrabold text-emerald-300">₹{potentialWin.toFixed(2)}</p>
            </div>
          </div>

          {/* Strategy row */}
          <div className="relative z-10 grid grid-cols-3 gap-2 mb-4">
            <Button
              variant="outline"
              className="rounded-2xl"
              disabled={isRolling}
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            >
              {theme === "dark" ? "Dark" : "Light"}
            </Button>

            <Button
              variant="outline"
              className="rounded-2xl flex items-center gap-2"
              disabled={isRolling}
              onClick={() => setDiceCount((c) => (c === 1 ? 2 : c === 2 ? 3 : 1))}
              title="Visual multi-dice mode"
            >
              <Layers className="w-4 h-4" />
              {diceCount}x
            </Button>

            <Button
              variant={autoRunning ? "default" : "outline"}
              className={cn("rounded-2xl", autoRunning ? "bg-primary hover:bg-primary/90" : "")}
              disabled={isRolling && !autoRunning}
              onClick={() => {
                if (autoRunning) {
                  setAutoRunning(false);
                  setAutoMode("off");
                  toast({ title: "Auto-bet stopped" });
                  return;
                }
                // start with last selected strategy (default martingale)
                const mode = autoMode === "off" ? "martingale" : autoMode;
                setAutoMode(mode);
                setAutoRunning(true);
                toast({ title: `Auto-bet: ${mode}`, description: "Tap again to stop" });
                // kick first roll
                setTimeout(() => rollMutation.mutate(), 150);
              }}
            >
              {autoRunning ? "STOP" : "AUTO"}
            </Button>
          </div>

          {/* Bet controls */}
          <div className="relative z-10 mb-4">
            <label className="text-sm text-muted-foreground mb-2 block">Bet Amount</label>
            <Input
              type="number"
              value={betAmount}
              onChange={(e) => setBetAmount(e.target.value)}
              className="text-lg font-mono mb-2"
              min="10"
              disabled={isRolling || autoRunning}
              data-testid="dice-bet-input"
            />
            <div className="flex flex-wrap gap-2">
              {QUICK_BETS.map((amount) => (
                <Button
                  key={amount}
                  variant="outline"
                  size="sm"
                  onClick={() => setBetAmount(amount.toString())}
                  disabled={isRolling || autoRunning}
                >
                  ₹{amount}
                </Button>
              ))}
            </div>

            {/* Strategy selector (simple) */}
            <div className="mt-3 flex gap-2">
              <Button
                variant={autoMode === "martingale" ? "default" : "outline"}
                size="sm"
                className={cn("rounded-full", autoMode === "martingale" ? "bg-primary" : "")}
                disabled={autoRunning}
                onClick={() => setAutoMode("martingale")}
              >
                Martingale
              </Button>
              <Button
                variant={autoMode === "dalembert" ? "default" : "outline"}
                size="sm"
                className={cn("rounded-full", autoMode === "dalembert" ? "bg-primary" : "")}
                disabled={autoRunning}
                onClick={() => setAutoMode("dalembert")}
              >
                D’Alembert
              </Button>
            </div>
          </div>

          {/* Roll button: hold for rattle, release to roll */}
          <Button
            className={cn(
              "relative z-10 w-full h-14 text-lg gap-2 rounded-2xl font-extrabold",
              theme === "dark" ? "bg-primary hover:bg-primary/90" : "bg-emerald-600 hover:bg-emerald-700"
            )}
            disabled={!canRoll || autoRunning}
            onPointerDown={onHoldStart}
            onPointerUp={onHoldEnd}
            onPointerCancel={onHoldEnd}
            data-testid="dice-roll-button"
          >
            {isRolling ? (
              <>
                <Dices className="w-5 h-5 animate-spin" />
                Rolling...
              </>
            ) : (
              <>
                <Dices className="w-5 h-5" />
                Hold & Release to Roll (₹{parseFloat(betAmount || "0").toFixed(0)})
                <span className="ml-2 text-xs opacity-80 inline-flex items-center gap-1">
                  <Zap className="w-4 h-4" /> rattle
                </span>
              </>
            )}
          </Button>

          <div className="relative z-10 text-xs text-muted-foreground text-center mt-2">
            Tip: Holding increases haptic “rattle” intensity (supported browsers).
          </div>
        </Card>

        {lastGame && (
          <div className="grid gap-4">
            <ProvablyFairCard
              roundId={lastGame.roundId}
              serverSeedHash={lastGame.serverSeedHash}
              clientSeed={lastGame.clientSeed}
              nonce={lastGame.nonce}
            />

            <Card className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold">Recent Rolls</span>
              </div>

              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground">Play to see history.</p>
              ) : (
                <div className="space-y-2">
                  {history.map((item, idx) => (
                    <div
                      key={`${item.roundId}-${idx}`}
                      className="flex justify-between text-sm rounded-xl bg-card/40 border border-border/40 px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">
                          {item.roundId ? `#${item.roundId.slice(0, 6)}` : "Round"}
                        </span>
                        <span className={cn("font-semibold", item.isWin ? "text-emerald-300" : "text-red-300")}>
                          Rolled {item.roll}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-muted-foreground">Payout</span>
                        <div className="font-medium">₹{item.payout.toFixed(2)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">How to Play</span>
          </div>
          <ul className="text-sm text-muted-foreground space-y-2">
            <li>• Set a target number (2–99) using the energy beam.</li>
            <li>• Predict if the roll will be higher or lower than the target.</li>
            <li>• Lower win chance = higher multiplier.</li>
            <li>• Heat dots show where recent rolls landed.</li>
          </ul>
        </Card>

      </div>

      {/* Chromatic impact + shake */}
      <style>{`
        .dice-impact body {
          animation: diceShake 220ms ease;
          filter: drop-shadow(0 0 0 rgba(0,0,0,0));
        }
        .dice-impact * {
          filter: saturate(1.05) contrast(1.02);
        }
        .dice-impact .app-shell, .dice-impact main, .dice-impact #root {
          filter: drop-shadow(-2px 0 0 rgba(255,0,100,0.10)) drop-shadow(2px 0 0 rgba(0,160,255,0.10));
        }
        @keyframes diceShake {
          0% { transform: translate(0,0); }
          25% { transform: translate(2px,-1px); }
          50% { transform: translate(-2px,1px); }
          75% { transform: translate(1px,2px); }
          100% { transform: translate(0,0); }
        }
      `}</style>
    </AppShell>
  );
}
