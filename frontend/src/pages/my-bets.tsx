import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import { format } from "date-fns";

function formatINR(value: number) {
  if (!Number.isFinite(value)) return "₹0.00";
  const rounded = Math.round(value * 100) / 100;
  return `₹${rounded.toFixed(2)}`;
}

function parseNum(v: any) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
}

function SegmentedControl({
  value,
  onChange,
}: {
  value: "OPEN" | "SETTLED";
  onChange: (v: "OPEN" | "SETTLED") => void;
}) {
  return (
    <div className="w-full">
      <div className="relative mx-auto w-full max-w-[360px] rounded-lg bg-muted/20 p-0.5 border border-border/30">
        <div
          className={cn(
            "absolute top-0.5 bottom-0.5 w-1/2 rounded-md bg-background shadow-sm transition-transform duration-200",
            value === "OPEN" ? "translate-x-0" : "translate-x-full"
          )}
        />
        <button
          type="button"
          onClick={() => onChange("OPEN")}
          className={cn(
            "relative z-10 w-1/2 rounded-md py-2 text-xs font-medium transition-colors",
            value === "OPEN" ? "text-foreground" : "text-muted-foreground"
          )}
        >
          OPEN
        </button>
        <button
          type="button"
          onClick={() => onChange("SETTLED")}
          className={cn(
            "relative z-10 w-1/2 rounded-md py-2 text-xs font-medium transition-colors",
            value === "SETTLED" ? "text-foreground" : "text-muted-foreground"
          )}
        >
          SETTLED
        </button>
      </div>
    </div>
  );
}

function SmallBadge({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "success" | "destructive" | "warning" | "info";
}) {
  const variantClasses = {
    default: "bg-muted/50 text-muted-foreground border-border/50",
    success: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
    destructive: "bg-red-500/10 text-red-300 border-red-500/20",
    warning: "bg-amber-500/10 text-amber-300 border-amber-500/20",
    info: "bg-blue-500/10 text-blue-300 border-blue-500/20",
  };

  return (
    <span
      className={cn(
        "px-2 py-0.5 rounded text-[10px] font-medium border",
        variantClasses[variant]
      )}
    >
      {children}
    </span>
  );
}

