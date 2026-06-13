/**
 * Richer post reactions (LinkedIn-style) — pure, framework-free logic.
 *
 * One reaction per user per post. The legacy binary "like" maps to the `like`
 * kind so the whole history stays back-compatible: every pre-existing row in
 * the `likes` table is treated as a `like`, and `posts.likeCount` keeps its
 * meaning as the TOTAL number of reactions on the post (not just thumbs-up).
 *
 * The icons referenced here are lucide-react names (NO emojis): the UI maps
 * each kind to its component. This module never imports React so it can be
 * unit-tested and reused on the server.
 */

/** The four supported post-reaction kinds, in display order. */
export const REACTION_KINDS = ["like", "insightful", "respect", "celebrate"] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

const REACTION_SET = new Set<string>(REACTION_KINDS);

export function isReactionKind(value: unknown): value is ReactionKind {
  return typeof value === "string" && REACTION_SET.has(value);
}

/**
 * Normalizes a stored `reaction` cell into a known kind. Legacy rows store
 * NULL (or an empty string) — those are plain likes. Anything unrecognized
 * also degrades to `like` so a future/garbled value can never break a feed.
 */
export function normalizeReaction(value: string | null | undefined): ReactionKind {
  return isReactionKind(value) ? value : "like";
}

interface ReactionMeta {
  kind: ReactionKind;
  /** Short noun shown in the picker and on the active button. */
  label: string;
  /** lucide-react icon component name (resolved to a component in the UI). */
  icon: "ThumbsUp" | "Lightbulb" | "HeartHandshake" | "PartyPopper";
  /** Tailwind text-color class for the filled/active state. */
  colorClass: string;
  /**
   * Top-feed score weight. Higher-signal reactions (a considered "Insightful"
   * or "Respect") count for slightly more than a one-tap Like. Deterministic,
   * documented, no ML. Kept small so volume still dominates over kind.
   */
  weight: number;
}

/** Canonical metadata for every reaction kind. Order matches REACTION_KINDS. */
export const REACTIONS: Record<ReactionKind, ReactionMeta> = {
  like: { kind: "like", label: "Like", icon: "ThumbsUp", colorClass: "text-accent", weight: 1 },
  insightful: {
    kind: "insightful",
    label: "Insightful",
    icon: "Lightbulb",
    colorClass: "text-amber-500",
    weight: 1.5,
  },
  respect: {
    kind: "respect",
    label: "Respect",
    icon: "HeartHandshake",
    colorClass: "text-emerald-500",
    weight: 1.5,
  },
  celebrate: {
    kind: "celebrate",
    label: "Celebrate",
    icon: "PartyPopper",
    colorClass: "text-fuchsia-500",
    weight: 1.2,
  },
};

/** Ordered metadata list, handy for rendering the picker. */
export const REACTION_LIST: ReactionMeta[] = REACTION_KINDS.map((k) => REACTIONS[k]);

/** Per-kind counts. Missing/zero kinds may be absent. */
export type ReactionCounts = Partial<Record<ReactionKind, number>>;

/**
 * Decides the next state of a toggle/switch interaction without touching any
 * store: clicking your current reaction removes it; clicking a different one
 * switches; clicking when you had none adds it. Pure — the caller applies the
 * returned `next` reaction and `delta` to the total count.
 */
export function nextReaction(
  current: ReactionKind | null,
  clicked: ReactionKind
): { next: ReactionKind | null; delta: -1 | 0 | 1; action: "add" | "remove" | "switch" } {
  if (current === null) return { next: clicked, delta: 1, action: "add" };
  if (current === clicked) return { next: null, delta: -1, action: "remove" };
  return { next: clicked, delta: 0, action: "switch" };
}

/**
 * Applies a reaction transition to a per-kind count map, returning a NEW map
 * (never mutates the input). Counts never go negative. Used both to keep the
 * denormalized `posts.reactions` breakdown correct on the server and to patch
 * the optimistic client cache.
 */
export function applyReaction(
  counts: ReactionCounts,
  current: ReactionKind | null,
  clicked: ReactionKind
): { counts: ReactionCounts; next: ReactionKind | null; totalDelta: -1 | 0 | 1 } {
  const { next, delta, action } = nextReaction(current, clicked);
  const out: ReactionCounts = { ...counts };
  const dec = (k: ReactionKind) => {
    out[k] = Math.max(0, (out[k] ?? 0) - 1);
    if (out[k] === 0) delete out[k];
  };
  const inc = (k: ReactionKind) => {
    out[k] = (out[k] ?? 0) + 1;
  };
  if (action === "add") inc(clicked);
  else if (action === "remove") dec(clicked);
  else {
    // switch
    if (current) dec(current);
    inc(clicked);
  }
  return { counts: out, next, totalDelta: delta };
}

/** Sum of all per-kind counts — the canonical post total. */
export function totalReactions(counts: ReactionCounts): number {
  return REACTION_KINDS.reduce((sum, k) => sum + (counts[k] ?? 0), 0);
}

/**
 * Folds a list of raw reaction rows (one per reacting user) into per-kind
 * counts, treating NULL/legacy/unknown as `like`. This is the back-compat
 * backfill path used when computing a post's breakdown from the `likes` table.
 */
