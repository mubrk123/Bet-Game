import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useStore } from "@/lib/store";
import type { Match, Runner } from "@/lib/store";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

type BetSlipProps = {
  selectedBet: {
    match: Match;
    runner: Runner;
    type: "BACK" | "LAY";
    odds: number;
  } | null;
  onClear: () => void;
};

export function BetSlip({ selectedBet, onClear }: BetSlipProps) {
  const { toast } = useToast();
  const { currentUser, setCurrentUser } = useStore();
  const [stake, setStake] = useState("100");
  const [isPlacing, setIsPlacing] = useState(false);

  if (!selectedBet) return null;

  const potentialProfit =
    selectedBet.type === "BACK"
      ? (parseFloat(stake || "0") * (selectedBet.odds - 1) || 0).toFixed(2)
      : parseFloat(stake || "0").toFixed(2);

  const placeBet = async () => {
    if (!currentUser) {
      toast({ title: "Please login", variant: "destructive" });
      return;
    }
    setIsPlacing(true);
    try {
      await api.placeBet({
        matchId: selectedBet.match.id,
        marketId: selectedBet.match.markets[0].id,
        runnerId: selectedBet.runner.id,
        runnerName: selectedBet.runner.name,
        type: selectedBet.type,
        odds: String(selectedBet.odds),
        stake,
      });

      toast({
        title: "Bet placed!",
        description: `${selectedBet.type} ${selectedBet.runner.name} @ ${selectedBet.odds.toFixed(2)}`,
      });

      const { user } = await api.getCurrentUser();
      setCurrentUser({
        id: user.id,
        username: user.username,
        role: user.role,
        balance: parseFloat(user.balance),
        exposure: parseFloat(user.exposure),
        currency: user.currency,
      });

      onClear();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setIsPlacing(false);
    }
  };

  return (
    <Card className="p-4 bg-card/90 border-primary/20 shadow-xl">
      <div className="flex justify-between items-center mb-2">
        <div>
          <p className="text-xs text-muted-foreground uppercase">{selectedBet.match.league}</p>
          <p className="text-sm font-bold">
            {selectedBet.match.homeTeam} vs {selectedBet.match.awayTeam}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      </div>

      <div className="p-3 rounded-lg bg-muted/40 border border-border/50 mb-3">
        <div className="flex justify-between text-sm mb-1">
          <span className="font-medium">{selectedBet.runner.name}</span>
          <span className="px-2 py-0.5 rounded text-xs font-bold bg-primary/10 text-primary">
            {selectedBet.type} @ {selectedBet.odds.toFixed(2)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">Market: {selectedBet.match.markets[0].name}</p>
      </div>

      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">Stake</label>
        <Input
          type="number"
          value={stake}
          onChange={(e) => setStake(e.target.value)}
          data-testid="input-stake"
        />
        <div className="flex gap-2">
          {[100, 200, 500, 1000].map((amt) => (
            <Button
              key={amt}
              variant="outline"
              size="sm"
              onClick={() => setStake(String(amt))}
              data-testid={`quick-${amt}`}
            >
              ₹{amt}
            </Button>
          ))}
        </div>
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>Potential {selectedBet.type === "BACK" ? "Win" : "Liability"}</span>
          <span className="font-bold text-primary">₹{potentialProfit}</span>
        </div>
        <Button
          className="w-full"
          onClick={placeBet}
          disabled={isPlacing}
          data-testid="button-place-bet"
        >
          {isPlacing ? "Placing..." : "Place Bet"}
        </Button>
      </div>
    </Card>
  );
}
