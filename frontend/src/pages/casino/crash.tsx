// import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
// import { Link } from "wouter";
// import { motion } from "framer-motion";
// import { ArrowLeft, Rocket, Sparkles, Timer } from "lucide-react";

// import { AppShell } from "@/components/layout/AppShell";
// import { Button } from "@/components/ui/button";
// import { Card } from "@/components/ui/card";
// import { Input } from "@/components/ui/input";
// import { Slider } from "@/components/ui/slider";
// import { Badge } from "@/components/ui/badge";
// import { useToast } from "@/hooks/use-toast";
// import { api, type CrashResult } from "@/lib/api";
// import { useStore } from "@/lib/store";
// import { cn } from "@/lib/utils";

// type Phase = "betting" | "flying" | "crashed" | "cashed";

// type QueuedBet = {
//   amount: number;
//   autoCashout: number;
// };

// type ActiveBet = {
//   betAmount: number;
//   autoCashout: number;
//   result: CrashResult;
//   status: "live" | "cashed" | "busted";
//   cashedAt?: number;
// };

// // Game constants - REALISTIC VALUES
// const BASE_RATE = 1.0015; // Much slower for realistic feel
// const TIME_ACCEL = 0.8; // Slowed down significantly
// const MIN_CASHOUT = 1.1;
// const MAX_CASHOUT = 50;
// const MIN_BET = 10;
// const BET_WINDOW_MIN = 10; // 10 seconds betting window
// const BET_WINDOW_MAX = 10;

// const numberFmt = new Intl.NumberFormat("en-IN", {
//   maximumFractionDigits: 2,
//   minimumFractionDigits: 0,
// });

// const clamp = (n: number, min: number, max: number) => {
//   if (typeof n !== 'number' || isNaN(n) || !isFinite(n)) return min;
//   return Math.min(max, Math.max(min, n));
// };

// const randomCountdown = () =>
//   Math.floor(Math.random() * (BET_WINDOW_MAX - BET_WINDOW_MIN + 1)) + BET_WINDOW_MIN;

// // Create realistic trail particles
// const createTrailParticles = (count: number) => 
//   Array.from({ length: count }).map((_, i) => ({
//     id: i,
//     size: 2 + Math.random() * 4,
//     opacity: 0.3 + Math.random() * 0.5,
//     offsetX: Math.random() * 8 - 4,
//     offsetY: Math.random() * 8 - 4,
//     delay: i * 0.05,
//     duration: 0.6 + Math.random() * 0.4,
//   }));

// // Create stars
// const createStars = (count: number) =>
//   Array.from({ length: count }).map((_, i) => ({
//     id: i,
//     left: Math.random() * 100,
//     top: Math.random() * 100,
//     size: Math.random() * 1.5 + 0.5,
//     opacity: Math.random() * 0.4 + 0.2,
//   }));

// export default function CrashGame() {
//   const { currentUser, setCurrentUser } = useStore();
//   const { toast } = useToast();

//   const [betAmount, setBetAmount] = useState<string>("100");
//   const [autoCashout, setAutoCashout] = useState<number>(2);
//   const [phase, setPhase] = useState<Phase>("betting");
//   const [countdown, setCountdown] = useState<number>(randomCountdown());
//   const [queuedBet, setQueuedBet] = useState<QueuedBet | null>(null);
//   const [activeBet, setActiveBet] = useState<ActiveBet | null>(null);
//   const [currentMultiplier, setCurrentMultiplier] = useState<number>(1);
//   const [crashPoint, setCrashPoint] = useState<number | null>(null);
//   const [shake, setShake] = useState<boolean>(false);
//   const [trailParticles, setTrailParticles] = useState(() => createTrailParticles(20));
//   const [stars, setStars] = useState(() => createStars(80));
//   const [rocketAngle, setRocketAngle] = useState<number>(0);

//   // Refs
//   const frameRef = useRef<number | null>(null);
//   const startTimeRef = useRef<number>(0);
//   const cashedOutRef = useRef<boolean>(false);
//   const crashTargetRef = useRef<number>(0);
//   const activeBetRef = useRef<ActiveBet | null>(null);
//   const userRef = useRef(currentUser);
//   const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
//   const rocketPathRef = useRef<{x: number, y: number}[]>([]);

//   useEffect(() => {
//     userRef.current = currentUser;
//   }, [currentUser]);

