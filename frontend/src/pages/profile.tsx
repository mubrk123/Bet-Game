import { AppShell } from "@/components/layout/AppShell";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Wallet,
  TrendingUp,
  LogOut,
  ChevronRight,
  Plus,
  Info,
  ArrowDownToLine,
  ArrowUpFromLine,
  Ticket,
} from "lucide-react";
import { useLocation } from "wouter";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

function formatMoney(currency: string, value: number) {
  const n = Number.isFinite(value) ? value : 0;
  // simple formatting that matches your UI style
  return `${currency} ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function getLoyalty(balance: number) {
  // You can replace this with real points from backend later.
  // For now, it creates believable progression.
  const points = Math.floor(clamp(balance * 12, 0, 5000));
  const tiers = [
    { name: "Bronze", min: 0, max: 999, ring: "from-amber-400/50 to-amber-200/10", badge: "bg-amber-500/15 text-amber-200 border-amber-400/20" },
    { name: "Silver", min: 1000, max: 2499, ring: "from-slate-200/50 to-slate-200/10", badge: "bg-slate-200/10 text-slate-200 border-slate-200/20" },
    { name: "Gold", min: 2500, max: 4999, ring: "from-yellow-400/55 to-yellow-200/10", badge: "bg-yellow-500/15 text-yellow-200 border-yellow-400/20" },
  ];

  const tier =
    points >= tiers[2].min ? tiers[2] : points >= tiers[1].min ? tiers[1] : tiers[0];

  const nextTier =
    tier.name === "Bronze" ? tiers[1] : tier.name === "Silver" ? tiers[2] : null;

  const tierProgress = nextTier
    ? clamp((points - tier.min) / (nextTier.min - tier.min), 0, 1)
    : 1;

  const toNext = nextTier ? Math.max(0, nextTier.min - points) : 0;

  return {
    points,
    tierName: tier.name,
    ringClass: tier.ring,
    badgeClass: tier.badge,
    progress: tierProgress,
    toNext,
    nextTierName: nextTier?.name ?? "Max",
  };
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="px-1 pt-2 pb-1 text-[11px] uppercase tracking-wider text-[#7A7F87]/80">
      {title}
    </div>
  );
}

function MenuRow({
  icon: Icon,
  label,
  href,
  desc,
}: {
  icon: any;
  label: string;
  href: string;
  desc?: string;
}) {
  return (
    <Link href={href}>
      <div className="group flex items-center justify-between py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-xl bg-[#F7F5EF] flex items-center justify-center border border-[#E5E0D6]">
            <Icon className="h-4.5 w-4.5 text-[#7A7F87] group-hover:text-foreground transition-colors" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{label}</div>
            {desc ? <div className="text-sm text-[#475569] font-semibold truncate">{desc}</div> : null}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-[#7A7F87] group-hover:text-foreground transition-colors" />
      </div>
    </Link>
  );
}

export default function Profile() {
  const { currentUser, logout } = useStore();
  const [, setLocation] = useLocation();
  const [showExposureInfo, setShowExposureInfo] = useState(false);

  const { data: betsData } = useQuery({
    queryKey: ["user-bets"],
    queryFn: async () => {
      const res = await api.getUserBets();
      return res.bets || [];
    },
    enabled: !!currentUser,
    staleTime: 30_000,
  });

  const handleLogout = () => {
    logout();
    setLocation("/login");
  };

  if (!currentUser) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
          <h2 className="text-xl font-bold mb-2">Not Logged In</h2>
          <p className="text-[#7A7F87] mb-4">Please login to view your profile</p>
          <Link href="/login">
            <Button>Login</Button>
          </Link>
        </div>
      </AppShell>
    );
  }

  const loyalty = useMemo(() => getLoyalty(currentUser.balance), [currentUser.balance]);
  const initials = currentUser.username?.[0]?.toUpperCase?.() ?? "U";
  const currency = currentUser.currency ?? "INR";
  const recentSettled = useMemo(() => {
    const list = betsData || [];
    return list
      .filter((bet) => {
        const status = String(bet?.status || "").toUpperCase();
        return status === "WON" || status === "LOST";
      })
      .slice(0, 5);
  }, [betsData]);

  const formatPnl = (bet: any) => {
    const status = String(bet?.status || "").toUpperCase();
    const stake = Number.parseFloat(bet?.stake ?? 0) || 0;
    const odds = Number.parseFloat(bet?.odds ?? 0) || 0;
    const potentialReturn = stake * odds;
    const profitField = Number.parseFloat(bet?.profit ?? bet?.potentialProfit ?? NaN);

    if (Number.isFinite(profitField)) return profitField;
    if (status === "WON") return Math.max(0, potentialReturn - stake);
    if (status === "LOST") return -stake;
    return 0;
  };

  return (
    <AppShell>
      <div className="space-y-6 pb-16">
        {/* HEADER: identity + status */}
        <div className="relative overflow-hidden rounded-2xl border border-[#94A3B8] bg-white shadow-xl">
          <div className="relative p-5">
              <div className="flex items-center gap-4">
                {/* avatar with level ring */}
                <div className="relative">
                  <div
                    className={cn(
                    "h-18 w-18 rounded-full p-[3px] bg-gradient-to-br",
                    loyalty.ringClass
                  )}
                  >
                    <div className="h-16 w-16 rounded-full bg-white border border-[#CBD5E1] shadow-inner flex items-center justify-center">
                      <div className="text-2xl font-black text-[#0B8A5F]">{initials}</div>
                    </div>
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-2xl font-black tracking-tight truncate text-[#0B1B31]">
                    {currentUser.username}
                  </h1>
                </div>

                {/* progress */}
                <div className="mt-2">
                  <div className="flex items-center justify-between text-sm text-[#0B1B31] font-semibold">
                    <span>VIP Progress</span>
                    <span className="font-mono">{loyalty.points} pts</span>
                  </div>
                  <div className="mt-2 h-3 rounded-full bg-[#E5E0D6] border border-[#E5E0D6] overflow-hidden">
                    <div
                      className="h-full bg-[#0B8A5F]"
                      style={{ width: `${Math.round(loyalty.progress * 100)}%` }}
                    />
                  </div>
                  <div className="mt-1 text-[12px] text-[#0B1B31] font-semibold">
                    {loyalty.toNext > 0
                      ? `${loyalty.toNext} pts to ${loyalty.nextTierName} VIP`
                      : "Top tier unlocked"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* FINANCIAL DASHBOARD */}
        <div className="grid grid-cols-2 gap-3">
          {/* Balance card with inline Deposit */}
          <Card className="overflow-hidden border border-[#CBD5E1] bg-white shadow-lg">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[#1F2937] font-semibold">
                    Available Balance
                  </div>
                  <div className="mt-1 text-2xl font-black text-[#0B8A5F]">
                    {formatMoney(currency, currentUser.balance)}
                  </div>
                </div>

                <Link href="/withdrawals">
                  <button
                    type="button"
                    className="h-9 w-9 rounded-xl bg-white border border-[#CBD5E1] shadow-inner flex items-center justify-center hover:bg-[#ECFDF5] transition"
                    aria-label="Deposit"
                    title="Deposit"
                  >
                    <Plus className="h-4 w-4 text-[#0B8A5F]" />
                  </button>
                </Link>
              </div>
              <div className="mt-3 flex items-center gap-2 text-sm text-[#0B1B31] font-semibold">
                <Wallet className="h-4 w-4" />
                <span>Tap + to deposit</span>
              </div>
            </CardContent>
          </Card>

          {/* Exposure card with info tooltip */}
          <Card className="overflow-hidden border border-[#CBD5E1] bg-white shadow-lg">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-[#1F2937] font-semibold">
                    Current Exposure
                    <button
                      type="button"
                      onClick={() => setShowExposureInfo((v) => !v)}
                      className="inline-flex items-center justify-center h-5 w-5 rounded-full hover:bg-[#ECFDF5] transition"
                      aria-label="Exposure info"
                    >
                      <Info className="h-3.5 w-3.5 text-[#4B5563]" />
                    </button>
                  </div>
                  <div className="mt-1 text-2xl font-black text-[#B91C1C]">
                    {formatMoney(currency, currentUser.exposure)}
                  </div>
                </div>

                <TrendingUp className="h-5 w-5 text-[#D92148]/80" />
              </div>

              {showExposureInfo ? (
                <div className="mt-3 text-sm text-[#0B1B31] font-semibold leading-snug">
                  Exposure is the amount currently locked in open bets (liability / risk).
                </div>
              ) : (
                <div className="mt-3 text-sm text-[#0B1B31] font-semibold">
                  Funds locked in bets
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* QUICK ACTIONS */}
        <div className="grid grid-cols-3 gap-3">
          <Link href="/withdrawals">
            <div className="flex flex-col items-center gap-2">
              <div className="h-12 w-12 rounded-2xl bg-[#ECFDF5] border border-[#0B8A5F]/40 flex items-center justify-center shadow-md">
                <ArrowDownToLine className="h-5 w-5 text-[#0B8A5F]" />
              </div>
              <div className="text-[12px] text-[#0B1B31] font-semibold">Deposit</div>
            </div>
          </Link>

          <Link href="/withdrawals">
            <div className="flex flex-col items-center gap-2">
              <div className="h-12 w-12 rounded-2xl bg-[#FEF2F2] border border-[#D92148]/40 flex items-center justify-center shadow-md">
                <ArrowUpFromLine className="h-5 w-5 text-[#B91C1C]" />
              </div>
              <div className="text-[12px] text-[#0B1B31] font-semibold">Withdraw</div>
            </div>
          </Link>

          <Link href="/my-bets">
            <div className="flex flex-col items-center gap-2">
              <div className="h-12 w-12 rounded-2xl bg-[#EEF2FF] border border-[#6366F1]/40 flex items-center justify-center shadow-md">
                <Ticket className="h-5 w-5 text-[#4338CA]" />
              </div>
              <div className="text-[12px] text-[#0B1B31] font-semibold">Bet History</div>
            </div>
          </Link>
        </div>

        {/* RECENT RESULTS */}
        <Card className="border border-[#CBD5E1] bg-white shadow-lg">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-[#1F2937] font-semibold">
                  Notifications
                </div>
                <h3 className="text-base font-bold text-[#0B1B31]">Recent wins / losses</h3>
              </div>
              <TrendingUp className="h-5 w-5 text-[#0B8A5F]/90" />
            </div>

            {recentSettled.length === 0 ? (
              <p className="text-sm text-[#0B1B31] font-semibold">No recent bet results yet.</p>
            ) : (
              <div className="space-y-2">
                {recentSettled.map((bet) => {
                  const status = String(bet?.status || "").toUpperCase();
                  const pnl = formatPnl(bet);
                  const isWin = status === "WON";
                  const matchName = bet?.matchName || bet?.marketName || "Bet";
                  const timeText = bet?.settledAt || bet?.createdAt;

                  return (
                    <div
                      key={bet.id}
                      className="flex items-start justify-between gap-3 rounded-xl border border-[#CBD5E1] bg-white px-3 py-3 shadow-md"
                    >
                      <div className="min-w-0">
                        <div className="text-sm text-[#0B1B31] font-bold truncate">{matchName}</div>
                        <div className="text-sm font-semibold text-[#0F172A] truncate">
                          {bet?.selectionName || bet?.runner_name || "Selection"}
                        </div>
                        {timeText ? (
                          <div className="text-[12px] text-[#1F2937] font-medium">
                            {new Date(timeText).toLocaleString()}
                          </div>
                        ) : null}
                      </div>
                      <div className="text-right shrink-0">
                        <div
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold",
                            isWin
                              ? "bg-[#ECFDF5] text-[#0B8A5F] border border-[#0B8A5F]"
                              : "bg-[#FEF2F2] text-[#B91C1C] border border-[#FCA5A5]"
                          )}
                        >
                          {isWin ? "WON" : "LOST"}
                        </div>
                        <div
                          className={cn(
                            "mt-1 text-sm font-mono",
                            isWin ? "text-[#0B8A5F]" : "text-[#D92148]"
                          )}
                        >
                          {isWin ? "+" : "-"}
                          {Math.abs(pnl).toFixed(2)} {currency}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* MENU LIST (Grouped, light separators) */}
        <div className="rounded-2xl border border-[#CBD5E1] bg-white backdrop-blur px-4 py-3 shadow-lg">
          <SectionHeader title="Finance" />
          <div className="divide-y divide-border/20">
            <MenuRow
              icon={Wallet}
              label="Wallet"
              desc="Deposit / Withdraw"
              href="/withdrawals"
            />
            <MenuRow icon={Ticket} label="My Bets" desc="All bet history" href="/my-bets" />
          </div>
        </div>

        {/* LOGOUT: subtle footer */}
        <div className="pt-2">
          <button
            type="button"
            onClick={handleLogout}
            data-testid="button-logout"
            className="w-full flex items-center justify-center gap-2 py-3 text-sm text-[#7A7F87] hover:text-[#D92148] transition"
          >
            <LogOut className="h-4 w-4" />
            Log Out <span className="text-sm text-[#475569] font-semibold/70">v1.0.4</span>
          </button>
        </div>
      </div>
    </AppShell>
  );
}
