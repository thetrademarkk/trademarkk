import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline", robots: { index: false } };

export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-4xl">📡</p>
      <h1 className="text-lg font-semibold">You&apos;re offline</h1>
      <p className="max-w-sm text-sm text-muted">
        TradeMark needs a connection to reach your database. Your data is safe — reconnect and
        reload.
      </p>
    </div>
  );
}
