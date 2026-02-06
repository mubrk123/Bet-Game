import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useStore } from "@/lib/store";
import type { Match, Market, Runner } from "@/lib/store";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

type BetSlipProps = {
  selectedBet: {
    match: Match;
    market: Market;
    runner: Runner;
    type: "BACK" | "LAY";
    odds: number;
  } | null;
  onClear: () => void;
};

export function MobileBetSlip({ selectedBet, onClear }: BetSlipProps) {
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
        marketId: selectedBet.market.id,
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
    <div className="h-full flex flex-col bg-[#F7F5EF] text-[#1F2733]">
      <div className="p-4 border-b border-[#E5E0D6] flex justify-between items-center bg-[#FDFBF6]">
        <div>
          <p className="text-[11px] uppercase tracking-[0.12em] text-[#7A7F87]">{selectedBet.match.league}</p>
          <p className="text-sm font-bold">
            {selectedBet.match.homeTeam} vs {selectedBet.match.awayTeam}
          </p>
        </div>
        <Button variant="ghost" size="sm" className="text-[#0B8A5F] hover:text-[#0A7A55]" onClick={onClear}>
          Close
        </Button>
      </div>

      <div className="p-4 flex-1 overflow-y-auto space-y-3">
        <Card className="p-3 bg-[#FDFBF6] border-[#E5E0D6] shadow-sm">
          <div className="flex items-start justify-between text-sm mb-1 gap-2">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.12em] text-[#7A7F87]">
                Selection
              </div>
              <span className="block font-semibold text-[#0F172A] truncate">
                {selectedBet.runner.name}
              </span>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#ECFDF5] text-[#0B8A5F] border border-[#C1F0D6] shrink-0">
              {selectedBet.type} @ {selectedBet.odds.toFixed(2)}
            </span>
          </div>
          <p className="text-[12px] text-[#4B5563]">Market: {selectedBet.market.name}</p>
        </Card>

        <div className="space-y-2">
          <label className="text-xs text-[#7A7F87]">Stake</label>
          <Input
            type="number"
            value={stake}
            onChange={(e) => setStake(e.target.value)}
            className="bg-white border-[#E5E0D6] text-[#1F2733]"
            data-testid="input-stake-mobile"
          />
          <div className="grid grid-cols-4 gap-2">
            {[100, 200, 500, 1000].map((amt) => (
              <Button
                key={amt}
                variant="outline"
                size="sm"
                className="border-[#E5E0D6] bg-white text-[#1F2733] hover:bg-[#ECFDF5] hover:border-[#C1F0D6]"
                onClick={() => setStake(String(amt))}
              >
                ₹{amt}
              </Button>
            ))}
          </div>
          <div className="flex justify-between text-sm text-[#4B5563]">
            <span>Potential {selectedBet.type === "BACK" ? "Win" : "Liability"}</span>
            <span className="font-bold text-[#0B8A5F]">₹{potentialProfit}</span>
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-[#E5E0D6] bg-[#FDFBF6]">
        <Button
          className="w-full h-12 bg-[#0B8A5F] hover:bg-[#0A7A55] text-white font-semibold shadow-md"
          onClick={placeBet}
          disabled={isPlacing}
          data-testid="button-place-bet-mobile"
        >
          {isPlacing ? "Placing..." : "Place Bet"}
        </Button>
      </div>
    </div>
  );
}
