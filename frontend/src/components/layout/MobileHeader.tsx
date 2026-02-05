import { Link, useLocation } from "wouter";
import { Wallet, Bell, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function MobileHeader() {
  const { currentUser } = useStore();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [location] = useLocation();
  const isAdmin = currentUser?.role === "ADMIN" || currentUser?.role === "SUPER_ADMIN";

  const menuItems = isAdmin
    ? [
        { href: "/admin", label: currentUser?.role === "SUPER_ADMIN" ? "Super Admin" : "Admin" },
        { href: "/withdrawals", label: "Wallet" },
        { href: "/profile", label: "Profile" },
      ]
    : [
        { href: "/", label: "Casino" },
        { href: "/casino", label: "Games" },
        { href: "/withdrawals", label: "Wallet" },
        { href: "/profile", label: "Profile" },
      ];

  const { data: betsData } = useQuery({
    queryKey: ["user-bets"],
    queryFn: async () => {
      const res = await api.getUserBets();
      return res.bets || [];
    },
    enabled: !!currentUser,
    staleTime: 30_000,
  });

  const recentResults = useMemo(() => {
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
    <header
      className={cn(
        "sticky top-0 z-50",
        // match page “deep navy” + premium gradient
        "bg-gradient-to-b from-[#0B1328]/95 to-[#070B16]/80",
        "backdrop-blur-xl",
        "border-b border-white/10"
      )}
    >
      {/* subtle inner glow line like your cards */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-emerald-400/25 to-transparent" />

      <div className="flex items-center justify-between h-14 px-3">
        {/* LEFT: menu + brand */}
        <div className="flex items-center gap-2">
          <Sheet open={isMenuOpen} onOpenChange={setIsMenuOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-9 w-9 rounded-xl",
                  "bg-white/[0.03] hover:bg-white/[0.06]",
                  "border border-white/10",
                  "text-white/85 hover:text-white"
                )}
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>

            <SheetContent
              side="left"
              className={cn(
                "w-72 p-0",
                "bg-gradient-to-b from-[#0B1328] to-[#070B16]",
                "border-r border-white/10"
              )}
            >
              <div className="p-4 border-b border-white/10 bg-white/[0.02]">
                <h1 className="font-heading text-xl font-bold tracking-tighter">
                  <span className="text-emerald-400">PROBET</span>
                  <span className="text-white/90">X</span>
                </h1>

                {currentUser && (
                  <div className="mt-3 flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-emerald-400/15 border border-emerald-400/25 flex items-center justify-center text-emerald-300 font-bold">
                      {currentUser.username[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium text-sm text-white/90">
                        {currentUser.username}
                      </p>
                      <p className="text-xs text-white/55">
                        {currentUser.role === "SUPER_ADMIN"
                          ? "Super Admin"
                          : `${currentUser.currency} ${currentUser.balance.toLocaleString()}`}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <nav className="p-2">
                {menuItems.map((item) => (
                  <Link key={item.href} href={item.href}>
                    <div
                      className={cn(
                        "px-4 py-3 rounded-xl text-sm font-medium transition-colors",
                        location === item.href
                          ? "bg-emerald-400/10 text-emerald-300 border border-emerald-400/20"
                          : "text-white/70 hover:bg-white/[0.04] hover:text-white/90 border border-transparent"
                      )}
                      onClick={() => setIsMenuOpen(false)}
                    >
                      {item.label}
                    </div>
                  </Link>
                ))}
              </nav>
            </SheetContent>
          </Sheet>

          <Link href="/">
            <h1 className="font-heading text-lg font-bold tracking-tighter cursor-pointer select-none">
              <span className="text-emerald-400">PROBET</span>
              <span className="text-white/90">X</span>
            </h1>
          </Link>
        </div>

        {/* RIGHT: wallet + actions */}
        <div className="flex items-center gap-1">
          {currentUser && currentUser.role !== "SUPER_ADMIN" && (
            <div
              className={cn(
                "flex items-center gap-2 mr-1",
                "rounded-full px-3 py-1.5",
                // “glass pill” like your page
                "bg-emerald-400/10",
                "border border-emerald-400/25",
                "shadow-[0_0_0_1px_rgba(16,185,129,0.08),0_10px_30px_-18px_rgba(16,185,129,0.45)]"
              )}
            >
              <Wallet className="h-3.5 w-3.5 text-emerald-300" />
              <span className="text-xs font-bold text-emerald-200 tabular-nums">
                {currentUser.currency} {currentUser.balance.toLocaleString()}
              </span>
            </div>
          )}

          {currentUser && currentUser.role === "SUPER_ADMIN" && (
            <div className="flex items-center gap-1.5 bg-purple-500/15 border border-purple-400/25 rounded-full px-3 py-1.5 mr-1">
              <span className="text-xs font-bold text-purple-300">
                SUPER ADMIN
              </span>
            </div>
          )}

          <Sheet open={isNotifOpen} onOpenChange={setIsNotifOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-9 w-9 rounded-xl relative",
                  "bg-white/[0.03] hover:bg-white/[0.06]",
                  "border border-white/10",
                  "text-white/80 hover:text-white"
                )}
                data-testid="button-notifications"
              >
                <Bell className="h-4 w-4" />
                {recentResults.length > 0 ? (
                  <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.8)]" />
                ) : null}
              </Button>
            </SheetTrigger>
            <SheetContent
              side="right"
              className={cn(
                "w-[320px] sm:w-[360px]",
                "bg-gradient-to-b from-[#0B1328] to-[#070B16]",
                "border-l border-white/10"
              )}
            >
              {/* Accessibility: provide title/description for dialog */}
              <SheetTitle className="sr-only">Notifications</SheetTitle>
              <SheetDescription className="sr-only">
                Recent bet results and alerts
              </SheetDescription>
              <div className="space-y-3 pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Notifications
                    </div>
                    <h3 className="text-lg font-semibold text-white">Recent wins / losses</h3>
                  </div>
                </div>

                {recentResults.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No recent bet results yet.</p>
                ) : (
                  <div className="space-y-2">
                    {recentResults.map((bet) => {
                      const status = String(bet?.status || "").toUpperCase();
                      const pnl = formatPnl(bet);
                      const isWin = status === "WON";
                      const matchName =
                        bet?.matchName ||
                        bet?.match?.name ||
                        bet?.marketName ||
                        "Bet";
                      const timeText = bet?.settledAt || bet?.createdAt;

                      return (
                        <div
                          key={bet.id}
                          className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-xs text-muted-foreground truncate">
                                {matchName}
                              </div>
                              <div className="text-sm font-semibold truncate text-white">
                                {bet?.selectionName || bet?.runnerName || "Selection"}
                              </div>
                              {timeText ? (
                                <div className="text-[11px] text-muted-foreground/80">
                                  {new Date(timeText).toLocaleString()}
                                </div>
                              ) : null}
                            </div>
                            <div className="text-right shrink-0">
                              <div
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold",
                                  isWin
                                    ? "bg-emerald-500/15 text-emerald-200 border border-emerald-500/30"
                                    : "bg-red-500/10 text-red-200 border border-red-500/25"
                                )}
                              >
                                {isWin ? "WON" : "LOST"}
                              </div>
                              <div
                                className={cn(
                                  "mt-1 text-sm font-mono",
                                  isWin ? "text-emerald-300" : "text-red-300"
                                )}
                              >
                                {isWin ? "+" : "-"}
                                {Math.abs(pnl).toFixed(2)} {currentUser?.currency || "INR"}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
