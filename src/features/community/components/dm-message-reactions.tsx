"use client";

import * as React from "react";
import { Frown, Heart, Laugh, PartyPopper, SmilePlus, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MESSAGE_REACTION_LIST,
  MESSAGE_REACTIONS,
  summarizeMessageReactions,
  type MessageReactionKind,
  type MessageReactionMap,
} from "../dm-v2";

/** lucide component for each message-reaction kind (names live in the pure module). */
const ICONS = { ThumbsUp, Heart, Laugh, PartyPopper, Frown } as const;

function ReactionIcon({ kind, className }: { kind: MessageReactionKind; className?: string }) {
  const Icon = ICONS[MESSAGE_REACTIONS[kind].icon];
  return <Icon className={className} aria-hidden />;
}

/**
 * Compact summary chips of a message's reactions (lucide glyphs + counts, no
 * literal emoji). The viewer's own reaction chip is highlighted and clickable to
 * remove. Sits just under the bubble. Purely a display + toggle surface.
 */
export function DmReactionChips({
  reactions,
  onReact,
}: {
  reactions: MessageReactionMap;
  onReact: (kind: MessageReactionKind) => void;
}) {
  const summary = summarizeMessageReactions(reactions, "me");
  if (summary.length === 0) return null;
  return (
    <div className="mt-0.5 flex flex-wrap gap-1">
      {summary.map((s) => (
        <button
          key={s.kind}
          type="button"
          onClick={() => onReact(s.kind)}
          aria-label={`${MESSAGE_REACTIONS[s.kind].label}: ${s.count}${s.mine ? " (yours, tap to remove)" : ""}`}
          aria-pressed={s.mine}
          className={cn(
            "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] transition-colors",
            s.mine ? "border-accent bg-accent/10 text-accent" : "bg-surface-2 hover:bg-surface"
          )}
        >
          <ReactionIcon
            kind={s.kind}
            className={cn(
              "h-3 w-3",
              MESSAGE_REACTIONS[s.kind].colorClass,
              s.mine && "fill-current"
            )}
          />
          <span className="font-money tabular-nums">{s.count}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * A small "react" affordance that pops the 5-kind picker. Used in a message's
 * hover/focus action row. Keyboard-accessible (Enter/Space opens; arrows move;
 * Escape closes). Closes on outside click / pick.
 */
export function DmReactionPicker({
  current,
  onReact,
}: {
  current: MessageReactionKind | null;
  onReact: (kind: MessageReactionKind) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const optionRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  React.useEffect(() => {
    if (open) optionRefs.current[0]?.focus();
  }, [open]);

  const pick = (kind: MessageReactionKind) => {
    onReact(kind);
    setOpen(false);
  };

  const onOptionKeyDown = (e: React.KeyboardEvent, i: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      optionRefs.current[(i + 1) % MESSAGE_REACTION_LIST.length]?.focus();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      optionRefs.current[
        (i - 1 + MESSAGE_REACTION_LIST.length) % MESSAGE_REACTION_LIST.length
      ]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="React to message"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-foreground"
      >
        <SmilePlus className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Pick a reaction"
          className="absolute bottom-full right-0 z-50 mb-1.5 flex gap-0.5 rounded-full border bg-surface p-1 shadow-lg animate-fade-in"
        >
          {MESSAGE_REACTION_LIST.map((meta, i) => {
            const isActive = current === meta.kind;
            return (
              <button
                key={meta.kind}
                ref={(el) => {
                  optionRefs.current[i] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-label={meta.label}
                aria-checked={isActive}
                title={meta.label}
                onClick={() => pick(meta.kind)}
                onKeyDown={(e) => onOptionKeyDown(e, i)}
                className={cn(
                  "flex items-center justify-center rounded-full p-1.5 outline-none transition-transform",
                  "hover:scale-110 focus-visible:scale-110 focus-visible:ring-2 focus-visible:ring-accent",
                  isActive && "bg-surface-2"
                )}
              >
                <ReactionIcon
                  kind={meta.kind}
                  className={cn("h-5 w-5", meta.colorClass, isActive && "fill-current")}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
