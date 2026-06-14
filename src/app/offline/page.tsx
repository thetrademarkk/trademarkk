import type { Metadata } from "next";
import { WifiOff } from "lucide-react";

export const metadata: Metadata = { title: "Offline", robots: { index: false } };

export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-2 p-6 text-center">
      <WifiOff className="h-10 w-10 text-muted" aria-hidden />
      <h1 className="text-lg font-semibold">You&apos;re offline</h1>
      <p className="max-w-sm text-sm text-muted">
        This page hasn&apos;t been cached yet. If you use TradeMarkk in local mode, your journal
        lives in this browser and keeps working offline — reopen the app to continue. Hosted and
        connected journals need a connection to sync; your data is safe, just reconnect and reload.
      </p>
    </div>
  );
}
