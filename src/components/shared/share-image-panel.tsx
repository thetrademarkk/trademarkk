"use client";

import * as React from "react";
import { Copy, Download, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ShareCardData } from "@/lib/share-card/model";
import { renderShareCard, resolveShareFonts } from "@/lib/share-card/render";

/**
 * Branded PNG export of a trade / report — rendered entirely on-device to a
 * canvas (nothing is uploaded anywhere). ₹ P&L is opt-in, mirroring community
 * trade cards: by default the card shows R multiples, win rates or WIN/LOSS.
 */
export function ShareImagePanel({
  build,
  allowPnl,
}: {
  /** Rebuilds the card data for the current ₹ opt-in state. */
  build: (includePnl: boolean) => ShareCardData;
  /** Show the ₹ P&L opt-in switch (hidden e.g. for open trades). */
  allowPnl: boolean;
}) {
  const [includePnl, setIncludePnl] = React.useState(false);
  const [canCopy, setCanCopy] = React.useState(false);
  const [canShare, setCanShare] = React.useState(false);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  const card = React.useMemo(() => build(includePnl && allowPnl), [build, includePnl, allowPnl]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const fonts = await resolveShareFonts();
      if (!cancelled && canvasRef.current) renderShareCard(canvasRef.current, card, fonts);
    })();
    return () => {
      cancelled = true;
    };
  }, [card]);

  React.useEffect(() => {
    setCanCopy("ClipboardItem" in window && typeof navigator.clipboard?.write === "function");
    try {
      const probe = new File([""], "probe.png", { type: "image/png" });
      setCanShare(navigator.canShare?.({ files: [probe] }) ?? false);
    } catch {
      setCanShare(false);
    }
  }, []);

  const toPng = () =>
    new Promise<Blob>((resolve, reject) => {
      const canvas = canvasRef.current;
      if (!canvas) return reject(new Error("Canvas not ready"));
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png");
    });

  const download = async () => {
    try {
      const blob = await toPng();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = card.fileName;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Image downloaded");
    } catch {
      toast.error("Could not export the image");
    }
  };

  const copy = async () => {
    try {
      const blob = await toPng();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast.success("Image copied to clipboard");
    } catch {
      toast.error("Copying images isn't supported here — use Download");
    }
  };

  const share = async () => {
    try {
      const blob = await toPng();
      const file = new File([blob], card.fileName, { type: "image/png" });
      await navigator.share({ files: [file] });
    } catch {
      // Share sheet dismissed (or unsupported) — nothing to clean up.
    }
  };

  return (
    <div className="space-y-3">
      <canvas
        ref={canvasRef}
        data-testid="share-card-canvas"
        data-hero={card.hero}
        data-hero-kind={card.heroKind}
        role="img"
        aria-label={`Share card for ${card.title}`}
        className="w-full rounded-lg border"
        style={{ aspectRatio: "16 / 9" }}
      />

      {allowPnl && (
        <div className="flex items-center justify-between rounded-lg border bg-surface-2/40 px-3 py-2">
          <Label htmlFor="share-image-pnl" className="text-xs">
            Include ₹ P&L on the card
          </Label>
          <Switch id="share-image-pnl" checked={includePnl} onCheckedChange={setIncludePnl} />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={download}>
          <Download className="h-3.5 w-3.5" /> Download PNG
        </Button>
        {canCopy && (
          <Button size="sm" variant="outline" onClick={copy}>
            <Copy className="h-3.5 w-3.5" /> Copy image
          </Button>
        )}
        {canShare && (
          <Button size="sm" variant="outline" onClick={share}>
            <Share2 className="h-3.5 w-3.5" /> Share…
          </Button>
        )}
      </div>

      <p className="text-[11px] leading-4 text-muted">
        1200×675 PNG, rendered on your device — nothing is uploaded.
      </p>
    </div>
  );
}
