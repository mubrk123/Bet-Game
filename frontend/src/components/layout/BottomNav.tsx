import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Home, Users, Wallet, User, Ticket, Gamepad2 } from "lucide-react";
import { useStore } from "@/lib/store";

function isPathActive(current: string, target: string) {
  if (target === "/casino") return current.startsWith("/casino");
  if (target === "/") return current === "/" || current.startsWith("/sports");
  return current === target;
}

export function BottomNav() {
  const [location] = useLocation();
  const { currentUser } = useStore();

  const role = currentUser?.role?.toUpperCase();
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";

  // Admin Command Center navigation (management-first)
  const adminNavItems = [
    { href: "/admin", icon: Home, label: "Overview", testId: "nav-admin-overview" },
    { href: "/admin/users", icon: Users, label: "Users", testId: "nav-admin-users" },
    { href: "/withdrawals", icon: Wallet, label: "Finances", testId: "nav-admin-finances" },
    { href: "/profile", icon: User, label: "Profile", testId: "nav-admin-profile" },
  ];

  // Regular user navigation (gameplay-first)
  const userNavItems = [
    { href: "/", icon: Home, label: "Sports", testId: "nav-home" },
    { href: "/casino", icon: Gamepad2, label: "Casino", testId: "nav-casino" },
    { href: "/my-bets", icon: Ticket, label: "My Plays", testId: "nav-my-plays" },
    { href: "/withdrawals", icon: Wallet, label: "Wallet", testId: "nav-wallet" },
    {
      href: currentUser ? "/profile" : "/login",
      icon: User,
      label: currentUser ? "Profile" : "Login",
      testId: "nav-profile",
    },
  ];

  const navItems = isAdmin ? adminNavItems : userNavItems;

  const renderNavItem = (item: (typeof navItems)[number]) => {
    const isActive = isPathActive(location, item.href);

    return (
      <Link key={item.href} href={item.href} className="flex-1">
        <div
          className={cn(
            "flex h-full flex-col items-center justify-center gap-1 rounded-lg px-2 py-2",
            "text-white/70 border border-transparent transition-all duration-150",
            "hover:text-white hover:bg-white/5",
            isActive &&
              "text-white bg-white/8 border-primary/30 shadow-[0_8px_24px_-14px_rgba(46,230,197,0.6)]"
          )}
          data-testid={item.testId}
        >
          <item.icon className={cn("h-5 w-5", isActive && "text-primary")} />
          <span className="text-[11px] font-medium leading-none">{item.label}</span>
        </div>
      </Link>
    );
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden safe-area-bottom">
      <div className="bg-black/60 backdrop-blur-2xl border-t border-white/10">
        <div className="flex items-stretch gap-1 px-3 py-2">{navItems.map((item) => renderNavItem(item))}</div>
      </div>
    </nav>
  );
}
