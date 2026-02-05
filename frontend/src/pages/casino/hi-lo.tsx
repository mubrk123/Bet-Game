// import { useEffect, useMemo, useRef, useState } from "react";
// import { AppShell } from "@/components/layout/AppShell";
// import { Button } from "@/components/ui/button";
// import { Card } from "@/components/ui/card";
// import { Input } from "@/components/ui/input";
// import { useStore } from "@/lib/store";
// import { api, type HiLoResult } from "@/lib/api";
// import { useToast } from "@/hooks/use-toast";
// import { motion, AnimatePresence } from "framer-motion";
// import {
//   ArrowLeft,
//   ArrowUp,
//   ArrowDown,
//   Sparkles,
//   History,
//   Zap,
// } from "lucide-react";
// import { Link } from "wouter";

// type RoundItem = {
//   id: string;
//   firstCard: string;
//   nextCard: string;
//   guess: "higher" | "lower";
//   isWin: boolean;
//   payout: number;
//   ts: number;
// };

// type NormalizedHiLo = {
//   roundId: string;
//   firstCard: string; // ✅ mapped from previousCard
//   nextCard: string;
//   guess: "higher" | "lower";
//   isWin: boolean;
//   multiplier: number;
//   betAmount: number;
//   payout: number;
//   profit: number;
//   newBalance: number;
//   serverSeedHash: string;
//   clientSeed: string;
//   nonce: number;
// };

// function normalizeHiLoResult(r: HiLoResult): NormalizedHiLo {
//   return {
//     roundId: r.roundId,
//     firstCard: r.previousCard, // ✅ FIX
//     nextCard: r.nextCard,
//     guess: r.guess,
//     isWin: r.isWin,
//     multiplier: r.multiplier,
//     betAmount: r.betAmount,
//     payout: r.payout,
//     profit: r.profit,
//     newBalance: r.newBalance,
//     serverSeedHash: r.serverSeedHash,
//     clientSeed: r.clientSeed,
//     nonce: r.nonce,
//   };
// }

// function parseCard(card?: string) {
//   if (!card) return null;
//   const suit = card.slice(-1);
//   const value = card.slice(0, -1);
//   const isRed = suit === "♥" || suit === "♦";
//   return { suit, value, isRed };
// }

// function CardBack() {
//   return (
//     <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-600 to-fuchsia-700 shadow-xl">
//       <div className="absolute inset-2 rounded-xl border border-white/20" />
//       <div className="absolute inset-0 flex items-center justify-center">
//         <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center">
//           <Sparkles className="w-5 h-5 text-yellow-300" />
//         </div>
//       </div>
//       <div className="absolute inset-0 opacity-25 [background:radial-gradient(circle_at_30%_30%,rgba(255,255,255,.35),transparent_35%),radial-gradient(circle_at_70%_70%,rgba(255,255,255,.25),transparent_40%)]" />
//     </div>
//   );
// }

// function CardFace({ card }: { card: string }) {
//   const p = parseCard(card);
//   const suit = p?.suit ?? "";
//   const value = p?.value ?? "?";
//   const isRed = !!p?.isRed;

//   return (
//     <div
//       className={`absolute inset-0 rounded-2xl bg-white shadow-xl border ${
//         isRed ? "border-red-200" : "border-slate-200"
//       }`}
//     >
//       <div className="absolute inset-0 rounded-2xl opacity-[0.06] [background:radial-gradient(circle_at_20%_20%,#000,transparent_40%),radial-gradient(circle_at_80%_70%,#000,transparent_45%)]" />

//       <div
//         className={`absolute left-3 top-3 flex flex-col leading-none ${
//           isRed ? "text-red-500" : "text-slate-800"
//         }`}
//       >
//         <span className="text-lg font-extrabold">{value}</span>
//         <span className="text-base -mt-0.5">{suit}</span>
//       </div>

//       <div
//         className={`absolute right-3 bottom-3 flex flex-col leading-none rotate-180 ${
//           isRed ? "text-red-500" : "text-slate-800"
//         }`}
//       >
//         <span className="text-lg font-extrabold">{value}</span>
//         <span className="text-base -mt-0.5">{suit}</span>
//       </div>

//       <div
//         className={`absolute inset-0 flex items-center justify-center ${
//           isRed ? "text-red-500" : "text-slate-800"
//         }`}
//       >
//         <div className="text-5xl font-black select-none">
//           {value}
//           <span className="ml-1">{suit}</span>
//         </div>
//       </div>
//     </div>
//   );
// }

