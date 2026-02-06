import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Gamepad2, Settings, Menu, Wallet, ShieldAlert, LogOut, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useState } from "react";
import { useStore } from "@/lib/store";

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [location, setLocation] = useLocation();
  const { currentUser, logout } = useStore();
  const isAdmin = currentUser?.role === "ADMIN" || currentUser?.role === "SUPER_ADMIN";

  const handleLogout = () => {
    logout();
    setLocation('/login');
  };

  const NavItems = () => (
    <>
      {!isAdmin && (
        <>
          <Link href="/">
            <div className={cn("flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer", location === "/" ? "bg-accent text-accent-foreground" : "hover:bg-accent/50 text-muted-foreground")}>
              <Trophy className="h-4 w-4" />
              <span className="font-medium">Sports</span>
            </div>
          </Link>
          <Link href="/casino">
            <div className={cn("flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer", location === "/casino" ? "bg-accent text-accent-foreground" : "hover:bg-accent/50 text-muted-foreground")}>
              <Gamepad2 className="h-4 w-4" />
              <span className="font-medium">Casino</span>
            </div>
          </Link>
        </>
      )}
      {isAdmin && (
        <Link href="/admin">
          <div className={cn("flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer text-orange-500", location === "/admin" ? "bg-orange-500/10" : "hover:bg-orange-500/5")}>
            <Settings className="h-4 w-4" />
            <span className="font-medium">{currentUser?.role === 'SUPER_ADMIN' ? 'Super Admin' : 'Admin Panel'}</span>
          </div>
        </Link>
      )}
    </>
  );

  return (
    <nav className="h-16 border-b border-[#E5E0D6] bg-[#FDFBF6] px-4 flex items-center justify-between sticky top-0 z-50 shadow-sm">
      <div className="flex items-center gap-4">
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild className="md:hidden">
            <Button variant="ghost" size="icon" className="text-[#1F2733] hover:text-[#0B8A5F]">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-4 bg-[#FDFBF6] border-r border-[#E5E0D6]">
            <div className="mb-6">
              <h1 className="text-2xl font-extrabold tracking-tight text-[#0B8A5F]">CricFun</h1>
              <p className="text-sm text-[#7A7F87]">Exchange &amp; Plays</p>
            </div>
            <div className="flex flex-col gap-2 text-[#1F2733]">
              <NavItems />
              <Button
                variant="ghost"
                className="justify-start gap-3 px-3 text-[#B91C1C] hover:text-[#991B1B] hover:bg-[#FEF2F2] mt-4"
                onClick={handleLogout}
              >
                <LogOut className="h-4 w-4" /> Logout
              </Button>
            </div>
          </SheetContent>
        </Sheet>

        <Link href="/">
          <div className="flex items-center gap-1 cursor-pointer">
            <h1 className="text-2xl font-extrabold tracking-tight text-[#0B8A5F]">CricFun</h1>
          </div>
        </Link>

        <div className="hidden md:flex items-center gap-1 ml-8">
          <NavItems />
        </div>
      </div>

      {currentUser ? (
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex flex-col items-end mr-2">
            <div className="flex items-center gap-1.5 text-xs text-[#7A7F87] uppercase tracking-wider font-semibold">
              <Wallet className="h-3 w-3" /> Balance
            </div>
            <div className="font-mono text-[#0B8A5F] font-bold text-lg leading-none">
              {currentUser.currency} {currentUser.balance.toLocaleString()}
            </div>
          </div>

          <div className="hidden sm:flex flex-col items-end">
            <div className="flex items-center gap-1.5 text-xs text-[#7A7F87] uppercase tracking-wider font-semibold">
              <ShieldAlert className="h-3 w-3" /> Exposure
            </div>
            <div className="font-mono text-[#D92148] font-bold text-lg leading-none">
              {currentUser.exposure > 0 ? '-' : ''}{currentUser.currency} {currentUser.exposure.toLocaleString()}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div
              className="h-9 w-9 rounded-full bg-[#ECFDF5] flex items-center justify-center border border-[#C1F0D6] text-[#0B8A5F] font-bold"
              title={currentUser.username}
            >
              {currentUser.username[0].toUpperCase()}
            </div>
            <Button variant="ghost" size="icon" onClick={handleLogout} className="text-[#7A7F87] hover:text-[#0B8A5F]">
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Link href="/login">
            <Button variant="default" className="font-bold bg-[#0B8A5F] hover:bg-[#0A7A55] text-white">
              Login
            </Button>
          </Link>
        </div>
      )}
    </nav>
  );
}
