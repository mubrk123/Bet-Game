// import React, { useEffect, useMemo, useRef, useState } from "react";
// import { AppShell } from "@/components/layout/AppShell";
// import { Button } from "@/components/ui/button";
// import { Card } from "@/components/ui/card";
// import { Input } from "@/components/ui/input";
// import { useStore } from "@/lib/store";
// import { api } from "@/lib/api";
// import { useToast } from "@/hooks/use-toast";
// import { AnimatePresence, motion, useMotionValue, useSpring } from "framer-motion";
// import {
//   ArrowLeft,
//   Bomb,
//   Gem,
//   ShieldCheck,
//   Sparkles,
//   ChevronUp,
//   ChevronDown,
//   Coins,
// } from "lucide-react";
// import { Link } from "wouter";
// import { cn } from "@/lib/utils";

// const GRID_SIZE = 5;
// const TILE_COUNT = GRID_SIZE * GRID_SIZE;
// const QUICK_BETS = [50, 100, 500, 1000];

// // House edge only for DISPLAY ladder (backend is the source of truth for actual payout)
// const DISPLAY_EDGE = 0.97;

// export default function MinesGame() {
//   const { currentUser, setCurrentUser } = useStore();
//   const { toast } = useToast();

//   // lock the viewport so the page never scrolls while the game is open
//   useEffect(() => {
//     const prev = document.body.style.overflow;
//     document.body.style.overflow = "hidden";
//     return () => {
//       document.body.style.overflow = prev;
//     };
//   }, []);

//   // ====== Inputs ======
//   const [betAmount, setBetAmount] = useState<number>(100);
//   const [mineCount, setMineCount] = useState<number>(5);

//   // Auto mode: how many tiles to open in one go
//   const [autoTiles, setAutoTiles] = useState<number>(3);

//   // manual: tap tile repeatedly (reveals 1 per tap)
//   const [mode, setMode] = useState<"manual" | "auto">("manual");

//   // ====== Game State ======
//   const [isBusy, setIsBusy] = useState(false);
//   const [revealedTiles, setRevealedTiles] = useState<number[]>([]);
//   const [minePositions, setMinePositions] = useState<number[]>([]);
//   const [activeReveal, setActiveReveal] = useState<number | null>(null);

//   const [currentMultiplier, setCurrentMultiplier] = useState<number>(1);
//   const [gameOver, setGameOver] = useState(false);
//   const [isWin, setIsWin] = useState(false);

//   const gridIndices = useMemo(
//     () => Array.from({ length: TILE_COUNT }, (_, i) => i),
//     []
//   );

//   const amount = Number.isFinite(betAmount) ? betAmount : 0;

//   const openedCount = revealedTiles.length;

//   // Display payout ladder right before tiles (based on combinatorics)
//   const displayCurrentMult = useMemo(() => {
//     if (openedCount <= 0) return 1;
//     return Math.max(1, fairMultiplier(mineCount, openedCount) * DISPLAY_EDGE);
//   }, [mineCount, openedCount]);

//   const displayNextMult = useMemo(() => {
//     const next = openedCount + 1;
//     if (next <= 0) return 1;
//     if (next > TILE_COUNT - mineCount) return displayCurrentMult;
//     return Math.max(1, fairMultiplier(mineCount, next) * DISPLAY_EDGE);
//   }, [mineCount, openedCount, displayCurrentMult]);

//   const payoutNow = useMemo(() => {
//     const mult = gameOver ? currentMultiplier : Math.max(currentMultiplier, displayCurrentMult);
//     return amount > 0 ? amount * mult : 0;
//   }, [amount, currentMultiplier, displayCurrentMult, gameOver]);

//   const profit = useMemo(() => {
//     if (!gameOver) return 0;
//     if (isWin) return payoutNow - amount;
//     return -amount;
//   }, [gameOver, isWin, payoutNow, amount]);

//   // animated profit/cashout counter
//   const payoutMotion = useMotionValue(payoutNow);
//   const payoutSpring = useSpring(payoutMotion, { stiffness: 120, damping: 18, mass: 0.9 });
//   const [animatedPayout, setAnimatedPayout] = useState(payoutNow);
//   useEffect(() => {
//     payoutMotion.set(payoutNow);
//   }, [payoutNow, payoutMotion]);
//   useEffect(() => {
//     const unsubscribe = payoutSpring.on("change", (v) => setAnimatedPayout(v));
//     return () => unsubscribe();
//   }, [payoutSpring]);

