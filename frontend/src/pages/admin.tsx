// @ts-nocheck
import { AppShell } from "@/components/layout/AppShell";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Activity,
  ArrowRightLeft,
  Crown,
  Eye,
  Search,
  Users,
  Wallet,
  Trash2,
  KeyRound,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { ConfirmDialog } from "@/components/modals/ConfirmDialog";
import { Fragment, useMemo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/* =======================
   SMALL UI HELPERS
======================= */

function StatusDot({
  tone,
  label,
}: {
  tone: "emerald" | "amber" | "crimson" | "slate";
  label?: string;
}) {
  const map = {
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    crimson: "bg-rose-500",
    slate: "bg-slate-400",
  };
  return (
    <div className="inline-flex items-center gap-2">
      <span className={cn("h-2 w-2 rounded-full", map[tone])} />
      {label ? (
        <span className="text-xs text-muted-foreground">{label}</span>
      ) : null}
    </div>
  );
}

function KpiCard({
  title,
  value,
  sub,
  icon,
  tone,
  className,
}: {
  title: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: "emerald" | "amber" | "crimson" | "slate";
  className?: string;
}) {
  const toneBorder =
    tone === "emerald"
      ? "border-emerald-100"
      : tone === "amber"
      ? "border-amber-100"
      : tone === "crimson"
      ? "border-rose-100"
      : "border-slate-200";

  return (
    <Card
      className={cn(
        "bg-white border shadow-sm rounded-2xl",
        toneBorder,
        className
      )}
    >
      <CardHeader className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-xs font-semibold tracking-wide text-muted-foreground">
            {title}
          </CardTitle>
          {icon}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">
          {value}
        </div>
        {sub ? (
          <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* =======================
   MAIN COMPONENT
======================= */

export default function AdminPanel() {
  const currentUser = useStore((state) => state.currentUser);
  const setCurrentUser = useStore((state) => state.setCurrentUser);
  const isSuperAdmin = currentUser?.role === "SUPER_ADMIN";

  const [newUserOpen, setNewUserOpen] = useState(false);
  const [newAdminOpen, setNewAdminOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [initialBalance, setInitialBalance] = useState("0");

  const [distributeAmount, setDistributeAmount] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [resetTargetId, setResetTargetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [deleteAdminTargetId, setDeleteAdminTargetId] = useState<string | null>(
    null
  );
  const [resetAdminTargetId, setResetAdminTargetId] = useState<string | null>(
    null
  );

  const [addBalanceAmount, setAddBalanceAmount] = useState("");
  const [selectedAdminId, setSelectedAdminId] = useState("");

  const [activityDialogOpen, setActivityDialogOpen] = useState(false);
  const [selectedActivityUserId, setSelectedActivityUserId] = useState<
    string | null
  >(null);

  // Command Center: Quick Search
  const [userSearch, setUserSearch] = useState("");

  // Touch tables: Expandable rows
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: activityData, isLoading: activityLoading } = useQuery({
    queryKey: ["user-activity", selectedActivityUserId],
    queryFn: async () => {
      if (!selectedActivityUserId) return null;
      return await api.getUserActivity(selectedActivityUserId);
    },
    enabled: !!selectedActivityUserId && activityDialogOpen,
  });

  const { data: adminsData, isLoading: adminsLoading } = useQuery({
    queryKey: ["super-admin-admins"],
    queryFn: async () => {
      const result = await api.getAdmins();
      return result.admins;
    },
    enabled: isSuperAdmin,
    refetchInterval: 30000,
    staleTime: 20000,
  });

  const { data: myUsersData, isLoading: myUsersLoading } = useQuery({
    queryKey: ["admin-my-users"],
    queryFn: async () => {
      const result = await api.getMyUsers();
      return result.users;
    },
    refetchInterval: 30000,
    staleTime: 20000,
  });

  const { data: betsData, isLoading: betsLoading } = useQuery({
    queryKey: ["admin-bets"],
    queryFn: async () => {
      const result = await api.getAllBets();
      return result.bets;
    },
    refetchInterval: 30000,
    staleTime: 20000,
  });

  const admins = adminsData || [];
  const myUsers = myUsersData || [];
  const bets = betsData || [];

  const createAdminMutation = useMutation({
    mutationFn: async (data: {
      username: string;
      password: string;
      balance: string;
    }) => {
      return await api.createAdmin(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["super-admin-admins"] });
      setNewAdminOpen(false);
      setNewUsername("");
      setNewPassword("");
      setInitialBalance("0");
      toast({
        title: "Admin Created",
        description: "New admin account created successfully.",
        className: "bg-emerald-600 text-white border-none",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create admin",
        variant: "destructive",
      });
    },
  });

  const addBalanceToAdminMutation = useMutation({
    mutationFn: async (data: { adminId: string; amount: number }) => {
      return await api.addBalanceToAdmin(data.adminId, data.amount);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["super-admin-admins"] });
      setAddBalanceAmount("");
      setSelectedAdminId("");
      toast({
        title: "Balance Added",
        description: "Admin balance updated successfully.",
        className: "bg-emerald-600 text-white border-none",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add balance",
        variant: "destructive",
      });
    },
  });

  const createUserMutation = useMutation({
    mutationFn: async (data: {
      username: string;
      password: string;
      balance: string;
    }) => {
      return await api.createUserWithBalance(data);
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["admin-my-users"] });
      const { user } = await api.getCurrentUser();
      setCurrentUser({
        id: user.id,
        username: user.username,
        role: user.role,
        balance: parseFloat(user.balance),
        exposure: parseFloat(user.exposure),
        currency: user.currency,
      });
      setNewUserOpen(false);
      setNewUsername("");
      setNewPassword("");
      setInitialBalance("0");
      toast({
        title: "User Created",
        description:
          "New user account created. Balance deducted from your account.",
        className: "bg-emerald-600 text-white border-none",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create user",
        variant: "destructive",
      });
    },
  });

  const distributeBalanceMutation = useMutation({
    mutationFn: async (data: { userId: string; amount: number }) => {
      return await api.distributeBalance(data.userId, data.amount);
    },
    onSuccess: async (result) => {
      queryClient.invalidateQueries({ queryKey: ["admin-my-users"] });
      const { user } = await api.getCurrentUser();
      setCurrentUser({
        id: user.id,
        username: user.username,
        role: user.role,
        balance: parseFloat(user.balance),
        exposure: parseFloat(user.exposure),
        currency: user.currency,
      });
      setDistributeAmount("");
      setSelectedUserId("");
      toast({
        title: "Balance Distributed",
        description: `Balance transferred successfully. Your new balance: ₹${parseFloat(
          result.adminBalance
        ).toLocaleString()}`,
        className: "bg-emerald-600 text-white border-none",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to distribute balance",
        variant: "destructive",
      });
    },
  });

  const handleCreateAdmin = () => {
    if (!newUsername || !newPassword) {
      toast({
        title: "Error",
        description: "Username and password are required",
        variant: "destructive",
      });
      return;
    }
    createAdminMutation.mutate({
      username: newUsername,
      password: newPassword,
      balance: initialBalance,
    });
  };

  const handleAddBalanceToAdmin = () => {
    if (!selectedAdminId || !addBalanceAmount) {
      toast({
        title: "Error",
        description: "Select admin and enter amount",
        variant: "destructive",
      });
      return;
    }
    addBalanceToAdminMutation.mutate({
      adminId: selectedAdminId,
      amount: Number(addBalanceAmount),
    });
  };

  const handleCreateUser = () => {
    if (!newUsername || !newPassword) {
      toast({
        title: "Error",
        description: "Username and password are required",
        variant: "destructive",
      });
      return;
    }
    const balance = parseFloat(initialBalance) || 0;
    if (balance > (currentUser?.balance || 0)) {
      toast({
        title: "Error",
        description: "Insufficient balance. You cannot give more than you have.",
        variant: "destructive",
      });
      return;
    }
    createUserMutation.mutate({
      username: newUsername,
      password: newPassword,
      balance: initialBalance,
    });
  };

  const handleDeleteUser = async (id: string) => {
    try {
      await api.deleteUser(id);
      queryClient.invalidateQueries({ queryKey: ["admin-my-users"] });
      toast({ title: "User deleted", className: "bg-emerald-600 text-white" });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete user",
        variant: "destructive",
      });
    }
  };

  const handleDeleteAdmin = async (id: string) => {
    try {
      await api.deleteAdmin(id);
      queryClient.invalidateQueries({ queryKey: ["super-admin-admins"] });
      toast({ title: "Admin deleted", className: "bg-emerald-600 text-white" });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete admin",
        variant: "destructive",
      });
    }
  };

  const handleResetUserPassword = async (id: string) => {
    try {
      if (!resetPassword) {
        toast({
          title: "Error",
          description: "Enter a new password",
          variant: "destructive",
        });
        return;
      }
      await api.resetUserPassword(id, resetPassword);
      setResetTargetId(null);
      setResetPassword("");
      toast({ title: "Password reset", className: "bg-emerald-600 text-white" });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to reset password",
        variant: "destructive",
      });
    }
  };

  const handleResetAdminPassword = async (id: string) => {
    try {
      if (!resetPassword) {
        toast({
          title: "Error",
          description: "Enter a new password",
          variant: "destructive",
        });
        return;
      }
      await api.resetAdminPassword(id, resetPassword);
      setResetTargetId(null);
      setResetPassword("");
      toast({ title: "Password reset", className: "bg-emerald-600 text-white" });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to reset password",
        variant: "destructive",
      });
    }
  };

  const handleDistributeBalance = () => {
    if (!selectedUserId || !distributeAmount) {
      toast({
        title: "Error",
        description: "Select user and enter amount",
        variant: "destructive",
      });
      return;
    }
    distributeBalanceMutation.mutate({
      userId: selectedUserId,
      amount: Number(distributeAmount),
    });
  };

  const clientUsers = useMemo(
    () => myUsers.filter((u) => u.role === "USER"),
    [myUsers]
  );

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return clientUsers;
    return clientUsers.filter((u) => {
      const uname = (u.username || "").toLowerCase();
      const uid = (u.id || "").toLowerCase();
      return uname.includes(q) || uid.includes(q);
    });
  }, [clientUsers, userSearch]);

  const totalUserBalance = clientUsers.reduce(
    (acc, u) => acc + parseFloat(u.balance),
    0
  );
  const totalAdminBalance = admins.reduce(
    (acc, a) => acc + parseFloat(a.balance),
    0
  );

  // Recent bets helper per user for expandable rows (best-effort)
  const recentBetsByUserId = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const b of bets) {
      const uid = b.userId || b.user_id || b.user?.id; // defensive
      if (!uid) continue;
      const arr = map.get(uid) || [];
      arr.push(b);
      map.set(uid, arr);
    }
    for (const [k, arr] of map.entries()) {
      arr.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      map.set(k, arr.slice(0, 5));
    }
    return map;
  }, [bets]);

  if ((isSuperAdmin && adminsLoading) || myUsersLoading || betsLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
            <p className="mt-4 text-muted-foreground">
              Loading command center...
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      {/* COMMAND CENTER BACKDROP */}
      <div className="min-h-[calc(100vh-6rem)] rounded-3xl p-4 sm:p-6 bg-white border border-slate-200 text-slate-900">
        {/* HEADER + QUICK SEARCH */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="space-y-1">
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                {isSuperAdmin
                  ? "Super Admin Command Center"
                  : "Admin Command Center"}
              </h1>
              <div className="flex flex-wrap items-center gap-3">
                <StatusDot
                  tone="emerald"
                  label={isSuperAdmin ? "System: Online" : "Operations: Active"}
                />
                {!isSuperAdmin ? (
                  <span className="text-xs font-mono text-emerald-700">
                    Balance: ₹{(currentUser?.balance || 0).toLocaleString()}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Manage admins, risk, and system finance
                  </span>
                )}
              </div>
            </div>

            {/* CREATE BUTTONS */}
            <div className="flex gap-2 w-full sm:w-auto">
              {isSuperAdmin ? (
                <Dialog open={newAdminOpen} onOpenChange={setNewAdminOpen}>
                  <DialogTrigger asChild>
                    <Button
                      data-testid="button-create-admin"
                      className="gap-2 flex-1 sm:flex-none rounded-xl bg-slate-900 text-white hover:bg-slate-800"
                    >
                      <Crown className="w-4 h-4 text-amber-300" /> Create Admin
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="bg-white border border-slate-200 rounded-2xl text-slate-900">
                    <DialogHeader>
                      <DialogTitle>Create New Admin</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Username</label>
                        <Input
                          data-testid="input-admin-username"
                          value={newUsername}
                          onChange={(e) => setNewUsername(e.target.value)}
                          placeholder="e.g. admin1"
                          className="rounded-xl"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Password</label>
                        <Input
                          data-testid="input-admin-password"
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Admin password"
                          className="rounded-xl"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">
                          Initial Balance
                        </label>
                        <Input
                          data-testid="input-admin-balance"
                          type="number"
                          value={initialBalance}
                          onChange={(e) => setInitialBalance(e.target.value)}
                          className="rounded-xl"
                        />
                      </div>
                      <Button
                        data-testid="button-submit-create-admin"
                        className="w-full rounded-xl bg-amber-500 text-white hover:bg-amber-600"
                        onClick={handleCreateAdmin}
                        disabled={createAdminMutation.isPending}
                      >
                        {createAdminMutation.isPending
                          ? "Creating..."
                          : "Create Admin"}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              ) : (
                <Dialog open={newUserOpen} onOpenChange={setNewUserOpen}>
                  <DialogTrigger asChild>
                    <Button
                      data-testid="button-create-user"
                      className="gap-2 flex-1 sm:flex-none rounded-xl bg-slate-900 text-white hover:bg-slate-800"
                    >
                      <Users className="w-4 h-4 text-emerald-300" /> Create User
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="bg-white border border-slate-200 rounded-2xl text-slate-900">
                    <DialogHeader>
                      <DialogTitle>Create New User</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <p className="text-sm text-muted-foreground">
                        Balance will be deducted from your account (₹
                        {(currentUser?.balance || 0).toLocaleString()} available)
                      </p>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Username</label>
                        <Input
                          data-testid="input-new-username"
                          value={newUsername}
                          onChange={(e) => setNewUsername(e.target.value)}
                          placeholder="e.g. player123"
                          className="rounded-xl"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Password</label>
                        <Input
                          data-testid="input-new-password"
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="User password"
                          className="rounded-xl"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">
                          Initial Balance (from your account)
                        </label>
                        <Input
                          data-testid="input-initial-balance"
                          type="number"
                          value={initialBalance}
                          onChange={(e) => setInitialBalance(e.target.value)}
                          max={currentUser?.balance || 0}
                          className="rounded-xl"
                        />
                      </div>
                      <Button
                        data-testid="button-submit-create-user"
                        className="w-full rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
                        onClick={handleCreateUser}
                        disabled={createUserMutation.isPending}
                      >
                        {createUserMutation.isPending
                          ? "Creating..."
                          : "Create User"}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </div>

          {/* Persistent Quick Search (User ID / Username) */}
          <div className="flex items-center gap-2 rounded-2xl bg-white border border-slate-200 px-3 py-2 shadow-sm">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Quick Search: User ID or Username…"
              className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
              data-testid="admin-quick-search"
            />
          </div>
        </div>

        {/* BENTO KPI GRID */}
        <div className="mt-5 grid grid-cols-2 lg:grid-cols-12 gap-4">
          {isSuperAdmin ? (
            <>
              <KpiCard
                className="col-span-2 lg:col-span-3"
                title="Admins"
                value={admins.length}
                icon={<Crown className="h-4 w-4 text-amber-500" />}
                tone="amber"
              />
              <KpiCard
                className="col-span-2 lg:col-span-5"
                title="Network Balance"
                value={`₹${(totalAdminBalance + totalUserBalance).toLocaleString()}`}
                sub="Admins + Users"
                icon={<Wallet className="h-4 w-4 text-emerald-500" />}
                tone="emerald"
              />
              <KpiCard
                className="col-span-2 lg:col-span-4"
                title="Total Bets"
                value={bets.length}
                sub="Across the network"
                icon={<Activity className="h-4 w-4 text-sky-500" />}
                tone="slate"
              />
            </>
          ) : (
            <>
              <KpiCard
                className="col-span-2 lg:col-span-4"
                title="Your Balance"
                value={`₹${(currentUser?.balance || 0).toLocaleString()}`}
                icon={<Wallet className="h-4 w-4 text-emerald-500" />}
                tone="emerald"
              />
              <KpiCard
                className="col-span-2 lg:col-span-4"
                title="Distributed"
                value={`₹${totalUserBalance.toLocaleString()}`}
                sub="Total issued to players"
                icon={<ArrowRightLeft className="h-4 w-4 text-amber-500" />}
                tone="amber"
              />
              <KpiCard
                className="col-span-2 lg:col-span-4"
                title="Total Bets"
                value={bets.length}
                sub="Last refresh: 30s"
                icon={<Activity className="h-4 w-4 text-sky-500" />}
                tone="slate"
              />
            </>
          )}

          <KpiCard
            className="col-span-2 lg:col-span-4"
            title="Active Users"
            value={clientUsers.length}
            sub="Players under management"
            icon={<Users className="h-4 w-4 text-indigo-500" />}
            tone="slate"
          />
        </div>

        {/* SUPER ADMIN: ADMIN MANAGEMENT */}
        {isSuperAdmin && (
          <Card className="mt-6 bg-white border border-slate-200 rounded-2xl shadow-sm">
            <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <CardTitle>Admin Management</CardTitle>
                <CardDescription>Add balance to admin accounts</CardDescription>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center bg-slate-50 p-2 rounded-2xl border border-slate-200 w-full sm:w-auto">
                <span className="text-xs font-bold text-slate-700 uppercase whitespace-nowrap">
                  Distribute
                </span>
                <div className="flex gap-2 w-full sm:w-auto">
                  <select
                    data-testid="select-admin"
                    className="h-9 flex-1 sm:w-[170px] bg-white border border-slate-200 rounded-xl text-xs px-3 text-slate-900"
                    value={selectedAdminId}
                    onChange={(e) => setSelectedAdminId(e.target.value)}
                  >
                    <option value="">Select Admin</option>
                    {admins.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.username}
                      </option>
                    ))}
                  </select>
                  <Input
                    data-testid="input-add-balance"
                    placeholder="Amount"
                    className="h-9 w-28 rounded-xl text-slate-900"
                    type="number"
                    value={addBalanceAmount}
                    onChange={(e) => setAddBalanceAmount(e.target.value)}
                  />
                  <Button
                    data-testid="button-add-balance"
                    className="h-9 rounded-xl bg-amber-500 text-white hover:bg-amber-600"
                    onClick={handleAddBalanceToAdmin}
                    disabled={addBalanceToAdminMutation.isPending}
                  >
                    {addBalanceToAdminMutation.isPending ? "Adding..." : "Add"}
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="overflow-x-auto text-slate-900 text-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-slate-600">Admin</TableHead>
                    <TableHead className="text-slate-600">Balance</TableHead>
                    <TableHead className="text-slate-600">
                      Users Created
                    </TableHead>
                    <TableHead className="text-slate-600">
                      Total Distributed
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="text-slate-800">
                  {admins.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="text-center text-slate-500"
                      >
                        No admins created yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    admins.map((admin) => (
                      <TableRow
                        key={admin.id}
                        data-testid={`admin-row-${admin.username}`}
                      >
                        <TableCell className="font-medium">
                          {admin.username}
                        </TableCell>
                        <TableCell className="font-mono text-emerald-700">
                          ₹{parseFloat(admin.balance).toLocaleString()}
                        </TableCell>
                        <TableCell className="font-mono">
                          {admin.usersCreated || 0}
                        </TableCell>
                        <TableCell className="font-mono">
                          ₹{(admin.totalDistributed || 0).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* USERS TABLE (Expandable Rows) */}
        <Card className="mt-6 bg-white border border-slate-200 rounded-2xl shadow-sm">
          <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <CardTitle>{isSuperAdmin ? "All Users" : "Your Users"}</CardTitle>
              <CardDescription>Expand rows for recent bets.</CardDescription>
            </div>

            {!isSuperAdmin && (
              <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center bg-slate-50 p-2 rounded-2xl border border-slate-200 w-full sm:w-auto">
                <span className="text-xs font-bold text-slate-700 uppercase whitespace-nowrap">
                  Distribute
                </span>
                <div className="flex gap-2 w-full sm:w-auto">
                  <select
                    data-testid="select-user"
                    className="h-9 flex-1 sm:w-[190px] bg-white border border-slate-200 rounded-xl text-xs px-3 text-slate-900"
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                  >
                    <option value="">Select User</option>
                    {clientUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.username}
                      </option>
                    ))}
                  </select>

                  <Input
                    data-testid="input-distribute-amount"
                    placeholder="Amount"
                    className="h-9 w-28 rounded-xl text-slate-900"
                    type="number"
                    value={distributeAmount}
                    onChange={(e) => setDistributeAmount(e.target.value)}
                  />

                  <Button
                    data-testid="button-distribute"
                    className="h-9 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
                    onClick={handleDistributeBalance}
                    disabled={distributeBalanceMutation.isPending}
                  >
                    {distributeBalanceMutation.isPending ? "Sending..." : "Send"}
                  </Button>
                </div>
              </div>
            )}
          </CardHeader>

          <CardContent className="overflow-x-auto text-slate-900 text-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-slate-600">User</TableHead>
                  <TableHead className="text-slate-600">Balance</TableHead>
                  <TableHead className="text-slate-600">Exposure</TableHead>
                  <TableHead className="text-slate-600">W/L</TableHead>
                  <TableHead className="w-32 text-right text-slate-600">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="text-slate-800">
                {filteredUsers.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center text-slate-500"
                    >
                      No users match your search
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredUsers.map((u) => {
                    const isExpanded = expandedUserId === u.id;
                    const recent = recentBetsByUserId.get(u.id) || [];
                    return (
                      <Fragment key={u.id}>
                        <TableRow
                          data-testid={`user-row-${u.username}`}
                          className="cursor-pointer"
                          onClick={() =>
                            setExpandedUserId(isExpanded ? null : u.id)
                          }
                        >
                          <TableCell className="font-medium">
                            <div className="flex flex-col">
                              <span>{u.username}</span>
                              <span className="text-[11px] text-slate-500 font-mono truncate max-w-[220px]">
                                {u.id}
                              </span>
                            </div>
                          </TableCell>

                          <TableCell className="font-mono whitespace-nowrap">
                            ₹{parseFloat(u.balance).toLocaleString()}
                          </TableCell>

                          <TableCell className="font-mono text-rose-700 whitespace-nowrap">
                            {parseFloat(u.exposure || "0") > 0
                              ? `- ₹${parseFloat(u.exposure).toLocaleString()}`
                              : "-"}
                          </TableCell>

                          <TableCell className="font-mono text-sm whitespace-nowrap">
                            <span className="text-emerald-700">
                              {u.wonBets || 0}W
                            </span>{" "}
                            /{" "}
                            <span className="text-rose-700">
                              {u.lostBets || 0}L
                            </span>
                          </TableCell>

                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 rounded-xl hover:bg-slate-100"
                                data-testid={`view-activity-${u.username}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedActivityUserId(u.id);
                                  setActivityDialogOpen(true);
                                }}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 rounded-xl hover:bg-slate-100 text-amber-700"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setResetTargetId(u.id);
                                }}
                                title="Reset password"
                              >
                                <KeyRound className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 rounded-xl hover:bg-slate-100 text-rose-700"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteTargetId(u.id);
                                }}
                                title="Delete user"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>

                        {isExpanded ? (
                          <TableRow>
                            <TableCell colSpan={5} className="bg-slate-50">
                              <div className="py-2">
                                <div className="flex items-center justify-between gap-4">
                                  <div className="text-xs text-slate-600">
                                    Recent bets (inline) — tap “eye” for full
                                    history
                                  </div>
                                  <div className="text-xs text-slate-600">
                                    {recent.length ? (
                                      <StatusDot
                                        tone="emerald"
                                        label="Has activity"
                                      />
                                    ) : (
                                      <StatusDot
                                        tone="slate"
                                        label="No bets yet"
                                      />
                                    )}
                                  </div>
                                </div>

                                {recent.length === 0 ? (
                                  <div className="mt-2 text-sm text-slate-600">
                                    No recent bets found for this user.
                                  </div>
                                ) : (
                                  <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-2">
                                    {recent.slice(0, 4).map((b: any) => (
                                      <div
                                        key={b.id}
                                        className="rounded-2xl border border-slate-200 bg-white px-3 py-2 flex items-center justify-between"
                                      >
                                        <div className="min-w-0">
                                          <div className="flex items-center gap-2">
                                            <span
                                              className={cn(
                                                "text-[10px] font-bold px-2 py-0.5 rounded-full border",
                                                b.type === "BACK"
                                                  ? "bg-sky-50 text-sky-700 border-sky-200"
                                                  : "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200"
                                              )}
                                            >
                                              {b.type}
                                            </span>
                                            <span className="text-xs text-slate-600 truncate max-w-[180px]">
                                              {b.marketName || "Market"}
                                            </span>
                                          </div>
                                          <div className="mt-1 flex items-center gap-3 text-xs text-slate-700">
                                            <span className="font-mono">
                                              Odds:{" "}
                                              {parseFloat(b.odds).toFixed(2)}
                                            </span>
                                            <span className="font-mono">
                                              Stake: ₹
                                              {parseFloat(
                                                b.stake
                                              ).toFixed(2)}
                                            </span>
                                          </div>
                                        </div>
                                        <div className="text-xs text-slate-500 font-mono">
                                          {new Date(
                                            b.createdAt
                                          ).toLocaleTimeString()}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* RECENT BETS */}
        <Card className="mt-6 bg-white border border-slate-200 rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle>Recent Bets</CardTitle>
            <CardDescription>
              Latest 20 bets across your network.
            </CardDescription>
          </CardHeader>

          <CardContent className="overflow-x-auto text-slate-900 text-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-slate-600">Time</TableHead>
                  <TableHead className="text-slate-600">Type</TableHead>
                  <TableHead className="text-slate-600">User</TableHead>
                  <TableHead className="text-slate-600">Market</TableHead>
                  <TableHead className="text-slate-600">Odds</TableHead>
                  <TableHead className="text-slate-600">Stake</TableHead>
                  <TableHead className="text-slate-600">Status</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody className="text-slate-800">
                {bets.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-slate-500"
                    >
                      No bets placed yet
                    </TableCell>
                  </TableRow>
                ) : (
                  bets.slice(0, 20).map((bet: any) => {
                    return (
                      <TableRow
                        key={bet.id}
                        data-testid={`bet-row-${bet.id}`}
                      >
                        <TableCell className="text-xs text-slate-600 whitespace-nowrap">
                          {new Date(bet.createdAt).toLocaleTimeString()}
                        </TableCell>

                        <TableCell>
                          <span
                            className={cn(
                              "text-xs font-bold px-2 py-1 rounded-full border",
                              bet.type === "BACK"
                                ? "bg-sky-50 text-sky-700 border-sky-200"
                                : "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200"
                            )}
                          >
                            {bet.type}
                          </span>
                        </TableCell>

                        <TableCell className="text-xs text-slate-700 whitespace-nowrap max-w-[180px] truncate">
                          {bet.userId ||
                            bet.user_id ||
                            bet.user?.id ||
                            "User"}
                        </TableCell>

                        <TableCell className="text-xs text-slate-700 max-w-[200px] truncate">
                          {bet.marketName || bet.market || "Market"}
                        </TableCell>

                        <TableCell className="font-mono">
                          {parseFloat(bet.odds).toFixed(2)}
                        </TableCell>

                        <TableCell className="font-mono">
                          ₹{parseFloat(bet.stake).toFixed(2)}
                        </TableCell>

                        <TableCell>
                          <span
                            className={cn(
                              "text-xs px-2 py-1 rounded-full border",
                              bet.status === "WON"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : bet.status === "LOST"
                                ? "bg-rose-50 text-rose-700 border-rose-200"
                                : "bg-amber-50 text-amber-700 border-amber-200"
                            )}
                          >
                            {bet.status}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* USER ACTIVITY DIALOG */}
        <Dialog open={activityDialogOpen} onOpenChange={setActivityDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden bg-white border border-slate-200 rounded-2xl text-slate-900">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                User Activity History
              </DialogTitle>
              <DialogDescription>
                {
                  clientUsers.find(
                    (u) => u.id === selectedActivityUserId
                  )?.username
                }
                's betting and casino history
              </DialogDescription>
            </DialogHeader>

            {activityLoading ? (
              <div className="py-8 text-center text-slate-500">
                Loading activity...
              </div>
            ) : activityData ? (
              <ScrollArea className="h-[60vh]">
                <div className="space-y-6 pr-4">
                  {/* Summary Stats */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-slate-50 rounded-2xl p-3 border border-slate-200">
                      <div className="text-xs text-slate-600 mb-1">
                        Sports Bets
                      </div>
                      <div className="text-lg font-bold">
                        {activityData.summary.totalBets}
                      </div>
                      <div className="text-xs mt-1">
                        <span className="text-emerald-700">
                          {activityData.summary.betsWon}W
                        </span>
                        {" / "}
                        <span className="text-rose-700">
                          {activityData.summary.betsLost}L
                        </span>
                      </div>
                    </div>

                    <div className="bg-slate-50 rounded-2xl p-3 border border-slate-200">
                      <div className="text-xs text-slate-600 mb-1">
                        Total Staked
                      </div>
                      <div className="text-lg font-bold font-mono">
                        ₹
                        {activityData.summary.totalBetAmount.toLocaleString()}
                      </div>
                    </div>

                    <div className="bg-slate-50 rounded-2xl p-3 border border-slate-200">
                      <div className="text-xs text-slate-600 mb-1">
                        Casino Bets
                      </div>
                      <div className="text-lg font-bold">
                        {activityData.summary.totalCasinoBets}
                      </div>
                      <div className="text-xs mt-1">
                        <span className="text-emerald-700">
                          {activityData.summary.casinoWon}W
                        </span>
                        {" / "}
                        <span className="text-rose-700">
                          {activityData.summary.casinoLost}L
                        </span>
                      </div>
                    </div>

                    <div className="bg-slate-50 rounded-2xl p-3 border border-slate-200">
                      <div className="text-xs text-slate-600 mb-1">
                        Casino Wagered
                      </div>
                      <div className="text-lg font-bold font-mono">
                        ₹
                        {activityData.summary.totalCasinoWagered.toLocaleString()}
                      </div>
                    </div>
                  </div>

                  {/* Recent Sports Bets */}
                  <div>
                    <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-sky-500" />
                      Recent Sports Bets
                    </h4>

                    {activityData.bets.length === 0 &&
                    activityData.instanceBets.length === 0 ? (
                      <p className="text-sm text-slate-600">
                        No sports bets placed
                      </p>
                    ) : (
                      <div className="space-y-1">
                        {[...activityData.bets, ...activityData.instanceBets]
                          .sort(
                            (a, b) =>
                              new Date(b.createdAt).getTime() -
                              new Date(a.createdAt).getTime()
                          )
                          .slice(0, 15)
                          .map((bet: any, idx: number) => (
                            <div
                              key={bet.id || idx}
                              className="flex items-center justify-between text-sm py-2 px-3 rounded-2xl bg-white border border-slate-200"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  className={cn(
                                    "text-[10px] font-bold px-2 py-0.5 rounded-full border",
                                    bet.type === "BACK"
                                      ? "bg-sky-50 text-sky-700 border-sky-200"
                                      : bet.type === "LAY"
                                      ? "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200"
                                      : "bg-violet-50 text-violet-700 border-violet-200"
                                  )}
                                >
                                  {bet.type || bet.marketType || "BET"}
                                </span>
                                <span className="text-slate-600 text-xs truncate max-w-40">
                                  {bet.marketName || "Match Bet"}
                                </span>
                              </div>

                              <div className="flex items-center gap-3">
                                <span className="font-mono text-xs text-slate-800">
                                  ₹{(bet.stake ?? 0).toLocaleString()}
                                </span>
                                <span
                                  className={cn(
                                    "text-xs px-2 py-1 rounded-full border",
                                    bet.status === "WON"
                                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                      : bet.status === "LOST"
                                      ? "bg-rose-50 text-rose-700 border-rose-200"
                                      : "bg-amber-50 text-amber-700 border-amber-200"
                                  )}
                                >
                                  {bet.status}
                                </span>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>

                  {/* Casino History */}
                  <div>
                    <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                      <TrendingDown className="h-4 w-4 text-violet-500" />
                      Recent Casino Plays
                    </h4>

                    {activityData.casinoBets.length === 0 ? (
                      <p className="text-sm text-slate-600">
                        No casino games played
                      </p>
                    ) : (
                      <div className="space-y-1">
                        {activityData.casinoBets
                          .slice(0, 15)
                          .map((bet: any, idx: number) => (
                            <div
                              key={bet.id || idx}
                              className="flex items-center justify-between text-sm py-2 px-3 rounded-2xl bg-white border border-slate-200"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-violet-50 text-violet-700 border-violet-200">
                                  CASINO
                                </span>
                                <span className="text-slate-600 text-xs truncate max-w-40">
                                  {bet.betChoice || "Game"}
                                </span>
                              </div>

                              <div className="flex items-center gap-3">
                                <span className="font-mono text-xs text-slate-800">
                                  ₹{(bet.betAmount ?? 0).toLocaleString()}
                                </span>
                                <span
                                  className={cn(
                                    "text-xs px-2 py-1 rounded-full border",
                                    bet.isWin
                                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                      : "bg-rose-50 text-rose-700 border-rose-200"
                                  )}
                                >
                                  {bet.isWin ? "WON" : "LOST"}
                                </span>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>

                  {/* Transaction History */}
                  <div>
                    <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                      <ArrowRightLeft className="h-4 w-4 text-emerald-500" />
                      Recent Transactions
                    </h4>

                    {activityData.transactions.length === 0 ? (
                      <p className="text-sm text-slate-600">
                        No transactions
                      </p>
                    ) : (
                      <div className="space-y-1">
                        {activityData.transactions
                          .slice(0, 10)
                          .map((tx: any, idx: number) => (
                            <div
                              key={tx.id || idx}
                              className="flex items-center justify-between text-sm py-2 px-3 rounded-2xl bg-white border border-slate-200"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  className={cn(
                                    "text-[10px] font-bold px-2 py-0.5 rounded-full border",
                                    tx.type === "CREDIT"
                                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                      : "bg-rose-50 text-rose-700 border-rose-200"
                                  )}
                                >
                                  {tx.type}
                                </span>
                                <span className="text-slate-600 text-xs truncate max-w-48">
                                  {tx.description}
                                </span>
                              </div>

                              <span
                                className={cn(
                                  "font-mono text-xs",
                                  tx.type === "CREDIT"
                                    ? "text-emerald-700"
                                    : "text-rose-700"
                                )}
                              >
                                {tx.type === "CREDIT" ? "+" : "-"}₹
                                {Math.abs(tx.amount ?? 0).toLocaleString()}
                              </span>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </div>
              </ScrollArea>
            ) : (
              <div className="py-8 text-center text-slate-500">
                No activity data
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
