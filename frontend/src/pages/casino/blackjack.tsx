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
import { ArrowLeft, Sparkles } from "lucide-react";
import { Link } from "wouter";

const CARD_BACK = "🂠";

function PlayingCard({ card, delay = 0, revealed = true }: { card: string; delay?: number; revealed?: boolean }) {
  const getCardDisplay = (card: string) => {
    if (!revealed) return CARD_BACK;
    const value = card.slice(0, -1);
    const suit = card.slice(-1);
    const suitSymbol = suit === '♠' ? '♠' : suit === '♥' ? '♥' : suit === '♦' ? '♦' : '♣';
    return `${value}${suitSymbol}`;
  };

  const isRed = card.includes('♥') || card.includes('♦');

  return (
    <motion.div
      initial={{ rotateY: 180, scale: 0 }}
      animate={{ rotateY: 0, scale: 1 }}
      transition={{ delay, duration: 0.5, type: "spring" }}
      className={`w-16 h-24 rounded-lg flex items-center justify-center text-2xl font-bold shadow-lg ${
        revealed 
          ? `bg-white ${isRed ? 'text-red-500' : 'text-gray-900'}`
          : 'bg-gradient-to-br from-blue-600 to-blue-800'
      }`}
    >
      {getCardDisplay(card)}
    </motion.div>
  );
}

export default function BlackjackGame() {
  const { currentUser, setCurrentUser } = useStore();
  const { toast } = useToast();
  const [betAmount, setBetAmount] = useState("100");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDealing, setIsDealing] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [dealerName] = useState("Jack Diamond");

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
    setIsDealing(true);
    setResult(null);

    try {
      // Simulate dealing animation
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const gameResult = await api.playBlackjack(amount);
      setResult(gameResult);
      
      if (currentUser) {
        setCurrentUser({ ...currentUser, balance: gameResult.newBalance });
      }

      setTimeout(() => {
        toast({
          title: gameResult.isWin ? "You Win!" : gameResult.isPush ? "Push!" : "Dealer Wins",
          description: gameResult.isWin 
            ? `You won ₹${gameResult.payout.toFixed(2)}!` 
            : gameResult.isPush 
              ? "It's a tie - bet returned"
              : `You lost ₹${amount.toFixed(2)}`,
          variant: gameResult.isWin ? "default" : "destructive"
        });
      }, 1500);
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsDealing(false);
      setTimeout(() => setIsPlaying(false), 3000);
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
          <h1 className="text-2xl font-heading font-bold">Blackjack</h1>
        </div>

        <Card className="p-6 bg-gradient-to-br from-green-900 to-green-950 border-green-700 min-h-[400px]">
          {/* Dealer Section */}
          <div className="text-center mb-8">
            <motion.div
              animate={isDealing ? { scale: [1, 1.1, 1] } : {}}
              transition={{ repeat: isDealing ? Infinity : 0, duration: 1 }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-black/30 mb-4"
            >
              <Sparkles className="w-4 h-4 text-yellow-400" />
              <span className="text-sm font-medium">{dealerName}</span>
            </motion.div>
            
            <p className="text-sm text-muted-foreground mb-4">Dealer's Hand</p>
            <div className="flex justify-center gap-2 min-h-[96px]">
              <AnimatePresence>
                {result?.dealerCards?.map((card: string, i: number) => (
                  <PlayingCard key={i} card={card} delay={i * 0.3 + 0.5} />
                ))}
                {isDealing && !result && (
                  <>
                    <motion.div
                      animate={{ rotateY: [0, 180, 0] }}
                      transition={{ repeat: Infinity, duration: 0.8 }}
                      className="w-16 h-24 rounded-lg bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center text-3xl"
                    >
                      {CARD_BACK}
                    </motion.div>
                    <motion.div
                      animate={{ rotateY: [0, 180, 0] }}
                      transition={{ repeat: Infinity, duration: 0.8, delay: 0.2 }}
                      className="w-16 h-24 rounded-lg bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center text-3xl"
                    >
                      {CARD_BACK}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
            {result && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-lg font-bold mt-2"
              >
                {result.dealerValue}
              </motion.p>
            )}
          </div>

          {/* Result Display */}
          <AnimatePresence>
            {result && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="text-center py-4"
              >
                <span className={`text-3xl font-bold ${result.isWin ? 'text-green-400' : result.isPush ? 'text-yellow-400' : 'text-red-400'}`}>
                  {result.isWin ? 'YOU WIN!' : result.isPush ? 'PUSH' : 'DEALER WINS'}
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Player Section */}
          <div className="text-center mt-8">
            <p className="text-sm text-muted-foreground mb-4">Your Hand</p>
            <div className="flex justify-center gap-2 min-h-[96px]">
              <AnimatePresence>
                {result?.playerCards?.map((card: string, i: number) => (
                  <PlayingCard key={i} card={card} delay={i * 0.3} />
                ))}
                {isDealing && !result && (
                  <>
                    <motion.div
                      animate={{ rotateY: [0, 180, 0] }}
                      transition={{ repeat: Infinity, duration: 0.8, delay: 0.4 }}
                      className="w-16 h-24 rounded-lg bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center text-3xl"
                    >
                      {CARD_BACK}
                    </motion.div>
                    <motion.div
                      animate={{ rotateY: [0, 180, 0] }}
                      transition={{ repeat: Infinity, duration: 0.8, delay: 0.6 }}
                      className="w-16 h-24 rounded-lg bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center text-3xl"
                    >
                      {CARD_BACK}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
            {result && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-lg font-bold mt-2"
              >
                {result.playerValue}
              </motion.p>
            )}
          </div>
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
            <Button 
              onClick={handlePlay} 
              disabled={isPlaying}
              className="w-full"
              size="lg"
            >
              {isDealing ? "Dealing..." : "Deal Cards"}
            </Button>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