//   const profitText =
//     profit > 0
//       ? `+₹${profit.toFixed(2)}`
//       : profit < 0
//       ? `-₹${Math.abs(profit).toFixed(2)}`
//       : "—";

//   // ====== Audio (proper SFX via WebAudio) ======
//   const audioRef = useRef<AudioContext | null>(null);

//   const getAudio = () => {
//     if (typeof window === "undefined") return null;
//     const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
//     if (!Ctx) return null;
//     if (!audioRef.current) audioRef.current = new Ctx();
//     return audioRef.current;
//   };

//   const playWinWink = () => {
//     const ctx = getAudio();
//     if (!ctx) return;
//     const now = ctx.currentTime;

//     // bright "wink": two quick plucks
//     const osc = ctx.createOscillator();
//     const gain = ctx.createGain();
//     const filter = ctx.createBiquadFilter();

//     filter.type = "highpass";
//     filter.frequency.value = 600;

//     osc.type = "sine";
//     osc.frequency.setValueAtTime(1100, now);
//     osc.frequency.exponentialRampToValueAtTime(1500, now + 0.05);

//     gain.gain.setValueAtTime(0.0001, now);
//     gain.gain.exponentialRampToValueAtTime(0.10, now + 0.01);
//     gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.10);

//     osc.connect(filter);
//     filter.connect(gain);
//     gain.connect(ctx.destination);

//     osc.start(now);
//     osc.stop(now + 0.12);

//     // tiny second sparkle
//     setTimeout(() => {
//       const ctx2 = getAudio();
//       if (!ctx2) return;
//       const t = ctx2.currentTime;

//       const o2 = ctx2.createOscillator();
//       const g2 = ctx2.createGain();
//       o2.type = "triangle";
//       o2.frequency.setValueAtTime(1400, t);
//       o2.frequency.exponentialRampToValueAtTime(1800, t + 0.04);
//       g2.gain.setValueAtTime(0.0001, t);
//       g2.gain.exponentialRampToValueAtTime(0.08, t + 0.008);
//       g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
//       o2.connect(g2);
//       g2.connect(ctx2.destination);
//       o2.start(t);
//       o2.stop(t + 0.09);
//     }, 55);
//   };

//   const playBombBoom = () => {
//     const ctx = getAudio();
//     if (!ctx) return;
//     const now = ctx.currentTime;

//     // boom: noise burst + low thump
//     const bufferSize = Math.floor(ctx.sampleRate * 0.18);
//     const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
//     const data = buffer.getChannelData(0);
//     for (let i = 0; i < bufferSize; i++) {
//       const t = i / bufferSize;
//       data[i] = (Math.random() * 2 - 1) * (1 - t);
//     }
//     const noise = ctx.createBufferSource();
//     noise.buffer = buffer;

//     const band = ctx.createBiquadFilter();
//     band.type = "bandpass";
//     band.frequency.value = 240;
//     band.Q.value = 0.7;

//     const gain = ctx.createGain();
//     gain.gain.setValueAtTime(0.0001, now);
//     gain.gain.exponentialRampToValueAtTime(0.28, now + 0.01);
//     gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

//     const thump = ctx.createOscillator();
//     const thGain = ctx.createGain();
//     thump.type = "sine";
//     thump.frequency.setValueAtTime(120, now);
//     thump.frequency.exponentialRampToValueAtTime(55, now + 0.12);
//     thGain.gain.setValueAtTime(0.0001, now);
//     thGain.gain.exponentialRampToValueAtTime(0.22, now + 0.008);
//     thGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

//     noise.connect(band);
//     band.connect(gain);
//     gain.connect(ctx.destination);

//     thump.connect(thGain);
//     thGain.connect(ctx.destination);

//     noise.start(now);
//     noise.stop(now + 0.18);
//     thump.start(now);
//     thump.stop(now + 0.16);
//   };

//   const playCoinDrop = () => {
//     const ctx = getAudio();
//     if (!ctx) return;
//     const now = ctx.currentTime;

//     // coin drop: short metallic pings cascading
//     const freqs = [980, 1240, 860, 1480, 1020, 1320];
//     freqs.forEach((f, i) => {
//       const t = now + i * 0.04;
//       const osc = ctx.createOscillator();
//       const gain = ctx.createGain();
//       const filter = ctx.createBiquadFilter();
//       filter.type = "highpass";
//       filter.frequency.value = 700;

//       osc.type = "square";
//       osc.frequency.setValueAtTime(f, t);
//       osc.frequency.exponentialRampToValueAtTime(f * 0.92, t + 0.06);

