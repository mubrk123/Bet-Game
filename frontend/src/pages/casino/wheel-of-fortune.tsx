import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";

const SEGMENTS = [
  { label: '1x', color: '#ef4444', multiplier: 1 },
  { label: '2x', color: '#f97316', multiplier: 2 },
  { label: '1x', color: '#ef4444', multiplier: 1 },
  { label: '5x', color: '#22c55e', multiplier: 5 },
  { label: '1x', color: '#ef4444', multiplier: 1 },
  { label: '2x', color: '#f97316', multiplier: 2 },
  { label: '1x', color: '#ef4444', multiplier: 1 },
  { label: '10x', color: '#3b82f6', multiplier: 10 },
  { label: '1x', color: '#ef4444', multiplier: 1 },
  { label: '2x', color: '#f97316', multiplier: 2 },
  { label: '1x', color: '#ef4444', multiplier: 1 },
  { label: '50x', color: '#a855f7', multiplier: 50 },
];

export default function WheelOfFortuneGame() {
  const { currentUser, setCurrentUser } = useStore();
  const { toast } = useToast();
  const [betAmount, setBetAmount] = useState("100");
  const [isSpinning, setIsSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState<any>(null);

  const handleSpin = async () => {
    const amount = parseFloat(betAmount);
    if (!amount || amount <= 0) {
      toast({ title: "Invalid bet", description: "Please enter a valid bet amount", variant: "destructive" });
      return;
    }

    if (currentUser && amount > currentUser.balance) {
      toast({ title: "Insufficient balance", variant: "destructive" });
      return;
    }

    setIsSpinning(true);
    setResult(null);

    try {
      const gameResult = await api.playWheelOfFortune(amount);
      
      // Calculate rotation to land on winning segment
      const segmentAngle = 360 / SEGMENTS.length;
      const targetAngle = gameResult.segment * segmentAngle;
      const spins = 5; // Number of full rotations
      const finalRotation = rotation + (spins * 360) + (360 - targetAngle) + (segmentAngle / 2);
      
      setRotation(finalRotation);
      
      // Wait for spin animation
      await new Promise(resolve => setTimeout(resolve, 4000));
      
      setResult(gameResult);
      
      if (currentUser) {
        setCurrentUser({ ...currentUser, balance: gameResult.newBalance });
      }

      toast({
        title: `${gameResult.multiplier}x!`,
        description: gameResult.isWin 
          ? `You won ₹${gameResult.payout.toFixed(2)}!` 
          : `You lost ₹${amount.toFixed(2)}`,
        variant: gameResult.isWin ? "default" : "destructive"
      });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsSpinning(false);
    }
  };

  return (
    <AppShell hideHeader hideBottomNav>
      <div className="flex flex-col gap-6 pb-20 md:pb-6">
        <div className="flex items-center gap-4">
          <Link href="/casino">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="text-2xl font-heading font-bold">Wheel of Fortune</h1>
        </div>

        <Card className="p-6 bg-gradient-to-br from-yellow-900 to-red-950 border-yellow-700">
          <div className="relative flex justify-center items-center py-8">
            {/* Pointer */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 z-10">
              <div className="w-0 h-0 border-l-[15px] border-r-[15px] border-t-[25px] border-l-transparent border-r-transparent border-t-yellow-400" />
            </div>

            {/* Wheel */}
            <motion.div
              animate={{ rotate: rotation }}
              transition={{ duration: 4, ease: [0.2, 0.8, 0.2, 1] }}
              className="relative w-64 h-64 rounded-full overflow-hidden shadow-2xl"
              style={{ transformOrigin: 'center center' }}
            >
              <svg viewBox="0 0 100 100" className="w-full h-full">
                {SEGMENTS.map((seg, i) => {
                  const angle = 360 / SEGMENTS.length;
                  const startAngle = i * angle - 90;
                  const endAngle = startAngle + angle;
                  const largeArc = angle > 180 ? 1 : 0;
                  
                  const startRad = (startAngle * Math.PI) / 180;
                  const endRad = (endAngle * Math.PI) / 180;
                  
                  const x1 = 50 + 50 * Math.cos(startRad);
                  const y1 = 50 + 50 * Math.sin(startRad);
                  const x2 = 50 + 50 * Math.cos(endRad);
                  const y2 = 50 + 50 * Math.sin(endRad);
                  
                  const textAngle = startAngle + angle / 2;
                  const textRad = (textAngle * Math.PI) / 180;
                  const textX = 50 + 35 * Math.cos(textRad);
                  const textY = 50 + 35 * Math.sin(textRad);
                  
                  return (
                    <g key={i}>
                      <path
                        d={`M 50 50 L ${x1} ${y1} A 50 50 0 ${largeArc} 1 ${x2} ${y2} Z`}
                        fill={seg.color}
                        stroke="#000"
                        strokeWidth="0.5"
                      />
                      <text
                        x={textX}
                        y={textY}
                        fill="white"
                        fontSize="6"
                        fontWeight="bold"
                        textAnchor="middle"
                        dominantBaseline="middle"
                        transform={`rotate(${textAngle + 90}, ${textX}, ${textY})`}
                      >
                        {seg.label}
                      </text>
                    </g>
                  );
                })}
                <circle cx="50" cy="50" r="8" fill="#1a1a2e" stroke="#ffd700" strokeWidth="2" />
              </svg>
            </motion.div>
          </div>

          {/* Result */}
          <AnimatePresence>
            {result && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="text-center py-4"
              >
                <span className={`text-4xl font-bold ${result.isWin ? 'text-green-400' : 'text-yellow-400'}`}>
                  {result.multiplier}x
                </span>
                <p className={`text-lg ${result.isWin ? 'text-green-400' : 'text-red-400'}`}>
                  {result.isWin ? `+₹${result.payout.toFixed(0)}` : `-₹${parseFloat(betAmount).toFixed(0)}`}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>

        {/* Controls */}
        <Card className="p-4">
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-sm text-muted-foreground mb-2 block">Bet Amount</label>
              <Input
                type="number"
                value={betAmount}
                onChange={(e) => setBetAmount(e.target.value)}
                min="10"
                disabled={isSpinning}
              />
            </div>
            <div className="flex gap-2">
              {[50, 100, 500, 1000].map(amount => (
                <Button
                  key={amount}
                  variant="outline"
                  size="sm"
                  onClick={() => setBetAmount(amount.toString())}
                  disabled={isSpinning}
                >
                  ₹{amount}
                </Button>
              ))}
            </div>
            <Button onClick={handleSpin} disabled={isSpinning} size="lg">
              {isSpinning ? "Spinning..." : "Spin the Wheel!"}
            </Button>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