// function PlayingCard({
//   card,
//   state,
//   accent,
// }: {
//   card?: string;
//   state: "placeholder" | "back" | "reveal";
//   accent?: "win" | "lose" | "neutral";
// }) {
//   const glow =
//     accent === "win"
//       ? "shadow-[0_0_0_1px_rgba(34,197,94,.35),0_0_28px_rgba(34,197,94,.25)]"
//       : accent === "lose"
//       ? "shadow-[0_0_0_1px_rgba(239,68,68,.35),0_0_28px_rgba(239,68,68,.18)]"
//       : "shadow-xl";

//   if (state === "placeholder") {
//     return (
//       <div className="relative w-28 h-40 rounded-2xl border-2 border-dashed border-white/20 bg-white/5 flex items-center justify-center text-white/35">
//         <span className="text-4xl font-black">?</span>
//       </div>
//     );
//   }

//   return (
//     <motion.div
//       className={`relative w-28 h-40 [perspective:900px] ${glow}`}
//       initial={false}
//       animate={
//         state === "reveal"
//           ? { rotateY: 180, scale: 1 }
//           : { rotateY: 0, scale: 1 }
//       }
//       transition={{ type: "spring", stiffness: 260, damping: 22 }}
//     >
//       <div className="absolute inset-0 [transform-style:preserve-3d]">
//         <div className="absolute inset-0 [backface-visibility:hidden]">
//           <CardBack />
//         </div>

//         <div className="absolute inset-0 [transform:rotateY(180deg)] [backface-visibility:hidden]">
//           {/* ✅ no fake face fallback */}
//           {card ? <CardFace card={card} /> : <CardBack />}
//         </div>
//       </div>
//     </motion.div>
//   );
// }

// function FloatingWinBits({ show }: { show: boolean }) {
//   const bits = useMemo(
//     () =>
//       Array.from({ length: 14 }).map((_, i) => ({
//         id: `b-${i}`,
//         x: Math.round((Math.random() * 2 - 1) * 140),
//         delay: Math.random() * 0.18,
//         s: Math.random() * 0.35 + 0.65,
//         r: Math.round((Math.random() * 2 - 1) * 30),
//       })),
//     [show]
//   );

//   return (
//     <AnimatePresence>
//       {show && (
//         <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
//           {bits.map((b) => (
//             <motion.div
//               key={b.id}
//               className="absolute left-1/2 bottom-10 text-xl"
//               initial={{ opacity: 0, y: 0, x: 0, rotate: 0, scale: 0.6 }}
//               animate={{
//                 opacity: [0, 1, 1, 0],
//                 y: [-10, -90, -150],
//                 x: [0, b.x],
//                 rotate: [0, b.r],
//                 scale: b.s,
//               }}
//               exit={{ opacity: 0 }}
//               transition={{ duration: 1.05, delay: b.delay, ease: "easeOut" }}
//             >
//               ✨
//             </motion.div>
//           ))}
//         </div>
//       )}
//     </AnimatePresence>
//   );
// }

// export default function HiLoGame() {
//   const { currentUser, setCurrentUser } = useStore();
//   const { toast } = useToast();

//   const [betAmount, setBetAmount] = useState("100");
//   const [selectedChip, setSelectedChip] = useState<number | null>(100);

//   const [phase, setPhase] = useState<
//     "idle" | "animating" | "revealFirst" | "revealNext" | "done"
//   >("idle");

//   const [isPlaying, setIsPlaying] = useState(false);
//   const [result, setResult] = useState<NormalizedHiLo | null>(null);
//   const [dealerName] = useState("Lucky Liu");

//   const [lastGuess, setLastGuess] = useState<"higher" | "lower" | null>(null);
//   const [history, setHistory] = useState<RoundItem[]>([]);
//   const [streak, setStreak] = useState(0);

//   const lockRef = useRef(false);

//   const balance = Number(currentUser?.balance ?? 0);
//   const amountNum = useMemo(() => parseFloat(betAmount || "0"), [betAmount]);

//   const canPlay = useMemo(() => {
//     if (isPlaying) return false;
//     if (!amountNum || amountNum <= 0) return false;
//     if (currentUser && amountNum > Number(currentUser.balance)) return false;
//     return true;
//   }, [isPlaying, amountNum, currentUser]);

//   useEffect(() => {
//     const onKey = (e: KeyboardEvent) => {
//       if (e.key === "ArrowUp" || e.key === "h" || e.key === "H") {
//         if (canPlay) handlePlay("higher");
//       }
//       if (e.key === "ArrowDown" || e.key === "l" || e.key === "L") {
//         if (canPlay) handlePlay("lower");
//       }
//     };
//     window.addEventListener("keydown", onKey);
//     return () => window.removeEventListener("keydown", onKey);
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [canPlay, betAmount, phase, isPlaying]);