//   useEffect(() => {
//     activeBetRef.current = activeBet;
//   }, [activeBet]);

//   useEffect(() => {
//     const prev = document.body.style.overflow;
//     document.body.style.overflow = "hidden";
//     return () => {
//       document.body.style.overflow = prev;
//     };
//   }, []);

//   // Calculate rocket position with exponential path
//   const rocketPosition = useMemo(() => {
//     if (!crashPoint || crashPoint <= 1) return { x: 0, y: 100 };
    
//     const progress = (Math.log(currentMultiplier) / Math.log(crashPoint));
//     const normalizedProgress = clamp(progress, 0, 1);
    
//     // Exponential curve for rocket path
//     const x = 10 + normalizedProgress * 80; // Horizontal movement
//     const y = 80 - Math.pow(normalizedProgress, 1.5) * 60; // Upward curve
    
//     // Calculate rocket angle based on movement
//     if (rocketPathRef.current.length > 0) {
//       const lastPos = rocketPathRef.current[rocketPathRef.current.length - 1];
//       const dx = x - lastPos.x;
//       const dy = y - lastPos.y;
//       const angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
//       setRocketAngle(angle);
//     }
    
//     rocketPathRef.current.push({ x, y });
//     if (rocketPathRef.current.length > 10) {
//       rocketPathRef.current.shift();
//     }
    
//     return { x, y };
//   }, [crashPoint, currentMultiplier]);

//   const multiplierProgress = useMemo(() => {
//     if (!crashPoint || crashPoint <= 1) return 0;
//     const progress = (Math.log(currentMultiplier) / Math.log(crashPoint));
//     return clamp(progress, 0, 1);
//   }, [crashPoint, currentMultiplier]);

//   // Reset everything
//   const resetLoop = useCallback(() => {
//     if (frameRef.current) {
//       cancelAnimationFrame(frameRef.current);
//       frameRef.current = null;
//     }
//     if (settleTimerRef.current) {
//       clearTimeout(settleTimerRef.current);
//       settleTimerRef.current = null;
//     }
//     cashedOutRef.current = false;
//     setCurrentMultiplier(1);
//     setCrashPoint(null);
//     setShake(false);
//     setRocketAngle(0);
//     rocketPathRef.current = [];
//     setTrailParticles(createTrailParticles(20));
//   }, []);

//   const scheduleNext = useCallback(() => {
//     settleTimerRef.current = setTimeout(() => {
//       resetLoop();
//       setActiveBet(null);
//       setPhase("betting");
//       setCountdown(randomCountdown());
//     }, 3000);
//   }, [resetLoop]);

//   const handleCrash = useCallback(
//     (target: number) => {
//       const safeTarget = clamp(target, 1.01, 1000);
//       setCurrentMultiplier(safeTarget);
//       setPhase("crashed");
//       setCrashPoint(safeTarget);
//       setShake(true);

//       const bet = activeBetRef.current;
//       if (bet && bet.status === "live") {
//         setActiveBet({ ...bet, status: "busted" });
//         if (userRef.current && bet.result) {
//           setCurrentUser({ ...userRef.current, balance: bet.result.newBalance });
//         }
//         toast({
//           title: "💥 Crashed!",
//           description: `Lost ₹${bet.betAmount.toFixed(2)} at ${safeTarget.toFixed(2)}x`,
//           variant: "destructive",
//         });
//       }

//       scheduleNext();
//     },
//     [scheduleNext, setCurrentUser, toast]
//   );

//   const animateFlight = useCallback(
//     (target: number, result: CrashResult | null) => {
//       resetLoop();
//       const safeTarget = clamp(target, 1.01, 1000);
//       crashTargetRef.current = safeTarget;
//       startTimeRef.current = performance.now();
//       setCrashPoint(safeTarget);
//       setPhase("flying");
//       rocketPathRef.current = [];

//       const step = () => {
//         const elapsedMs = performance.now() - startTimeRef.current;
//         if (elapsedMs < 0) {
//           frameRef.current = requestAnimationFrame(step);
//           return;
//         }

//         // Exponential growth that starts slow and accelerates
//         const elapsed = (elapsedMs / 1000) * TIME_ACCEL;
//         const exponent = elapsed * BASE_RATE;
//         const next = Math.pow(1.01, exponent); // Much slower exponential growth
//         const clamped = Math.min(next, safeTarget);