//       gain.gain.setValueAtTime(0.0001, t);
//       gain.gain.exponentialRampToValueAtTime(0.09, t + 0.01);
//       gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);

//       osc.connect(filter);
//       filter.connect(gain);
//       gain.connect(ctx.destination);

//       osc.start(t);
//       osc.stop(t + 0.14);
//     });
//   };

//   // ====== Haptics ======
//   const haptic = (kind: "gem" | "mine" | "cash") => {
//     if (typeof navigator === "undefined" || !navigator.vibrate) return;
//     if (kind === "gem") navigator.vibrate([10, 8]);
//     if (kind === "mine") navigator.vibrate([30, 80, 40]);
//     if (kind === "cash") navigator.vibrate([18, 10, 18, 10, 24]);
//   };

//   // ====== Gameplay ======
//   const canPlay = amount > 0 && mineCount >= 1 && mineCount <= 24;

//   const startOrReveal = async () => {
//     if (!canPlay) {
//       toast({
//         title: "Invalid inputs",
//         description: "Please enter a valid bet and mines.",
//         variant: "destructive",
//       });
//       return;
//     }

//     if (currentUser && amount > currentUser.balance) {
//       toast({ title: "Insufficient balance", variant: "destructive" });
//       return;
//     }

//     setIsBusy(true);
//     setGameOver(false);
//     setIsWin(false);

//     try {
//       const tilesToReveal = mode === "auto" ? clamp(autoTiles, 1, TILE_COUNT - mineCount) : 1;

//       const result = await api.playMines(amount, mineCount, tilesToReveal);

//       const tiles: number[] = result.revealedTiles || [];
//       const mines: number[] = result.minePositions || [];

//       // IMPORTANT: keep minePositions even if we don’t show them until end.
//       setMinePositions(mines);

//       // animate reveal one-by-one
//       for (let i = 0; i < tiles.length; i++) {
//         const tile = tiles[i];

//         setActiveReveal(tile);
//         await delay(170);

//         setRevealedTiles((prev) => {
//           if (prev.includes(tile)) return prev;
//           return [...prev, tile];
//         });

//         const hitMine = mines.includes(tile);
//         if (hitMine) {
//           playBombBoom();
//           haptic("mine");
//         } else {
//           playWinWink();
//           haptic("gem");
//         }
//         await delay(120);

//         // If mine hit, stop revealing further (backend might still send more, but UX should stop)
//         if (hitMine) break;
//       }

//       setActiveReveal(null);

//       setCurrentMultiplier(result.multiplier || 1);
//       setIsWin(Boolean(result.isWin));
//       setGameOver(true);

//       if (currentUser) {
//         setCurrentUser({
//           ...currentUser,
//           balance:
//             result.newBalance !== undefined ? result.newBalance : currentUser.balance,
//         });
//       }

//       if (result.isWin) {
//         playCoinDrop();
//         haptic("cash");
//       }

//       toast({
//         title: result.isWin ? `Won ${Number(result.multiplier || 0).toFixed(2)}x!` : "BOOM!",
//         description: result.isWin
//           ? `You won ₹${Number(result.payout || 0).toFixed(2)}`
//           : "You hit a mine",
//         variant: result.isWin ? "default" : "destructive",
//       });
//     } catch (err: any) {
//       toast({
//         title: "Error",
//         description: err?.message ?? "Failed to play Mines",
//         variant: "destructive",
//       });

//       // reset on failure
//       setRevealedTiles([]);
//       setMinePositions([]);
//       setCurrentMultiplier(1);
//       setGameOver(false);
//       setIsWin(false);
//       setActiveReveal(null);
//     } finally {
//       setIsBusy(false);
//       setActiveReveal(null);
//     }
//   };

//   const resetBoard = () => {
//     setRevealedTiles([]);
//     setMinePositions([]);
//     setCurrentMultiplier(1);
//     setGameOver(false);
//     setIsWin(false);
//     setActiveReveal(null);
//   };

//   // Tap tile behavior (manual: triggers reveal flow)
//   const onTileTap = async (index: number) => {
//     if (mode !== "manual") return;
//     if (isBusy) return;
//     if (gameOver) return;

//     // In your current API, manual reveal is server-driven (one tile per request).
//     // We still let users tap tiles for UX (feels like mines), but the server decides next reveal.
//     await startOrReveal();
//   };

