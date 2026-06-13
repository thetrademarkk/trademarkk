"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Clock, FileText, Hash, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CommunityAvatar } from "./avatar";
import { useCommunitySearch } from "../api";
import { formatCount } from "../format";
import {
  clearRecentSearches,
  flattenSearchItems,
  loadRecentSearches,
  moveActive,
  pushRecentSearch,
  saveRecentSearches,
  splitMatch,
  SEARCH_MIN_CHARS,
  type SearchItem,
} from "../search";
import type { SearchResponse } from "../types";

const EMPTY: SearchResponse = { users: [], tags: [], posts: [] };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Bolds the first case-insensitive occurrence of the query inside a result. */
function Match({ text, q }: { text: string; q: string }) {
  const parts = splitMatch(text, q);
  if (!parts) return <>{text}</>;
  return (
    <>
      {parts[0]}
      <span className="font-semibold text-foreground">{parts[1]}</span>
      {parts[2]}
    </>
  );
}

/**
 * One search box instance — input + typeahead panel (Twitter-style combobox).
 * Desktop renders it as a header dropdown; the phone bar renders it full-width.
 * Both instances exist at once (CSS hides one), so each owns its state.
 */
function SearchBox({
  variant,
  onNavigate,
}: {
  variant: "desktop" | "mobile";
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const q = useSearchParams().get("q") ?? "";
  const uid = React.useId();
  const listRef = React.useRef<HTMLUListElement>(null);

  const [value, setValue] = React.useState(q);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const [recents, setRecents] = React.useState<string[]>([]);

  // Keep the field in sync when navigation changes the query (back button).
  React.useEffect(() => setValue(q), [q]);
  React.useEffect(() => setRecents(loadRecentSearches()), []);

  const term = value.trim();
  const debounced = useDebounced(term, 250);
  const { data, isFetching } = useCommunitySearch(debounced);

  const showRecents = term.length === 0;
  const results = !showRecents && debounced.length >= SEARCH_MIN_CHARS ? (data ?? null) : null;
  const items: SearchItem[] = React.useMemo(() => {
    if (showRecents)
      return recents.map((t) => ({
        key: `recent:${t}`,
        group: "query" as const,
        href: `/community?q=${encodeURIComponent(t)}`,
        term: t,
      }));
    return flattenSearchItems(results ?? EMPTY, value);
  }, [showRecents, recents, results, value]);

  // The highlight is positional — reset it whenever the list changes shape.
  React.useEffect(() => setActive(-1), [debounced, showRecents, items.length]);
  React.useEffect(() => {
    if (active < 0) return;
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const panelVisible = open && (showRecents ? recents.length > 0 : term.length > 0);

  const recordRecent = (t: string) => {
    const next = pushRecentSearch(recents, t);
    setRecents(next);
    saveRecentSearches(next);
  };

  const go = (item: SearchItem) => {
    if (item.term) recordRecent(item.term);
    setOpen(false);
    setActive(-1);
    onNavigate?.();
    router.push(item.href);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (active >= 0 && items[active]) return go(items[active]);
    if (term) recordRecent(term);
    setOpen(false);
    onNavigate?.();
    router.push(term ? `/community?q=${encodeURIComponent(term)}` : "/community");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive((cur) => moveActive(cur, e.key === "ArrowDown" ? 1 : -1, items.length));
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  };

  const clear = () => {
    setValue("");
    setActive(-1);
    if (q && pathname === "/community") router.push("/community");
  };

  // Flat indices per section (users → tags → posts → query row).
  const r = results ?? EMPTY;
  const tagsStart = r.users.length;
  const postsStart = tagsStart + r.tags.length;
  const queryIndex = items.length - 1;
  const noMatches =
    results !== null &&
    !isFetching &&
    r.users.length === 0 &&
    r.tags.length === 0 &&
    r.posts.length === 0;

  const rowCls =
    "flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm text-muted";
  const optionProps = (i: number) => ({
    id: `${uid}-opt-${i}`,
    "data-index": i,
    role: "option" as const,
    "aria-selected": active === i,
    onMouseEnter: () => setActive(i),
    onClick: () => go(items[i]!),
    className: cn(rowCls, active === i && "bg-surface-2 text-foreground"),
  });

  return (
    <form role="search" onSubmit={submit} className="relative w-full">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
        aria-hidden
      />
      <Input
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Clicking into an already-focused field reopens the panel (it closes
        // on selection but focus stays — Twitter behaves the same way).
        onClick={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
        placeholder="Search community…"
        aria-label="Search community"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={panelVisible}
        aria-controls={panelVisible ? `${uid}-listbox` : undefined}
        aria-activedescendant={active >= 0 ? `${uid}-opt-${active}` : undefined}
        className="h-8 w-full pl-9 pr-8 text-sm"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={clear}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}

      {panelVisible && (
        // mousedown is prevented so option clicks never blur the input first.
        <div
          onMouseDown={(e) => e.preventDefault()}
          className={cn(
            "overflow-y-auto rounded-xl border bg-surface py-1 shadow-lg",
            variant === "desktop"
              ? "absolute right-0 top-full z-50 mt-2 max-h-[70vh] w-80"
              : "mt-2 max-h-[60vh] w-full"
          )}
        >
          <ul ref={listRef} id={`${uid}-listbox`} role="listbox" aria-label="Search suggestions">
            {showRecents ? (
              <>
                <li
                  role="presentation"
                  className="flex items-center justify-between px-3 pb-1 pt-1.5"
                >
                  <span className="micro-label">Recent searches</span>
                  <button
                    type="button"
                    onClick={() => {
                      clearRecentSearches();
                      setRecents([]);
                    }}
                    className="text-xs text-muted hover:text-foreground"
                  >
                    Clear
                  </button>
                </li>
                {items.map((item, i) => (
                  <li key={item.key} {...optionProps(i)}>
                    <Clock className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="truncate">{item.term}</span>
                  </li>
                ))}
              </>
            ) : (
              <>
                {term.length < SEARCH_MIN_CHARS && (
                  <li role="presentation" className="px-3 py-2 text-xs text-muted">
                    Keep typing to search traders, topics and posts…
                  </li>
                )}
                {isFetching && results === null && term.length >= SEARCH_MIN_CHARS && (
                  <li role="presentation" className="px-3 py-2 text-xs text-muted">
                    Searching…
                  </li>
                )}
                {noMatches && (
                  <li role="presentation" className="px-3 py-2 text-xs text-muted">
                    No traders, topics or posts match.
                  </li>
                )}

                {r.users.length > 0 && (
                  <li role="presentation" className="micro-label px-3 pb-1 pt-1.5">
                    Traders
                  </li>
                )}
                {r.users.map((u, idx) => (
                  <li key={`u:${u.username}`} {...optionProps(idx)}>
                    <CommunityAvatar
                      username={u.username}
                      displayName={u.displayName}
                      avatar={u.avatar}
                      size="sm"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-foreground">
                        <Match text={u.displayName} q={value} />
                      </span>
                      <span className="block truncate text-xs text-muted">
                        @<Match text={u.username} q={value} />
                      </span>
                    </span>
                  </li>
                ))}

                {r.tags.length > 0 && (
                  <li role="presentation" className="micro-label px-3 pb-1 pt-1.5">
                    Topics
                  </li>
                )}
                {r.tags.map((t, idx) => (
                  <li key={`t:${t.tag}`} {...optionProps(tagsStart + idx)}>
                    <Hash className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="truncate text-sm text-foreground">
                      #<Match text={t.tag} q={value} />
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-muted">
                      {formatCount(t.count)} {t.count === 1 ? "post" : "posts"}
                    </span>
                  </li>
                ))}

                {r.posts.length > 0 && (
                  <li role="presentation" className="micro-label px-3 pb-1 pt-1.5">
                    Posts
                  </li>
                )}
                {r.posts.map((p, idx) => (
                  <li key={`p:${p.id}`} {...optionProps(postsStart + idx)}>
                    <FileText className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-foreground">
                        <Match text={p.title?.trim() || p.snippet} q={value} />
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {p.author.displayName} · {formatCount(p.likeCount)}{" "}
                        {p.likeCount === 1 ? "like" : "likes"}
                      </span>
                    </span>
                  </li>
                ))}

                {term.length > 0 && items[queryIndex] && (
                  <li key="query" {...optionProps(queryIndex)}>
                    <Search className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="truncate">
                      Search posts for{" "}
                      <span className="font-medium text-foreground">&ldquo;{term}&rdquo;</span>
                    </span>
                  </li>
                )}
              </>
            )}
          </ul>
        </div>
      )}
    </form>
  );
}

/**
 * Community search lives in the site header (LinkedIn/Twitter pattern) and is
 * URL-driven — submitting navigates to /community?q=… so results are shareable
 * and survive reloads. Search v2 adds a unified typeahead (traders, topics,
 * posts) with full keyboard navigation and recent searches.
 */
export function CommunitySearch() {
  const [barOpen, setBarOpen] = React.useState(false);

  return (
    <>
      <div className="relative hidden w-44 transition-[width] duration-200 focus-within:w-64 md:block">
        <SearchBox variant="desktop" />
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-label="Search community"
        aria-expanded={barOpen}
        onClick={() => setBarOpen((v) => !v)}
      >
        <Search className="h-4 w-4" />
      </Button>
      {barOpen && (
        <div className="absolute inset-x-0 top-full border-b bg-bg/95 p-2 backdrop-blur md:hidden">
          <SearchBox variant="mobile" onNavigate={() => setBarOpen(false)} />
        </div>
      )}
    </>
  );
}