//         // Update multiplier
//         if (typeof clamped === 'number' && !isNaN(clamped) && isFinite(clamped)) {
//           setCurrentMultiplier(clamped);
//         }

//         // Check auto cashout
//         const bet = activeBetRef.current;
//         if (
//           bet &&
//           bet.status === "live" &&
//           result?.isWin &&
//           !cashedOutRef.current &&
//           clamped >= bet.autoCashout
//         ) {
//           cashedOutRef.current = true;
//           setActiveBet({ ...bet, status: "cashed", cashedAt: bet.autoCashout });
//           setPhase("cashed");
          
//           if (userRef.current) {
//             setCurrentUser({ ...userRef.current, balance: result.newBalance });
//           }
//           toast({
//             title: `💰 Cashed at ${bet.autoCashout.toFixed(2)}x`,
//             description: `+₹${result.payout.toFixed(2)}`,
//             className: "bg-emerald-600 text-white border-none",
//           });
//         }

//         // Check if reached crash point
//         if (clamped >= safeTarget) {
//           handleCrash(safeTarget);
//           return;
//         }

//         frameRef.current = requestAnimationFrame(step);
//       };

//       frameRef.current = requestAnimationFrame(step);
//     },
//     [handleCrash, resetLoop, setCurrentUser, toast]
//   );

//   const startRound = useCallback(async () => {
//     if (phase !== "betting") return;

//     const queued = queuedBet;
//     setQueuedBet(null);
//     cashedOutRef.current = false;
//     setShake(false);
//     setPhase("flying");

//     let result: CrashResult | null = null;

//     if (queued) {
//       if (!currentUser) {
//         toast({ title: "Login to place a bet", variant: "destructive" });
//         return;
//       }
//       if (queued.amount > currentUser.balance) {
//         toast({ title: "Insufficient balance", variant: "destructive" });
//         return;
//       }

//       try {
//         result = await api.playCrash(queued.amount, queued.autoCashout);
//         setActiveBet({
//           betAmount: queued.amount,
//           autoCashout: queued.autoCashout,
//           result,
//           status: "live",
//         });
        
//         // Animate flight with server crash point
//         animateFlight(result.crashPoint, result);
//         return;
//       } catch (err: unknown) {
//         const message = err instanceof Error ? err.message : "Unable to start round";
//         toast({
//           title: "Bet failed",
//           description: message,
//           variant: "destructive",
//         });
//       }
//     }

//     // If no bet placed, just show visual crash (with realistic point)
//     const visualCrashPoint = 1.5 + Math.random() * 10; // Visual only
//     animateFlight(visualCrashPoint, null);
//   }, [animateFlight, currentUser, phase, queuedBet, toast]);

//   // Countdown timer
//   useEffect(() => {
//     if (phase !== "betting") return;
    
//     const timer = setInterval(() => {
//       setCountdown((prev) => {
//         if (prev <= 1) {
//           clearInterval(timer);
//           void startRound();
//           return 0;
//         }
//         return prev - 1;
//       });
//     }, 1000);

//     return () => clearInterval(timer);
//   }, [phase, startRound]);

//   // Auto queue bet when timer is low
//   useEffect(() => {
//     if (phase === "betting" && countdown <= 3 && !queuedBet) {
//       const amount = parseFloat(betAmount);
//       if (currentUser && Number.isFinite(amount) && amount > 0 && amount <= currentUser.balance) {
//         const target = clamp(autoCashout, MIN_CASHOUT, MAX_CASHOUT);
//         setQueuedBet({ amount, autoCashout: target });
//       }
//     }
//   }, [phase, countdown, betAmount, autoCashout, currentUser, queuedBet]);

//   // Cleanup
//   useEffect(() => {
//     return () => {
//       if (frameRef.current) cancelAnimationFrame(frameRef.current);
//       if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
//     };
//   }, []);

//   const queueCurrentBet = () => {
//     const amount = parseFloat(betAmount);
    
//     if (!currentUser) {
//       toast({ title: "Please log in", variant: "destructive" });
//       return;
//     }
//     if (!Number.isFinite(amount) || amount <= 0) {
//       toast({ title: "Invalid bet", description: "Enter a valid amount", variant: "destructive" });
//       return;
//     }
//     if (amount > currentUser.balance) {
//       toast({ title: "Insufficient balance", variant: "destructive" });
//       return;
//     }
    
