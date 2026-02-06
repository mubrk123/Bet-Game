// @ts-nocheck
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Wallet as WalletIcon,
  ArrowDownToLine,
  ArrowUpFromLine,
  Clock,
  CheckCircle,
  XCircle,
  Info,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";

interface WithdrawalRequest {
  id: string;
  userId: string;
  adminId: string;
  amount: string;
  status: "REQUESTED" | "APPROVED" | "REJECTED";
  notes: string | null;
  createdAt: string;
  resolvedAt: string | null;
  user?: { id: string; username: string; balance: string } | null;
}

interface DepositRequest {
  id: string;
  userId: string;
  adminId: string;
  amount: string;
  status: "REQUESTED" | "APPROVED" | "REJECTED";
  notes: string | null;
  createdAt: string;
  resolvedAt: string | null;
  user?: { id: string; username: string; balance: string } | null;
}

interface WithdrawalAvailable {
  availableWinnings: number;
  currentBalance: number;
  maxWithdrawable: number;
}

interface Transaction {
  id: string;
  userId: string;
  amount: string;
  type: string;
  description: string | null;
  createdAt: string;
}

type TabKey = "deposit" | "withdraw" | "activity" | "admin";

function parseNum(v: any) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(n: number) {
  const v = Number.isFinite(n) ? n : 0;
  return `₹${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function SegmentedTabs({
  value,
  onChange,
  items,
}: {
  value: TabKey;
  onChange: (v: TabKey) => void;
  items: { key: TabKey; label: string; badge?: number }[];
}) {
  const idx = Math.max(0, items.findIndex((i) => i.key === value));

  return (
    <div className="w-full">
      <div className="relative w-full rounded-full bg-white border border-[#E5E0D6] p-1 overflow-hidden shadow-inner">
        <div
          className="absolute top-1 bottom-1 rounded-full bg-white shadow-sm transition-all duration-200"
          style={{
            width: `${100 / items.length}%`,
            transform: `translateX(${idx * 100}%)`,
          }}
        />
        <div className="relative z-10 grid" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
          {items.map((item) => {
            const active = item.key === value;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onChange(item.key)}
                className={cn(
                  "py-2 text-[11px] font-semibold rounded-full transition-colors flex items-center justify-center gap-2",
                  active ? "text-[#0B8A5F]" : "text-[#7A7F87]"
                )}
              >
                <span>{item.label}</span>
                {typeof item.badge === "number" && item.badge > 0 ? (
                  <span className="h-5 min-w-5 px-1 rounded-full bg-[#D92148] text-white text-[10px] flex items-center justify-center">
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  if (status === "REQUESTED") {
    return (
      <Badge variant="outline" className="bg-yellow-500/15 text-yellow-300 border-yellow-500/20">
        <Clock className="w-3 h-3 mr-1" />
        Pending
      </Badge>
    );
  }
  if (status === "APPROVED") {
    return (
      <Badge variant="outline" className="bg-emerald-500/15 text-emerald-300 border-emerald-500/20">
        <CheckCircle className="w-3 h-3 mr-1" />
        Success
      </Badge>
    );
  }
  if (status === "REJECTED") {
    return (
      <Badge variant="outline" className="bg-red-500/15 text-red-300 border-red-500/20">
        <XCircle className="w-3 h-3 mr-1" />
        Rejected
      </Badge>
    );
  }
  return <Badge variant="outline">{status}</Badge>;
}

function QuickChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1.5 rounded-full bg-[#F7F5EF] border border-[#E5E0D6] text-xs text-[#1F2733] hover:bg-[#ECFDF5] transition"
    >
      {label}
    </button>
  );
}

function ActivityRow({
  icon,
  title,
  subtitle,
  rightTop,
  rightBottom,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  rightTop: React.ReactNode;
  rightBottom?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-10 w-10 rounded-2xl bg-white border border-[#94A3B8] flex items-center justify-center shadow-sm">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[#0F172A] truncate">{title}</div>
          <div className="text-xs text-[#475569] truncate">{subtitle}</div>
        </div>
      </div>

      <div className="text-right shrink-0">
        <div className="text-sm font-bold text-[#0F172A]">{rightTop}</div>
        {rightBottom ? <div className="mt-1">{rightBottom}</div> : null}
      </div>
    </div>
  );
}

export default function Withdrawals() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const currentUser = useStore((s) => s.currentUser);
  const setCurrentUser = useStore((s) => s.setCurrentUser);

  const isAdmin = currentUser?.role === "ADMIN" || currentUser?.role === "SUPER_ADMIN";

  const [tab, setTab] = useState<TabKey>(isAdmin ? "admin" : "deposit");
  const [depositAmount, setDepositAmount] = useState<string>("");
  const [withdrawAmount, setWithdrawAmount] = useState<string>("");

  const depositValue = parseNum(depositAmount);
  const withdrawValue = parseNum(withdrawAmount);

  const { data: availableData } = useQuery<WithdrawalAvailable>({
    queryKey: ["withdrawal-available"],
    queryFn: async () => api.getWithdrawable(),
    enabled: !!currentUser,
  });

  const { data: myWithdrawalRequests } = useQuery<{ requests: WithdrawalRequest[] }>({
    queryKey: ["my-withdrawals"],
    queryFn: async () => api.getMyWithdrawals(),
    enabled: !!currentUser,
  });

  const { data: myDepositRequests } = useQuery<{ requests: DepositRequest[] }>({
    queryKey: ["my-deposits"],
    queryFn: async () => api.getMyDepositRequests(),
    enabled: !!currentUser,
  });

  const { data: pendingWithdrawals } = useQuery<{ requests: WithdrawalRequest[] }>({
    queryKey: ["pending-withdrawals"],
    queryFn: async () => api.getPendingWithdrawals(),
    enabled: isAdmin,
  });

  const { data: pendingDeposits } = useQuery<{ requests: DepositRequest[] }>({
    queryKey: ["pending-deposits"],
    queryFn: async () => api.getPendingDepositRequests(),
    enabled: isAdmin,
  });

  const { data: transactions } = useQuery<{ transactions: Transaction[] }>({
    queryKey: ["wallet-transactions"],
    queryFn: async () => api.getWalletTransactions(),
    enabled: !!currentUser,
  });

  const withdrawMutation = useMutation({
    mutationFn: async (amount: number) => api.requestWithdrawal(amount),
    onSuccess: () => {
      toast({ title: "Request Submitted", description: "Withdrawal request sent to admin" });
      setWithdrawAmount("");
      queryClient.invalidateQueries({ queryKey: ["my-withdrawals"] });
      queryClient.invalidateQueries({ queryKey: ["withdrawal-available"] });
    },
    onError: (error: Error) => toast({ title: "Failed", description: error.message, variant: "destructive" }),
  });

  const depositMutation = useMutation({
    mutationFn: async (amount: number) => api.requestDeposit(amount),
    onSuccess: () => {
      toast({ title: "Request Submitted", description: "Deposit request sent to admin" });
      setDepositAmount("");
      queryClient.invalidateQueries({ queryKey: ["my-deposits"] });
    },
    onError: (error: Error) => toast({ title: "Failed", description: error.message, variant: "destructive" }),
  });

  const approveWithdrawalMutation = useMutation({
    mutationFn: async (requestId: string) => api.approveWithdrawal(requestId),
    onSuccess: async (result) => {
      toast({ title: "Approved", description: "Withdrawal approved" });
      queryClient.invalidateQueries({ queryKey: ["pending-withdrawals"] });
      if (result.adminBalance && currentUser) setCurrentUser({ ...currentUser, balance: parseFloat(result.adminBalance) });
    },
    onError: (error: Error) => toast({ title: "Failed", description: error.message, variant: "destructive" }),
  });

  const rejectWithdrawalMutation = useMutation({
    mutationFn: async (requestId: string) => api.rejectWithdrawal(requestId, "Request rejected by admin"),
    onSuccess: () => {
      toast({ title: "Rejected", description: "Withdrawal request rejected" });
      queryClient.invalidateQueries({ queryKey: ["pending-withdrawals"] });
    },
    onError: (error: Error) => toast({ title: "Failed", description: error.message, variant: "destructive" }),
  });

  const approveDepositMutation = useMutation({
    mutationFn: async (requestId: string) => api.approveDepositRequest(requestId),
    onSuccess: async (result: any) => {
      toast({ title: "Approved", description: "Deposit approved" });
      queryClient.invalidateQueries({ queryKey: ["pending-deposits"] });
      if (result.adminBalance && currentUser) setCurrentUser({ ...currentUser, balance: parseFloat(result.adminBalance) });
    },
    onError: (error: Error) => toast({ title: "Failed", description: error.message, variant: "destructive" }),
  });

  const rejectDepositMutation = useMutation({
    mutationFn: async (requestId: string) => api.rejectDepositRequest(requestId, "Request rejected by admin"),
    onSuccess: () => {
      toast({ title: "Rejected", description: "Deposit request rejected" });
      queryClient.invalidateQueries({ queryKey: ["pending-deposits"] });
    },
    onError: (error: Error) => toast({ title: "Failed", description: error.message, variant: "destructive" }),
  });

  const pendingWithdrawalCount = pendingWithdrawals?.requests?.length || 0;
  const pendingDepositCount = pendingDeposits?.requests?.length || 0;
  const totalPendingCount = pendingWithdrawalCount + pendingDepositCount;

  const tabs = useMemo(() => {
    const base: { key: TabKey; label: string; badge?: number }[] = [
      { key: "deposit", label: "Deposit" },
      { key: "withdraw", label: "Withdraw" },
      { key: "activity", label: "Activity" },
    ];
    if (isAdmin) base.push({ key: "admin", label: "Admin", badge: totalPendingCount });
    return base;
  }, [isAdmin, totalPendingCount]);

  const heroBalance = currentUser?.balance ?? 0;

  const setAmountFromChip = (mode: "deposit" | "withdraw", add: number) => {
    if (mode === "deposit") {
      const next = parseNum(depositAmount) + add;
      setDepositAmount(String(next));
    } else {
      const next = parseNum(withdrawAmount) + add;
      setWithdrawAmount(String(next));
    }
  };

  const onSubmit = () => {
    if (tab === "deposit") {
      if (!depositValue || depositValue <= 0) {
        toast({ title: "Invalid Amount", variant: "destructive" });
        return;
      }
      depositMutation.mutate(depositValue);
      return;
    }
    if (tab === "withdraw") {
      if (!withdrawValue || withdrawValue <= 0) {
        toast({ title: "Invalid Amount", variant: "destructive" });
        return;
      }
      withdrawMutation.mutate(withdrawValue);
    }
  };

  const primaryButtonLabel =
    tab === "deposit"
      ? `Add ${formatMoney(depositValue || 0)} to Wallet`
      : `Withdraw ${formatMoney(withdrawValue || 0)}`;

  const primaryButtonDisabled =
    tab === "deposit"
      ? depositMutation.isPending || depositValue <= 0
      : withdrawMutation.isPending || withdrawValue <= 0;

  const withdrawable = availableData?.maxWithdrawable ?? 0;

  return (
    <AppShell>
      <div className="p-3 md:p-4 space-y-4 pb-16">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-[#0B1B31]" data-testid="text-page-title">
              Wallet
            </h1>
            <div className="text-sm text-[#4B5563] font-semibold">Fast & secure transactions</div>
          </div>
        </div>

        {/* Segmented control */}
        <SegmentedTabs value={tab} onChange={setTab} items={tabs} />

        {/* Hero balance card */}
        <div className="relative overflow-hidden rounded-2xl border border-[#94A3B8] bg-white shadow-xl">
          <div className="relative p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[#7A7F87]">
                  Total Balance
                </div>
                <div className="mt-2 text-4xl font-extrabold text-[#0B8A5F]">
                  {formatMoney(heroBalance)}
                </div>
                <div className="mt-2 inline-flex items-center gap-2 text-xs text-[#4B5563]">
                  <ShieldCheck className="h-4 w-4 text-[#0B8A5F]" />
                  Protected by admin approval
                </div>
              </div>
              <div className="h-11 w-11 rounded-2xl bg-white border border-[#E5E0D6] flex items-center justify-center shadow-inner">
                <WalletIcon className="h-5 w-5 text-[#0B8A5F]" />
              </div>
            </div>
          </div>
        </div>

        {/* Deposit / Withdraw fintech input */}
        {(tab === "deposit" || tab === "withdraw") && (
        <Card className="border border-[#CBD5E1] bg-white shadow-lg">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-bold text-[#0F172A]">
                  {tab === "deposit" ? "Deposit Amount" : "Withdraw Amount"}
                </div>
                {tab === "withdraw" ? (
                  <div className="text-sm text-[#374151] font-semibold">
                    Withdrawable: <span className="text-[#0B8A5F] font-mono">{formatMoney(withdrawable)}</span>
                  </div>
                ) : null}
              </div>

              {/* Huge amount input */}
              <div className="rounded-2xl bg-white border border-[#CBD5E1] px-4 py-4 shadow-inner">
                <div className="flex items-center justify-center gap-2">
                  <span className="text-3xl font-black text-[#111827]">₹</span>
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    className={cn(
                      "w-full text-center bg-transparent outline-none text-5xl font-black tracking-tight",
                      "placeholder:text-[#CBD5E1]",
                      tab === "deposit" ? "text-[#0B8A5F]" : "text-[#0B1B31]"
                    )}
                    placeholder="0"
                    value={tab === "deposit" ? depositAmount : withdrawAmount}
                    onChange={(e) =>
                      tab === "deposit" ? setDepositAmount(e.target.value) : setWithdrawAmount(e.target.value)
                    }
                    data-testid={tab === "deposit" ? "input-deposit-amount" : "input-withdraw-amount"}
                  />
                </div>
                <div className="mt-2 text-center text-sm text-[#4B5563] font-semibold">
                  {tab === "deposit" ? "Minimum ₹1 • Admin approval required" : "Winnings only • Admin approval required"}
                </div>
              </div>

              {/* Quick add chips */}
              <div className="flex items-center gap-2 flex-wrap">
                <QuickChip label="+₹500" onClick={() => setAmountFromChip(tab, 500)} />
                <QuickChip label="+₹1000" onClick={() => setAmountFromChip(tab, 1000)} />
                <QuickChip label="+₹5000" onClick={() => setAmountFromChip(tab, 5000)} />
                <QuickChip label="Clear" onClick={() => (tab === "deposit" ? setDepositAmount("") : setWithdrawAmount(""))} />
              </div>

              {/* Payment method row */}
              <button
                type="button"
                className="w-full flex items-center justify-between rounded-2xl bg-white border border-[#E5E0D6] px-4 py-3 hover:bg-[#ECFDF5] transition"
                onClick={() => {
                  toast({
                    title: "Payment Method",
                    description: "Currently: Admin Transfer (more methods can be added later).",
                  });
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-2xl bg-[#F7F5EF] border border-[#E5E0D6] flex items-center justify-center">
                    <Info className="h-5 w-5 text-[#7A7F87]" />
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-semibold">Payment Method</div>
                    <div className="text-xs text-[#7A7F87]">Admin Transfer</div>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-[#7A7F87]" />
              </button>
            </CardContent>
          </Card>
        )}

        {/* Activity tab */}
        {tab === "activity" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-[#0F172A]">Recent Activity</div>
              <div className="text-xs font-semibold text-[#475569]">Last 30 days</div>
            </div>

          <Card className="border border-[#94A3B8] bg-white shadow-lg">
              <CardContent className="p-4">
                {/* Deposit requests */}
                {myDepositRequests?.requests?.length ? (
                  <div className="divide-y divide-border/20">
                    {myDepositRequests.requests.slice(0, 5).map((req) => (
                      <ActivityRow
                        key={req.id}
                        icon={<ArrowDownToLine className="h-5 w-5 text-[#0B8A5F]" />}
                        title="Deposit Request"
                        subtitle={new Date(req.createdAt).toLocaleString()}
                        rightTop={<span className="text-[#0B8A5F] font-mono font-bold">+{formatMoney(parseNum(req.amount))}</span>}
                        rightBottom={<StatusPill status={req.status} />}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-sm text-[#475569] font-semibold py-6">
                    No deposit activity yet
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border border-[#94A3B8] bg-white shadow-lg">
              <CardContent className="p-4">
                {/* Withdrawal requests */}
                {myWithdrawalRequests?.requests?.length ? (
                  <div className="divide-y divide-border/20">
                    {myWithdrawalRequests.requests.slice(0, 5).map((req) => (
                      <ActivityRow
                        key={req.id}
                        icon={<ArrowUpFromLine className="h-5 w-5 text-[#D92148]" />}
                        title="Withdrawal Request"
                        subtitle={new Date(req.createdAt).toLocaleString()}
                        rightTop={<span className="text-[#D92148] font-mono font-bold">-{formatMoney(parseNum(req.amount))}</span>}
                        rightBottom={<StatusPill status={req.status} />}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-sm text-[#475569] font-semibold py-6">
                    No withdrawal activity yet
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border border-[#94A3B8] bg-white shadow-lg">
              <CardContent className="p-4">
                {/* Transactions */}
                {transactions?.transactions?.length ? (
                  <div className="divide-y divide-border/20">
                    {transactions.transactions.slice(0, 8).map((tx) => {
                      const amt = parseNum(tx.amount);
                      const isIn = amt >= 0;
                      return (
                        <ActivityRow
                          key={tx.id}
                          icon={
                            isIn ? (
                              <ArrowDownToLine className="h-5 w-5 text-[#0B8A5F]" />
                            ) : (
                              <ArrowUpFromLine className="h-5 w-5 text-[#D92148]" />
                            )
                          }
                          title={tx.type.replace(/_/g, " ")}
                          subtitle={tx.description || new Date(tx.createdAt).toLocaleString()}
                          rightTop={
                            <span className={cn("font-mono font-bold", isIn ? "text-[#0B8A5F]" : "text-[#D92148]")}>
                              {isIn ? "+" : "-"}
                              {formatMoney(Math.abs(amt))}
                            </span>
                          }
                          rightBottom={
                            <div className="text-[11px] text-[#475569]">
                              {new Date(tx.createdAt).toLocaleDateString()}
                            </div>
                          }
                        />
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center text-sm text-[#475569] font-semibold py-6">
                    No transactions yet
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Admin tab */}
        {isAdmin && tab === "admin" && (
          <div className="space-y-4">
            <div className="text-sm font-semibold">Admin Approvals</div>

            <Card className="border border-[#E5E0D6] bg-white shadow-md">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Pending Deposits</div>
                  {pendingDepositCount > 0 ? (
                    <Badge className="bg-emerald-600">{pendingDepositCount}</Badge>
                  ) : null}
                </div>

                {pendingDeposits?.requests?.length ? (
                  <div className="mt-3 space-y-3">
                    {pendingDeposits.requests.map((req) => (
                      <div
                        key={req.id}
                        className="rounded-2xl border border-emerald-500/20 bg-emerald-500/8 p-4 space-y-3"
                        data-testid={`admin-deposit-${req.id}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold">{req.user?.username || "Unknown User"}</div>
                            <div className="text-xs text-muted-foreground">
                              Current Balance: ₹{req.user?.balance || "0"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {new Date(req.createdAt).toLocaleString()}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-xl font-extrabold text-emerald-300">
                              +{formatMoney(parseNum(req.amount))}
                            </div>
                            <StatusPill status={req.status} />
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <Button
                            className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                            onClick={() => approveDepositMutation.mutate(req.id)}
                            disabled={approveDepositMutation.isPending}
                            data-testid={`button-approve-deposit-${req.id}`}
                          >
                            Approve
                          </Button>
                          <Button
                            className="flex-1"
                            variant="destructive"
                            onClick={() => rejectDepositMutation.mutate(req.id)}
                            disabled={rejectDepositMutation.isPending}
                            data-testid={`button-reject-deposit-${req.id}`}
                          >
                            Reject
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-sm text-muted-foreground py-6">
                    No pending deposits
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border border-[#E5E0D6] bg-white shadow-md">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Pending Withdrawals</div>
                  {pendingWithdrawalCount > 0 ? (
                    <Badge className="bg-orange-600">{pendingWithdrawalCount}</Badge>
                  ) : null}
                </div>

                {pendingWithdrawals?.requests?.length ? (
                  <div className="mt-3 space-y-3">
                    {pendingWithdrawals.requests.map((req) => (
                      <div
                        key={req.id}
                        className="rounded-2xl border border-orange-500/20 bg-orange-500/8 p-4 space-y-3"
                        data-testid={`admin-withdrawal-${req.id}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold">{req.user?.username || "Unknown User"}</div>
                            <div className="text-xs text-muted-foreground">
                              Current Balance: ₹{req.user?.balance || "0"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {new Date(req.createdAt).toLocaleString()}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-xl font-extrabold text-orange-300">
                              -{formatMoney(parseNum(req.amount))}
                            </div>
                            <StatusPill status={req.status} />
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <Button
                            className="flex-1 bg-orange-600 hover:bg-orange-700"
                            onClick={() => approveWithdrawalMutation.mutate(req.id)}
                            disabled={approveWithdrawalMutation.isPending}
                            data-testid={`button-approve-withdrawal-${req.id}`}
                          >
                            Approve
                          </Button>
                          <Button
                            className="flex-1"
                            variant="destructive"
                            onClick={() => rejectWithdrawalMutation.mutate(req.id)}
                            disabled={rejectWithdrawalMutation.isPending}
                            data-testid={`button-reject-withdrawal-${req.id}`}
                          >
                            Reject
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-sm text-muted-foreground py-6">
                    No pending withdrawals
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Floating action button for deposit/withdraw */}
      {(tab === "deposit" || tab === "withdraw") && (
        <div className="fixed left-0 right-0 bottom-16 md:bottom-0 z-40 px-4 pb-4">
          <Button
            className={cn(
              "w-full h-14 rounded-2xl text-base font-extrabold shadow-md",
              tab === "deposit"
                ? "bg-[#0B8A5F] hover:bg-[#0A7A55]"
                : "bg-[#0B8A5F] hover:bg-[#0A7A55]"
            )}
            onClick={onSubmit}
            disabled={primaryButtonDisabled}
            data-testid={tab === "deposit" ? "button-request-deposit" : "button-request-withdraw"}
          >
            {tab === "deposit" ? <ArrowDownToLine className="h-5 w-5 mr-2" /> : <ArrowUpFromLine className="h-5 w-5 mr-2" />}
            {tab === "deposit"
              ? depositMutation.isPending
                ? "Requesting…"
                : primaryButtonLabel
              : withdrawMutation.isPending
                ? "Requesting…"
                : primaryButtonLabel}
          </Button>
        </div>
      )}
    </AppShell>
  );
}
