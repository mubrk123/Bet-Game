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
    <nav className="h-16 border-b bg-sidebar px-4 flex items-center justify-between sticky top-0 z-50 shadow-md">
      <div className="flex items-center gap-4">
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild className="md:hidden">
            <Button variant="ghost" size="icon">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-4 bg-sidebar border-r border-border">
            <div className="mb-8">
              <h1 className="font-heading text-2xl font-bold tracking-tighter text-primary">PROBET<span className="text-white">X</span></h1>
            </div>
            <div className="flex flex-col gap-2">
              <NavItems />
              <Button variant="ghost" className="justify-start gap-3 px-3 text-red-400 hover:text-red-500 hover:bg-red-950/20 mt-4" onClick={handleLogout}>
                <LogOut className="h-4 w-4" /> Logout
              </Button>
            </div>
          </SheetContent>
        </Sheet>
        
        <Link href="/">
          <div className="flex items-center gap-1 cursor-pointer">
            <h1 className="font-heading text-2xl font-bold tracking-tighter text-primary neon-glow">PROBET<span className="text-foreground">X</span></h1>
          </div>
        </Link>

        <div className="hidden md:flex items-center gap-1 ml-8">
          <NavItems />
        </div>
      </div>

      {currentUser ? (
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex flex-col items-end mr-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase tracking-wider font-bold">
              <Wallet className="h-3 w-3" /> Balance
            </div>
            <div className="font-mono text-primary font-bold text-lg leading-none">
              {currentUser.currency} {currentUser.balance.toLocaleString()}
            </div>
          </div>
          
          <div className="hidden sm:flex flex-col items-end">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase tracking-wider font-bold">
              <ShieldAlert className="h-3 w-3" /> Exposure
            </div>
            <div className="font-mono text-destructive font-bold text-lg leading-none">
              {currentUser.exposure > 0 ? '-' : ''}{currentUser.currency} {currentUser.exposure.toLocaleString()}
            </div>
          </div>

          <div className="flex items-center gap-3">
             <div className="h-9 w-9 rounded-full bg-accent flex items-center justify-center border border-accent-foreground/10 text-accent-foreground font-bold" title={currentUser.username}>
              {currentUser.username[0].toUpperCase()}
            </div>
            <Button variant="ghost" size="icon" onClick={handleLogout} className="text-muted-foreground hover:text-foreground">
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
           <Link href="/login">
             <Button variant="default" className="font-bold">Login</Button>
           </Link>
        </div>
      )}
    </nav>
  );
}