//     const target = clamp(autoCashout, MIN_CASHOUT, MAX_CASHOUT);
//     setQueuedBet({ amount, autoCashout: target });
//     toast({
//       title: "Bet placed",
//       description: `₹${amount.toFixed(2)} • Auto cashout ${target.toFixed(2)}x`,
//     });
//   };

//   const cancelQueuedBet = () => {
//     setQueuedBet(null);
//     toast({ title: "Bet cancelled", description: "Removed from next round" });
//   };

//   const quickSet = (kind: "min" | "double" | "max") => {
//     if (kind === "min") setBetAmount(String(MIN_BET));
//     if (kind === "double") {
//       setBetAmount((prev) => {
//         const next = Number(prev || "0") * 2 || MIN_BET * 2;
//         return String(Math.round(next));
//       });
//     }
//     if (kind === "max" && currentUser) {
//       setBetAmount(String(Math.max(MIN_BET, currentUser.balance)));
//     }
//   };

//   const statusText = phase === "betting" 
//     ? `Place bet: ${countdown}s` 
//     : phase === "flying" 
//       ? "Live" 
//       : phase === "cashed" 
//         ? "Cashed" 
//         : "Crashed";

//   const displayMultiplier = Number.isFinite(currentMultiplier) ? currentMultiplier : 1;

//   return (
//     <AppShell hideHeader hideBottomNav fullBleed>
//       <div
//         className={cn(
//           "relative min-h-[100dvh] w-full overflow-hidden text-white",
//           shake && "animate-[crash-shake_0.4s_ease-in-out]"
//         )}
//       >
//         {/* Background with animated stars */}
//         <div className="absolute inset-0 bg-gradient-to-b from-gray-900 via-blue-950 to-gray-900">
//           {stars.map((star) => (
//             <div
//               key={star.id}
//               className="absolute rounded-full bg-white"
//               style={{
//                 left: `${star.left}%`,
//                 top: `${star.top}%`,
//                 width: `${star.size}px`,
//                 height: `${star.size}px`,
//                 opacity: star.opacity,
//               }}
//             />
//           ))}
          
//           {/* Animated nebula */}
//           <div className="absolute inset-0 opacity-40"
//             style={{
//               background: `
//                 radial-gradient(circle at 20% 30%, rgba(59, 130, 246, 0.2), transparent 40%),
//                 radial-gradient(circle at 80% 70%, rgba(168, 85, 247, 0.2), transparent 40%)
//               `,
//             }}
//           />
//         </div>

//         {/* Custom animations */}
//         <style>{`
//           @keyframes crash-shake {
//             0%, 100% { transform: translateX(0); }
//             10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
//             20%, 40%, 60%, 80% { transform: translateX(5px); }
//           }
          
//           @keyframes trail-particle {
//             0% { transform: translate(var(--tx), var(--ty)) scale(1); opacity: 0.8; }
//             100% { transform: translate(calc(var(--tx) * 1.5), calc(var(--ty) * 1.5)) scale(0.2); opacity: 0; }
//           }
          
//           @keyframes rocket-pulse {
//             0%, 100% { transform: scale(1); }
//             50% { transform: scale(1.05); }
//           }
//         `}</style>

//         <div className="relative z-10 flex h-full flex-col">
//           {/* Header */}
//           <div className="flex items-center justify-between px-4 pt-4">
//             <Link href="/casino">
//               <Button variant="ghost" size="sm" className="gap-2 text-white/80 hover:text-white">
//                 <ArrowLeft className="h-4 w-4" />
//                 Back
//               </Button>
//             </Link>
//             <Badge className="bg-white/10 text-white backdrop-blur border-white/20 flex items-center gap-2">
//               <ShieldGlow />
//               Provably Fair
//             </Badge>
//           </div>

//           {/* Main Game Area */}
//           <div className="flex-1 px-4 pb-24 pt-6 w-full max-w-4xl mx-auto space-y-6">
//             <div className="flex items-center justify-between">
//               <div>
//                 <h1 className="text-3xl font-bold tracking-tight">CRASH</h1>
//                 <p className="text-sm text-white/60 mt-1">Betting closes in {countdown} seconds</p>
//               </div>
//               <div className="flex items-center gap-2 text-sm">
//                 <Timer className="h-4 w-4" />
//                 <span className={cn(
//                   "font-semibold",
//                   phase === "betting" ? "text-amber-300" :
//                   phase === "flying" ? "text-emerald-300" :
//                   phase === "cashed" ? "text-emerald-400" :
//                   "text-rose-300"
//                 )}>
//                   {statusText}
//                 </span>
//               </div>
//             </div>

