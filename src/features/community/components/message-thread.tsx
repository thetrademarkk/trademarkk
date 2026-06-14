"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Clock,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  useDeleteMessage,
  useEditMessage,
  useMarkThreadRead,
  useReactToMessage,
  useSendMessage,
  useThread,
  useTypingPing,
} from "../api";
import { editMinutesLeft, isWithinEditWindow } from "../edit-window";
import {
  deliveryState,
  isTyping,
  shouldSendTypingPing,
  summarizeMessageReactions,
  type DeliveryState,
  type MessageReactionKind,
} from "../dm-v2";
import type { DmMessageView, ThreadState } from "../types";
import { CommunityAvatar } from "./avatar";
import { DmAttachment } from "./dm-attachment";
import { DmReactionChips, DmReactionPicker } from "./dm-message-reactions";
import { RichText } from "./rich-text";

/** Open thread: peer header, v2 bubbles, typing bubble, seen ticks, composer. */
export function MessageThread({ conversationId }: { conversationId: string | null }) {
  const { data, isLoading, isError } = useThread(conversationId);
  const send = useSendMessage(conversationId ?? "");
  const ping = useTypingPing(conversationId ?? "");
  const markRead = useMarkThreadRead(conversationId ?? "");
  const [draft, setDraft] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const lastTypingPing = React.useRef<number | null>(null);
  const count = data?.messages.length ?? 0;
  const lastId = data?.messages[count - 1]?.id;

  // A 1s wall-clock tick so the typing bubble + delivery ticks re-evaluate
  // against the TTL between polls (and even if polling pauses on a backgrounded
  // tab) — the bubble must clear on time, not only on the next 5s poll.
  const [, forceTick] = React.useReducer((n: number) => n + 1, 0);
  const peerTypingAt = data?.state.peerTypingAt ?? null;
  React.useEffect(() => {
    if (!isTyping(peerTypingAt)) return;
    const t = setInterval(forceTick, 1000);
    return () => clearInterval(t);
  }, [peerTypingAt]);

  // Auto-scroll to the newest bubble on a new message (sent or received) or on
  // switching threads. Keyed by the last message id so a history prepend (which
  // grows count but not the tail) doesn't yank the view down.
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lastId, conversationId]);

  // Re-confirm read when the tab/window regains focus so the sender's "seen"
  // updates promptly when the recipient returns to an already-open thread.
  React.useEffect(() => {
    if (!conversationId) return;
    const onFocus = () => markRead.mutate();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // markRead identity is stable per conversation; binding once is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

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

  const peerTyping = isTyping(data.state.peerTypingAt);

  const onDraftChange = (value: string) => {
    setDraft(value);
    // Throttled typing heartbeat — only while there's content to type.
    if (value.trim() && shouldSendTypingPing(lastTypingPing.current)) {
      lastTypingPing.current = Date.now();
      ping.mutate();
    }
  };

  const submit = () => {
    const body = draft.trim();
    if (!body || send.isPending) return;
    setDraft("");
    lastTypingPing.current = null;
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
            <span className="block truncate text-xs">
              {peerTyping ? (
                <span className="text-accent">typing…</span>
              ) : (
                <span className="text-muted">@{data.peer.username}</span>
              )}
            </span>
          </span>
        </Link>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
        {data.messages.length === 0 && (
          <p className="py-10 text-center text-sm text-muted">
            Say hi to {data.peer.displayName} — keep it educational.
          </p>
        )}
        {data.messages.map((m, i) => (
          <MessageBubble
            key={m.id}
            conversationId={conversationId}
            message={m}
            state={data.state}
            // The seen/delivered tick shows only on the LAST of the viewer's own
            // messages (like every modern chat), not on every bubble.
            showTick={m.mine && isLastMine(data.messages, i)}
          />
        ))}
        {peerTyping && <TypingBubble />}
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
          onChange={(e) => onDraftChange(e.target.value)}
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

/** True when message `i` is the last of the viewer's OWN messages in the list. */
function isLastMine(messages: DmMessageView[], i: number): boolean {
  for (let j = i + 1; j < messages.length; j++) if (messages[j]!.mine) return false;
  return true;
}

/** The peer's animated "typing…" bubble (three pulsing dots, no emoji). */
function TypingBubble() {
  return (
    <div className="flex justify-start" data-typing-bubble aria-live="polite">
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-surface-2 px-3 py-2.5">
        <span className="sr-only">Typing</span>
        {[0, 1, 2].map((d) => (
          <span
            key={d}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted"
            style={{ animationDelay: `${d * 150}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

const TICK: Record<DeliveryState, { Icon: typeof Check; label: string; className: string }> = {
  sending: { Icon: Clock, label: "Sending", className: "text-accent-fg/60" },
  sent: { Icon: Check, label: "Sent", className: "text-accent-fg/70" },
  delivered: { Icon: CheckCheck, label: "Delivered", className: "text-accent-fg/70" },
  seen: { Icon: CheckCheck, label: "Seen", className: "text-sky-200" },
};

/** One message: bubble, attachment, reactions, edit/delete, seen ticks. */
function MessageBubble({
  conversationId,
  message: m,
  state,
  showTick,
}: {
  conversationId: string;
  message: DmMessageView;
  state: ThreadState;
  showTick: boolean;
}) {
  const react = useReactToMessage(conversationId);
  const edit = useEditMessage(conversationId);
  const del = useDeleteMessage(conversationId);
  const confirm = useConfirm();
  const [editing, setEditing] = React.useState(false);
  const [editDraft, setEditDraft] = React.useState(m.body);
  const optimistic = m.id.startsWith("optimistic-");
  const deleted = Boolean(m.deletedAt);
  const myReaction =
    (summarizeMessageReactions(m.reactions, "me").find((s) => s.mine)?.kind as
      | MessageReactionKind
      | undefined) ?? null;
  const canEdit = m.mine && !deleted && !optimistic && isWithinEditWindow(m.createdAt);

  const tick: DeliveryState = optimistic
    ? "sending"
    : deliveryState(m.createdAt, false, state.peerLastReadAt, state.peerLastSeenAt);

  const onReact = (kind: MessageReactionKind) => {
    if (optimistic) return;
    react.mutate({ messageId: m.id, reaction: kind });
  };

  const saveEdit = () => {
    const body = editDraft.trim();
    if (!body || body === m.body) {
      setEditing(false);
      return;
    }
    edit.mutate(
      { messageId: m.id, body },
      { onError: (e) => toast.error(e instanceof Error ? e.message : "Could not edit the message") }
    );
    setEditing(false);
  };

  const onDelete = async () => {
    const ok = await confirm({
      title: "Delete message?",
      description: "It will be replaced with “message deleted” for both of you.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    del.mutate(m.id, {
      onError: (e) => toast.error(e instanceof Error ? e.message : "Could not delete the message"),
    });
  };

  return (
    <div className={cn("group flex flex-col", m.mine ? "items-end" : "items-start")}>
      <div className={cn("flex max-w-[88%] items-end gap-1", m.mine && "flex-row-reverse")}>
        {/* Hover/focus action row — anyone may react; only the author edits/deletes. */}
        {!deleted && !editing && (
          <div className="flex items-center gap-0.5 self-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <DmReactionPicker current={myReaction} onReact={onReact} />
            {m.mine && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Message actions"
                    className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-foreground"
                  >
                    <MoreHorizontal className="h-4 w-4" aria-hidden />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canEdit && (
                    <DropdownMenuItem
                      onSelect={() => {
                        setEditDraft(m.body);
                        setEditing(true);
                      }}
                    >
                      <Pencil className="mr-2 h-3.5 w-3.5" aria-hidden />
                      Edit
                      <span className="ml-auto pl-3 text-xs text-muted">
                        {editMinutesLeft(m.createdAt)}m left
                      </span>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={onDelete} className="text-loss">
                    <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}

        <div className="min-w-0">
          <div
            data-message-id={m.id}
            data-deleted={deleted ? "true" : undefined}
            className={cn(
              "rounded-2xl px-3 py-1.5",
              deleted
                ? "border border-dashed bg-transparent text-muted"
                : m.mine
                  ? "rounded-br-sm bg-accent-solid text-accent-fg"
                  : "rounded-bl-sm bg-surface-2 text-foreground"
            )}
          >
            {editing ? (
              <div className="flex flex-col gap-1.5 py-0.5">
                <Textarea
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      saveEdit();
                    } else if (e.key === "Escape") {
                      setEditing(false);
                    }
                  }}
                  rows={1}
                  maxLength={2000}
                  aria-label="Edit message"
                  className="min-h-8 w-56 max-w-full resize-none bg-surface text-foreground"
                />
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                    <X className="h-3.5 w-3.5" aria-hidden /> Cancel
                  </Button>
                  <Button size="sm" onClick={saveEdit} disabled={!editDraft.trim()}>
                    Save
                  </Button>
                </div>
              </div>
            ) : deleted ? (
              <p className="flex items-center gap-1.5 text-sm italic">
                <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Message deleted
              </p>
            ) : (
              <p className="whitespace-pre-wrap break-words text-sm leading-6">
                <RichText text={m.body} />
              </p>
            )}

            {!deleted && !editing && (
              <span className="mt-0.5 flex items-center justify-end gap-1">
                {m.editedAt && (
                  <span
                    className={cn("text-[10px]", m.mine ? "text-accent-fg/70" : "text-muted")}
                    title="This message was edited"
                  >
                    edited
                  </span>
                )}
                <time
                  dateTime={m.createdAt}
                  className={cn("text-[10px]", m.mine ? "text-accent-fg/70" : "text-muted")}
                >
                  {timeAgo(m.createdAt)}
                </time>
                {showTick && (
                  <span
                    className={cn("flex items-center", TICK[tick].className)}
                    data-tick={tick}
                    aria-label={TICK[tick].label}
                    title={TICK[tick].label}
                  >
                    {React.createElement(TICK[tick].Icon, { className: "h-3 w-3" })}
                  </span>
                )}
              </span>
            )}
          </div>

          {/* Image / link attachment (zero-infra: next/image + lazy unfurl). */}
          {!deleted && !editing && m.attachment && (
            <DmAttachment
              conversationId={conversationId}
              messageId={m.id}
              attachment={m.attachment}
              optimistic={optimistic}
              mine={m.mine}
            />
          )}

          {!deleted && <DmReactionChips reactions={m.reactions} onReact={onReact} />}
        </div>
      </div>
    </div>
  );
}
