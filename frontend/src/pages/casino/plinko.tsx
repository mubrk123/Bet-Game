// @ts-nocheck
import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Circle } from "lucide-react";
import { Link } from "wouter";

export default function PlinkoGame() {
  const { currentUser, setCurrentUser } = useStore();
  const { toast } = useToast();
  const [betAmount, setBetAmount] = useState("100");
  const [risk, setRisk] = useState<'low' | 'medium' | 'high'>('medium');
  const [isPlaying, setIsPlaying] = useState(false);
  const [ballPosition, setBallPosition] = useState({ x: 50, y: 0 });
  const [isDropping, setIsDropping] = useState(false);
  const [result, setResult] = useState<any>(null);

  const multipliers = {
    low: [1.5, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.5],
    medium: [3, 1.5, 1.2, 0.5, 0.3, 0.5, 1.2, 1.5, 3],
    high: [10, 3, 1.5, 0.5, 0.2, 0.5, 1.5, 3, 10]
  };

  const handlePlay = async () => {
    const amount = parseFloat(betAmount);
    if (!amount || amount <= 0) {
      toast({ title: "Invalid bet", description: "Please enter a valid bet amount", variant: "destructive" });
      return;
    }

    if (currentUser && amount > currentUser.balance) {
      toast({ title: "Insufficient balance", variant: "destructive" });
      return;
    }

    setIsPlaying(true);
    setIsDropping(true);
    setResult(null);
    setBallPosition({ x: 50, y: 0 });

    try {
      const gameResult = await api.playPlinko(amount, risk, 16);
      
      // Animate ball dropping
      const steps = 16;
      let currentX = 50;
      
      for (let i = 0; i < steps; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const direction = gameResult.path[i] === 'L' ? -3 : 3;
        currentX += direction;
        setBallPosition({ x: currentX, y: ((i + 1) / steps) * 100 });
      }

      setIsDropping(false);
      setResult(gameResult);
      
      if (currentUser) {
        setCurrentUser({ ...currentUser, balance: gameResult.newBalance });
      }

      toast({
        title: gameResult.isWin ? "Winner!" : "Better luck next time",
        description: `${gameResult.multiplier}x - ${gameResult.isWin ? `Won ₹${gameResult.payout.toFixed(2)}` : `Lost ₹${amount.toFixed(2)}`}`,
        variant: gameResult.isWin ? "default" : "destructive"
      });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setIsDropping(false);
    } finally {
      setTimeout(() => setIsPlaying(false), 1000);
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
          <h1 className="text-2xl font-heading font-bold">Plinko</h1>
        </div>

        <Card className="p-6 bg-gradient-to-br from-cyan-900 to-blue-950 border-cyan-700">
          {/* Plinko Board */}
          <div className="relative w-full h-[300px] overflow-hidden rounded-xl bg-black/30">
            {/* Pegs */}
            {Array.from({ length: 8 }).map((_, row) => (
              <div key={row} className="absolute w-full flex justify-center gap-6" style={{ top: `${(row + 1) * 30}px` }}>
                {Array.from({ length: row + 3 }).map((_, col) => (
                  <div key={col} className="w-2 h-2 rounded-full bg-white/50" />
                ))}
              </div>
            ))}

            {/* Ball */}
            <AnimatePresence>
              {isDropping && (
                <motion.div
                  animate={{
                    left: `${ballPosition.x}%`,
                    top: `${ballPosition.y}%`,
                  }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  className="absolute w-6 h-6 -ml-3 -mt-3"
                >
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 0.5, ease: "linear" }}
                    className="w-full h-full rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 shadow-lg"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Multiplier Slots */}
            <div className="absolute bottom-0 left-0 right-0 flex justify-center gap-1 px-2">
              {multipliers[risk].map((mult, i) => (
                <motion.div
                  key={i}
                  animate={result?.slot === i ? { scale: [1, 1.2, 1], backgroundColor: ['#22c55e', '#16a34a', '#22c55e'] } : {}}
                  transition={{ duration: 0.5 }}
                  className={`flex-1 py-2 text-center text-xs font-bold rounded-t-lg ${
                    mult >= 3 ? 'bg-green-600' : mult >= 1.5 ? 'bg-yellow-600' : mult >= 1 ? 'bg-blue-600' : 'bg-red-600'
                  }`}
                >
                  {mult}x
                </motion.div>
              ))}
            </div>
          </div>

          {/* Result */}
          <AnimatePresence>
            {result && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="text-center py-4"
              >
                <span className={`text-3xl font-bold ${result.isWin ? 'text-green-400' : 'text-red-400'}`}>
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
              <label className="text-sm text-muted-foreground mb-2 block">Risk Level</label>
              <div className="grid grid-cols-3 gap-2">
                {(['low', 'medium', 'high'] as const).map(r => (
                  <Button
                    key={r}
                    variant={risk === r ? 'default' : 'outline'}
                    onClick={() => setRisk(r)}
                    disabled={isPlaying}
                    className="capitalize"
                  >
                    {r}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-2 block">Bet Amount</label>
              <Input
                type="number"
                value={betAmount}
                onChange={(e) => setBetAmount(e.target.value)}
                min="10"
                disabled={isPlaying}
              />
            </div>
            <div className="flex gap-2">
              {[50, 100, 500, 1000].map(amount => (
                <Button
                  key={amount}
                  variant="outline"
                  size="sm"
                  onClick={() => setBetAmount(amount.toString())}
                  disabled={isPlaying}
                >
                  ₹{amount}
                </Button>
              ))}
            </div>
            <Button onClick={handlePlay} disabled={isPlaying} size="lg">
              {isDropping ? "Dropping..." : "Drop Ball"}
            </Button>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
