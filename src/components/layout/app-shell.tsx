"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { CandlestickChart } from "lucide-react";
import { useDbSession } from "@/providers/db-session-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { BottomNav } from "./bottom-nav";
import { CommandPalette } from "./command-palette";
import { UnlockScreen } from "./unlock-screen";
import { QuickAdd } from "@/features/trades";

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="flex items-center gap-2 text-muted animate-pulse">
        <CandlestickChart className="h-5 w-5 text-accent" />
        <span className="text-sm">Connecting to your journal…</span>
      </div>
    </div>
  );
}

function ConnectionError({ message }: { message: string }) {
  const { disconnect } = useDbSession();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm text-loss max-w-md">{message}</p>
      <div className="flex gap-2">
        <Button onClick={() => location.reload()}>Retry</Button>
        <Button variant="outline" onClick={disconnect}>
          Reconnect / change mode
        </Button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { state } = useDbSession();
  const pathname = usePathname();
  const router = useRouter();
  const isOnboarding = pathname.startsWith("/app/onboarding");

  React.useEffect(() => {
    // Onboarding handles its own forward-redirect once setup completes.
    if (state.status === "none" && !isOnboarding) router.replace("/app/onboarding");
  }, [state.status, isOnboarding, router]);

  if (isOnboarding) return <>{children}</>;
  if (state.status === "loading") return <Splash />;
  if (state.status === "locked") return <UnlockScreen />;
  if (state.status === "error") return <ConnectionError message={state.message} />;
  if (state.status === "none") return <Splash />; // redirecting to onboarding

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-dvh">
        <Sidebar />
        <div className="flex-1 min-w-0 flex flex-col">
          <Topbar />
          <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 pb-28 md:p-6 md:pb-10 animate-fade-in">
            {children}
          </main>
        </div>
      </div>
      <BottomNav />
      <QuickAdd />
      <CommandPalette />
    </TooltipProvider>
  );
}
