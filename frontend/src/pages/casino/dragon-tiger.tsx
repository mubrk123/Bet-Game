import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Sparkles } from "lucide-react";
import { Link } from "wouter";

function PlayingCard({ card, label, delay = 0, isDealing = false }: { card?: string; label: string; delay?: number; isDealing?: boolean }) {
  const getCardDisplay = (card: string) => {
    const value = card.slice(0, -1);
    const suit = card.slice(-1);
    return `${value}${suit}`;
  };

  const isRed = card?.includes('♥') || card?.includes('♦');

  if (isDealing) {
    return (
      <div className="text-center">
        <p className="text-lg font-bold mb-3">{label}</p>
        <motion.div
          animate={{ rotateY: [0, 180, 360] }}
          transition={{ repeat: Infinity, duration: 0.6 }}
          className="w-20 h-28 rounded-xl bg-gradient-to-br from-red-600 to-orange-600 flex items-center justify-center text-3xl shadow-xl mx-auto"
        >
          🂠
        </motion.div>
      </div>
    );
  }

  return (
    <div className="text-center">
      <p className="text-lg font-bold mb-3">{label}</p>
      <motion.div
        initial={{ rotateY: 180, scale: 0.5 }}
        animate={{ rotateY: 0, scale: 1 }}
        transition={{ delay, duration: 0.5, type: "spring" }}
        className={`w-20 h-28 rounded-xl flex items-center justify-center text-2xl font-bold shadow-xl mx-auto ${
          isRed ? 'bg-white text-red-500' : 'bg-white text-gray-900'
        }`}
      >
        {card ? getCardDisplay(card) : '?'}
      </motion.div>
    </div>
  );
}

export default function DragonTigerGame() {
  const { currentUser, setCurrentUser } = useStore();
  const { toast } = useToast();
  const [betAmount, setBetAmount] = useState("100");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDealing, setIsDealing] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [dealerName] = useState("Master Chen");

  const handlePlay = async (bet: 'dragon' | 'tiger' | 'tie') => {
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
    setIsDealing(true);
    setResult(null);

    try {
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const gameResult = await api.playDragonTiger(amount, bet);
      setIsDealing(false);
      setResult(gameResult);
      
      if (currentUser) {
        setCurrentUser({ ...currentUser, balance: gameResult.newBalance });
      }

      setTimeout(() => {
        toast({
          title: gameResult.isWin ? "You Win!" : "You Lose",
          description: gameResult.isWin 
            ? `You won ₹${gameResult.payout.toFixed(2)}!` 
            : `You lost ₹${amount.toFixed(2)}`,
          variant: gameResult.isWin ? "default" : "destructive"
        });
      }, 1000);
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setIsDealing(false);
    } finally {
      setTimeout(() => setIsPlaying(false), 2000);
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
          <h1 className="text-2xl font-heading font-bold">Dragon Tiger</h1>
        </div>

        <Card className="p-6 bg-gradient-to-br from-red-900 to-orange-950 border-red-700 min-h-[350px]">
          {/* Dealer */}
          <div className="text-center mb-6">
            <motion.div
              animate={isDealing ? { scale: [1, 1.1, 1] } : {}}
              transition={{ repeat: isDealing ? Infinity : 0, duration: 0.5 }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-black/30"
            >
              <Sparkles className="w-4 h-4 text-yellow-400" />
              <span className="text-sm font-medium">{dealerName}</span>
            </motion.div>
          </div>

          {/* Cards Display */}
          <div className="flex justify-center items-center gap-12 py-6">
            {isDealing ? (
              <>
                <PlayingCard label="🐉 Dragon" isDealing />
                <div className="text-3xl font-bold text-yellow-400">VS</div>
                <PlayingCard label="🐯 Tiger" isDealing />
              </>
            ) : result ? (
              <>
                <div className={result.winner === 'dragon' ? 'ring-4 ring-yellow-400 rounded-xl p-1' : ''}>
                  <PlayingCard card={result.dragonCard} label="🐉 Dragon" />
                </div>
                <div className="text-3xl font-bold text-yellow-400">VS</div>
                <div className={result.winner === 'tiger' ? 'ring-4 ring-yellow-400 rounded-xl p-1' : ''}>
                  <PlayingCard card={result.tigerCard} label="🐯 Tiger" delay={0.3} />
                </div>
              </>
            ) : (
              <>
                <div className="text-center">
                  <p className="text-lg font-bold mb-3">🐉 Dragon</p>
                  <div className="w-20 h-28 rounded-xl bg-gradient-to-br from-red-600 to-orange-600 flex items-center justify-center text-3xl">
                    🂠
                  </div>
                </div>
                <div className="text-3xl font-bold text-yellow-400">VS</div>
                <div className="text-center">
                  <p className="text-lg font-bold mb-3">🐯 Tiger</p>
                  <div className="w-20 h-28 rounded-xl bg-gradient-to-br from-orange-600 to-yellow-600 flex items-center justify-center text-3xl">
                    🂠
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Result */}
          <AnimatePresence>
            {result && (
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="text-center py-4"
              >
                <span className="text-xl font-bold text-yellow-400 uppercase">
                  {result.winner === 'tie' ? '🎴 TIE!' : result.winner === 'dragon' ? '🐉 Dragon Wins!' : '🐯 Tiger Wins!'}
                </span>
                <p className={`text-lg mt-2 ${result.isWin ? 'text-green-400' : 'text-red-400'}`}>
                  {result.isWin ? `+₹${result.payout.toFixed(0)}` : `-₹${parseFloat(betAmount).toFixed(0)}`}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>

        {/* Betting Controls */}
        <Card className="p-4">
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-sm text-muted-foreground mb-2 block">Bet Amount</label>
              <Input
                type="number"
                value={betAmount}
                onChange={(e) => setBetAmount(e.target.value)}
                placeholder="Enter bet amount"
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
            <div className="grid grid-cols-3 gap-3">
              <Button 
                onClick={() => handlePlay('dragon')} 
                disabled={isPlaying}
                className="bg-red-600 hover:bg-red-700"
                size="lg"
              >
                🐉 Dragon
              </Button>
              <Button 
                onClick={() => handlePlay('tie')} 
                disabled={isPlaying}
                className="bg-yellow-600 hover:bg-yellow-700"
                size="lg"
              >
                🎴 Tie (8x)
              </Button>
              <Button 
                onClick={() => handlePlay('tiger')} 
                disabled={isPlaying}
                className="bg-orange-600 hover:bg-orange-700"
                size="lg"
              >
                🐯 Tiger
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