//   const pushHistory = (item: RoundItem) => {
//     setHistory((prev) => [item, ...prev].slice(0, 6));
//   };

//   const handlePlay = async (guess: "higher" | "lower") => {
//     if (lockRef.current) return;
//     lockRef.current = true;

//     const amount = parseFloat(betAmount);
//     if (!amount || amount <= 0) {
//       toast({
//         title: "Invalid bet",
//         description: "Please enter a valid bet amount",
//         variant: "destructive",
//       });
//       lockRef.current = false;
//       return;
//     }

//     if (currentUser && amount > Number(currentUser.balance)) {
//       toast({ title: "Insufficient balance", variant: "destructive" });
//       lockRef.current = false;
//       return;
//     }

//     setLastGuess(guess);
//     setIsPlaying(true);
//     setResult(null);
//     setPhase("animating");

//     try {
//       await new Promise((r) => setTimeout(r, 550));

//       const raw = await api.playHiLo(amount, guess);
//       const gameResult = normalizeHiLoResult(raw);

//       // reveal sequence
//       setResult(gameResult);
//       setPhase("revealFirst");
//       await new Promise((r) => setTimeout(r, 520));
//       setPhase("revealNext");
//       await new Promise((r) => setTimeout(r, 520));
//       setPhase("done");

//       if (currentUser) {
//         setCurrentUser({
//           ...currentUser,
//           balance: String(gameResult.newBalance),
//         });
//       }

//       setStreak((s) => (gameResult.isWin ? s + 1 : 0));
//       pushHistory({
//         id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
//         firstCard: gameResult.firstCard,
//         nextCard: gameResult.nextCard,
//         guess,
//         isWin: gameResult.isWin,
//         payout: Number(gameResult.payout || 0),
//         ts: Date.now(),
//       });

//       setTimeout(() => {
//         toast({
//           title: gameResult.isWin ? "Correct!" : "Wrong!",
//           description: gameResult.isWin
//             ? `You won ₹${Number(gameResult.payout).toFixed(2)}`
//             : `You lost ₹${amount.toFixed(2)}`,
//           variant: gameResult.isWin ? "default" : "destructive",
//         });
//       }, 250);
//     } catch (error: any) {
//       toast({
//         title: "Error",
//         description: error.message,
//         variant: "destructive",
//       });
//       setPhase("idle");
//     } finally {
//       setTimeout(() => {
//         setIsPlaying(false);
//         lockRef.current = false;
//       }, 350);
//     }
//   };

//   const headerText =
//     phase === "animating"
//       ? "Dealing..."
//       : result
//       ? "Result!"
//       : "Will the next card be higher or lower?";

//   const subText =
//     currentUser && amountNum > 0
//       ? `Balance: ₹${Number(balance).toFixed(0)}`
//       : "Tip: Use ↑ / ↓ keys to play faster";

//   const win = !!result?.isWin;
//   const lose = !!result && !result.isWin;

//   return (
//     <AppShell hideHeader hideBottomNav>
//       <div className="flex flex-col gap-6 pb-20 md:pb-6">
//         <div className="flex items-center gap-4">
//           <Link href="/casino">
//             <Button variant="ghost" size="icon">
//               <ArrowLeft className="h-5 w-5" />
//             </Button>
//           </Link>

//           <div className="flex items-baseline gap-3">
//             <h1 className="text-2xl font-heading font-bold">Hi-Lo</h1>
//             <span className="text-xs text-muted-foreground">
//               A is low • K is high
//             </span>
//           </div>
//         </div>

//         <Card className="relative overflow-hidden p-6 border-indigo-700 bg-gradient-to-br from-indigo-950 via-violet-950 to-slate-950 min-h-[410px]">
//           <div className="pointer-events-none absolute inset-0 opacity-20 [background:radial-gradient(circle_at_20%_20%,rgba(34,197,94,.25),transparent_40%),radial-gradient(circle_at_80%_30%,rgba(99,102,241,.28),transparent_45%),radial-gradient(circle_at_60%_85%,rgba(217,70,239,.18),transparent_50%)]" />
//           <div className="pointer-events-none absolute inset-0 opacity-10 [background:repeating-linear-gradient(45deg,rgba(255,255,255,.12)_0px,rgba(255,255,255,.12)_1px,transparent_1px,transparent_10px)]" />

//           <FloatingWinBits show={phase === "done" && win} />