//             {/* Game Card */}
//             <Card className="relative overflow-hidden border-white/10 bg-gradient-to-br from-white/5 via-white/2 to-white/5 backdrop-blur">
//               <div className="relative z-10 p-5 space-y-6">
//                 {/* Status badges */}
//                 <div className="flex items-center gap-2 flex-wrap">
//                   <Badge className={cn(
//                     "font-semibold",
//                     phase === "betting" ? "bg-amber-500/20 text-amber-200 border-amber-400/30" :
//                     phase === "flying" ? "bg-emerald-500/20 text-emerald-200 border-emerald-400/30" :
//                     phase === "cashed" ? "bg-emerald-600/30 text-emerald-100 border-emerald-500/40" :
//                     "bg-rose-500/20 text-rose-200 border-rose-400/30"
//                   )}>
//                     {phase === "betting" ? `BETTING TIME: ${countdown}s` : 
//                      phase === "flying" ? "ROCKET FLYING" : 
//                      phase === "cashed" ? "CASHED OUT" : "CRASHED"}
//                   </Badge>
                  
//                   {queuedBet && (
//                     <Badge className="bg-blue-500/20 text-blue-100 border-blue-400/30">
//                       ₹{queuedBet.amount} @ {queuedBet.autoCashout.toFixed(2)}x
//                     </Badge>
//                   )}
                  
//                   {activeBet && (
//                     <Badge className="bg-amber-500/20 text-amber-100 border-amber-400/30">
//                       Live: ₹{activeBet.betAmount.toFixed(0)}
//                     </Badge>
//                   )}
//                 </div>

//                 {/* Multiplier Display */}
//                 <div className="flex items-end justify-between">
//                   <div className="text-6xl sm:text-7xl font-black tracking-tight">
//                     <div className="flex items-baseline gap-2">
//                       <span className="text-white/70">x</span>
//                       <span className={cn(
//                         phase === "crashed" ? "text-rose-300" :
//                         phase === "cashed" ? "text-emerald-300" :
//                         "text-white"
//                       )}>
//                         {displayMultiplier.toFixed(displayMultiplier < 10 ? 2 : 1)}
//                       </span>
//                     </div>
//                   </div>
                  
//                   {phase === "crashed" && crashPoint && (
//                     <div className="text-sm font-semibold text-rose-300">
//                       Crashed @ {crashPoint.toFixed(2)}x
//                     </div>
//                   )}
//                   {phase === "cashed" && activeBet?.cashedAt && (
//                     <div className="text-sm font-semibold text-emerald-300">
//                       Cashed @ {activeBet.cashedAt.toFixed(2)}x
//                     </div>
//                   )}
//                 </div>

//                 {/* Game Track - Now with curved path */}
//                 <div className="relative h-[320px] overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-black/30 to-gray-900/40">
//                   {/* Curved path line */}
//                   <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }}>
//                     <path
//                       d="M 5% 80% Q 50% 20%, 95% 20%"
//                       fill="none"
//                       stroke="rgba(255,255,255,0.1)"
//                       strokeWidth="2"
//                       strokeDasharray="5,5"
//                     />
//                   </svg>

//                   {/* Multiplier markers along curved path */}
//                   {[1, 2, 5, 10, 20, 50].map((mult) => {
//                     const progress = mult <= 1 ? 0 : Math.log(mult) / Math.log(100);
//                     const x = 5 + progress * 90;
//                     const y = 80 - Math.pow(progress, 1.5) * 60;
                    
//                     return (
//                       <div
//                         key={mult}
//                         className="absolute flex flex-col items-center"
//                         style={{
//                           left: `${x}%`,
//                           top: `${y}%`,
//                           transform: 'translate(-50%, -50%)',
//                         }}
//                       >
//                         <div className="h-3 w-px bg-white/30 mb-1" />
//                         <div className="text-xs text-white/50">{mult}x</div>
//                       </div>
//                     );
//                   })}