//   // Lively gradient background + animated blobs
//   return (
//     <AppShell hideHeader hideBottomNav fullBleed>
//       <div className="relative h-[100dvh] min-h-[100dvh] w-full overflow-hidden flex flex-col">
//         <AnimatedLivelyBG />
//         <style>{`
//           @keyframes floaty {
//             0% { transform: translate3d(0,0,0) scale(1); }
//             50% { transform: translate3d(0,-12px,0) scale(1.03); }
//             100% { transform: translate3d(0,0,0) scale(1); }
//           }
//           @keyframes shimmer {
//             0% { transform: translateX(-60%); opacity: 0.0; }
//             30% { opacity: 0.35; }
//             100% { transform: translateX(140%); opacity: 0.0; }
//           }
//           .shimmer-line::after{
//             content:"";
//             position:absolute;
//             inset:-20% auto -20% -40%;
//             width:55%;
//             transform:skewX(-20deg);
//             background:linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent);
//             animation: shimmer 2.2s ease-in-out infinite;
//           }
//         `}</style>

//         <div className="relative z-10 h-full flex flex-col">
//           {/* Thin top bar */}
//           <div className="px-4 pt-3 pb-1 md:px-6">
//             <div className="flex items-center justify-between gap-2 rounded-full bg-white/45 border border-white/50 backdrop-blur-xl px-3 py-2 shadow-sm">
//               <div className="flex items-center gap-2 text-xs text-slate-800">
//                 <Link href="/casino">
//                   <Button
//                     variant="ghost"
//                     size="icon"
//                     className="rounded-full bg-white/70 border border-white/55 backdrop-blur-md shadow-sm"
//                   >
//                     <ArrowLeft className="h-4 w-4" />
//                   </Button>
//                 </Link>
//                 <span className="font-semibold text-slate-900">Mines</span>
//                 <span className="text-slate-500">•</span>
//                 <span>
//                   Mult:{" "}
//                   <span className="font-semibold text-slate-900">
//                     {gameOver ? currentMultiplier.toFixed(2) : displayCurrentMult.toFixed(2)}x
//                   </span>
//                 </span>
//                 <span className="text-slate-500">•</span>
//                 <span>
//                   Profit:{" "}
//                   <span className={cn("font-semibold", profit >= 0 ? "text-emerald-700" : "text-rose-700")}>
//                     {profitText}
//                   </span>
//                 </span>
//                 <span className="text-slate-500">•</span>
//                 <span>
//                   Bal: <span className="font-semibold text-slate-900">₹{Number(currentUser?.balance ?? 0).toFixed(2)}</span>
//                 </span>
//               </div>
//               <div className="flex items-center gap-2">
//                 <ModeToggle mode={mode} onChange={setMode} />
//                 <div className="h-8 w-8 rounded-full bg-white/70 border border-white/60 grid place-items-center shadow-sm">
//                   <ShieldCheck className="w-4 h-4 text-emerald-600" />
//                 </div>
//               </div>
//             </div>
//           </div>

//           {/* MAIN LAYOUT: Compact, no scroll */}
//           <div className="flex-1 px-4 pb-4 md:px-6 min-h-0">
//             <div className="h-full flex flex-col items-center">
//               <Card
//                 className="w-full max-w-5xl flex-1 rounded-[30px] border-white/50 bg-white/30 backdrop-blur-xl shadow-[0_18px_60px_-35px_rgba(0,0,0,0.35)] overflow-hidden"
//                 style={{
//                   backgroundImage:
//                     "linear-gradient(135deg, rgba(255,255,255,0.32), rgba(186,230,253,0.26), rgba(167,243,208,0.26))",
//                 }}
//               >
//                 <div className="flex h-full flex-col gap-2 p-3 md:p-4 min-h-0">
//                   {/* Summary row */}
//                   <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/60 bg-white/70 px-4 py-3 shadow-sm backdrop-blur">
//                     <div>
//                       <div className="text-[12px] text-slate-700">Cashout right now</div>
//                       <div className="text-3xl font-extrabold text-slate-900 tracking-tight">
//                         ₹{animatedPayout.toFixed(2)}
//                       </div>
//                     </div>
//                     <div className="text-right">
//                       <div className="text-[12px] text-slate-700">Next tile</div>
//                       <div className="text-lg font-bold text-emerald-700">
//                         ₹{(amount * displayNextMult).toFixed(2)}{" "}
//                         <span className="text-[12px] font-semibold text-slate-600">
//                           ({displayNextMult.toFixed(2)}x)
//                         </span>
//                       </div>
//                     </div>
//                   </div>

//                   {/* Floating multiplier label */}
//                   <div className="text-center text-sm font-semibold text-emerald-700 drop-shadow-sm">
//                     Next tile payout grows to {displayNextMult.toFixed(2)}x
//                   </div>

