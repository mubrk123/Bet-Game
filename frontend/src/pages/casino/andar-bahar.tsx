// @ts-nocheck
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Shield } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Link } from "wouter";
import { useStore } from "@/lib/store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

const STAKES = [10, 50, 100, 200, 500, 1000, 2000, 5000];

type Side = "andar" | "bahar";

type PlayResult = {
  jokerCard: string;
  andarCards: string[];
  baharCards: string[];
  winningSide: Side;
  isWin: boolean;
  payout: number;
};

type DealtCard = {
  id: string;
  side: Side;
  label: string;
  order: number;
};

function uid() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

/** ------------------------------
 *  Winner normalization (FIXES UNDEFINED WON)
 *  ------------------------------ */
function normalizeSide(x: any): Side | null {
  if (x == null) return null;

  if (typeof x === "number") {
    if (x === 0) return "andar";
    if (x === 1) return "bahar";
  }

  const s = String(x).toLowerCase().trim();
  if (!s) return null;

  if (s.includes("andar")) return "andar";
  if (s.includes("bahar")) return "bahar";

  if (s === "a" || s.startsWith("a")) return "andar";
  if (s === "b" || s.startsWith("b")) return "bahar";

  return null;
}

/** ------------------------------
 *  Card Parsing + Rendering
 *  ------------------------------ */
type Suit = "spades" | "hearts" | "diamonds" | "clubs" | "unknown";

function suitGlyph(suit: Suit) {
  if (suit === "spades") return "♠";
  if (suit === "hearts") return "♥";
  if (suit === "diamonds") return "♦";
  if (suit === "clubs") return "♣";
  return "■";
}

function isRedSuit(suit: Suit) {
  return suit === "hearts" || suit === "diamonds";
}

function parseCardLabel(raw: string): { rank: string; suit: Suit; pretty: string } {
  const s = String(raw ?? "").trim();
  if (!s) return { rank: "?", suit: "unknown", pretty: "?" };

  const upper = s.toUpperCase();

  // contains suit symbols
  if (s.includes("♠") || s.includes("♥") || s.includes("♦") || s.includes("♣")) {
    const suit: Suit =
      s.includes("♠") ? "spades" : s.includes("♥") ? "hearts" : s.includes("♦") ? "diamonds" : "clubs";
    const rank = s.replace(/[♠♥♦♣]/g, "").trim() || "?";
    const pretty = `${rank}${suitGlyph(suit)}`;
    return { rank, suit, pretty };
  }

  // "A of Hearts"
  if (upper.includes(" OF ")) {
    const parts = upper.split(" OF ").map((x) => x.trim());
    const rankRaw = parts[0] ?? "?";
    const suitRaw = parts[1] ?? "";

    const suit: Suit =
      suitRaw.includes("HEART") ? "hearts" :
      suitRaw.includes("DIAMOND") ? "diamonds" :
      suitRaw.includes("SPADE") ? "spades" :
      suitRaw.includes("CLUB") ? "clubs" :
      "unknown";

    const rank = rankRaw.replace(/[^0-9AJQK]/g, "") || rankRaw;
    const pretty = suit === "unknown" ? rank : `${rank}${suitGlyph(suit)}`;
    return { rank, suit, pretty };
  }

  // Compact forms like "AS", "10H", "KD"
  const compact = upper.replace(/\s+/g, "");
  const match = compact.match(/^([0-9]{1,2}|A|K|Q|J)([SHDC])$/);
  if (match) {
    const rank = match[1];
    const suitLetter = match[2];
    const suit: Suit =
      suitLetter === "S" ? "spades" :
      suitLetter === "H" ? "hearts" :
      suitLetter === "D" ? "diamonds" :
      "clubs";
    const pretty = `${rank}${suitGlyph(suit)}`;
    return { rank, suit, pretty };
  }

  return { rank: s, suit: "unknown", pretty: s };
}

function CardBack({
  size = "sm",
  className,
}: {
  size?: "sm" | "md" | "xl";
  className?: string;
}) {
  const dims =
    size === "xl"
      ? "h-[70px] w-[52px] rounded-lg"
      : size === "md"
        ? "h-[48px] w-[36px] rounded-md"
        : "h-[40px] w-[30px] rounded-md";

  return (
    <div
      className={cn(
        "relative overflow-hidden border shadow-[0_10px_24px_rgba(0,0,0,0.45)]",
        dims,
        "border-white/18 bg-gradient-to-br from-black/65 to-black/18",
        className
      )}
    >
      <div className="absolute inset-0 opacity-70 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.10),transparent_60%)]" />
      <div className="absolute inset-0 opacity-70 bg-[linear-gradient(135deg,rgba(255,191,0,0.12),rgba(56,189,248,0.08),transparent)]" />
      <div className="absolute inset-0 border border-white/10 rounded-[inherit]" />
      <div className="absolute inset-1 rounded-[10px] border border-white/10">
        <div className="absolute inset-0 opacity-35 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.14),transparent_55%)]" />
      </div>
    </div>
  );
}