//                   {/* Auto cashout line */}
//                   {activeBet && crashPoint && (
//                     <div
//                       className="absolute"
//                       style={{
//                         left: `${rocketPosition.x}%`,
//                         top: `${rocketPosition.y}%`,
//                         transform: 'translate(-50%, -50%)',
//                         width: '2px',
//                         height: '60px',
//                         background: 'linear-gradient(to top, transparent, #10b981, transparent)',
//                         opacity: 0.5,
//                       }}
//                     >
//                       <div className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap bg-emerald-500 text-[10px] px-2 py-1 rounded-full text-emerald-950 font-bold shadow-lg">
//                         {activeBet.autoCashout.toFixed(1)}x
//                       </div>
//                     </div>
//                   )}

//                   {/* Rocket with trail */}
//                   <div className="absolute w-full h-full">
//                     {/* Trail particles */}
//                     <div className="absolute"
//                       style={{
//                         left: `${rocketPosition.x}%`,
//                         top: `${rocketPosition.y}%`,
//                         transform: 'translate(-50%, -50%)',
//                       }}
//                     >
//                       {trailParticles.map((particle) => (
//                         <div
//                           key={particle.id}
//                           className="absolute rounded-full bg-gradient-to-r from-amber-400 to-orange-500"
//                           style={{
//                             width: `${particle.size}px`,
//                             height: `${particle.size}px`,
//                             opacity: particle.opacity,
//                             '--tx': `${particle.offsetX}px`,
//                             '--ty': `${particle.offsetY}px`,
//                             animation: `trail-particle ${particle.duration}s ${particle.delay}s infinite`,
//                           } as React.CSSProperties}
//                         />
//                       ))}
//                     </div>

//                     {/* Rocket */}
//                     <motion.div
//                       className="absolute"
//                       style={{
//                         left: `${rocketPosition.x}%`,
//                         top: `${rocketPosition.y}%`,
//                         transform: `translate(-50%, -50%) rotate(${rocketAngle}deg)`,
//                       }}
//                       animate={
//                         phase === "flying" 
//                           ? { 
//                               scale: [1, 1.02, 1],
//                             } 
//                           : {}
//                       }
//                       transition={
//                         phase === "flying" 
//                           ? { 
//                               duration: 0.5,
//                               repeat: Infinity,
//                               ease: "easeInOut"
//                             } 
//                           : {}
//                       }
//                     >
//                       <div className="relative">
//                         {/* Rocket glow */}
//                         <div className="absolute -inset-4 rounded-full bg-amber-400/30 blur-xl" />
                        
//                         {/* Rocket body */}
//                         <div className="relative h-14 w-14 rounded-full bg-gradient-to-br from-amber-300 via-orange-400 to-red-500 shadow-[0_0_40px_rgba(251,191,36,0.6)] flex items-center justify-center animate-rocket-pulse">
//                           <Rocket className="h-7 w-7 text-gray-900" style={{ transform: 'rotate(45deg)' }} />
                          
//                           {/* Rocket flames */}
//                           <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-4 h-6">
//                             <div className="absolute inset-0 rounded-full bg-gradient-to-t from-red-500 via-orange-400 to-yellow-300 blur-sm" />
//                             <div className="absolute inset-0 rounded-full bg-gradient-to-t from-red-600 via-orange-500 to-yellow-400 blur" />
//                           </div>
//                         </div>
//                       </div>
//                     </motion.div>
//                   </div>
//                 </div>
//               </div>
//             </Card>
//           </div>

//           {/* Betting Panel */}
//           <div className="fixed inset-x-0 bottom-0 z-20 px-4 pb-4">
//             <Card className="relative border-white/10 bg-gradient-to-t from-gray-900 to-gray-800/90 backdrop-blur-xl">
//               <div className="relative p-4 space-y-4">
//                 {/* Timer and status */}
//                 <div className="flex items-center justify-between text-sm">
//                   <div className="flex items-center gap-2 text-white/70">
//                     <Timer className="h-4 w-4" />
//                     <span>
//                       {phase === "betting" 
//                         ? `Betting closes in ${countdown} seconds` 
//                         : phase === "flying" 
//                           ? "Rocket is flying..."
//                           : "Round ended"}
//                     </span>
//                   </div>
                  
//                   {queuedBet && (
//                     <Button 
//                       size="sm" 
//                       variant="ghost" 
//                       className="text-amber-200 h-7 px-3 text-xs"
//                       onClick={cancelQueuedBet}
//                     >
//                       Cancel Bet
//                     </Button>
//                   )}
//                 </div>