//                   {/* Grid + controls */}
//                   <div className="flex-1 min-h-0 flex flex-col gap-3">
//                     <div
//                       className="flex-1 min-h-0 rounded-[24px] border border-white/50 bg-white/45 backdrop-blur-md p-2 md:p-3"
//                       style={{
//                         boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5), 0 30px 80px -65px rgba(0,0,0,0.3)",
//                         backgroundImage:
//                           "linear-gradient(145deg, rgba(186,230,253,0.18), rgba(209,250,229,0.18), rgba(254,249,195,0.12))",
//                       }}
//                     >
//                       <div className="flex h-full flex-col items-center justify-center gap-3">
//                         <div className="grid grid-cols-5 gap-1.5 sm:gap-2 w-full max-w-[480px]">
//                           {gridIndices.map((index) => {
//                             const isRevealed = revealedTiles.includes(index);
//                             const isMine = minePositions.includes(index);
//                             const wasHit = isRevealed && isMine;

//                             // show bombs clearly on gameOver (loss) as ghosted bombs
//                             const showGhostBomb = gameOver && !isWin && isMine && !isRevealed;

//                             const scanning = activeReveal === index;

//                             return (
//                               <motion.button
//                                 key={index}
//                                 onClick={() => onTileTap(index)}
//                                 type="button"
//                                 disabled={isBusy || gameOver}
//                                 className={cn(
//                                   "relative aspect-square rounded-[14px] overflow-hidden border transition-all",
//                                   "shadow-[0_10px_26px_-20px_rgba(0,0,0,0.3)]",
//                                   isRevealed
//                                     ? wasHit
//                                       ? "border-rose-200 bg-gradient-to-br from-rose-50 to-rose-100"
//                                       : "border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-100"
//                                     : "border-white/80 bg-gradient-to-br from-white/80 to-white/60 hover:from-white hover:to-white/80",
//                                   isBusy && "cursor-not-allowed opacity-95"
//                                 )}
//                                 animate={
//                                   scanning
//                                     ? { scale: [1, 1.04, 1], rotateX: [0, 8, 0] }
//                                     : isRevealed
//                                     ? { scale: [1, 1.05, 1] }
//                                     : {}
//                                 }
//                                 transition={{ duration: 0.22 }}
//                               >
//                                 <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(14,165,233,0.18),transparent_55%)]" />
//                                 <div className="absolute inset-0 bg-gradient-to-br from-white/60 to-transparent" />

//                                 {/* neon rim */}
//                                 {!isRevealed && (
//                                   <div className="absolute inset-0 rounded-[14px] ring-1 ring-white/30 shadow-[0_0_16px_rgba(59,130,246,0.15)]" />
//                                 )}

//                                 {/* Reveal icon */}
//                                 <AnimatePresence>
//                                   {(isRevealed || showGhostBomb) && (
//                                     <motion.div
//                                       initial={{ scale: 0.6, opacity: 0, rotateY: -45 }}
//                                       animate={{ scale: 1, opacity: showGhostBomb ? 0.55 : 1, rotateY: 0 }}
//                                       exit={{ scale: 0.7, opacity: 0, rotateY: 45 }}
//                                       className="absolute inset-0 grid place-items-center"
//                                     >
//                                       {isMine ? (
//                                         <motion.div
//                                           className="grid place-items-center"
//                                           animate={{ scale: wasHit ? [1, 1.1, 1] : 1 }}
//                                           transition={{ duration: 0.18 }}
//                                         >
//                                           <div className="absolute h-10 w-10 rounded-full bg-rose-300/70 blur-[2px]" />
//                                           <Bomb className="relative h-7 w-7 text-rose-700 drop-shadow-[0_10px_18px_rgba(244,63,94,0.3)]" />
//                                         </motion.div>
//                                       ) : (
//                                         <motion.div
//                                           className="grid place-items-center"
//                                           animate={{ scale: [1, 1.06, 1] }}
//                                           transition={{ duration: 0.24 }}
//                                         >
//                                           <div className="absolute h-10 w-10 rounded-full bg-emerald-300/70 blur-[2px]" />
//                                           <Gem className="relative h-7 w-7 text-emerald-700 drop-shadow-[0_10px_18px_rgba(16,185,129,0.3)]" />
//                                         </motion.div>
//                                       )}
//                                     </motion.div>
//                                   )}
//                                 </AnimatePresence>
//                               </motion.button>
//                             );
//                           })}
//                         </div>
//                       </div>
//                     </div>