//           <div className="relative text-center mb-4">
//             <motion.div
//               animate={phase === "animating" ? { scale: [1, 1.05, 1] } : {}}
//               transition={{
//                 repeat: phase === "animating" ? Infinity : 0,
//                 duration: 0.6,
//               }}
//               className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-black/30 border border-white/10"
//             >
//               <Sparkles className="w-4 h-4 text-yellow-400" />
//               <span className="text-sm font-medium">{dealerName}</span>

//               {streak >= 2 && (
//                 <span className="ml-2 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-white/10 border border-white/10">
//                   <Zap className="w-3 h-3 text-yellow-300" />
//                   {streak} streak
//                 </span>
//               )}
//             </motion.div>

//             <p className="text-sm text-muted-foreground mt-2">{headerText}</p>
//             <p className="text-xs text-white/40 mt-1">{subText}</p>

//             {/* tiny fairness hint (hash + nonce) */}
//             <AnimatePresence>
//               {phase === "done" && result && (
//                 <motion.div
//                   initial={{ opacity: 0, y: 6 }}
//                   animate={{ opacity: 1, y: 0 }}
//                   exit={{ opacity: 0 }}
//                   className="mt-2 text-[11px] text-white/35"
//                 >
//                   Hash: {result.serverSeedHash?.slice(0, 10)}… • Nonce:{" "}
//                   {result.nonce}
//                 </motion.div>
//               )}
//             </AnimatePresence>
//           </div>

//           <div className="relative flex justify-center items-center gap-8 py-6">
//             <div className="text-center">
//               <p className="text-xs tracking-wide text-white/55 mb-2">
//                 FIRST CARD
//               </p>

//               <PlayingCard
//                 card={result?.firstCard}
//                 state={
//                   phase === "idle"
//                     ? "back"
//                     : phase === "animating"
//                     ? "back"
//                     : phase === "revealFirst" ||
//                       phase === "revealNext" ||
//                       phase === "done"
//                     ? "reveal"
//                     : "back"
//                 }
//                 accent={result ? (win ? "win" : "lose") : "neutral"}
//               />
//             </div>

//             <div className="relative w-16 flex items-center justify-center">
//               <AnimatePresence>
//                 {phase === "done" && result && (
//                   <motion.div
//                     initial={{ scale: 0.6, opacity: 0 }}
//                     animate={
//                       win
//                         ? { scale: [1, 1.06, 1], opacity: 1 }
//                         : { scale: 1, opacity: 1, x: [0, -8, 8, -6, 6, 0] }
//                     }
//                     exit={{ opacity: 0 }}
//                     transition={{ duration: win ? 0.35 : 0.45 }}
//                     className={`select-none text-5xl font-black ${
//                       win ? "text-green-400" : "text-red-400"
//                     }`}
//                   >
//                     {win ? "✓" : "✕"}
//                   </motion.div>
//                 )}
//               </AnimatePresence>

//               <AnimatePresence>
//                 {phase !== "done" && lastGuess && (
//                   <motion.div
//                     key={lastGuess}
//                     initial={{ opacity: 0, scale: 0.9 }}
//                     animate={{ opacity: 0.85, scale: 1 }}
//                     exit={{ opacity: 0, scale: 0.95 }}
//                     className="text-xs text-white/70"
//                   >
//                     {lastGuess === "higher" ? "Higher" : "Lower"}
//                   </motion.div>
//                 )}
//               </AnimatePresence>

//               <AnimatePresence>
//                 {phase === "done" && lose && (
//                   <motion.div
//                     initial={{ opacity: 0, scale: 1.2, rotate: -10 }}
//                     animate={{ opacity: 1, scale: 1, rotate: -8 }}
//                     exit={{ opacity: 0 }}
//                     className="absolute -bottom-10 left-1/2 -translate-x-1/2"
//                   >
//                     <div className="px-4 py-1.5 rounded-lg border border-red-400/40 bg-red-500/10 text-red-300 text-xs font-extrabold tracking-widest">
//                       WRONG
//                     </div>
//                   </motion.div>
//                 )}
//               </AnimatePresence>
//             </div>

//             <div className="text-center">
//               <p className="text-xs tracking-wide text-white/55 mb-2">
//                 NEXT CARD
//               </p>

//               <PlayingCard
//                 card={result?.nextCard}
//                 state={
//                   result
//                     ? phase === "revealNext" || phase === "done"
//                       ? "reveal"
//                       : "back"
//                     : "placeholder"
//                 }
//                 accent={result ? (win ? "win" : "lose") : "neutral"}
//               />
//             </div>
//           </div>

