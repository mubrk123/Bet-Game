import { BottomNav } from "./BottomNav";
import { cn } from "@/lib/utils";

interface AppShellProps {
  children: React.ReactNode;
  hideHeader?: boolean;
  hideBottomNav?: boolean;
  fullBleed?: boolean;
}

export function AppShell({
  children,
  hideHeader = false,
  hideBottomNav = false,
  fullBleed = false,
}: AppShellProps) {
  // Header is intentionally removed in current UX; keep prop for compatibility.
  void hideHeader;
  const mainClass = cn(
    "flex-1 flex flex-col w-full",
    fullBleed
      ? "p-0 md:p-0 gap-0"
      : "px-3 py-3 md:px-6 md:py-6 md:max-w-7xl md:mx-auto gap-4 md:gap-6",
    fullBleed ? "" : hideBottomNav ? "pb-6" : "pb-20 md:pb-6"
  );

  return (
    <div className="min-h-screen bg-[#F7F5EF] text-[#1F2733] flex flex-col">
      {/* Header removed per new design */}
      <main className={mainClass}>{children}</main>
      {!hideBottomNav && <BottomNav />}
    </div>
  );
}
