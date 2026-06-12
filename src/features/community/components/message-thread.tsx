"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { cn, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useSendMessage, useThread } from "../api";
import { CommunityAvatar } from "./avatar";

/** Open thread: peer header, bubbles (mine = accent/right), Enter-to-send composer. */
export function MessageThread({ conversationId }: { conversationId: string | null }) {
  const { data, isLoading, isError } = useThread(conversationId);
  const send = useSendMessage(conversationId ?? "");
  const [draft, setDraft] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const count = data?.messages.length ?? 0;

  React.useEffect(() => {
    // New message (sent or received) → pin the view to the latest bubble.
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [count, conversationId]);

  if (!conversationId) {
    return (
      <div className="hidden flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted md:flex">
        <MessageCircle className="h-6 w-6" aria-hidden />
        Select a conversation
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="flex-1 space-y-3 p-4">
        <Skeleton className="h-9 w-48 rounded-lg" />
        <Skeleton className="h-40 rounded-lg" />
      </div>
    );
  }
  if (isError || !data) {
    return <p className="flex-1 p-8 text-center text-sm text-muted">Conversation not found.</p>;
  }

  const submit = () => {
    const body = draft.trim();
    if (!body || send.isPending) return;
    setDraft("");
    send.mutate(body, {
      onError: (e) => {
        setDraft(body);
        toast.error(e instanceof Error ? e.message : "Could not send the message");
      },
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2.5 border-b px-3 py-2.5">
        <Button variant="ghost" size="icon" asChild className="md:hidden">
          <Link href="/community/messages" aria-label="Back to conversations">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <Link
          href={`/community/u/${data.peer.username}`}
          className="flex min-w-0 items-center gap-2.5"
        >
          <CommunityAvatar
            size="sm"
            username={data.peer.username}
            displayName={data.peer.displayName}
            avatar={data.peer.avatar}
          />
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm font-semibold hover:underline">
              {data.peer.displayName}
            </span>
            <span className="block truncate text-xs text-muted">@{data.peer.username}</span>
          </span>
        </Link>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
        {data.messages.length === 0 && (
          <p className="py-10 text-center text-sm text-muted">
            Say hi to {data.peer.displayName} — keep it educational.
          </p>
        )}
        {data.messages.map((m) => (
          <div key={m.id} className={cn("flex", m.mine ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[78%] rounded-2xl px-3 py-1.5",
                m.mine
                  ? "rounded-br-sm bg-accent text-accent-fg"
                  : "rounded-bl-sm bg-surface-2 text-foreground"
              )}
            >
              <p className="whitespace-pre-wrap break-words text-sm leading-6">{m.body}</p>
              <time
                dateTime={m.createdAt}
                className={cn(
                  "block text-right text-[10px]",
                  m.mine ? "text-accent-fg/70" : "text-muted"
                )}
              >
                {timeAgo(m.createdAt)}
              </time>
            </div>
          </div>
        ))}
      </div>

      <form
        className="flex items-end gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder={`Message ${data.peer.displayName}`}
          aria-label="Write a message"
          className="max-h-32 min-h-9 flex-1 resize-none"
        />
        <Button
          type="submit"
          size="icon"
          aria-label="Send message"
          disabled={!draft.trim() || send.isPending}
        >
          {send.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Send className="h-4 w-4" aria-hidden />
          )}
        </Button>
      </form>
    </div>
  );
}