//                     {/* Control dock (split columns) */}
//                     <div className="rounded-3xl border border-white/60 bg-white/60 backdrop-blur p-3 md:p-4 shadow-[0_12px_45px_-32px_rgba(0,0,0,0.3)]">
//                       <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
//                         <div className="flex flex-col gap-2">
//                           <div className="rounded-2xl border border-white/60 bg-white/70 p-3">
//                             <div className="flex items-center justify-between text-[12px] text-slate-700 font-semibold">
//                               Bet Amount
//                               <span className="text-[11px] text-slate-500">
//                                 Bal: ₹{Number(currentUser?.balance ?? 0).toFixed(2)}
//                               </span>
//                             </div>
//                             <div className="mt-2">
//                               <NumericField
//                                 label=""
//                                 value={betAmount}
//                                 min={1}
//                                 max={100000}
//                                 onChange={(v) => setBetAmount(clamp(v, 1, 100000))}
//                                 hideLabel
//                               />
//                             </div>
//                             <div className="mt-2 flex flex-wrap gap-2">
//                               {QUICK_BETS.map((v) => (
//                                 <button
//                                   key={v}
//                                   onClick={() => setBetAmount(v)}
//                                   className="h-9 w-12 rounded-full bg-gradient-to-br from-sky-50 to-sky-100 border border-sky-200 text-sky-700 text-sm font-semibold shadow-inner"
//                                 >
//                                   ₹{v}
//                                 </button>
//                               ))}
//                             </div>
//                           </div>
//                         </div>

//                         <div className="flex flex-col gap-2">
//                           <div className="rounded-2xl border border-white/60 bg-white/70 p-3 flex flex-col gap-2">
//                             <div className="flex items-center justify-between text-[12px] text-slate-700 font-semibold">
//                               Mines & Mode
//                               <ModeToggle mode={mode} onChange={setMode} />
//                             </div>
//                             <div className="grid grid-cols-2 gap-2">
//                               <NumericField
//                                 label="Mines"
//                                 value={mineCount}
//                                 min={1}
//                                 max={24}
//                                 onChange={(v) => {
//                                   const next = clamp(v, 1, 24);
//                                   setMineCount(next);
//                                   setAutoTiles((prev) => clamp(prev, 1, TILE_COUNT - next));
//                                 }}
//                               />
//                               {mode === "auto" && (
//                                 <NumericField
//                                   label="Auto tiles"
//                                   value={autoTiles}
//                                   min={1}
//                                   max={Math.max(1, TILE_COUNT - mineCount)}
//                                   onChange={(v) => setAutoTiles(clamp(v, 1, TILE_COUNT - mineCount))}
//                                 />
//                               )}
//                             </div>
//                           </div>

//                           <div className="grid grid-cols-3 gap-2">
//                             <Button
//                               onClick={async () => {
//                                 try {
//                                   const ctx = getAudio();
//                                   if (ctx && ctx.state === "suspended") await ctx.resume();
//                                 } catch {}
//                                 await startOrReveal();
//                               }}
//                               disabled={isBusy}
//                               className={cn(
//                                 "h-12 rounded-2xl text-base font-bold",
//                                 "shadow-[0_18px_45px_-30px_rgba(16,185,129,0.7)]",
//                                 profit > 0 && "animate-pulse"
//                               )}
//                               style={{
//                                 background:
//                                   "linear-gradient(135deg, rgba(34,197,94,0.95), rgba(14,165,233,0.9))",
//                               }}
//                             >
//                               {isBusy ? "Revealing..." : mode === "auto" ? "Auto Play" : "Play"}
//                             </Button>

//                             <Button
//                               variant="secondary"
//                               className="h-12 rounded-2xl bg-white text-slate-800 border border-slate-200 hover:bg-slate-50"
//                               onClick={() => {
//                                 resetBoard();
//                                 playWinWink();
//                               }}
//                               disabled={isBusy}
//                             >
//                               Reset
//                             </Button>

//                             <Button
//                               variant="secondary"
//                               className={cn(
//                                 "h-12 rounded-2xl bg-white text-slate-800 border border-slate-200 hover:bg-slate-50 flex items-center gap-2",
//                                 profit > 0 && "shadow-[0_0_18px_rgba(245,158,11,0.35)] ring-2 ring-amber-200"
//                               )}
//                               onClick={() => {
//                                 playCoinDrop();
//                                 haptic("cash");
//                                 toast({
//                                   title: "Cashout",
//                                   description: "Cashout happens when the round ends (backend result).",
//                                 });
//                               }}
//                               disabled={isBusy}
//                             >
//                               <Coins className="h-4 w-4" />
//                               Cashout
//                             </Button>
//                           </div>

