import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Gamepad2, Sparkles } from "lucide-react";
import { Link } from "wouter";

export default function CasinoComingSoon() {
  return (
    <AppShell>
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center gap-5 py-12">
        <div className="flex items-center gap-2 text-primary">
          <Gamepad2 className="h-6 w-6" />
          <span className="font-semibold uppercase tracking-wide text-xs">Casino</span>
        </div>
        <h1 className="text-3xl font-heading font-bold">Casino Games</h1>
        <Card className="p-6 sm:p-8 max-w-xl w-full bg-card/80 border-primary/20">
          <p className="text-base sm:text-lg text-muted-foreground leading-relaxed">
            We are sorry for the inconvenience, casino games are coming soon.
          </p>
        </Card>
        <div className="flex flex-col sm:flex-row gap-3">
          <Link href="/">
            <Button variant="secondary">Back to Sports</Button>
          </Link>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="h-4 w-4" />
          <span>Stay tuned for the new experience.</span>
        </div>
      </div>
    </AppShell>
  );
}