//                 {/* Betting controls */}
//                 <div className="grid gap-4 sm:grid-cols-3">
//                   {/* Bet Amount */}
//                   <div className="space-y-2">
//                     <div className="flex justify-between text-xs text-white/70">
//                       <span>Bet Amount</span>
//                       <span>Balance: ₹{numberFmt.format(currentUser?.balance ?? 0)}</span>
//                     </div>
//                     <div className="flex items-center gap-2">
//                       <Input
//                         type="number"
//                         inputMode="decimal"
//                         value={betAmount}
//                         onChange={(e) => setBetAmount(e.target.value)}
//                         className="bg-white/5 border-white/10 h-10"
//                         disabled={phase !== "betting"}
//                       />
//                       <div className="flex gap-1">
//                         <Button 
//                           size="sm" 
//                           variant="secondary" 
//                           className="bg-white/10 h-10 px-3 text-xs"
//                           onClick={() => quickSet("min")}
//                           disabled={phase !== "betting"}
//                         >
//                           Min
//                         </Button>
//                         <Button 
//                           size="sm" 
//                           variant="secondary" 
//                           className="bg-white/10 h-10 px-3 text-xs"
//                           onClick={() => quickSet("double")}
//                           disabled={phase !== "betting"}
//                         >
//                           2x
//                         </Button>
//                         <Button 
//                           size="sm" 
//                           variant="secondary" 
//                           className="bg-white/10 h-10 px-3 text-xs"
//                           onClick={() => quickSet("max")}
//                           disabled={phase !== "betting"}
//                         >
//                           Max
//                         </Button>
//                       </div>
//                     </div>
//                   </div>

//                   {/* Auto Cashout */}
//                   <div className="space-y-2">
//                     <div className="flex justify-between text-xs text-white/70">
//                       <span>Auto Cashout</span>
//                       <span>{clamp(autoCashout, MIN_CASHOUT, MAX_CASHOUT).toFixed(2)}x</span>
//                     </div>
//                     <div className="flex items-center gap-2">
//                       <Slider
//                         min={MIN_CASHOUT}
//                         max={MAX_CASHOUT}
//                         step={0.1}
//                         value={[clamp(autoCashout, MIN_CASHOUT, MAX_CASHOUT)]}
//                         onValueChange={(v) => setAutoCashout(Number(v[0]?.toFixed(2) || autoCashout))}
//                         className="w-full"
//                         disabled={phase !== "betting"}
//                       />
//                       <Input
//                         type="number"
//                         inputMode="decimal"
//                         value={autoCashout.toFixed(2)}
//                         onChange={(e) =>
//                           setAutoCashout(clamp(parseFloat(e.target.value) || MIN_CASHOUT, MIN_CASHOUT, MAX_CASHOUT))
//                         }
//                         className="w-20 bg-white/5 border-white/10 h-10"
//                         disabled={phase !== "betting"}
//                       />
//                     </div>
//                   </div>

//                   {/* Action Button */}
//                   <div className="flex items-end">
//                     <Button
//                       className={cn(
//                         "w-full py-3 text-base font-semibold transition-all duration-200",
//                         phase !== "betting" 
//                           ? "bg-gray-600 cursor-not-allowed" 
//                           : queuedBet
//                             ? "bg-amber-500 hover:bg-amber-400 text-gray-900"
//                             : "bg-emerald-500 hover:bg-emerald-400 text-white"
//                       )}
//                       onClick={() => {
//                         if (phase !== "betting") return;
//                         if (queuedBet) {
//                           cancelQueuedBet();
//                         } else {
//                           queueCurrentBet();
//                         }
//                       }}
//                       disabled={phase !== "betting"}
//                     >
//                       {phase === "betting" 
//                         ? (queuedBet ? "Cancel Bet" : "Place Bet") 
//                         : phase === "flying" 
//                           ? "Rocket Flying..." 
//                           : "Round Ended"}
//                     </Button>
//                   </div>
//                 </div>
//               </div>
//             </Card>
//           </div>
//         </div>
//       </div>
//     </AppShell>
//   );
// }

// function ShieldGlow() {
//   return (
//     <span className="relative inline-flex h-4 w-4 items-center justify-center">
//       <span className="absolute inset-0 rounded-full bg-emerald-400/30 blur-md" />
//       <Sparkles className="relative h-3 w-3 text-emerald-200" />
//     </span>
//   );
// }