function CardFace({
  label,
  size = "sm",
  highlight = false,
  className,
}: {
  label: string;
  size?: "sm" | "md" | "target" | "xl";
  highlight?: boolean;
  className?: string;
}) {
  const p = parseCardLabel(label);
  const red = isRedSuit(p.suit);

  const dims =
    size === "target"
      ? "h-[92px] w-[64px] rounded-xl"
      : size === "xl"
        ? "h-[70px] w-[52px] rounded-lg"
        : size === "md"
          ? "h-[48px] w-[36px] rounded-md"
          : "h-[40px] w-[30px] rounded-md";

  const cornerText = (p.rank?.toString() ?? "?").slice(0, 2);

  return (
    <div
      className={cn(
        "relative overflow-hidden border bg-gradient-to-br shadow-[0_18px_55px_rgba(0,0,0,0.55)]",
        dims,
        "border-white/18 from-white/22 to-white/8",
        highlight && "ring-1 ring-white/25",
        className
      )}
    >
      <div className="absolute inset-0 opacity-70 bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.18),transparent_58%)]" />

      {/* Corner */}
      <div
        className={cn(
          "absolute left-2 top-2 text-[11px] font-extrabold leading-none",
          red ? "text-red-300" : "text-white/90"
        )}
        style={{ textShadow: "0 2px 14px rgba(0,0,0,0.65)" }}
      >
        <div>{cornerText}</div>
        <div className="text-[12px] -mt-[1px]">
          {p.suit === "unknown" ? "■" : suitGlyph(p.suit)}
        </div>
      </div>

      {/* Center suit */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className={cn(
            "font-black",
            size === "target" ? "text-4xl" : size === "xl" ? "text-3xl" : "text-xl",
            red ? "text-red-200/70" : "text-white/75"
          )}
          style={{ textShadow: "0 22px 65px rgba(0,0,0,0.70)" }}
        >
          {p.suit === "unknown" ? "■" : suitGlyph(p.suit)}
        </div>
      </div>

      {size === "target" && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] font-semibold tracking-[0.22em] text-white/70">
          TARGET
        </div>
      )}

      <div className="absolute inset-0 rounded-[inherit] border border-white/10" />
    </div>
  );
}

/** ------------------------------
 *  Outcome Overlay: win/lose screen effect
 *  ------------------------------ */
type OutcomeFx = null | {
  key: string;
  type: "win" | "lose";
  payout: number;
  winner: Side;
};

function OutcomeOverlay({ fx }: { fx: OutcomeFx }) {
  if (!fx) return null;

  const emojis =
    fx.type === "win"
      ? ["🎉", "🪙", "✨", "💸", "🥳", "⭐"]
      : ["😢", "💔", "🥀", "😞", "🫠", "🌧️"];

  const particles = Array.from({ length: 18 }).map((_, i) => {
    const left = Math.round(Math.random() * 92) + 2;
    const delay = Math.random() * 0.35;
    const dur = 1.2 + Math.random() * 0.8;
    const size = 16 + Math.round(Math.random() * 18);
    const emo = emojis[i % emojis.length];
    return { left, delay, dur, size, emo };
  });

  return (
    <div key={fx.key} className="pointer-events-none absolute inset-0 z-[80]">
      <div
        className={cn(
          "absolute inset-0 opacity-0",
          fx.type === "win"
            ? "bg-[radial-gradient(circle_at_50%_35%,rgba(16,185,129,0.20),transparent_60%)]"
            : "bg-[radial-gradient(circle_at_50%_35%,rgba(239,68,68,0.16),transparent_60%)]"
        )}
        style={{ animation: "screenFlash 950ms ease-out both" }}
      />

      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className={cn(
            "px-5 py-3 rounded-2xl border backdrop-blur-md",
            "bg-black/35",
            fx.type === "win"
              ? "border-emerald-300/25 shadow-[0_0_45px_rgba(16,185,129,0.18)]"
              : "border-red-300/20 shadow-[0_0_45px_rgba(239,68,68,0.12)]"
          )}
          style={{ animation: "popIn 900ms cubic-bezier(.2,.9,.2,1) both" }}
        >
          <div className="flex items-center gap-3">
            <div className="text-2xl">{fx.type === "win" ? "🎉" : "😢"}</div>
            <div>
              <div className="text-sm font-extrabold text-white/90 tracking-wide">
                {fx.type === "win" ? "YOU WIN" : "YOU LOSE"}
              </div>
              <div className="text-xs text-white/70">
                {fx.type === "win"
                  ? `+₹${fx.payout.toFixed(2)}`
                  : `${fx.winner.toUpperCase()} WON`}
              </div>
            </div>
          </div>
        </div>
      </div>

      {particles.map((p, idx) => (
        <div
          key={idx}
          className="absolute top-[-40px]"
          style={{
            left: `${p.left}%`,
            fontSize: `${p.size}px`,
            animation: `fall ${p.dur}s ease-in both`,
            animationDelay: `${p.delay}s`,
            filter: "drop-shadow(0 10px 30px rgba(0,0,0,0.45))",
            opacity: 0.95,
          }}
        >
          {p.emo}
        </div>
      ))}
    </div>
  );
}

/** ------------------------------
 *  Flying Card (ENHANCED with better timing and reveal)
 *  ------------------------------ */
type FlyingPayload = {
  id: string;
  label: string;
  side: Side;
  from: { x: number; y: number };
  to: { x: number; y: number };
};

