"use client";

import * as React from "react";
import { AtSign, DollarSign, Hash } from "lucide-react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { useTagAutocomplete, useUserAutocomplete } from "../api";
import {
  completeToken,
  detectActiveToken,
  matchSymbols,
  type ActiveToken,
  type TokenKind,
} from "../autocomplete";
import { formatCount } from "../format";
import { CommunityAvatar } from "./avatar";

/** One normalized suggestion row across all three kinds. */
interface Suggestion {
  /** The bare value inserted after the trigger (handle / tag / SYMBOL). */
  value: string;
  /** Primary line shown in the row. */
  primary: string;
  /** Optional secondary line (display name, post count). */
  secondary?: string;
  avatar?: string | null;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const TRIGGER_ICON: Record<TokenKind, React.ComponentType<{ className?: string }>> = {
  user: AtSign,
  tag: Hash,
  cashtag: DollarSign,
};

interface ComposerTextareaProps extends Omit<
  React.ComponentProps<"textarea">,
  "onChange" | "value"
> {
  value: string;
  onValueChange: (next: string) => void;
}

/**
 * A Textarea with an in-composer typeahead for @mentions, $cashtags and
 * #hashtags. Detecting the active token at the caret (mid-text aware), it shows
 * a debounced, keyboard-navigable suggestion listbox anchored under the field
 * - never wider than the field, so it can't overflow on a 360px phone.
 *
 * - @mention -> community users (block-aware server lookup)
 * - #hashtag -> existing tags + curated topics (server, with post counts)
 * - $cashtag -> curated Indian symbols (resolved client-side; free entry allowed)
 *
 * Inserting a suggestion completes the token + trailing space at the caret.
 */
export const ComposerTextarea = React.forwardRef<HTMLTextAreaElement, ComposerTextareaProps>(
  function ComposerTextarea(
    { value, onValueChange, onKeyDown, className, ...props },
    forwardedRef
  ) {
    const ref = React.useRef<HTMLTextAreaElement>(null);
    // Expose the inner textarea to a forwarded ref (autofocus, caret control).
    React.useImperativeHandle(forwardedRef, () => ref.current as HTMLTextAreaElement, []);
    const uid = React.useId();
    const [token, setToken] = React.useState<ActiveToken | null>(null);
    const [active, setActive] = React.useState(0);
    // True only while the field is focused - blur/insert hides the panel.
    const [open, setOpen] = React.useState(false);

    const debouncedQuery = useDebounced(token?.query ?? "", 200);
    const isUser = token?.kind === "user";
    const isTag = token?.kind === "tag";
    const isCash = token?.kind === "cashtag";

    // Server-backed kinds: only fetch while that token kind is active.
    const userQ = useUserAutocomplete(debouncedQuery, open && isUser);
    const tagQ = useTagAutocomplete(debouncedQuery, open && isTag);

    const suggestions = React.useMemo<Suggestion[]>(() => {
      if (!token) return [];
      if (isCash) {
        return matchSymbols(token.query).map((s) => ({ value: s.symbol, primary: `$${s.symbol}` }));
      }
      if (isUser) {
        return (userQ.data?.users ?? []).map((u) => ({
          value: u.username,
          primary: `@${u.username}`,
          secondary: u.displayName,
          avatar: u.avatar,
        }));
      }
      if (isTag) {
        return (tagQ.data?.tags ?? []).map((t) => ({
          value: t.tag,
          primary: `#${t.tag}`,
          secondary:
            t.count > 0 ? `${formatCount(t.count)} ${t.count === 1 ? "post" : "posts"}` : undefined,
        }));
      }
      return [];
    }, [token, isCash, isUser, isTag, userQ.data, tagQ.data]);

    // Reset the highlight whenever the suggestion set changes shape.
    React.useEffect(() => setActive(0), [token?.kind, debouncedQuery, suggestions.length]);

    const panelOpen = open && token !== null && suggestions.length > 0;

    const syncToken = (el: HTMLTextAreaElement) => {
      const caret = el.selectionStart ?? el.value.length;
      // Detection only makes sense with a collapsed caret (no selection).
      const next =
        el.selectionStart === el.selectionEnd ? detectActiveToken(el.value, caret) : null;
      setToken(next);
    };

    const insert = (s: Suggestion) => {
      if (!token) return;
      const el = ref.current;
      const result = completeToken(value, token, isCash ? s.value.toUpperCase() : s.value);
      onValueChange(result.text);
      setToken(null);
      // Restore the caret just past the inserted token on the next paint.
      requestAnimationFrame(() => {
        if (!el) return;
        el.focus();
        el.setSelectionRange(result.caret, result.caret);
        syncToken(el);
      });
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (panelOpen) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActive((i) => (i + 1) % suggestions.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          const choice = suggestions[active];
          if (choice) {
            e.preventDefault();
            insert(choice);
            return;
          }
        }
        if (e.key === "Escape") {
          // Close only the suggestion panel — don't let Escape bubble up and also
          // close a surrounding modal (the Composer lives inside a Radix Dialog).
          e.preventDefault();
          e.stopPropagation();
          setToken(null);
          return;
        }
      }
      onKeyDown?.(e); // pass through (e.g. Ctrl+Enter submit on comments)
    };

    const TriggerIcon = token ? TRIGGER_ICON[token.kind] : null;

    return (
      <div className="relative">
        <Textarea
          ref={ref}
          value={value}
          onChange={(e) => {
            onValueChange(e.target.value);
            syncToken(e.target);
          }}
          onClick={(e) => syncToken(e.currentTarget)}
          onKeyUp={(e) => {
            // Arrow/Home/End move the caret without changing the value.
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
              syncToken(e.currentTarget);
          }}
          onFocus={() => setOpen(true)}
          // Delay so an option's mousedown->click fires before the panel unmounts.
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-expanded={panelOpen}
          aria-autocomplete="list"
          aria-controls={panelOpen ? `${uid}-listbox` : undefined}
          aria-activedescendant={panelOpen ? `${uid}-opt-${active}` : undefined}
          className={className}
          {...props}
        />

        {panelOpen && (
          <div
            // mousedown is swallowed so clicking an option never blurs the field first.
            onMouseDown={(e) => e.preventDefault()}
            className="absolute left-0 right-0 z-50 mt-1 max-h-60 max-w-full overflow-y-auto rounded-xl border bg-surface py-1 shadow-lg"
          >
            <ul id={`${uid}-listbox`} role="listbox" aria-label="Suggestions">
              {suggestions.map((s, i) => (
                <li
                  key={`${s.primary}-${i}`}
                  id={`${uid}-opt-${i}`}
                  role="option"
                  aria-selected={active === i}
                  data-index={i}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => insert(s)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm",
                    active === i ? "bg-surface-2 text-foreground" : "text-muted"
                  )}
                >
                  {s.avatar !== undefined ? (
                    <CommunityAvatar
                      username={s.value}
                      displayName={s.secondary ?? s.value}
                      avatar={s.avatar}
                      size="sm"
                    />
                  ) : (
                    TriggerIcon && <TriggerIcon className="h-4 w-4 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground">{s.primary}</span>
                    {s.secondary && (
                      <span className="block truncate text-xs text-muted">{s.secondary}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
);
ComposerTextarea.displayName = "ComposerTextarea";
