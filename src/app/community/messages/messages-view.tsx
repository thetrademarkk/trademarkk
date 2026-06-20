"use client";

import * as React from "react";
import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageThread, MessagesInbox, SignInGate } from "@/features/community";

/** Two-pane DM screen: inbox list + open thread (stacked on mobile via ?c=). */
function MessagesView() {
  const selectedId = useSearchParams().get("c");
  const { data: session, isPending } = useSession();
  const [gateOpen, setGateOpen] = React.useState(false);

  if (isPending) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }
  if (!session) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-16 text-center">
        <MessageCircle className="mx-auto h-8 w-8 text-muted" aria-hidden />
        <h1 className="mt-3 text-lg font-bold">Messages</h1>
        <p className="mt-1 text-sm text-muted">Sign in to chat privately with other traders.</p>
        <Button className="mt-4" onClick={() => setGateOpen(true)}>
          Sign in
        </Button>
        <SignInGate open={gateOpen} onOpenChange={setGateOpen} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <Link
        href="/community"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted hover:text-accent"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to community
      </Link>
      <h1 className="mb-3 flex items-center gap-2 text-xl font-bold">
        <MessageCircle className="h-5 w-5 text-accent" aria-hidden /> Messages
      </h1>

      {/* Subtract the mobile bottom bar (~4rem) from the pane height so the
          two-pane chat never hides behind it; restored from md up. */}
      <div className="flex h-[calc(100dvh-13.5rem-4rem)] min-h-[380px] overflow-hidden rounded-xl border bg-surface md:h-[calc(100dvh-13.5rem)]">
        <aside
          aria-label="Inbox"
          className={cn(
            "w-full overflow-y-auto md:w-72 md:shrink-0 md:border-r",
            selectedId && "hidden md:block"
          )}
        >
          <MessagesInbox selectedId={selectedId} />
        </aside>
        <section
          aria-label="Conversation"
          className={cn("min-w-0 flex-1 flex-col", selectedId ? "flex" : "hidden md:flex")}
        >
          <MessageThread conversationId={selectedId} />
        </section>
      </div>
    </div>
  );
}

export function MessagesPageClient() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-5xl px-4 py-6">
          <Skeleton className="h-80 rounded-xl" />
        </div>
      }
    >
      <MessagesView />
    </Suspense>
  );
}