export function aggregateReactions(rows: { reaction: string | null }[]): ReactionCounts {
  const counts: ReactionCounts = {};
  for (const r of rows) {
    const k = normalizeReaction(r.reaction);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

/**
 * The top N reaction kinds for the stacked LinkedIn-style summary icons.
 * Sorted by count desc, ties broken by canonical display order so the result
 * is deterministic. Only kinds with a positive count are returned.
 */
export function topReactionKinds(counts: ReactionCounts, n = 2): ReactionKind[] {
  return REACTION_KINDS.filter((k) => (counts[k] ?? 0) > 0)
    .sort((a, b) => {
      const diff = (counts[b] ?? 0) - (counts[a] ?? 0);
      if (diff !== 0) return diff;
      return REACTION_KINDS.indexOf(a) - REACTION_KINDS.indexOf(b);
    })
    .slice(0, n);
}

/**
 * Weighted reaction signal for the Top-feed hot-score. Insightful/Respect
 * weigh 1.5×, Celebrate 1.2×, Like 1× (see REACTIONS[*].weight). Deterministic;
 * recency/other engagement are layered on by the feed query, not here.
 */
export function reactionScore(counts: ReactionCounts): number {
  return REACTION_KINDS.reduce((sum, k) => sum + (counts[k] ?? 0) * REACTIONS[k].weight, 0);
}

/**
 * Deterministic Top-feed hot-score for a post. Weighted reactions dominate
 * (Insightful/Respect 1.5×, Celebrate 1.2×, Like 1×), comments count as a
 * stronger signal than a reaction (2× each), and the whole thing decays gently
 * with age so a fresh post can overtake a slightly older one with equal pull.
 * No ML, no randomness — pure inputs in, score out.
 *
 * @param counts   per-kind reaction breakdown
 * @param comments number of comments on the post
 * @param ageHours hours since the post was created (clamped at 0)
 */
export function topFeedScore(counts: ReactionCounts, comments: number, ageHours: number): number {
  const engagement = reactionScore(counts) + Math.max(0, comments) * 2;
  // Gravity decay (Hacker-News-style): (engagement+1) / (ageHours+2)^1.2.
  const age = Math.max(0, ageHours);
  return (engagement + 1) / Math.pow(age + 2, 1.2);
}

/** Default: at most 2 posts from any one author in a single Top-feed window. */
export const TOP_FEED_AUTHOR_CAP = 2;

/**
 * Per-author diversity cap for the Top feed. Given items ALREADY sorted best-
 * first by hot-score, keeps each item only until its author has appeared
 * `maxPerAuthor` times, so a single prolific poster can't monopolise the Top
 * window. Overflow posts are NOT dropped — they're appended after the capped
 * set (still in hot-score order) so the feed stays full when there aren't
 * enough distinct authors. Deterministic, stable, no ML.
 *
 * @param items        hot-score-sorted items, each exposing an author key
 * @param authorOf     extracts the author id from an item
 * @param maxPerAuthor cap per author (default TOP_FEED_AUTHOR_CAP)
 */
export function applyDiversityCap<T>(
  items: T[],
  authorOf: (item: T) => string,
  maxPerAuthor = TOP_FEED_AUTHOR_CAP
): T[] {
  if (maxPerAuthor < 1) return [...items];
  const seen = new Map<string, number>();
  const kept: T[] = [];
  const overflow: T[] = [];
  for (const item of items) {
    const author = authorOf(item);
    const n = seen.get(author) ?? 0;
    if (n < maxPerAuthor) {
      kept.push(item);
      seen.set(author, n + 1);
    } else {
      overflow.push(item);
    }
  }
  return kept.concat(overflow);
}

/**
 * Serializes a per-kind breakdown for the denormalized `posts.reactions`
 * column. Drops zero/empty kinds; returns null when there are no reactions so
 * the column stays compact (and legacy NULL means "all likes, see likeCount").
 */
export function serializeReactionCounts(counts: ReactionCounts): string | null {
  const compact: ReactionCounts = {};
  for (const k of REACTION_KINDS) if ((counts[k] ?? 0) > 0) compact[k] = counts[k];
  const keys = Object.keys(compact);
  return keys.length ? JSON.stringify(compact) : null;
}

/**
 * Parses the denormalized `posts.reactions` column back into counts. A NULL or
 * malformed value yields an empty map; the caller backfills it as `like` from
 * the total `likeCount` when needed (legacy posts have no breakdown yet).
 */
export function parseReactionCounts(value: string | null | undefined): ReactionCounts {
  if (!value) return {};
  try {
    const obj = JSON.parse(value) as Record<string, unknown>;
    const counts: ReactionCounts = {};
    for (const k of REACTION_KINDS) {
      const n = obj[k];
      if (typeof n === "number" && Number.isFinite(n) && n > 0) counts[k] = Math.floor(n);
    }
    return counts;
  } catch {
    return {};
  }
}

/**
 * Resolves a post's per-kind breakdown for display, with legacy back-compat:
 * if the denormalized column is empty/absent but the post has a positive total
 * (an old post liked before reactions shipped), treat the whole total as
 * `like`. Guarantees the breakdown sum equals the authoritative total.
 */
export function resolveReactionCounts(
  serialized: string | null | undefined,
  total: number
): ReactionCounts {
  const parsed = parseReactionCounts(serialized);
  const sum = totalReactions(parsed);
  if (sum === 0 && total > 0) return { like: total };
  return parsed;
}