//           <AnimatePresence>
//             {phase === "done" && result && (
//               <motion.div
//                 initial={{ opacity: 0, y: 6 }}
//                 animate={{ opacity: 1, y: 0 }}
//                 exit={{ opacity: 0 }}
//                 className="relative text-center pt-2"
//               >
//                 <div
//                   className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border ${
//                     win
//                       ? "border-green-400/30 bg-green-500/10 text-green-300"
//                       : "border-red-400/30 bg-red-500/10 text-red-300"
//                   }`}
//                 >
//                   <span className="text-sm font-extrabold tracking-wide">
//                     {win
//                       ? `YOU WIN +₹${Number(result.payout).toFixed(0)}`
//                       : `YOU LOSE -₹${Number(amountNum).toFixed(0)}`}
//                   </span>
//                 </div>
//               </motion.div>
//             )}
//           </AnimatePresence>

//           <div className="mt-6 flex items-center justify-between">
//             <div className="flex items-center gap-2 text-xs text-white/60">
//               <History className="w-4 h-4" />
//               <span>Last rounds</span>
//             </div>

//             <div className="flex gap-2 flex-wrap justify-end">
//               {history.length === 0 ? (
//                 <span className="text-xs text-white/35">No rounds yet</span>
//               ) : (
//                 history.map((h) => {
//                   const p = parseCard(h.nextCard);
//                   const chipColor = h.isWin
//                     ? "bg-green-500/15 border-green-400/25 text-green-200"
//                     : "bg-red-500/15 border-red-400/25 text-red-200";
//                   return (
//                     <div
//                       key={h.id}
//                       className={`px-2.5 py-1 rounded-full border text-xs ${chipColor}`}
//                       title={`${h.firstCard} → ${h.nextCard} (${h.guess})`}
//                     >
//                       <span className={p?.isRed ? "text-red-200" : ""}>
//                         {h.nextCard}
//                       </span>
//                     </div>
//                   );
//                 })
//               )}
//             </div>
//           </div>
//         </Card>

//         <Card className="p-4">
//           <div className="flex flex-col gap-4">
//             <div className="flex items-center justify-between">
//               <label className="text-sm text-muted-foreground">Bet Amount</label>
//               <div className="text-xs text-muted-foreground">
//                 {currentUser ? `Balance: ₹${balance.toFixed(0)}` : ""}
//               </div>
//             </div>

//             <Input
//               type="number"
//               value={betAmount}
//               onChange={(e) => {
//                 setBetAmount(e.target.value);
//                 setSelectedChip(null);
//               }}
//               placeholder="Enter bet amount"
//               min="10"
//               disabled={isPlaying}
//             />

//             <div className="flex gap-2 flex-wrap">
//               {[50, 100, 500, 1000].map((amt) => {
//                 const active = selectedChip === amt && betAmount === String(amt);
//                 return (
//                   <Button
//                     key={amt}
//                     variant={active ? "default" : "outline"}
//                     size="sm"
//                     onClick={() => {
//                       setBetAmount(String(amt));
//                       setSelectedChip(amt);
//                     }}
//                     disabled={isPlaying}
//                     className={
//                       active ? "bg-white text-black hover:bg-white/90" : undefined
//                     }
//                   >
//                     ₹{amt}
//                   </Button>
//                 );
//               })}
//             </div>

//             <div className="grid grid-cols-2 gap-4">
//               <Button
//                 onClick={() => handlePlay("higher")}
//                 disabled={!canPlay}
//                 className="bg-green-600 hover:bg-green-700 active:scale-[0.99] transition"
//                 size="lg"
//               >
//                 <ArrowUp className="w-5 h-5 mr-2" />
//                 Higher <span className="ml-2 text-xs opacity-80">(↑ / H)</span>
//               </Button>

//               <Button
//                 onClick={() => handlePlay("lower")}
//                 disabled={!canPlay}
//                 className="bg-red-600 hover:bg-red-700 active:scale-[0.99] transition"
//                 size="lg"
//               >
//                 <ArrowDown className="w-5 h-5 mr-2" />
//                 Lower <span className="ml-2 text-xs opacity-80">(↓ / L)</span>
//               </Button>
//             </div>

//             {!canPlay && currentUser && amountNum > Number(currentUser.balance) && (
//               <div className="text-xs text-red-400">
//                 Your bet is higher than your balance.
//               </div>
//             )}

//             <div className="text-[11px] text-muted-foreground">
//               Security note: results come from server seed hash + client seed + nonce (not guessable).
//             </div>
//           </div>
//         </Card>
//       </div>
//     </AppShell>
//   );
// }
