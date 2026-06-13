"use client";

import * as React from "react";
import { HeartHandshake, Lightbulb, PartyPopper, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCount } from "../format";
import {
  REACTION_LIST,
  REACTIONS,
  topReactionKinds,
  type ReactionCounts,
  type ReactionKind,
} from "../reactions";

/** lucide component for each kind (icon names live in the pure reactions module). */
const ICONS = {
  ThumbsUp,
  Lightbulb,
  HeartHandshake,
  PartyPopper,
} as const;

function ReactionIcon({ kind, className }: { kind: ReactionKind; className?: string }) {
  const Icon = ICONS[REACTIONS[kind].icon];
  return <Icon className={className} aria-hidden />;
}

/**
 * Stacked summary of a post's top reaction icons (LinkedIn-style), e.g. the
 * two most-used reactions overlapping. Purely presentational.
 */
export function ReactionSummary({ counts }: { counts: ReactionCounts }) {
  const top = topReactionKinds(counts, 2);
  if (top.length === 0) return null;
  return (
    <span className="flex -space-x-1" aria-hidden>
      {top.map((kind) => (
        <span
          key={kind}
          className={cn(
            "flex h-4 w-4 items-center justify-center rounded-full border border-surface bg-surface-2",
            REACTIONS[kind].colorClass
          )}
        >
          <ReactionIcon kind={kind} className="h-2.5 w-2.5 fill-current" />
        </span>
      ))}
    </span>
  );
}

/**
 * Reaction button + hover/long-press picker.
 *
 * - Desktop: hovering the button reveals the 4-option picker; clicking the
 *   button toggles your current reaction (or adds Like if you have none).
 * - Mobile/touch: a long-press (or focus + keyboard) opens the picker; a quick
 *   tap toggles like-or-current.
 * - Keyboard: Tab to the button, Enter/Space toggles; ArrowUp/Down or Enter
 *   while focused opens the picker, arrows move between options, Escape closes.
 *
 * The component is fully controlled by `current` (the viewer's reaction) and
 * `total` (count) from the parent — it only emits `onReact(kind)`.
 */
export function ReactionPicker({
  current,
  total,
  counts,
  onReact,
}: {
  current: ReactionKind | null;
  total: number;
  counts: ReactionCounts;
  onReact: (kind: ReactionKind) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPress = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const optionRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const clearClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  // Small grace period so moving the cursor from button to panel doesn't close it.
  const scheduleClose = () => {
    clearClose();
    closeTimer.current = setTimeout(() => setOpen(false), 160);
  };

  React.useEffect(() => () => clearClose(), []);

  // Close on outside click / pointer down anywhere else.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // When the picker opens, move focus to the active (or first) option.
  React.useEffect(() => {
    if (!open) return;
    const idx = current
      ? Math.max(
          0,
          REACTION_LIST.findIndex((r) => r.kind === current)
        )
      : 0;
    optionRefs.current[idx]?.focus();
  }, [open, current]);

  const activeMeta = current ? REACTIONS[current] : null;

  const pick = (kind: ReactionKind) => {
    onReact(kind);
    setOpen(false);
  };

  // Quick tap on the button: toggle current, or add Like when none.
  const onButtonClick = () => {
    if (open) {
      setOpen(false);
      return;
    }
    onReact(current ?? "like");
  };

  const onButtonKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const onOptionKeyDown = (e: React.KeyboardEvent, i: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      optionRefs.current[(i + 1) % REACTION_LIST.length]?.focus();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      optionRefs.current[(i - 1 + REACTION_LIST.length) % REACTION_LIST.length]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  // Long-press (touch) opens the picker; clear it on release/move/leave.
  const startLongPress = () => {
    longPress.current = setTimeout(() => setOpen(true), 450);
  };
  const cancelLongPress = () => {
    if (longPress.current) clearTimeout(longPress.current);
    longPress.current = null;
  };

  return (
    <div
      ref={rootRef}
      className="relative flex"
      onMouseEnter={() => {
        clearClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-pressed={current !== null}
        aria-label={
          activeMeta
            ? `Your reaction: ${activeMeta.label}. Activate to remove, or open the reaction picker.`
            : "React to this post"
        }
        onClick={onButtonClick}
        onKeyDown={onButtonKeyDown}
        onTouchStart={startLongPress}
        onTouchEnd={cancelLongPress}
        onTouchMove={cancelLongPress}
        data-reaction={current ?? "none"}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
          activeMeta
            ? cn(activeMeta.colorClass, "hover:bg-surface-2")
            : "text-muted hover:bg-surface-2 hover:text-foreground"
        )}
      >
        {activeMeta ? (
          <ReactionIcon kind={activeMeta.kind} className="h-4 w-4 fill-current" />
        ) : (
          <ThumbsUp className="h-4 w-4" aria-hidden />
        )}
        {/* Label hides on the narrowest screens (≤xs) so the action row never
            overflows; the icon + count keep the meaning, like LinkedIn mobile. */}
        <span className="hidden xs:inline">{activeMeta ? activeMeta.label : "React"}</span>
        {total > 0 && (
          <span className="flex items-center gap-1 text-muted">
            <ReactionSummary counts={counts} />
            <span className="font-money">{formatCount(total)}</span>
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Pick a reaction"
          onMouseEnter={clearClose}
          onMouseLeave={scheduleClose}
          className="absolute bottom-full left-0 z-50 mb-1.5 flex gap-0.5 rounded-full border bg-surface p-1 shadow-lg animate-fade-in"
        >
          {REACTION_LIST.map((meta, i) => {
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
                  "group flex flex-col items-center rounded-full px-2 py-1.5 outline-none transition-transform",
                  "hover:scale-110 focus-visible:scale-110 focus-visible:ring-2 focus-visible:ring-accent",
                  isActive && "bg-surface-2"
                )}
              >
                <ReactionIcon
                  kind={meta.kind}
                  className={cn("h-5 w-5", meta.colorClass, isActive && "fill-current")}
                />
                <span className="mt-0.5 text-[10px] font-medium text-muted group-hover:text-foreground">
                  {meta.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
