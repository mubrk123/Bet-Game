import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

type FairnessProps = {
  roundId?: string;
  serverSeedHash?: string;
  clientSeed?: string;
  nonce?: number;
};

export function ProvablyFairCard({
  roundId,
  serverSeedHash,
  clientSeed,
  nonce,
}: FairnessProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copy = (label: string, value?: string | number | null) => {
    if (!value) return;
    navigator.clipboard?.writeText(String(value)).catch(() => undefined);
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 1200);
  };

  if (!serverSeedHash && !clientSeed && !nonce && !roundId) return null;

  return (
    <Card className="p-4 space-y-3 bg-muted/40">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-primary" />
        <div>
          <p className="text-sm font-semibold">Provably Fair</p>
          <p className="text-xs text-muted-foreground">
            Verify every round with the server seed hash, your client seed, and nonce.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {roundId && (
          <Field
            label="Round ID"
            value={roundId}
            onCopy={() => copy("round", roundId)}
            copied={copiedField === "round"}
          />
        )}
        {nonce !== undefined && nonce !== null && (
          <Field
            label="Nonce"
            value={nonce}
            onCopy={() => copy("nonce", nonce)}
            copied={copiedField === "nonce"}
          />
        )}
        {serverSeedHash && (
          <Field
            label="Server Seed Hash"
            value={serverSeedHash}
            onCopy={() => copy("server", serverSeedHash)}
            copied={copiedField === "server"}
          />
        )}
        {clientSeed && (
          <Field
            label="Client Seed"
            value={clientSeed}
            onCopy={() => copy("client", clientSeed)}
            copied={copiedField === "client"}
          />
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Keep your client seed handy. After the round settles, reveal the server seed from the backend and hash it to confirm it matches the server seed hash above.
      </p>
    </Card>
  );
}

function Field({
  label,
  value,
  onCopy,
  copied,
}: {
  label: string;
  value: string | number;
  onCopy: () => void;
  copied?: boolean;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <Input
          value={value}
          readOnly
          className="text-xs font-mono"
          data-testid={`fair-${label.toLowerCase().replace(/\s+/g, "-")}`}
        />
        <Button
          variant="outline"
          size="icon"
          onClick={onCopy}
          className={cn("shrink-0", copied && "border-primary text-primary")}
          aria-label={`Copy ${label}`}
        >
          <Copy className="w-4 h-4" />
        </Button>
      </div>
      {copied && <p className="text-[11px] text-primary">Copied!</p>}
    </div>
  );
}
