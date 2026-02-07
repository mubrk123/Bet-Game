import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useStore } from "@/lib/store";
import type { Match, Market, Runner } from "@/lib/store";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

type BetSlipProps = {
  selectedBet: {
    match: Match;
    market: Market;
    runner: Runner;
    type: "BACK" | "LAY";
    odds: number;
  } | null;
  onClear: () => void;
  variant?: "default" | "compact";
};

export function BetSlip({ selectedBet, onClear, variant = "default" }: BetSlipProps) {
  const { toast } = useToast();
  const { currentUser, setCurrentUser } = useStore();
  const [stake, setStake] = useState("100");
  const [isPlacing, setIsPlacing] = useState(false);

  const friendlyBetError = (err: any) => {
    const raw = String(err?.message || err || "Unable to place bet.");
    if (/expired|closed|suspended/i.test(raw)) return "Betting window closed for this market.";
    if (/insufficient|balance/i.test(raw)) return "Insufficient balance to place this bet.";
    if (/odds|price|changed/i.test(raw)) return "Odds changed. Please refresh and try again.";
    if (/market not open|market_status/i.test(raw)) return "Market is not open for betting.";
    return raw;
  };

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
      toast({ title: "Failed", description: friendlyBetError(err), variant: "destructive" });
    } finally {
      setIsPlacing(false);
    }
  };

  const isCompact = variant === "compact";

  if (isCompact) {
    const quickChips = [100, 250, 500];
    return (
      <div className="rounded-2xl border border-[#E5E0D6] bg-[#FDFBF6] text-[#1F2733] shadow-xl w-full max-w-sm p-3 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.12em] text-[#7A7F87] mb-1">
              Selection
            </div>
            <p className="text-sm font-semibold truncate text-[#0F172A]">
              {selectedBet.runner.name}
            </p>
            <div className="mt-1 flex items-center gap-2 text-[11px]">
              <span className="px-2 py-[3px] rounded-full bg-[#ECFDF5] text-[#0B8A5F] border border-[#C1F0D6]">
                {selectedBet.type} {selectedBet.odds.toFixed(2)}
              </span>
              <span className="px-2 py-[3px] rounded-full bg-[#F7F5EF] text-[#4B5563] border border-[#E5E0D6]">
                {selectedBet.market.name}
              </span>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="text-[#7A7F87] hover:text-[#1F2733]" onClick={onClear}>
            ×
          </Button>
        </div>

        <div className="space-y-2">
        <Input
          type="number"
          value={stake}
          onChange={(e) => setStake(e.target.value)}
          className="bg-white border-[#E5E0D6] text-[#1F2733] text-base"
          inputMode="decimal"
          data-testid="input-stake"
        />
          <div className="flex gap-2">
            {quickChips.map((amt) => (
              <Button
                key={amt}
                variant="outline"
                size="sm"
                className="border-[#E5E0D6] text-[#1F2733] bg-white"
                onClick={() => setStake(String(amt))}
              >
                ₹{amt}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between text-sm text-[#4B5563]">
          <span>Potential {selectedBet.type === "BACK" ? "Win" : "Liability"}</span>
          <span className="font-bold text-[#0B8A5F]">₹{potentialProfit}</span>
        </div>

        <Button
          className="w-full bg-[#0B8A5F] hover:bg-[#0A7A55] text-white font-semibold shadow-md"
          onClick={placeBet}
          disabled={isPlacing}
          data-testid="button-place-bet"
        >
          {isPlacing ? "Placing..." : `Place ${selectedBet.type}`}
        </Button>
      </div>
    );
  }

  return (
    <Card className="p-4 bg-[#FDFBF6] border-[#E5E0D6] shadow-sm">
      <div className="flex justify-between items-center mb-2">
        <div>
          <p className="text-xs text-[#7A7F87] uppercase">{selectedBet.match.league}</p>
          <p className="text-sm font-bold text-[#1F2733]">
            {selectedBet.match.homeTeam} vs {selectedBet.match.awayTeam}
          </p>
        </div>
        <Button variant="ghost" size="sm" className="text-[#7A7F87]" onClick={onClear}>
          Clear
        </Button>
      </div>

      <div className="p-3 rounded-lg bg-[#F7F5EF] border border-[#E5E0D6] mb-3">
        <div className="flex justify-between text-sm mb-1">
          <span className="font-medium text-[#1F2733]">{selectedBet.runner.name}</span>
          <span className="px-2 py-0.5 rounded text-xs font-bold bg-[#ECFDF5] text-[#0B8A5F] border border-[#C1F0D6]">
            {selectedBet.type} @ {selectedBet.odds.toFixed(2)}
          </span>
        </div>
        <p className="text-[11px] uppercase tracking-[0.14em] text-[#7A7F87] mb-0.5">
          Selection
        </p>
        <p className="text-xs text-[#7A7F87]">Market: {selectedBet.market.name}</p>
      </div>

      <div className="space-y-2">
        <label className="text-xs text-[#7A7F87]">Stake</label>
        <Input
          type="number"
          value={stake}
          onChange={(e) => setStake(e.target.value)}
          className="text-base"
          data-testid="input-stake"
        />
        <div className="flex gap-2">
          {[100, 200, 500, 1000].map((amt) => (
            <Button
              key={amt}
              variant="outline"
              size="sm"
              className="border-[#E5E0D6] text-[#1F2733]"
              onClick={() => setStake(String(amt))}
              data-testid={`quick-${amt}`}
            >
              ₹{amt}
            </Button>
          ))}
        </div>
        <div className="flex justify-between text-sm text-[#7A7F87]">
          <span>Potential {selectedBet.type === "BACK" ? "Win" : "Liability"}</span>
          <span className="font-bold text-[#0B8A5F]">₹{potentialProfit}</span>
        </div>
        <Button
          className="w-full bg-[#0B8A5F] hover:bg-[#0A7A55] text-white font-semibold shadow-md"
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
