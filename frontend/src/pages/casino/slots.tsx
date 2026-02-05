import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Cherry, RefreshCw, Shield, History, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type SlotsResult } from "@/lib/api";
import { Link } from "wouter";
import { useStore } from "@/lib/store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ProvablyFairCard } from "@/components/casino/ProvablyFairCard";

const QUICK_BETS = [10, 50, 100, 500, 1000];

// --- Surreal Symbol Set (glassy / metallic vibe using gradients + emoji fallback) ---
const SYMBOLS = [
  { id: "SEVEN", glyph: "7", label: "Seven", tone: "from-cyan-400/35 to-blue-600/10", glow: "shadow-cyan-500/25" },
  { id: "CHERRY", glyph: "🍒", label: "Cherry", tone: "from-pink-400/35 to-purple-600/10", glow: "shadow-pink-500/25" },
  { id: "DIAMOND", glyph: "💎", label: "Diamond", tone: "from-emerald-400/35 to-teal-600/10", glow: "shadow-emerald-500/25" },
  { id: "STAR", glyph: "✦", label: "Star", tone: "from-yellow-400/35 to-orange-600/10", glow: "shadow-yellow-500/25" },
  { id: "ORB", glyph: "⬤", label: "Orb", tone: "from-violet-400/35 to-fuchsia-600/10", glow: "shadow-fuchsia-500/25" },
  { id: "CROWN", glyph: "♛", label: "Crown", tone: "from-amber-300/35 to-yellow-500/10", glow: "shadow-amber-500/25" },
];

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function isBrowserVibrateSupported() {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

// --- Infinity Background: particles + optional gyro tilt ---
function InfinityBackground({
  intensity = 1,
  hueShift = 0,
}: {
  intensity?: number;
  hueShift?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tiltRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      w = parent.clientWidth;
      h = parent.clientHeight;
      canvas.width = Math.floor(w * devicePixelRatio);
      canvas.height = Math.floor(h * devicePixelRatio);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);

    // Particles
    const count = 70;
    const particles = Array.from({ length: count }).map(() => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 0.6 + Math.random() * 2.2,
      vx: (-0.15 + Math.random() * 0.3) * intensity,
      vy: (-0.15 + Math.random() * 0.3) * intensity,
      a: 0.08 + Math.random() * 0.15,
    }));

    // Gyro (optional, permission might block on iOS)
    const onDeviceOrientation = (e: DeviceOrientationEvent) => {
      const gx = (e.gamma ?? 0) / 45; // -1..1-ish
      const gy = (e.beta ?? 0) / 45;
      tiltRef.current.x = clamp(gx, -1, 1);
      tiltRef.current.y = clamp(gy, -1, 1);
    };

    window.addEventListener("deviceorientation", onDeviceOrientation);

    // Fallback: gentle float even without gyro
    let t = 0;

    const loop = () => {
      t += 0.01;

      const tiltX = tiltRef.current.x || Math.sin(t) * 0.15;
      const tiltY = tiltRef.current.y || Math.cos(t * 0.9) * 0.15;

      ctx.clearRect(0, 0, w, h);

      // Deep obsidian/purple wash
      const grad = ctx.createRadialGradient(w * 0.5, h * 0.25, 30, w * 0.5, h * 0.6, Math.max(w, h));
      grad.addColorStop(0, `rgba(120, 60, 255, 0.10)`);
      grad.addColorStop(0.55, `rgba(20, 15, 45, 0.45)`);
      grad.addColorStop(1, `rgba(10, 10, 20, 0.70)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      for (const p of particles) {
        p.x += p.vx + tiltX * 0.55 * intensity;
        p.y += p.vy + tiltY * 0.55 * intensity;

        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10;
        if (p.y > h + 10) p.y = -10;

        const hue = (250 + hueShift + (p.x / w) * 40) % 360;
        ctx.beginPath();
        ctx.fillStyle = `hsla(${hue}, 95%, 70%, ${p.a})`;
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Subtle vignette
      const v = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.2, w * 0.5, h * 0.5, Math.max(w, h) * 0.65);
      v.addColorStop(0, "rgba(0,0,0,0)");
      v.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, w, h);

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("deviceorientation", onDeviceOrientation);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [intensity, hueShift]);

  return <canvas ref={canvasRef} className="absolute inset-0 z-0" />;
}

// --- Tiny WebAudio: ambient hum + click + win shimmer (no external files) ---
function useSurrealAudio() {
  const ctxRef = useRef<AudioContext | null>(null);
  const humGainRef = useRef<GainNode | null>(null);
  const startedRef = useRef(false);

  const ensure = async () => {
    if (typeof window === "undefined") return;
    if (!ctxRef.current) {
      // @ts-ignore
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      ctxRef.current = new AudioCtx();
    }
    const ctx = ctxRef.current!;
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    if (!startedRef.current) {
      // Ambient hum
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const g = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = "sine";
      osc.frequency.value = 48; // low hum
      osc2.type = "triangle";
      osc2.frequency.value = 96;

      filter.type = "lowpass";
      filter.frequency.value = 240;

      g.gain.value = 0.0;

      osc.connect(filter);
      osc2.connect(filter);
      filter.connect(g);
      g.connect(ctx.destination);

      osc.start();
      osc2.start();

      humGainRef.current = g;
      startedRef.current = true;

      // fade in hum
      g.gain.setTargetAtTime(0.05, ctx.currentTime, 0.2);
    }
  };

  const click = async () => {
    await ensure();
    const ctx = ctxRef.current!;
    const noiseBuffer = ctx.createBuffer(1, 800, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);

    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 1200;

    const gain = ctx.createGain();
    gain.gain.value = 0.07;

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    src.start();
  };

  const shimmer = async (strength: number) => {
    await ensure();
    const ctx = ctxRef.current!;
    const now = ctx.currentTime;

    const base = ctx.createOscillator();
    const over = ctx.createOscillator();
    const gain = ctx.createGain();

    base.type = "sine";
    over.type = "sine";
    base.frequency.value = 440 + strength * 40;
    over.frequency.value = 880 + strength * 80;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);

    base.connect(gain);
    over.connect(gain);
    gain.connect(ctx.destination);

    base.start(now);
    over.start(now);
    base.stop(now + 0.7);
    over.stop(now + 0.7);
  };

  const setHumIntensity = async (v: number) => {
    await ensure();
    const g = humGainRef.current;
    if (!g) return;
    g.gain.setTargetAtTime(clamp(v, 0.02, 0.12), ctxRef.current!.currentTime, 0.2);
  };

  return { ensure, click, shimmer, setHumIntensity };
}

// --- Convert numeric matrix to symbol matrix (keeps backend result, only changes visuals) ---
function toSymbolMatrix(raw: any): { id: string; glyph: string; label: string; tone: string; glow: string }[][] {
  // raw might be 5x3, 3x3, etc.
  const matrix = Array.isArray(raw) ? raw : [];
  const rows = matrix.length || 3;
  const cols = Array.isArray(matrix[0]) ? matrix[0].length : 3;

  const out: any[][] = [];
  for (let r = 0; r < rows; r++) {
    const row = matrix[r] || [];
    out[r] = [];
    for (let c = 0; c < cols; c++) {
      const num = Number(row[c] ?? 0);
      const idx = Math.abs(num) % SYMBOLS.length;
      out[r][c] = SYMBOLS[idx];
    }
  }
  return out;
}

// --- Simple "near miss" detector: 2 match in middle payline, third different ---
function detectNearMiss(symbols: ReturnType<typeof toSymbolMatrix>) {
  // Use middle row as payline (classic)
  const mid = Math.floor(symbols.length / 2);
  const row = symbols[mid] || [];
  if (row.length < 3) return null;
  const a = row[0]?.id;
  const b = row[1]?.id;
  const c = row[2]?.id;
  if (!a || !b || !c) return null;

  // if two match and one differs, spotlight the differing reel
  if (a === b && b !== c) return { spotlightCol: 2 };
  if (a === c && a !== b) return { spotlightCol: 1 };
  if (b === c && a !== b) return { spotlightCol: 0 };
  return null;
}

const QUICK_CHIPS = [500, 1000, 5000];

export default function SlotsGame() {
  const [betAmount, setBetAmount] = useState("100");
  const [round, setRound] = useState<SlotsResult | null>(null);

  const [isSpinning, setIsSpinning] = useState(false);
  const [turbo, setTurbo] = useState(false);

  const [lastWin, setLastWin] = useState<{ amount: number; multiplier: number } | null>(null);
  const [lastResult, setLastResult] = useState<{ isWin: boolean; payout: number; multiplier: number } | null>(null);
  const [history, setHistory] = useState<SlotsResult[]>([]);

  const [spotlightCol, setSpotlightCol] = useState<number | null>(null);
  const [paletteMode, setPaletteMode] = useState<"normal" | "gold">("normal");

  const spinStartRef = useRef<number>(0);

  const { currentUser, setCurrentUser } = useStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const audio = useSurrealAudio();

  // Pre-warm audio on first interaction
  useEffect(() => {
    const onFirst = () => {
      audio.ensure().catch(() => {});
      window.removeEventListener("pointerdown", onFirst);
    };
    window.addEventListener("pointerdown", onFirst, { once: true });
    return () => window.removeEventListener("pointerdown", onFirst);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const spinMutation = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(betAmount);
      if (isNaN(amount) || amount <= 0) throw new Error("Invalid bet amount");
      return await api.playSlots(amount);
    },
    onMutate: async () => {
      setIsSpinning(true);
      setSpotlightCol(null);
      setLastWin(null);
      setPaletteMode("normal");
      spinStartRef.current = Date.now();

      // more intensity during spin
      audio.setHumIntensity(turbo ? 0.1 : 0.08).catch(() => {});
      audio.click().catch(() => {});

      if (isBrowserVibrateSupported()) {
        navigator.vibrate([10, 15, 10]);
      }
    },
    onSuccess: async (data) => {
      const spinDuration = turbo ? 650 : 1400;

      // create near-miss tension before reveal
      const symbolsForDetect = toSymbolMatrix(data.result.symbols);
      const nearMiss = detectNearMiss(symbolsForDetect);

      // dim + spotlight for near-miss briefly
      if (!data.result.isWin && nearMiss) {
        setSpotlightCol(nearMiss.spotlightCol);
        if (isBrowserVibrateSupported()) navigator.vibrate(15);
      }

      setTimeout(async () => {
        const payout = Number(data.payout ?? 0);
        const newBalance = Number(data.newBalance ?? currentUser?.balance ?? 0);

        setRound({ ...data, payout, newBalance });
        setHistory((prev) => [{ ...data, payout, newBalance }, ...prev].slice(0, 6));
        setIsSpinning(false);
        setSpotlightCol(null);

        setLastResult({
          isWin: data.result.isWin,
          payout,
          multiplier: data.result.multiplier,
        });

        // multiplier dimension shift (gold mode)
        if (data.result.multiplier >= 10) {
          setPaletteMode("gold");
          audio.setHumIntensity(0.11).catch(() => {});
        } else {
          audio.setHumIntensity(0.05).catch(() => {});
        }

        if (data.result.isWin) {
          setLastWin({ amount: payout, multiplier: data.result.multiplier });

          const strength = clamp(data.result.multiplier, 1, 20);
          audio.shimmer(strength).catch(() => {});

          if (isBrowserVibrateSupported()) {
            // win rhythm
            navigator.vibrate([20, 30, 20, 30, 60]);
          }

          toast({
            title: `You Won! ✨`,
            description: `₹${payout.toFixed(2)} (${data.result.multiplier}x)`,
            className: "bg-emerald-600 text-white border-none",
          });
        } else {
          setLastWin(null);

          if (isBrowserVibrateSupported()) navigator.vibrate(10);

          toast({
            title: "No win this spin",
            description: `Lost ₹${Number(betAmount).toFixed(2)}`,
            variant: "destructive",
          });
        }

        setCurrentUser({
          ...currentUser!,
          balance: newBalance,
        });

        queryClient.invalidateQueries({ queryKey: ["casino-history"] });
      }, spinDuration);
    },
    onError: (error: unknown) => {
      setIsSpinning(false);
      setSpotlightCol(null);
      audio.setHumIntensity(0.05).catch(() => {});
      toast({
        title: "Spin Failed",
        description: error instanceof Error ? error.message : "Unable to spin",
        variant: "destructive",
      });
    },
  });

  const handleSpin = () => {
    if (!currentUser) {
      toast({ title: "Please login", variant: "destructive" });
      return;
    }
    if (isSpinning) return;
    spinMutation.mutate();
  };

  // Your backend gives numbers currently
  const rawSymbols = round?.result.symbols ?? [
    [14, 2, 75],
    [1, 63, 4],
    [28, 90, 2],
  ];

  const symbolMatrix = useMemo(() => toSymbolMatrix(rawSymbols), [rawSymbols]);

  // rows/cols dynamic
  const rows = symbolMatrix.length;
  const cols = symbolMatrix[0]?.length ?? 3;

  const spinOverlayIntensity = isSpinning ? (turbo ? 1 : 0.7) : 0;
  const bgHueShift = paletteMode === "gold" ? 35 : 0;

  const applyChip = (v: number) => {
    const curr = parseFloat(betAmount || "0") || 0;
    setBetAmount(String(curr + v));
  };

  const onSpinPointerDown = () => {
    setTurbo(true);
  };
  const onSpinPointerUp = () => {
    setTurbo(false);
  };

  return (
    <AppShell hideHeader hideBottomNav>
      <div className="relative overflow-hidden rounded-2xl">
        <InfinityBackground intensity={spinOverlayIntensity ? 1.2 : 0.9} hueShift={bgHueShift} />

        <div className="relative z-10 flex flex-col gap-6 pb-20 md:pb-6 max-w-2xl mx-auto px-4">
          {/* Header */}
          <div className="flex items-center gap-4 pt-2">
            <Link href="/casino">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div className="min-w-0">
              <h1 className="text-2xl font-heading font-extrabold flex items-center gap-2">
                <Cherry className="w-6 h-6 text-pink-400" />
                Surreal Slots
                {turbo ? (
                  <span className="ml-2 inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-primary/15 border border-primary/20 text-primary">
                    <Zap className="w-3.5 h-3.5" />
                    TURBO
                  </span>
                ) : null}
              </h1>
              <p className="text-sm text-muted-foreground">A neon lounge slot experience</p>
            </div>
          </div>

          {/* Machine */}
          <Card
            className={cn(
              "relative p-6 border space-y-4 overflow-hidden",
              paletteMode === "gold"
                ? "bg-gradient-to-br from-yellow-900/35 to-amber-900/20 border-yellow-500/25"
                : "bg-gradient-to-br from-purple-900/35 to-fuchsia-900/20 border-purple-500/25"
            )}
          >
            {/* inner glow */}
            <div className="absolute inset-0 opacity-80 pointer-events-none">
              <div className="absolute -top-16 -right-16 h-56 w-56 rounded-full bg-primary/15 blur-2xl" />
              <div className="absolute -bottom-20 -left-20 h-72 w-72 rounded-full bg-pink-500/10 blur-2xl" />
            </div>

            {/* Spotlight near-miss */}
            {spotlightCol !== null ? (
              <div className="absolute inset-0 z-10 pointer-events-none">
                <div className="absolute inset-0 bg-black/45" />
                <div
                  className="absolute top-14 bottom-24 rounded-2xl"
                  style={{
                    left: `${(spotlightCol / cols) * 100}%`,
                    width: `${100 / cols}%`,
                    boxShadow: "0 0 120px rgba(255,255,255,0.18)",
                    background: "radial-gradient(circle at 50% 30%, rgba(255,255,255,0.14), rgba(0,0,0,0))",
                  }}
                />
              </div>
            ) : null}

            {/* Reel Grid */}
            <div className="relative z-20 rounded-2xl p-4 bg-black/40 border border-white/10">
              {/* Neon Trails overlay while spinning */}
              {isSpinning ? (
                <div className="absolute inset-0 rounded-2xl pointer-events-none overflow-hidden">
                  <div
                    className={cn(
                      "absolute inset-0 opacity-60",
                      paletteMode === "gold" ? "bg-yellow-500/10" : "bg-primary/10"
                    )}
                  />
                  <div
                    className="absolute -inset-x-10 top-0 h-full animate-[spinTrail_0.8s_linear_infinite]"
                    style={{
                      background:
                        paletteMode === "gold"
                          ? "linear-gradient(90deg, transparent, rgba(255,220,120,0.22), transparent)"
                          : "linear-gradient(90deg, transparent, rgba(140,80,255,0.22), transparent)",
                      filter: "blur(6px)",
                      opacity: turbo ? 0.9 : 0.6,
                    }}
                  />
                </div>
              ) : null}

              <div
                className="grid gap-3"
                style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
              >
                {Array.from({ length: rows }).map((_, r) => (
                  <div key={r} className="contents">
                    {Array.from({ length: cols }).map((__, c) => {
                      const sym = symbolMatrix[r]?.[c] ?? SYMBOLS[0];

                      // Middle row gets extra emphasis (classic payline)
                      const isPayline = r === Math.floor(rows / 2);

                      return (
                        <div
                          key={`${r}-${c}`}
                          className={cn(
                            "relative aspect-square rounded-2xl border overflow-hidden",
                            "bg-gradient-to-br from-slate-900/70 to-slate-800/30",
                            "border-white/10",
                            isPayline ? "ring-1 ring-white/10" : "",
                            isSpinning ? "animate-pulse" : ""
                          )}
                          data-testid={`slot-${r}-${c}`}
                        >
                          {/* symbol glass layer */}
                          <div
                            className={cn(
                              "absolute inset-0 opacity-90",
                              `bg-gradient-to-br ${sym.tone}`
                            )}
                          />
                          {/* specular highlight */}
                          <div
                            className="absolute -top-8 left-0 right-0 h-20 opacity-50"
                            style={{
                              background:
                                "linear-gradient(180deg, rgba(255,255,255,0.35), rgba(255,255,255,0))",
                              transform: "skewY(-12deg)",
                              filter: "blur(1px)",
                            }}
                          />

                          {/* content */}
                          <div className="relative z-10 h-full w-full flex items-center justify-center">
                            {isSpinning ? (
                              <RefreshCw className={cn("w-8 h-8 animate-spin", paletteMode === "gold" ? "text-yellow-200" : "text-primary")} />
                            ) : (
                              <div
                                className={cn(
                                  "text-4xl md:text-5xl font-extrabold drop-shadow",
                                  isPayline ? "scale-[1.02]" : "opacity-90",
                                  // glow
                                  sym.glow,
                                  paletteMode === "gold" ? "text-yellow-100" : "text-white"
                                )}
                                style={{
                                  textShadow:
                                    paletteMode === "gold"
                                      ? "0 0 18px rgba(255,220,120,0.25)"
                                      : "0 0 18px rgba(160,120,255,0.20)",
                                }}
                                title={sym.label}
                              >
                                {sym.glyph}
                              </div>
                            )}
                          </div>

                          {/* payline indicator */}
                          {isPayline ? (
                            <div className="absolute left-2 right-2 bottom-2 h-[2px] rounded-full bg-white/10" />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            {/* Result panel */}
            {lastWin ? (
              <div className="relative z-20 text-center mt-4 p-4 rounded-2xl bg-emerald-500/12 border border-emerald-500/20">
                <p className="text-2xl font-extrabold text-emerald-300">
                  WIN! {lastWin.multiplier}x
                </p>
                <p className="text-lg text-emerald-200">
                  +₹{lastWin.amount.toFixed(2)}
                </p>
              </div>
            ) : !isSpinning && lastResult && !lastResult.isWin ? (
              <div className="relative z-20 text-center mt-4 p-4 rounded-2xl bg-red-500/12 border border-red-500/20">
                <p className="text-lg font-semibold text-red-200">No win this time</p>
                <p className="text-sm text-red-200/80">
                  Multiplier {lastResult.multiplier}x • Payout ₹{lastResult.payout.toFixed(2)}
                </p>
              </div>
            ) : null}

            {/* Controls */}
            <div className="relative z-20 space-y-4 mt-2">
              <div>
                <label className="text-sm text-muted-foreground mb-2 block">Bet Amount</label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    value={betAmount}
                    onChange={(e) => setBetAmount(e.target.value)}
                    className="text-lg font-mono"
                    min="10"
                    data-testid="slots-bet-input"
                  />
                  <Button
                    variant="outline"
                    onClick={() => setBetAmount((Math.max(1, parseFloat(betAmount || "0") / 2)).toString())}
                  >
                    ½
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setBetAmount((Math.max(1, parseFloat(betAmount || "0") * 2)).toString())}
                  >
                    2x
                  </Button>
                </div>
              </div>

              {/* Quick add chips */}
              <div className="flex flex-wrap gap-2">
                {QUICK_BETS.map((amount) => (
                  <Button
                    key={amount}
                    variant="outline"
                    size="sm"
                    onClick={() => setBetAmount(amount.toString())}
                    className={betAmount === amount.toString() ? "border-primary" : ""}
                  >
                    ₹{amount}
                  </Button>
                ))}
                {QUICK_CHIPS.map((v) => (
                  <Button key={`chip-${v}`} variant="outline" size="sm" onClick={() => applyChip(v)}>
                    +₹{v}
                  </Button>
                ))}
              </div>

              {/* Spin Button: Hold for turbo */}
              <Button
                className={cn(
                  "w-full h-14 text-lg gap-2 rounded-2xl font-extrabold",
                  paletteMode === "gold"
                    ? "bg-yellow-500 text-black hover:bg-yellow-400"
                    : "bg-primary hover:bg-primary/90"
                )}
                onClick={handleSpin}
                onPointerDown={onSpinPointerDown}
                onPointerUp={onSpinPointerUp}
                onPointerCancel={onSpinPointerUp}
                disabled={isSpinning || !currentUser}
                data-testid="slots-spin-button"
              >
                {isSpinning ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    {turbo ? "Spinning (Turbo)..." : "Spinning..."}
                  </>
                ) : (
                  <>
                    <Cherry className="w-5 h-5" />
                    Spin (₹{parseFloat(betAmount || "0").toFixed(0)})
                    <span className="ml-2 text-xs opacity-80">(hold for turbo)</span>
                  </>
                )}
              </Button>

              {/* Haptics note */}
              <div className="text-xs text-muted-foreground text-center">
                {isBrowserVibrateSupported()
                  ? "Haptics enabled on supported devices."
                  : "Haptics not supported in this browser."}
              </div>
            </div>
          </Card>

          {/* Provably fair + Recent */}
          {round && (
            <div className="grid gap-4">
              <ProvablyFairCard
                roundId={round.roundId}
                serverSeedHash={round.serverSeedHash}
                clientSeed={round.clientSeed}
                nonce={round.nonce}
              />

              <Card className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold">Recent Rounds</span>
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
                          <span className={cn("font-semibold", item.result.isWin ? "text-emerald-300" : "text-red-300")}>
                            {item.result.multiplier}x
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-xs text-muted-foreground">Payout</span>
                          <div className="font-medium">₹{Number(item.payout ?? 0).toFixed(2)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* Payouts */}
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">Payouts</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex justify-between p-2 rounded bg-card/40 border border-border/40">
                <span>💎💎💎</span><span className="text-emerald-300">50x</span>
              </div>
              <div className="flex justify-between p-2 rounded bg-card/40 border border-border/40">
                <span>7️⃣7️⃣7️⃣</span><span className="text-emerald-300">25x</span>
              </div>
              <div className="flex justify-between p-2 rounded bg-card/40 border border-border/40">
                <span>⭐⭐⭐</span><span className="text-emerald-300">10x</span>
              </div>
              <div className="flex justify-between p-2 rounded bg-card/40 border border-border/40">
                <span>Any 3 match</span><span className="text-emerald-300">5x</span>
              </div>
              <div className="flex justify-between p-2 rounded bg-card/40 border border-border/40 col-span-2">
                <span>Any 2 adjacent match</span><span className="text-emerald-300">2x</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* local keyframes */}
      <style>{`
        @keyframes spinTrail {
          0% { transform: translateX(-20%); opacity: 0.3; }
          50% { opacity: 0.9; }
          100% { transform: translateX(20%); opacity: 0.3; }
        }
      `}</style>
    </AppShell>
  );
}