function FlyingCard({
  payload,
  onComplete,
}: {
  payload: FlyingPayload;
  onComplete: () => void;
}) {
  const [fly, setFly] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const doneRef = useRef(false);

  const dx = payload.to.x - payload.from.x;
  const dy = payload.to.y - payload.from.y;
  const lift = payload.side === "andar" ? -26 : -18;
  const roll = payload.side === "andar" ? -10 : 10;

  useEffect(() => {
    const flightTimer = setTimeout(() => setFly(true), 10);
    const flipTimer = setTimeout(() => {
      setFlipped(true);
      setRevealed(true);
    }, 220);
    const completeTimer = setTimeout(() => {
      if (doneRef.current) return;
      doneRef.current = true;
      onComplete();
    }, 520);

    return () => {
      clearTimeout(flightTimer);
      clearTimeout(flipTimer);
      clearTimeout(completeTimer);
    };
  }, [payload.id, onComplete]);

  return (
    <div
      className="fixed left-0 top-0 z-[95] pointer-events-none"
      style={{ transform: `translate(${payload.from.x}px, ${payload.from.y}px)` }}
    >
      <motion.div
        initial={{ x: -0.0001, y: -0.0001, rotateZ: 0, scale: 0.92, opacity: 0.95 }}
        animate={
          fly
            ? { x: dx, y: dy + lift, rotateZ: roll, scale: 1, opacity: 1 }
            : { x: -0.0001, y: -0.0001, rotateZ: 0, scale: 0.92, opacity: 0.95 }
        }
        transition={{ duration: 0.52, ease: [0.2, 0.9, 0.25, 1.12] }}
        style={{
          transformOrigin: "center",
          filter: revealed
            ? "drop-shadow(0 30px 75px rgba(0,0,0,0.9)) saturate(1.08)"
            : "drop-shadow(0 18px 55px rgba(0,0,0,0.75))",
        }}
      >
        <div
          style={{
            width: 54,
            height: 74,
            perspective: 1200,
            transform: "translate(-50%, -50%)",
          }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              position: "relative",
              transformStyle: "preserve-3d",
              transform: flipped ? "rotateY(180deg) scale(1.06)" : "rotateY(0deg) scale(1)",
              transition: "transform 220ms cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                backfaceVisibility: "hidden",
                opacity: flipped ? 0 : 1,
                transition: "opacity 160ms ease-out",
              }}
            >
              <CardBack size="xl" />
            </div>

            <div
              style={{
                position: "absolute",
                inset: 0,
                transform: "rotateY(180deg)",
                backfaceVisibility: "hidden",
                opacity: flipped ? 1 : 0,
                transition: "opacity 160ms ease-out",
              }}
            >
              <CardFace label={payload.label} size="xl" />
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default function AndarBaharGame() {
  const { currentUser, setCurrentUser } = useStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Inputs
  const [choice, setChoice] = useState<Side>("andar");
  const [betAmount, setBetAmount] = useState<number>(100);

  // Playback
  const [isPlaying, setIsPlaying] = useState(false);
  const [result, setResult] = useState<PlayResult | null>(null);

  // Dealing state
  const [targetCard, setTargetCard] = useState<string>("AS");
  const [dealtAndar, setDealtAndar] = useState<DealtCard[]>([]);
  const [dealtBahar, setDealtBahar] = useState<DealtCard[]>([]);
  const [dealIndex, setDealIndex] = useState<number>(0);

  // FX
  const [revealActive, setRevealActive] = useState(false);
  const [beamActive, setBeamActive] = useState(false);

  // Heat map last 5
  const [heat, setHeat] = useState<Side[]>([]);

  // UI Impact FX
  const [outcomeShake, setOutcomeShake] = useState(false);
  const [fxOverlay, setFxOverlay] = useState<OutcomeFx>(null);

  // FLYING CARD STATE
  const [flyingCards, setFlyingCards] = useState<FlyingPayload[]>([]);
  const [completedFlights, setCompletedFlights] = useState<Set<string>>(new Set());

  // refs for measuring
  const deckRef = useRef<HTMLDivElement | null>(null);
  const andarDropRef = useRef<HTMLDivElement | null>(null);
  const baharDropRef = useRef<HTMLDivElement | null>(null);

  // timers cleanup
  const timersRef = useRef<number[]>([]);
  const clearTimers = () => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  };

  const potentialWin = useMemo(() => (Number(betAmount) || 0) * 1.9, [betAmount]);

  const canPlay = useMemo(() => {
    if (!currentUser) return false;
    if (!betAmount || betAmount <= 0) return false;
    return true;
  }, [currentUser, betAmount]);

  const resetRoundUI = () => {
    clearTimers();
    setResult(null);
    setRevealActive(false);
    setBeamActive(false);

    setTargetCard("AS");
    setDealtAndar([]);
    setDealtBahar([]);
    setDealIndex(0);

    setOutcomeShake(false);
    setFxOverlay(null);
    setFlyingCards([]);
    setCompletedFlights(new Set());
  };

  function centerOf(el: HTMLElement | null) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // ENHANCED SEQUENTIAL DEAL with flying cards
  const runDealSequence = (
    seq: { side: Side; label: string }[],
    onFinished: () => void
  ) => {
    setFlyingCards([]);
    setCompletedFlights(new Set());

    let currentIndex = 0;
    
    const processNextCard = () => {
      if (currentIndex >= seq.length) {
        // All cards have been dealt
        setTimeout(() => {
          onFinished();
        }, 300);
        return;
      }

      const item = seq[currentIndex];
      currentIndex++;
      setDealIndex(currentIndex);

      const from = centerOf(deckRef.current);
      const to = centerOf(item.side === "andar" ? andarDropRef.current : baharDropRef.current);

      if (!from || !to) {
        // Fallback if refs missing
        if (item.side === "andar") {
          setDealtAndar((prev) => [...prev, { id: uid(), side: "andar", label: item.label, order: currentIndex }].slice(-28));
        } else {
          setDealtBahar((prev) => [...prev, { id: uid(), side: "bahar", label: item.label, order: currentIndex }].slice(-28));
        }
        // Continue quickly
        setTimeout(processNextCard, 80);
        return;
      }

      const flyPayload: FlyingPayload = {
        id: uid(),
        label: item.label,
        side: item.side,
        from,
        to,
      };

      // Add flying card
      setFlyingCards(prev => [...prev, flyPayload]);

      // When flight completes
      const onCardComplete = () => {
        setCompletedFlights(prev => new Set([...prev, flyPayload.id]));
        
        // Add card to appropriate side
        if (item.side === "andar") {
          setDealtAndar((prev) => [...prev, { 
            id: uid(), 
            side: "andar", 
            label: item.label, 
            order: currentIndex 
          }].slice(-28));
        } else {
          setDealtBahar((prev) => [...prev, { 
            id: uid(), 
            side: "bahar", 
            label: item.label, 
            order: currentIndex 
          }].slice(-28));
        }

        // Remove flying card after a delay
        setTimeout(() => {
          setFlyingCards(prev => prev.filter(card => card.id !== flyPayload.id));
        }, 200);

        // Process next card with delay
        setTimeout(processNextCard, currentIndex === seq.length ? 0 : 120);
      };

      // Store completion handler
      (window as any)[`complete_${flyPayload.id}`] = onCardComplete;
    };

    // Start with a slight delay to show deck animation
    setTimeout(processNextCard, 200);
  };

  const playMutation = useMutation({
    mutationFn: async () => {
      const amount = Number(betAmount);
      if (!currentUser) throw new Error("Please login");
      if (Number.isNaN(amount) || amount <= 0) throw new Error("Invalid bet amount");
      return await api.playAndarBahar(amount, choice);
    },
    onMutate: () => {
      resetRoundUI();
      setIsPlaying(true);
    },
    onSuccess: (data: any) => {
      const newTarget = data?.jokerCard ?? data?.result?.jokerCard ?? "AS";
      setTargetCard(newTarget);

      const aRaw: string[] = Array.isArray(data?.andarCards)
        ? data.andarCards
        : Array.isArray(data?.result?.andarCards)
          ? data.result.andarCards
          : [];
      const bRaw: string[] = Array.isArray(data?.baharCards)
        ? data.baharCards
        : Array.isArray(data?.result?.baharCards)
          ? data.result.baharCards
          : [];

      // Fallback synthetic sequence if API somehow returns empty arrays
      const buildFallbackSeq = (win: Side) => {
        const rank = parseCardLabel(newTarget).rank || "A";
        const pool = ["3S", "9H", "5D", "8C", `${rank}S`, `${rank}H`];
        const seq: { side: Side; label: string }[] = [];
        pool.forEach((lbl, idx) => {
          const side: Side = idx % 2 === 0 ? "andar" : "bahar";
          seq.push({ side, label: lbl });
        });
        seq.push({ side: win, label: `${rank}${win === "andar" ? "C" : "D"}` });
        return seq;
      };

      let seq: { side: Side; label: string }[] = [];
      const maxLen = Math.max(aRaw.length, bRaw.length);
      for (let i = 0; i < maxLen; i++) {
        if (aRaw[i] != null) seq.push({ side: "andar", label: aRaw[i] });
        if (bRaw[i] != null) seq.push({ side: "bahar", label: bRaw[i] });
      }
      const targetRank = parseCardLabel(newTarget).rank;

      // Derive winner with stronger fallback to avoid "always andar"
      const serverWinner = normalizeSide(data?.winningSide ?? data?.result?.winningSide);
      const derivedWinnerFromSeq =
        targetRank && seq.find((c) => parseCardLabel(c.label).rank === targetRank)?.side;
      const winnerNorm = serverWinner ?? derivedWinnerFromSeq ?? (choice === "andar" ? "bahar" : "andar");

      if (seq.length === 0) {
        seq = buildFallbackSeq(winnerNorm);
      }

      // Run sequential deal with flying cards
      runDealSequence(seq, () => {
        // Reveal phase
        setRevealActive(true);
        setBeamActive(true);

        const t1 = setTimeout(() => setBeamActive(false), 900);
        timersRef.current.push(t1);

          const t2 = setTimeout(() => {
          const inferredWin = typeof data?.isWin === "boolean" ? data.isWin : winnerNorm === choice;
          const inferredPayout =
            typeof data?.payout === "number"
              ? data.payout
              : inferredWin
                ? Number((Number(betAmount) * 1.9).toFixed(2))
                : 0;

          const final: PlayResult = {
            jokerCard: newTarget,
            andarCards: seq.filter((c) => c.side === "andar").map((c) => c.label),
            baharCards: seq.filter((c) => c.side === "bahar").map((c) => c.label),
            winningSide: winnerNorm,
            isWin: inferredWin,
            payout: inferredPayout,
          };

          setResult(final);
          setIsPlaying(false);

          // Heat update
          setHeat((prev) => [...prev, winnerNorm].slice(-5));

          // Impact shake
          setOutcomeShake(true);
          setTimeout(() => setOutcomeShake(false), 650);

          // Overlay FX
          setFxOverlay({
            key: uid(),
            type: final.isWin ? "win" : "lose",
            payout: final.payout,
            winner: winnerNorm,
          });
          setTimeout(() => setFxOverlay(null), 1600);

          // Vibration
          try {
            if (typeof navigator !== "undefined" && "vibrate" in navigator) {
              if (final.isWin) navigator.vibrate([30, 40, 30, 40, 30]);
              else navigator.vibrate([80, 50, 80]);
            }
          } catch {}

          // Toast
          if (final.isWin) {
            toast({
              title: `🎉 YOU WIN`,
              description: `+₹${final.payout.toFixed(2)} • ${winnerNorm.toUpperCase()} WINS`,
              className: "bg-emerald-600 text-white border-none",
            });
          } else {
            toast({
              title: `😢 YOU LOSE`,
              description: `${winnerNorm.toUpperCase()} WINS`,
              variant: "destructive",
            });
          }

          // Balance update
          if (currentUser) {
            if (typeof data?.newBalance === "number") {
              setCurrentUser({ ...currentUser, balance: data.newBalance });
            } else {
              const nextBalance =
                currentUser.balance -
                Number(betAmount || 0) +
                (final.isWin ? final.payout : 0);
              setCurrentUser({ ...currentUser, balance: nextBalance });
            }
          }

          queryClient.invalidateQueries({ queryKey: ["casino-history"] });
        }, 600);

        timersRef.current.push(t2);
      });
    },
    onError: (error: any) => {
      setIsPlaying(false);
      toast({
        title: "Game Failed",
        description: error?.message || "Something went wrong",
        variant: "destructive",
      });
    },
  });

  const handlePlay = () => {
    if (!currentUser) {
      toast({ title: "Please login", variant: "destructive" });
      return;
    }
    if (!betAmount || betAmount <= 0) {
      toast({ title: "Enter bet amount", variant: "destructive" });
      return;
    }
    playMutation.mutate();
  };

  useEffect(() => {
    return () => clearTimers();
  }, []);

  const leftAura = choice === "andar";
  const rightAura = choice === "bahar";

  const winningSide = result?.winningSide ?? null;
  const showWinFX = !!result && revealActive;

  const losingSide: Side | null =
    showWinFX && winningSide ? (winningSide === "andar" ? "bahar" : "andar") : null;

  const andarFaded = showWinFX && losingSide === "andar";
  const baharFaded = showWinFX && losingSide === "bahar";

  const playLabel =
    isPlaying && dealIndex === 0 
      ? "SHUFFLING..." 
      : isPlaying 
        ? `DEALING ${dealIndex}/${Math.max(dealtAndar.length + dealtBahar.length, 1)}` 
        : `PLAY ₹${Number(betAmount || 0).toLocaleString("en-IN")}`;

  return (
    <AppShell hideHeader hideBottomNav fullBleed>
      <style>{`
        @keyframes shimmerBG {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes floatTarget {
          0% { transform: translateY(0px) rotateX(16deg) rotateY(-14deg); }
          50% { transform: translateY(-6px) rotateX(16deg) rotateY(-14deg); }
          100% { transform: translateY(0px) rotateX(16deg) rotateY(-14deg); }
        }
        @keyframes pulseOrb {
          0% { transform: scale(1); filter: drop-shadow(0 0 0 rgba(255,215,0,0)); }
          50% { transform: scale(1.04); filter: drop-shadow(0 0 14px rgba(255,215,0,0.25)); }
          100% { transform: scale(1); filter: drop-shadow(0 0 0 rgba(255,215,0,0)); }
        }
        @keyframes smokeFade {
          0% { opacity: 1; filter: blur(0px); transform: scale(1); }
          60% { opacity: 0.35; filter: blur(3px); transform: scale(0.98); }
          100% { opacity: 0.10; filter: blur(6px); transform: scale(0.96); }
        }
        @keyframes beamFlash {
          0% { opacity: 0; transform: scaleX(0.5); }
          25% { opacity: 1; transform: scaleX(1); }
          100% { opacity: 0; transform: scaleX(1.15); }
        }
        @keyframes shakeImpact {
          0% { transform: translateX(0); }
          12% { transform: translateX(-3px); }
          24% { transform: translateX(3px); }
          36% { transform: translateX(-2px); }
          48% { transform: translateX(2px); }
          60% { transform: translateX(-1px); }
          72% { transform: translateX(1px); }
          100% { transform: translateX(0); }
        }
        @keyframes popIn {
          0% { transform: translateY(8px) scale(0.92); opacity: 0; }
          60% { transform: translateY(0px) scale(1.04); opacity: 1; }
          100% { transform: translateY(0px) scale(1); opacity: 1; }
        }
        @keyframes fall {
          0% { transform: translateY(-10vh) rotate(0deg); opacity: 0; }
          10% { opacity: 1; }
          100% { transform: translateY(110vh) rotate(380deg); opacity: 1; }
        }
        @keyframes screenFlash {
          0% { opacity: 0; }
          12% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes deckShake {
          0% { transform: translateX(0px) rotate(0deg); }
          25% { transform: translateX(-3px) rotate(-2deg); }
          50% { transform: translateX(3px) rotate(2deg); }
          75% { transform: translateX(-2px) rotate(-1deg); }
          100% { transform: translateX(0px) rotate(0deg); }
        }
        @keyframes winnerPop {
          0% { transform: scale(1); }
          40% { transform: scale(1.15); }
          100% { transform: scale(1); }
        }
        @keyframes cardTrail {
          0% { opacity: 0; transform: scale(0.8); }
          50% { opacity: 0.6; }
          100% { opacity: 0; transform: scale(1.2); }
        }
        @keyframes neonSweep {
          0% { transform: translateX(-60%); opacity: 0; }
          50% { opacity: 0.22; }
          100% { transform: translateX(140%); opacity: 0; }
        }
        @keyframes glowPulse {
          0% { box-shadow: 0 0 0 rgba(255,255,255,0.0); }
          50% { box-shadow: 0 0 40px rgba(255,255,255,0.08); }
          100% { box-shadow: 0 0 0 rgba(255,255,255,0.0); }
        }

        .silk-bg {
          background: radial-gradient(1200px 700px at 50% 40%, rgba(255,215,0,0.10), rgba(0,0,0,0.84) 55%, rgba(0,0,0,0.95)),
                      linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.00));
          background-size: 200% 200%;
          animation: shimmerBG 10s ease-in-out infinite;
        }
        .table-perspective { perspective: 900px; }
        .table-surface { transform: rotateX(24deg); transform-origin: center top; }
      `}</style>

      <div className="h-screen overflow-hidden">
        <div className="relative h-full w-full silk-bg">
          <div className="absolute inset-0 pointer-events-none mix-blend-screen opacity-60 bg-[radial-gradient(circle_at_20%_25%,rgba(56,189,248,0.08),transparent_35%),radial-gradient(circle_at_80%_35%,rgba(255,191,0,0.09),transparent_35%),radial-gradient(circle_at_50%_70%,rgba(255,255,255,0.05),transparent_45%)]" />
          <div className="absolute inset-0 pointer-events-none backdrop-blur-[2px]" />
          <OutcomeOverlay fx={fxOverlay} />

          {/* FLYING CARDS OVERLAY */}
          {flyingCards.map((card) => (
            <FlyingCard
              key={card.id}
              payload={card}
              onComplete={() => {
                const handler = (window as any)[`complete_${card.id}`];
                if (handler) {
                  handler();
                  delete (window as any)[`complete_${card.id}`];
                }
              }}
            />
          ))}

          {/* Top bar */}
          <div className="absolute top-0 left-0 right-0 z-30">
            <div className="mx-auto max-w-2xl px-4 pt-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Link href="/casino">
                    <Button variant="ghost" size="icon" className="hover:bg-white/10">
                      <ArrowLeft className="w-5 h-5" />
                    </Button>
                  </Link>
                  <div className="leading-tight">
                    <div className="text-lg font-heading font-bold text-white/95">Andar Bahar</div>
                    <div className="text-xs text-white/60">One screen. Zero scroll. High stakes.</div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="text-[11px] text-white/55">Last</div>
                  <div className="flex gap-1">
                    {Array.from({ length: 5 }).map((_, i) => {
                      const v = heat[heat.length - 5 + i];
                      const isA = v === "andar";
                      const isB = v === "bahar";
                      return (
                        <div
                          key={i}
                          className={cn(
                            "h-2.5 w-2.5 rounded-full border border-white/20",
                            !v && "bg-white/10",
                            isA && "bg-amber-400/90 shadow-[0_0_10px_rgba(255,191,0,0.35)]",
                            isB && "bg-sky-400/90 shadow-[0_0_10px_rgba(56,189,248,0.35)]"
                          )}
                          title={v ? v.toUpperCase() : "—"}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Center stage */}
          <div className="absolute inset-0 z-10">
            <div className="mx-auto h-full max-w-2xl px-4 pt-16 pb-[164px]">
              {/* Target card */}
              <div className="relative flex justify-center">
                <div className="relative select-none table-perspective">
                  <div className="absolute -inset-10 rounded-full bg-amber-400/10 blur-3xl" />
                  <div className="absolute -inset-6 rounded-full bg-[radial-gradient(circle_at_50%_45%,rgba(255,255,255,0.05),transparent_65%)]" />
                  <div
                    style={{ transformStyle: "preserve-3d", animation: "floatTarget 2.6s ease-in-out infinite" }}
                    className={cn("relative", isPlaying && "drop-shadow-[0_0_22px_rgba(255,191,0,0.25)]")}
                  >
                    <div className="relative">
                      <div className="absolute -inset-4 rounded-[22px] border border-amber-200/20 bg-[radial-gradient(circle_at_50%_35%,rgba(255,191,0,0.24),transparent_60%)] blur-xl" />
                      <CardFace label={targetCard} size="target" highlight={isPlaying || showWinFX} />
                    </div>
                    <div className="absolute -bottom-4 left-1/2 h-3 w-24 -translate-x-1/2 rounded-full bg-black/70 blur-md" />
                  </div>
                </div>
              </div>

              {/* Arena */}
              <div className="mt-6 table-perspective">
                <div className="relative rounded-[26px] border border-white/10 bg-gradient-to-b from-white/8 via-white/2 to-white/[0.01] shadow-[0_50px_140px_rgba(0,0,0,0.70)] backdrop-blur-xl overflow-hidden">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_12%,rgba(255,215,0,0.16),transparent_65%)]" />
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_45%,rgba(56,189,248,0.09),transparent_55%)]" />
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_50%,rgba(255,255,255,0.04),transparent_60%)]" />
                  <div className="absolute left-1/2 top-0 bottom-0 w-[1px] bg-gradient-to-b from-amber-400/30 via-amber-300/25 to-transparent" />
                  <div className="absolute inset-0 opacity-40" style={{maskImage:"linear-gradient(180deg, transparent, black 15%, black 85%, transparent)"}}>
                    <div className="absolute left-[-20%] top-0 h-full w-[40%] bg-white/25 blur-3xl" style={{animation:"neonSweep 3.8s ease-in-out infinite"}} />
                  </div>

                  {/* aura */}
                  <div className={cn("absolute inset-y-0 left-0 w-1/2 transition-opacity duration-300", leftAura ? "opacity-100" : "opacity-40")}>
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_40%_45%,rgba(255,191,0,0.22),transparent_65%)]" />
                  </div>
                  <div className={cn("absolute inset-y-0 right-0 w-1/2 transition-opacity duration-300", rightAura ? "opacity-100" : "opacity-40")}>
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_60%_45%,rgba(56,189,248,0.18),transparent_65%)]" />
                  </div>

                  <div className="relative table-surface px-3 py-4">
                    <div className="grid grid-cols-2 gap-3">
                      {/* ANDAR */}
                      <div className="relative rounded-2xl border border-white/10 bg-white/[0.04] p-3 overflow-hidden backdrop-blur-md shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-semibold tracking-[0.22em] text-white/80">ANDAR</div>
                          <div className={cn("text-[10px] px-2 py-1 rounded-full border",
                            choice === "andar"
                              ? "border-amber-400/30 text-amber-200/90 bg-amber-400/10"
                              : "border-white/10 text-white/50 bg-white/5"
                          )}>A</div>
                        </div>

                        <div className={cn("mt-3 min-h-[180px] rounded-xl border border-white/10 bg-gradient-to-br from-black/40 via-black/25 to-white/[0.05] p-2", andarFaded && "opacity-50")}>
                          <div ref={andarDropRef as any} className="relative flex flex-wrap justify-center gap-2">
                            {dealtAndar.map((c, idx) => {
                              const isLast = idx === dealtAndar.length - 1;
                              const isWinnerSide = showWinFX && winningSide === "andar";
                              return (
                                <div
                                  key={c.id}
                                  className={cn(
                                    "transition-all duration-300",
                                    showWinFX && isWinnerSide && isLast && "animate-[winnerPop_420ms_ease-out]"
                                  )}
                                  style={{ transform: `rotate(${(idx % 7) - 3}deg) translateZ(0)` }}
                                >
                                  <CardFace
                                    label={c.label}
                                    size="md"
                                    className={cn(
                                      showWinFX && isWinnerSide && isLast && "ring-2 ring-amber-300/35 shadow-[0_0_35px_rgba(255,191,0,0.22)]",
                                      showWinFX && andarFaded && "animate-[smokeFade_1.1s ease-in-out forwards]"
                                    )}
                                  />
                                </div>
                              );
                            })}

                            {!dealtAndar.length && (
                              <div className="py-10 text-xs text-white/35 flex items-center gap-2">
                                <CardBack size="md" />
                                <span>Cards land here</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* BAHAR */}
                      <div className="relative rounded-2xl border border-white/10 bg-white/[0.04] p-3 overflow-hidden backdrop-blur-md shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-semibold tracking-[0.22em] text-white/80">BAHAR</div>
                          <div className={cn("text-[10px] px-2 py-1 rounded-full border",
                            choice === "bahar"
                              ? "border-sky-400/30 text-sky-200/90 bg-sky-400/10"
                              : "border-white/10 text-white/50 bg-white/5"
                          )}>B</div>
                        </div>

                        <div className={cn("mt-3 min-h-[180px] rounded-xl border border-white/10 bg-gradient-to-br from-black/40 via-black/25 to-white/[0.05] p-2", baharFaded && "opacity-50")}>
                          <div ref={baharDropRef as any} className="relative flex flex-wrap justify-center gap-2">
                            {dealtBahar.map((c, idx) => {
                              const isLast = idx === dealtBahar.length - 1;
                              const isWinnerSide = showWinFX && winningSide === "bahar";
                              return (
                                <div
                                  key={c.id}
                                  className={cn(
                                    "transition-all duration-300",
                                    showWinFX && isWinnerSide && isLast && "animate-[winnerPop_420ms_ease-out]"
                                  )}
                                  style={{ transform: `rotate(${3 - (idx % 7)}deg) translateZ(0)` }}
                                >
                                  <CardFace
                                    label={c.label}
                                    size="md"
                                    className={cn(
                                      showWinFX && isWinnerSide && isLast && "ring-2 ring-sky-300/35 shadow-[0_0_35px_rgba(56,189,248,0.20)]",
                                      showWinFX && baharFaded && "animate-[smokeFade_1.1s ease-in-out forwards]"
                                    )}
                                  />
                                </div>
                              );
                            })}

                            {!dealtBahar.length && (
                              <div className="py-10 text-xs text-white/35 flex items-center gap-2">
                                <CardBack size="md" />
                                <span>Cards land here</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Beam */}
                    {beamActive && winningSide && (
                      <div className="pointer-events-none absolute left-1/2 top-[22px] h-[140px] w-[2px] -translate-x-1/2">
                        <div
                          className={cn(
                            "absolute inset-0 rounded-full blur-[1px]",
                            winningSide === "andar"
                              ? "bg-gradient-to-b from-amber-300/90 via-amber-200/40 to-transparent"
                              : "bg-gradient-to-b from-sky-300/90 via-sky-200/40 to-transparent"
                          )}
                          style={{ animation: "beamFlash 0.95s ease-out both" }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Deck */}
                  <div className="absolute left-1/2 bottom-4 -translate-x-1/2">
                    <div
                      ref={deckRef as any}
                      className="relative"
                      style={{
                        animation: isPlaying && dealIndex === 0 ? "deckShake 520ms ease-in-out infinite" : "none",
                      }}
                    >
                      <div className="relative h-12 w-[72px]">
                        <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_50%_30%,rgba(255,191,0,0.12),transparent_60%)] blur-xl" />
                        <div className="absolute left-0 top-0 rotate-[-5deg] scale-[0.96] opacity-80">
                          <CardBack size="md" />
                        </div>
                        <div className="absolute left-2 top-[4px] rotate-[3deg] scale-[1] opacity-95">
                          <CardBack size="md" />
                        </div>
                        <div className="absolute left-4 top-[8px] rotate-[-2deg]">
                          <CardBack size="md" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Result strip */}
              <div className="mt-3">
                <div
                  className={cn(
                    "rounded-xl border border-white/10 bg-black/25 px-4 py-2",
                    result?.isWin
                      ? "shadow-[0_0_35px_rgba(16,185,129,0.18)]"
                      : result
                        ? "shadow-[0_0_35px_rgba(239,68,68,0.14)]"
                        : "shadow-none",
                    outcomeShake && "animate-[shakeImpact_650ms_ease-out]"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-white/60">
                      Payout <span className="text-white/80">1.9x</span> · Potential{" "}
                      <span className="text-white/80">₹{potentialWin.toFixed(2)}</span>
                    </div>

                    {result ? (
                      <div
                        className={cn(
                          "text-xs font-extrabold tracking-wide",
                          result.isWin ? "text-emerald-300" : "text-red-300"
                        )}
                      >
                        {result.isWin
                          ? `🎉 WIN +₹${Number(result.payout).toFixed(2)}`
                          : `😢 ${String(result.winningSide).toUpperCase()} WON`}
                      </div>
                    ) : (
                      <div className="text-xs text-white/45">
                        {isPlaying ? `Dealing cards...` : "Place your bet"}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-2 flex items-center gap-2 px-1 text-[11px] text-white/55">
                <Shield className="h-4 w-4 text-white/55" />
                <span>Provably fair round outcomes</span>
              </div>
            </div>
          </div>

          {/* Bottom HUD */}
          <div className="absolute bottom-0 left-0 right-0 z-40">
            <div className="mx-auto max-w-2xl px-4 pb-4">
              <div className="rounded-2xl border border-white/10 bg-black/35 backdrop-blur-md shadow-[0_35px_90px_rgba(0,0,0,0.60)] overflow-hidden">
                <div className="px-4 pt-4 pb-3">
                  <div className="flex items-center gap-3">
                    <button
                      className={cn(
                        "relative flex-1 rounded-2xl border transition-all duration-200",
                        "h-14 flex items-center justify-center gap-3",
                        "bg-gradient-to-br from-white/10 to-white/5",
                        choice === "andar"
                          ? "border-amber-300/30 shadow-[0_0_35px_rgba(255,191,0,0.20)]"
                          : "border-white/10 hover:border-white/20"
                      )}
                      style={{
                        animation: choice === "andar" ? "pulseOrb 1.2s ease-in-out infinite" : "none",
                      }}
                      onClick={() => !isPlaying && setChoice("andar")}
                      disabled={isPlaying}
                    >
                      <span className="h-9 w-9 rounded-full flex items-center justify-center font-bold bg-amber-400/15 border border-amber-300/25 text-amber-100">
                        A
                      </span>
                      <span className="text-sm font-semibold text-white/90 tracking-wide">ANDAR</span>
                    </button>

                    <button
                      className={cn(
                        "relative flex-1 rounded-2xl border transition-all duration-200",
                        "h-14 flex items-center justify-center gap-3",
                        "bg-gradient-to-br from-white/10 to-white/5",
                        choice === "bahar"
                          ? "border-sky-300/30 shadow-[0_0_35px_rgba(56,189,248,0.18)]"
                          : "border-white/10 hover:border-white/20"
                      )}
                      style={{
                        animation: choice === "bahar" ? "pulseOrb 1.2s ease-in-out infinite" : "none",
                      }}
                      onClick={() => !isPlaying && setChoice("bahar")}
                      disabled={isPlaying}
                    >
                      <span className="h-9 w-9 rounded-full flex items-center justify-center font-bold bg-sky-400/15 border border-sky-300/25 text-sky-100">
                        B
                      </span>
                      <span className="text-sm font-semibold text-white/90 tracking-wide">BAHAR</span>
                    </button>
                  </div>

                  <div className="mt-3">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] text-white/60">Stake</div>
                      <div className="text-[11px] text-white/75">
                        ₹{Number(betAmount || 0).toLocaleString("en-IN")}
                      </div>
                    </div>

                    <div className={cn("mt-2 flex gap-2 overflow-x-auto no-scrollbar py-1")} style={{ scrollSnapType: "x mandatory" }}>
                      {STAKES.map((s) => {
                        const active = s === betAmount;
                        return (
                          <button
                            key={s}
                            className={cn(
                              "shrink-0 px-4 h-10 rounded-xl border text-sm font-semibold",
                              "scroll-snap-align-start",
                              active
                                ? "border-amber-300/30 bg-amber-400/10 text-amber-100 shadow-[0_0_26px_rgba(255,191,0,0.18)]"
                                : "border-white/10 bg-white/5 text-white/75 hover:border-white/20"
                            )}
                            onClick={() => !isPlaying && setBetAmount(s)}
                            disabled={isPlaying}
                          >
                            ₹{s}
                          </button>
                        );
                      })}

                      <div className="shrink-0 flex items-center gap-2 pl-2 pr-1">
                        <button
                          className="h-10 w-10 rounded-xl border border-white/10 bg-white/5 text-white/70 hover:border-white/20 disabled:opacity-50"
                          disabled={isPlaying}
                          onClick={() => setBetAmount((v) => clamp(v - 10, 1, 1000000))}
                          aria-label="Decrease stake"
                        >
                          −
                        </button>
                        <button
                          className="h-10 w-10 rounded-xl border border-white/10 bg-white/5 text-white/70 hover:border-white/20 disabled:opacity-50"
                          disabled={isPlaying}
                          onClick={() => setBetAmount((v) => clamp(v + 10, 1, 1000000))}
                          aria-label="Increase stake"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div className="mt-2 text-[11px] text-white/45">Swipe stake · Tap A/B to lock side</div>
                  </div>
                </div>

                <button
                  onClick={handlePlay}
                  disabled={!canPlay || isPlaying}
                  className={cn(
                    "w-full h-14 flex items-center justify-center border-t border-white/10 transition-all duration-200 relative overflow-hidden",
                    !canPlay || isPlaying
                      ? "bg-white/5 text-white/45 cursor-not-allowed"
                      : "bg-gradient-to-r from-amber-400/14 to-orange-400/10 text-white/90 hover:from-amber-400/18 hover:to-orange-400/14"
                  )}
                >
                  {!isPlaying && canPlay && (
                    <span className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,191,0,0.22),transparent_55%)] opacity-70" />
                  )}
                  <span className="relative text-sm font-extrabold tracking-wide">{playLabel}</span>
                </button>
              </div>
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-[92px] z-20">
            <div className="mx-auto max-w-2xl px-4">
              <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