function StatPills({
  items,
}: {
  items: Array<{
    label: string;
    value: React.ReactNode;
    valueClassName?: string;
  }>;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map((it, idx) => (
        <div
          key={idx}
          className="rounded-full border border-border/30 bg-muted/15 px-3 py-2"
        >
          <div className="text-[10px] text-muted-foreground leading-none">
            {it.label}
          </div>
          <div className={cn("mt-1 text-xs font-semibold font-mono", it.valueClassName)}>
            {it.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function BetCard({ bet, variant }: { bet: any; variant: "OPEN" | "SETTLED" }) {
  const type = String(bet?.type ?? bet?.bet_type ?? "BACK").toUpperCase();
  const status = String(bet?.status ?? bet?.bet_status ?? "").toUpperCase();

  const odds = parseNum(bet?.odds);
  const stake = parseNum(bet?.stake);
  const commission = parseNum(bet?.commission);
  const profit = parseNum(bet?.profit);

  const isBack = type === "BACK";
  const isLay = type === "LAY";

  // ✅ OPEN calculations
  const liability = isLay ? stake * Math.max(0, odds - 1) : 0; // risk on lay
  const grossPayout = isBack ? stake * odds : stake; // what you receive back if that side wins (simple UI number)
  const potentialProfit = isBack ? stake * Math.max(0, odds - 1) : stake;

  // ✅ SETTLED pnl (fallback)
  const isWon = status === "WON";
  const isLost = status === "LOST";
  const pnl =
    profit !== 0
      ? profit
      : isWon
        ? potentialProfit
        : isLost
          ? -(isLay ? liability : stake)
          : 0;

  const matchName =
    bet?.matchName ||
    bet?.eventName ||
    bet?.fixtureName ||
    bet?.match?.name ||
    bet?.market?.matchName ||
    "Match";

  const marketName =
    bet?.marketName ||
    bet?.market?.name ||
    bet?.instanceMarketName ||
    bet?.market_title ||
    bet?.market_name ||
    bet?.bet_category ||
    "Market";

  const selectionName =
    bet?.selectionName ||
    bet?.runnerName ||
    bet?.teamName ||
    bet?.selection ||
    bet?.runner ||
    bet?.marketSelection ||
    bet?.runner_name ||
    "Selection";

  // "Actual outcome" – best-effort across possible fields
  const actualOutcome =
    bet?.resultSelection ||
    bet?.winningSelection ||
    bet?.winner ||
    bet?.result ||
    bet?.outcome ||
    bet?.settled_selection ||
    bet?.settlement?.winner ||
    bet?.marketResult ||
    "";

  const createdAt = bet?.createdAt
    ? new Date(bet.createdAt)
    : bet?.created_at
      ? new Date(bet.created_at)
      : null;

  const settledAt = bet?.settledAt
    ? new Date(bet.settledAt)
    : bet?.settled_at
      ? new Date(bet.settled_at)
      : null;

  const timeText = createdAt ? format(createdAt, "MMM dd, HH:mm") : "";
  const settledText = settledAt ? format(settledAt, "MMM dd, HH:mm") : "";

  const betTypeLabel = isBack ? "Back" : "Lay";

  const statusConfig = {
    OPEN: { label: "Open", variant: "warning" as const },
    PENDING: { label: "Pending", variant: "warning" as const },
    LIVE: { label: "Live", variant: "info" as const },
    WON: { label: "Won", variant: "success" as const },
    LOST: { label: "Lost", variant: "destructive" as const },
    VOID: { label: "Void", variant: "default" as const },
    SETTLED: { label: "Settled", variant: "default" as const },
    CANCELLED: { label: "Cancelled", variant: "destructive" as const },
  };

  const statusInfo =
    statusConfig[status as keyof typeof statusConfig] || {
      label: status || "Unknown",
      variant: "default" as const,
    };

  return (
    <div className="relative overflow-hidden rounded-lg border border-border/40 bg-card/50 hover:bg-card/70 transition-colors">
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 w-1",
          variant === "SETTLED"
            ? isWon
              ? "bg-emerald-500/60"
              : isLost
                ? "bg-red-500/60"
                : "bg-muted-foreground/30"
            : isBack
              ? "bg-blue-500/60"
              : "bg-pink-500/60"
        )}
      />

      {/* tighter / thinner */}
      <div className="p-2.5 pl-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-medium truncate" title={matchName}>
                {matchName}
              </h3>
              <SmallBadge variant={variant === "OPEN" ? "info" : "default"}>
                {variant === "OPEN" ? "LIVE" : "SETTLED"}
              </SmallBadge>
            </div>

            <div className="mt-0.5 flex items-center gap-2 min-w-0">
              <span className="text-xs font-semibold text-foreground/90 truncate">
                {selectionName}
              </span>
              <span className="text-[10px] text-muted-foreground/80 truncate">
                {marketName}
              </span>
            </div>

            {variant === "SETTLED" && (
              <div className="mt-1 flex items-center gap-2 min-w-0">
                <span className="text-[10px] text-muted-foreground">Outcome:</span>
                <span className="text-[11px] font-semibold truncate">
                  {actualOutcome ? String(actualOutcome) : "—"}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-1 shrink-0">
            <div
              className={cn(
                "px-2 py-0.5 rounded text-[10px] font-semibold border",
                isBack
                  ? "border-blue-500/30 bg-blue-500/10 text-blue-300"
                  : "border-pink-500/30 bg-pink-500/10 text-pink-300"
              )}
              title={`${betTypeLabel} @ ${odds.toFixed(2)}`}
            >
              {betTypeLabel} @ {odds.toFixed(2)}
            </div>
            <SmallBadge variant={statusInfo.variant}>{statusInfo.label}</SmallBadge>
          </div>
        </div>

        {/* OPEN: odds + stake + payout/return in 1-row 3-pill bar */}
        {variant === "OPEN" ? (
          <div className="mt-2">
            <StatPills
              items={[
                {
                  label: "Stake",
                  value: formatINR(stake),
                },
                {
                  label: "Potential Return",
                  value: formatINR(grossPayout),
                  valueClassName: isBack ? "text-emerald-300" : "text-foreground",
                },
                {
                  label: "Risk / Reward",
                  value: formatINR(isLay ? liability : potentialProfit),
                  valueClassName: isLay ? "text-pink-300" : "text-amber-300",
                },
              ]}
            />
            <div className="mt-2 flex items-center justify-between border-t border-border/20 pt-1">
              <span className="text-[10px] text-muted-foreground">{timeText}</span>
              <span className="text-[10px] text-muted-foreground">
                {/* show exactly what user chose */}
                Selected: <span className="text-foreground/80">{selectionName}</span>
              </span>
            </div>
          </div>
        ) : (
          // SETTLED: show chosen + actual outcome + pnl (compact), no ID
          <div className="mt-2">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-full border border-border/30 bg-muted/15 px-3 py-2">
                <div className="text-[10px] text-muted-foreground leading-none">
                  You Picked
                </div>
                <div className="mt-1 text-xs font-semibold truncate">{selectionName}</div>
              </div>

              <div className="rounded-full border border-border/30 bg-muted/15 px-3 py-2">
                <div className="text-[10px] text-muted-foreground leading-none">
                  Actual Outcome
                </div>
                <div className="mt-1 text-xs font-semibold truncate">
                  {actualOutcome ? String(actualOutcome) : "—"}
                </div>
              </div>

              <div className="rounded-full border border-border/30 bg-muted/15 px-3 py-2">
                <div className="text-[10px] text-muted-foreground leading-none">P/L</div>
                <div
                  className={cn(
                    "mt-1 text-xs font-semibold font-mono",
                    pnl > 0
                      ? "text-emerald-300"
                      : pnl < 0
                        ? "text-red-300"
                        : "text-muted-foreground"
                  )}
                >
                  {pnl > 0 ? "+" : ""}
                  {formatINR(pnl)}
                </div>
              </div>
            </div>

            <div className="mt-2 flex items-center justify-between border-t border-border/20 pt-1">
              <span className="text-[10px] text-muted-foreground">
                {settledText ? `Settled ${settledText}` : timeText}
              </span>
              <span className="text-[10px] text-muted-foreground">
                Stake <span className="font-mono">{formatINR(stake)}</span>
                {commission > 0 && (
                  <>
                    {" "}
                    • Comm <span className="font-mono">-{formatINR(commission)}</span>
                  </>
                )}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CompactStatsBarPills({
  openBets,
  settledBets,
  activeTab,
}: {
  openBets: any[];
  settledBets: any[];
  activeTab: "OPEN" | "SETTLED";
}) {
  const openStats = useMemo(() => {
    const totalStake = openBets.reduce((acc, b) => acc + parseNum(b?.stake), 0);
    const totalPotential = openBets.reduce((acc, b) => {
      const stake = parseNum(b?.stake);
      const odds = parseNum(b?.odds);
      const isBack = String(b?.type ?? b?.bet_type).toUpperCase() === "BACK";
      return acc + (isBack ? stake * odds : stake);
    }, 0);
    return { totalStake, totalPotential };
  }, [openBets]);

  const settledStats = useMemo(() => {
    const totalWagered = settledBets.reduce((acc, b) => acc + parseNum(b?.stake), 0);

    const totalPnl = settledBets.reduce((acc, b) => {
      const profit = parseNum(b?.profit);
      if (profit !== 0) return acc + profit;

      const status = String(b?.status ?? b?.bet_status).toUpperCase();
      const stake = parseNum(b?.stake);
      const odds = parseNum(b?.odds);
      const isBack = String(b?.type ?? b?.bet_type).toUpperCase() === "BACK";
      const isLay = String(b?.type ?? b?.bet_type).toUpperCase() === "LAY";
      const liability = isLay ? stake * Math.max(0, odds - 1) : 0;
      const potentialProfit = isBack ? stake * Math.max(0, odds - 1) : stake;

      if (status === "WON") return acc + potentialProfit;
      if (status === "LOST") return acc - (isLay ? liability : stake);
      return acc;
    }, 0);

    const wonBets = settledBets.filter(
      (b) => String(b?.status ?? b?.bet_status).toUpperCase() === "WON"
    ).length;
    const winRate = settledBets.length > 0 ? (wonBets / settledBets.length) * 100 : 0;

    return { totalWagered, totalPnl, winRate };
  }, [settledBets]);

  const pills =
    activeTab === "OPEN"
      ? [
          {
            label: "Open Stake",
            value: formatINR(openStats.totalStake),
            valueClassName: "text-foreground",
          },
          {
            label: "Potential Return",
            value: formatINR(openStats.totalPotential),
            valueClassName: "text-emerald-300",
          },
          {
            label: "Risk / Reward",
            value: formatINR(openStats.totalPotential - openStats.totalStake),
            valueClassName: "text-amber-300",
          },
        ]
      : [
          {
            label: "Total Wagered",
            value: formatINR(settledStats.totalWagered),
            valueClassName: "text-foreground",
          },
          {
            label: "Net P/L",
            value: `${settledStats.totalPnl > 0 ? "+" : ""}${formatINR(settledStats.totalPnl)}`,
            valueClassName:
              settledStats.totalPnl > 0
                ? "text-emerald-300"
                : settledStats.totalPnl < 0
                  ? "text-red-300"
                  : "text-foreground",
          },
          {
            label: "Win Rate",
            value: `${settledStats.winRate.toFixed(1)}%`,
            valueClassName: "text-foreground",
          },
        ];

  return (
    <div className="mb-3">
      <StatPills items={pills} />
    </div>
  );
}

export default function MyBets() {
  const [tab, setTab] = useState<"OPEN" | "SETTLED">("OPEN");

  const query = useQuery({
    queryKey: ["my-bets"],
    queryFn: async () => {
      const result = await api.getUserBets();
      return result.bets;
    },
    refetchInterval: tab === "OPEN" ? 10000 : 30000,
    refetchOnWindowFocus: true,
  });

  const { data, isLoading, isFetching, isError, error, refetch } = query;

  // Keep error UI but remove the big heading/refresh; keep it compact
  if (isError) {
    const msg =
      (error as any)?.message ||
      (typeof error === "string" ? error : "Failed to load bets");

    const isAuth = msg.toLowerCase().includes("not authenticated");

    return (
      <AppShell>
        <div className="container mx-auto px-3 py-2 max-w-5xl">
          <Card className="border-border/40 shadow-xs">
            <CardContent className="py-3">
              <div className="mb-3">
                <SegmentedControl value={tab} onChange={setTab} />
              </div>

              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
                <div className="text-sm font-semibold text-red-200">
                  Failed to load bets
                </div>
                <div className="mt-1 text-xs text-red-200/80">{msg}</div>

                {isAuth && (
                  <div className="mt-3 text-xs text-red-200/70">
                    You’re not logged in on this page. Login first, then come back.
                  </div>
                )}

                <div className="mt-3 text-xs text-muted-foreground">
                  If this says “permission denied”, you need a Supabase RLS SELECT policy on{" "}
                  <span className="font-mono">bets</span> for{" "}
                  <span className="font-mono">user_id = auth.uid()</span>.
                </div>

                <button
                  type="button"
                  onClick={() => refetch()}
                  disabled={isFetching}
                  className={cn(
                    "mt-3 w-full rounded-md border border-border/40 bg-background/50 py-2 text-xs font-medium",
                    "hover:bg-background/70 transition-colors disabled:opacity-60"
                  )}
                >
                  {isFetching ? "Refreshing..." : "Retry"}
                </button>
              </div>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  const bets = Array.isArray(data) ? data : [];

  const { openBets, settledBets } = useMemo(() => {
    const open: any[] = [];
    const settled: any[] = [];

    for (const b of bets) {
      const s = String(b?.status ?? b?.bet_status ?? "").toUpperCase();
      if (s === "OPEN" || s === "PENDING" || s === "LIVE") open.push(b);
      else settled.push(b);
    }

    open.sort(
      (a, b) =>
        new Date(b.createdAt || b.created_at || 0).getTime() -
        new Date(a.createdAt || a.created_at || 0).getTime()
    );

    settled.sort(
      (a, b) =>
        new Date(b.settledAt || b.settled_at || b.createdAt || b.created_at || 0).getTime() -
        new Date(a.settledAt || a.settled_at || a.createdAt || a.created_at || 0).getTime()
    );

    return { openBets: open, settledBets: settled };
  }, [bets]);

  const showing = tab === "OPEN" ? openBets : settledBets;

  return (
    <AppShell>
      {/* shifted up: smaller top padding */}
      <div className="container mx-auto px-3 py-2 max-w-5xl">
        {/* keep design but remove headings & refresh */}
        <Card className="border-border/40 shadow-xs">
          <CardContent className="py-3">
            <div className="mb-3">
              <SegmentedControl value={tab} onChange={setTab} />
            </div>

            {/* stats pill row (3 cols, 1 row) */}
            <CompactStatsBarPills
              openBets={openBets}
              settledBets={settledBets}
              activeTab={tab}
            />

            {isLoading ? (
              <div className="text-center py-6">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto mb-2" />
                <div className="text-sm text-muted-foreground">Loading your bets...</div>
              </div>
            ) : showing.length === 0 ? (
              <div className="text-center py-6 border border-dashed border-border/40 rounded-md bg-muted/10">
                <div className="text-muted-foreground text-base mb-1">
                  {tab === "OPEN" ? "No open bets" : "No settled bets yet"}
                </div>
                <div className="text-xs text-muted-foreground/70">
                  {tab === "OPEN"
                    ? "Place a bet to see it here"
                    : "Your settled bets will appear here"}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {showing.map((bet: any) => (
                  <BetCard
                    key={`${bet.id}-${bet.createdAt || bet.created_at}-${bet.status || bet.bet_status}`}
                    bet={bet}
                    variant={tab}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
