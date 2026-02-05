// @ts-nocheck
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Shield } from "lucide-react";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Link } from "wouter";
import { useStore } from "@/lib/store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const QUICK_BETS = [10, 50, 100, 500, 1000];

export default function TeenPattiGame() {
  const [betAmount, setBetAmount] = useState('100');
  const [isPlaying, setIsPlaying] = useState(false);
  const [result, setResult] = useState<{
    playerCards: string[];
    dealerCards: string[];
    playerHandRank: string;
    dealerHandRank: string;
    winner: 'player' | 'dealer' | 'tie';
    isWin: boolean;
    isTie: boolean;
    payout: number;
  } | null>(null);
  
  const { currentUser, setCurrentUser } = useStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const playMutation = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(betAmount);
      if (isNaN(amount) || amount <= 0) throw new Error('Invalid bet amount');
      return await api.playTeenPatti(amount);
    },
    onMutate: () => {
      setIsPlaying(true);
      setResult(null);
    },
    onSuccess: (data) => {
      setTimeout(() => {
        setIsPlaying(false);
        setResult({
          playerCards: data.playerCards,
          dealerCards: data.dealerCards,
          playerHandRank: data.playerHandRank,
          dealerHandRank: data.dealerHandRank,
          winner: data.winner,
          isWin: data.isWin,
          isTie: data.isTie,
          payout: data.payout,
        });
        
        if (data.isWin) {
          toast({
            title: `You Win with ${data.playerHandRank}!`,
            description: `+₹${data.payout.toFixed(2)}`,
            className: "bg-green-600 text-white border-none"
          });
        } else if (data.isTie) {
          toast({
            title: `It's a Tie!`,
            description: `Bet returned`,
          });
        } else {
          toast({
            title: `Dealer wins with ${data.dealerHandRank}`,
            description: `Lost ₹${data.betAmount.toFixed(2)}`,
            variant: "destructive"
          });
        }
        
        setCurrentUser({
          ...currentUser!,
          balance: data.newBalance
        });
        
        queryClient.invalidateQueries({ queryKey: ['casino-history'] });
      }, 1500);
    },
    onError: (error: any) => {
      setIsPlaying(false);
      toast({
        title: "Game Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const handlePlay = () => {
    if (!currentUser) {
      toast({ title: "Please login", variant: "destructive" });
      return;
    }
    playMutation.mutate();
  };

  return (
    <AppShell hideHeader hideBottomNav>
      <div className="flex flex-col gap-6 pb-20 md:pb-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-4">
          <Link href="/casino">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-heading font-bold flex items-center gap-2">
              <span className="text-2xl">🎴</span>
              Teen Patti
            </h1>
            <p className="text-sm text-muted-foreground">Beat the dealer with the best hand</p>
          </div>
        </div>

        <Card className="p-6 bg-gradient-to-br from-rose-900/50 to-pink-900/50 border-rose-500/30">
          <div className="grid grid-cols-2 gap-8">
            <div className="text-center">
              <p className={cn(
                "font-bold mb-3 text-lg",
                result?.winner === 'player' ? "text-green-500" : ""
              )}>YOUR HAND</p>
              <div className="flex gap-2 justify-center mb-2">
                {isPlaying ? (
                  <>
                    <div className="w-14 h-20 rounded-lg bg-white/10 animate-pulse border-2 border-white/20" />
                    <div className="w-14 h-20 rounded-lg bg-white/10 animate-pulse border-2 border-white/20" />
                    <div className="w-14 h-20 rounded-lg bg-white/10 animate-pulse border-2 border-white/20" />
                  </>
                ) : result?.playerCards ? (
                  result.playerCards.map((card, i) => (
                    <div key={i} className="w-14 h-20 rounded-lg bg-white/10 border-2 border-white/30 flex items-center justify-center text-xl font-bold">
                      {card}
                    </div>
                  ))
                ) : (
                  <>
                    <div className="w-14 h-20 rounded-lg bg-white/10 border-2 border-white/20 flex items-center justify-center text-2xl">?</div>
                    <div className="w-14 h-20 rounded-lg bg-white/10 border-2 border-white/20 flex items-center justify-center text-2xl">?</div>
                    <div className="w-14 h-20 rounded-lg bg-white/10 border-2 border-white/20 flex items-center justify-center text-2xl">?</div>
                  </>
                )}
              </div>
              {result && <p className="text-sm text-muted-foreground">{result.playerHandRank}</p>}
            </div>

            <div className="text-center">
              <p className={cn(
                "font-bold mb-3 text-lg",
                result?.winner === 'dealer' ? "text-red-500" : ""
              )}>DEALER</p>
              <div className="flex gap-2 justify-center mb-2">
                {isPlaying ? (
                  <>
                    <div className="w-14 h-20 rounded-lg bg-red-900/50 animate-pulse border-2 border-red-500/30" />
                    <div className="w-14 h-20 rounded-lg bg-red-900/50 animate-pulse border-2 border-red-500/30" />
                    <div className="w-14 h-20 rounded-lg bg-red-900/50 animate-pulse border-2 border-red-500/30" />
                  </>
                ) : result?.dealerCards ? (
                  result.dealerCards.map((card, i) => (
                    <div key={i} className="w-14 h-20 rounded-lg bg-red-900/30 border-2 border-red-500/30 flex items-center justify-center text-xl font-bold">
                      {card}
                    </div>
                  ))
                ) : (
                  <>
                    <div className="w-14 h-20 rounded-lg bg-red-900/30 border-2 border-red-500/20 flex items-center justify-center text-2xl">?</div>
                    <div className="w-14 h-20 rounded-lg bg-red-900/30 border-2 border-red-500/20 flex items-center justify-center text-2xl">?</div>
                    <div className="w-14 h-20 rounded-lg bg-red-900/30 border-2 border-red-500/20 flex items-center justify-center text-2xl">?</div>
                  </>
                )}
              </div>
              {result && <p className="text-sm text-muted-foreground">{result.dealerHandRank}</p>}
            </div>
          </div>

          {result && (
            <div className={cn(
              "text-center py-3 rounded-lg mt-6",
              result.isWin ? "bg-green-500/20 text-green-400" : 
              result.isTie ? "bg-yellow-500/20 text-yellow-400" : 
              "bg-red-500/20 text-red-400"
            )}>
              {result.isWin ? `🎉 You Won ₹${result.payout.toFixed(2)}!` : 
               result.isTie ? '🤝 Tie - Bet Returned' : 
               `Dealer Wins`}
            </div>
          )}
        </Card>

        <Card className="p-6">
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Bet Amount</label>
              <Input
                type="number"
                value={betAmount}
                onChange={(e) => setBetAmount(e.target.value)}
                disabled={isPlaying}
                data-testid="input-bet-amount"
              />
              <div className="flex gap-2 mt-2 flex-wrap">
                {QUICK_BETS.map((amount) => (
                  <Button
                    key={amount}
                    variant="outline"
                    size="sm"
                    onClick={() => setBetAmount(amount.toString())}
                    disabled={isPlaying}
                    data-testid={`btn-quick-bet-${amount}`}
                  >
                    ₹{amount}
                  </Button>
                ))}
              </div>
            </div>

            <div className="text-sm text-muted-foreground space-y-1">
              <p>Win: 2x (3x for Pure Sequence or Trail)</p>
              <p>Tie: Bet returned</p>
            </div>

            <Button
              className="w-full h-14 text-lg bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-700 hover:to-pink-700"
              onClick={handlePlay}
              disabled={isPlaying || !betAmount}
              data-testid="btn-play"
            >
              {isPlaying ? 'Dealing...' : `Deal Cards (₹${betAmount})`}
            </Button>
          </div>
        </Card>

        <Card className="p-4 bg-card/50">
          <h3 className="font-bold mb-2">Hand Rankings (High to Low)</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex justify-between"><span>Trail (Three of a kind)</span><span className="text-primary">3x</span></div>
            <div className="flex justify-between"><span>Pure Sequence</span><span className="text-primary">3x</span></div>
            <div className="flex justify-between"><span>Sequence</span><span className="text-primary">2x</span></div>
            <div className="flex justify-between"><span>Color (Flush)</span><span className="text-primary">2x</span></div>
            <div className="flex justify-between"><span>Pair</span><span className="text-primary">2x</span></div>
            <div className="flex justify-between"><span>High Card</span><span className="text-primary">2x</span></div>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3 bg-primary/5 border-primary/20">
          <Shield className="w-5 h-5 text-primary" />
          <div className="text-sm">
            <p className="font-medium text-primary">Provably Fair</p>
            <p className="text-muted-foreground">Every result can be verified</p>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