//                           <div className="rounded-2xl border border-white/70 bg-white/70 p-3 flex items-center justify-between flex-wrap gap-2">
//                             <div className="text-[12px] font-semibold text-slate-700">Status</div>
//                             <div
//                               className={cn(
//                                 "text-[12px] font-bold",
//                                 gameOver
//                                   ? isWin
//                                     ? "text-emerald-700"
//                                     : "text-rose-700"
//                                   : "text-slate-700"
//                               )}
//                             >
//                               {gameOver ? (isWin ? "WIN" : "BOMB") : "READY"}
//                             </div>
//                             <div className="text-[12px] text-slate-700">
//                               Payout:{" "}
//                               <span className="font-bold text-slate-900">₹{payoutNow.toFixed(2)}</span>{" "}
//                               • Mult:{" "}
//                               <span className="font-bold text-slate-900">
//                                 {(gameOver ? currentMultiplier : displayCurrentMult).toFixed(2)}x
//                               </span>
//                             </div>
//                             {mode === "auto" && (
//                               <div className="text-[11px] text-slate-600">
//                                 Auto will reveal{" "}
//                                 <span className="font-semibold text-slate-800">{autoTiles}</span> tiles.
//                               </div>
//                             )}
//                           </div>
//                         </div>
//                       </div>
//                     </div>
//                   </div>
//                 </div>
//               </Card>
//             </div>
//           </div>

//           {/* Tiny floating confetti when win */}
//           <AnimatePresence>{gameOver && isWin && <WinConfetti />}</AnimatePresence>
//         </div>
//       </div>
//     </AppShell>
//   );
// }

// /* ==============================
//    Helpers / UI Components
// ============================== */

// function ModeToggle({
//   mode,
//   onChange,
// }: {
//   mode: "manual" | "auto";
//   onChange: (m: "manual" | "auto") => void;
// }) {
//   return (
//     <div className="flex items-center bg-white/70 rounded-2xl border border-white/65 overflow-hidden shadow-sm">
//       {(["manual", "auto"] as const).map((m) => (
//         <button
//           key={m}
//           onClick={() => onChange(m)}
//           className={cn(
//             "px-3 py-2 text-xs font-bold transition-all",
//             mode === m
//               ? "bg-gradient-to-r from-emerald-500 to-sky-500 text-white"
//               : "text-slate-700 hover:text-slate-900"
//           )}
//         >
//           {m === "manual" ? "Manual" : "Auto"}
//         </button>
//       ))}
//     </div>
//   );
// }

// function NumericField({
//   label,
//   value,
//   min,
//   max,
//   onChange,
//   hideLabel,
// }: {
//   label: string;
//   value: number;
//   min: number;
//   max: number;
//   onChange: (v: number) => void;
//   hideLabel?: boolean;
// }) {
//   const clampV = (v: number) => clamp(v, min, max);

//   return (
//     <div className="rounded-3xl border border-white/65 bg-white/65 p-2.5">
//       {!hideLabel && (
//         <div className="flex items-center justify-between">
//           <div className="text-[12px] font-semibold text-slate-700">{label}</div>
//           <div className="text-[11px] text-slate-600">
//             {min}–{max}
//           </div>
//         </div>
//       )}

//       <div className={cn("relative", hideLabel ? "" : "mt-2")}>
//         <Input
//           type="number"
//           value={value}
//           min={min}
//           max={max}
//           onChange={(e) => {
//             const next = parseInt(e.target.value || "0", 10);
//             onChange(clampV(Number.isFinite(next) ? next : min));
//           }}
//           className="h-10 rounded-2xl bg-white/80 border-white/70 text-slate-900 font-semibold pr-12 text-sm"
//         />

//         {/* Small up/down arrows inside field */}
//         <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-1">
//           <button
//             type="button"
//             onClick={() => onChange(clampV(value + 1))}
//             className="h-5 w-8 rounded-lg bg-white/85 border border-white/70 hover:bg-white grid place-items-center"
//           >
//             <ChevronUp className="h-4 w-4 text-slate-700" />
//           </button>
//           <button
//             type="button"
//             onClick={() => onChange(clampV(value - 1))}
//             className="h-5 w-8 rounded-lg bg-white/85 border border-white/70 hover:bg-white grid place-items-center"
//           >
//             <ChevronDown className="h-4 w-4 text-slate-700" />
//           </button>
//         </div>
//       </div>
//     </div>
//   );
// }

// function AnimatedLivelyBG() {
//   const blobs = useMemo(() => Array.from({ length: 5 }, (_, i) => i), []);

//   return (
//     <div className="absolute inset-0">
//       <div className="absolute inset-0 bg-gradient-to-br from-[#76c8ff] via-[#b6f2dd] to-[#ffd89b]" />
//       <div className="absolute inset-0 opacity-75 bg-[radial-gradient(circle_at_20%_10%,rgba(59,130,246,0.25),transparent_55%),radial-gradient(circle_at_80%_20%,rgba(34,197,94,0.24),transparent_55%),radial-gradient(circle_at_50%_90%,rgba(245,158,11,0.20),transparent_55%)]" />
//       <div className="absolute inset-0 opacity-[0.16] bg-[linear-gradient(0deg,rgba(255,255,255,0.7)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.7)_1px,transparent_1px)] bg-[size:18px_18px]" />

//       {blobs.map((i) => (
//         <motion.div
//           key={i}
//           className="absolute rounded-full blur-3xl"
//           style={{
//             width: 220 + i * 40,
//             height: 220 + i * 40,
//             left: `${(i * 19) % 85}%`,
//             top: `${(i * 23) % 85}%`,
//             background:
//               i % 3 === 0
//                 ? "rgba(52,211,153,0.22)"
//                 : i % 3 === 1
//                 ? "rgba(86,204,242,0.22)"
//                 : "rgba(251,189,64,0.18)",
//           }}
//           animate={{ y: [0, -14, 0], x: [0, 10, 0], scale: [1, 1.05, 1] }}
//           transition={{ duration: 5 + i, repeat: Infinity, ease: "easeInOut" }}
//         />
//       ))}

//       {/* sparkles */}
//       <div className="absolute inset-0 pointer-events-none">
//         {Array.from({ length: 14 }).map((_, i) => (
//           <motion.span
//             key={i}
//             className="absolute h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_20px_rgba(255,255,255,0.75)]"
//             style={{
//               left: `${(i * 71) % 100}%`,
//               top: `${(i * 37) % 100}%`,
//               opacity: 0.6,
//             }}
//             animate={{ y: [0, -10, 0], opacity: [0.25, 0.75, 0.25] }}
//             transition={{ duration: 2.8 + (i % 4) * 0.3, repeat: Infinity, ease: "easeInOut" }}
//           />
//         ))}
//       </div>
//     </div>
//   );
// }

// function WinConfetti() {
//   const pieces = useMemo(() => Array.from({ length: 18 }, (_, i) => i), []);
//   return (
//     <motion.div
//       className="pointer-events-none absolute inset-0"
//       initial={{ opacity: 0 }}
//       animate={{ opacity: 1 }}
//       exit={{ opacity: 0 }}
//     >
//       {pieces.map((i) => (
//         <motion.div
//           key={i}
//           className="absolute h-2 w-2 rounded-sm"
//           style={{
//             left: `${(i * 19) % 100}%`,
//             top: `-5%`,
//             background:
//               i % 3 === 0
//                 ? "rgba(16,185,129,0.9)"
//                 : i % 3 === 1
//                 ? "rgba(56,189,248,0.9)"
//                 : "rgba(139,92,246,0.85)",
//           }}
//           animate={{ y: ["-5%", "110%"], rotate: [0, 220 + i * 30], x: [0, (i % 2 ? 40 : -40)] }}
//           transition={{ duration: 1.4 + (i % 5) * 0.1, ease: "easeInOut" }}
//         />
//       ))}
//     </motion.div>
//   );
// }

// function clamp(v: number, min: number, max: number) {
//   return Math.max(min, Math.min(max, v));
// }

// function delay(ms: number) {
//   return new Promise((r) => setTimeout(r, ms));
// }

// // Fair multiplier (no edge): 1 / P(survive k picks)
// // P = C(T-m, k) / C(T, k)
// // => Mult = C(T, k) / C(T-m, k)
// function fairMultiplier(mineCount: number, picks: number) {
//   const T = TILE_COUNT;
//   const safe = T - mineCount;
//   if (picks <= 0) return 1;
//   if (picks > safe) return Number.POSITIVE_INFINITY;

//   // compute ratio using products to avoid large factorials
//   // C(T,k)/C(safe,k) = Π_{i=0..k-1} (T-i)/(safe-i)
//   let mult = 1;
//   for (let i = 0; i < picks; i++) {
//     mult *= (T - i) / (safe - i);
//   }
//   return mult;
// }
