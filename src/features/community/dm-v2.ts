/**
 * DM v2 — pure, framework-free logic shared by the server routes, the API hooks,
 * the UI and the unit tests. No I/O, no React, no Node-only APIs here so it can
 * be unit-tested in isolation and reused on both sides of the wire.
 *
 * Covers the v2 building blocks layered on top of DM v1's plain-text 1:1 chat:
 *   • delivery / seen state derivation (sent → delivered → seen)
 *   • per-participant unread derivation from a last-read timestamp
 *   • a short-TTL typing indicator (ephemeral, expires after a few seconds)
 *   • per-message emoji reactions (reusing the post-reaction idiom — lucide
 *     icons, no literal emoji chars in code; one reaction-kind per user)
 *   • inline image / link detection so an image URL renders an inline preview
 *     and a normal link renders a card (zero-infra: reuses the unfurl path,
 *     never a file upload — see docs note in the API route)
 *
 * The 15-minute edit window + immutable history is reused verbatim from
 * `edit-window.ts` — a DM message edit obeys exactly the same boundary maths as
 * a post/comment edit, so there's nothing to re-derive here.
 */

/* ── Per-message reactions ─────────────────────────────────────────────────── */

/**
 * The message-reaction kinds, in display order. A SMALL, intentional set — a
 * chat reaction is a quick acknowledgement, not the 4-way post reaction. Each
 * maps to a lucide-react icon component name (resolved in the UI); this module
 * never imports React so it stays unit-testable. NO literal emoji characters
 * appear in code (the design system renders reactions as lucide glyphs, exactly
 * like post reactions).
 */
export const MESSAGE_REACTION_KINDS = ["like", "love", "laugh", "celebrate", "sad"] as const;
export type MessageReactionKind = (typeof MESSAGE_REACTION_KINDS)[number];

const MESSAGE_REACTION_SET = new Set<string>(MESSAGE_REACTION_KINDS);

export function isMessageReactionKind(value: unknown): value is MessageReactionKind {
  return typeof value === "string" && MESSAGE_REACTION_SET.has(value);
}

interface MessageReactionMeta {
  kind: MessageReactionKind;
  /** Accessible label shown in the picker / aria-label. */
  label: string;
  /** lucide-react icon component name (resolved to a component in the UI). */
  icon: "ThumbsUp" | "Heart" | "Laugh" | "PartyPopper" | "Frown";
  /** Tailwind text-color class for the active/filled state. */
  colorClass: string;
}

/** Canonical metadata for every message-reaction kind. Order = display order. */
export const MESSAGE_REACTIONS: Record<MessageReactionKind, MessageReactionMeta> = {
  like: { kind: "like", label: "Like", icon: "ThumbsUp", colorClass: "text-accent" },
  love: { kind: "love", label: "Love", icon: "Heart", colorClass: "text-rose-500" },
  laugh: { kind: "laugh", label: "Haha", icon: "Laugh", colorClass: "text-amber-500" },
  celebrate: {
    kind: "celebrate",
    label: "Celebrate",
    icon: "PartyPopper",
    colorClass: "text-fuchsia-500",
  },
  sad: { kind: "sad", label: "Sad", icon: "Frown", colorClass: "text-sky-500" },
};

/** Ordered metadata list, handy for rendering the picker. */
export const MESSAGE_REACTION_LIST: MessageReactionMeta[] = MESSAGE_REACTION_KINDS.map(
  (k) => MESSAGE_REACTIONS[k]
);

/**
 * The on-disk shape of a message's reactions: a map of userId -> reaction kind
 * (one reaction per user per message). Stored as compact JSON on the message
 * row. Reading is tolerant — unknown/garbled kinds and non-string keys are
 * dropped so a corrupt cell degrades to "no reactions", never throws.
 */
export type MessageReactionMap = Record<string, MessageReactionKind>;

export function parseMessageReactions(raw: string | null | undefined): MessageReactionMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: MessageReactionMap = {};
    for (const [userId, kind] of Object.entries(parsed as Record<string, unknown>)) {
      if (userId && isMessageReactionKind(kind)) out[userId] = kind;
    }
    return out;
  } catch {
    return {};
  }
}

/** Serializes a reaction map back to compact JSON, or null when empty. */
export function serializeMessageReactions(map: MessageReactionMap): string | null {
  const keys = Object.keys(map).sort();
  if (keys.length === 0) return null;
  const ordered: MessageReactionMap = {};
  for (const k of keys) ordered[k] = map[k]!;
  return JSON.stringify(ordered);
}

/**
 * Toggles `userId`'s reaction on a message, returning a NEW map (immutable):
 * clicking your current kind removes it; clicking a different kind switches it;
 * clicking when you have none adds it. Mirrors the post-reaction semantics so
 * the optimistic client math and the server math stay identical.
 */
export function toggleMessageReaction(
  map: MessageReactionMap,
  userId: string,
  clicked: MessageReactionKind
): MessageReactionMap {
  const next = { ...map };
  if (next[userId] === clicked) delete next[userId];
  else next[userId] = clicked;
  return next;
}

/** Per-kind counts for the summary chips, ordered by display order. */
export interface MessageReactionCount {
  kind: MessageReactionKind;
  count: number;
  /** True when the viewer's own reaction is this kind (highlights the chip). */
  mine: boolean;
}

/**
 * Folds a reaction map into ordered per-kind counts for display, marking which
 * kind (if any) is the viewer's. Only kinds with a positive count are returned,
 * in canonical display order (deterministic).
 */
export function summarizeMessageReactions(
  map: MessageReactionMap,
  viewerId: string | null
): MessageReactionCount[] {
  const counts = new Map<MessageReactionKind, number>();
  for (const kind of Object.values(map)) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  const mine = viewerId ? (map[viewerId] ?? null) : null;
  return MESSAGE_REACTION_KINDS.filter((k) => (counts.get(k) ?? 0) > 0).map((k) => ({
    kind: k,
    count: counts.get(k)!,
    mine: mine === k,
  }));
}

/* ── Typing indicator (ephemeral, short-TTL) ───────────────────────────────── */

/**
 * How long a "typing" signal stays live. The client refreshes it (throttled)
 * while the user is actually typing; the thread poll surfaces it and it expires
 * a few seconds after the last keystroke so a stale signal never lingers. Kept
 * a touch above the 5s thread poll so a genuinely-typing peer doesn't flicker.
 */
export const TYPING_TTL_MS = 6000;

/**
 * Whether a peer's stored `typingAt` (ISO timestamp, or null) means they are
 * CURRENTLY typing as of `now`. A null/absent/unparseable value, or one older
 * than the TTL, is "not typing". `now` is injectable for deterministic tests.
 */
export function isTyping(
  typingAt: string | null | undefined,
  now: number = Date.now(),
  ttlMs: number = TYPING_TTL_MS
): boolean {
  if (!typingAt) return false;
  const t = Date.parse(typingAt);
  if (Number.isNaN(t)) return false;
  // A typing timestamp from the future (clock skew) still counts as live.
  return now - t < ttlMs;
}

/**
 * Client-side throttle gate: returns whether we should send a fresh typing
 * heartbeat given when we last sent one. Avoids hammering the endpoint on every
 * keystroke — we re-ping at most once per `intervalMs`.
 */
export const TYPING_PING_INTERVAL_MS = 3000;

export function shouldSendTypingPing(
  lastSentAt: number | null,
  now: number = Date.now(),
  intervalMs: number = TYPING_PING_INTERVAL_MS
): boolean {
  if (lastSentAt === null) return true;
  return now - lastSentAt >= intervalMs;
}

/* ── Delivery / seen state ─────────────────────────────────────────────────── */

/**
 * The delivery state of a message the VIEWER sent (only ever shown on your own
 * outgoing bubbles, like every modern chat):
 *   • "sending"   — optimistic, not yet acknowledged by the server
 *   • "sent"      — persisted server-side, peer hasn't loaded it yet
 *   • "delivered" — the peer's client has loaded the thread past this message
 *   • "seen"      — the peer's last-read mark is at/after this message
 */
export type DeliveryState = "sending" | "sent" | "delivered" | "seen";

/**
 * Derives the delivery state of one of the viewer's own messages.
 *
 * @param createdAt        the message's ISO timestamp (its monotonic ordering key)
 * @param optimistic       true when this is an un-acknowledged local bubble
 * @param peerLastReadAt   peer's last-read message ISO timestamp (or null)
 * @param peerLastSeenAt   peer's last thread-activity ISO timestamp (or null) —
 *                         drives "delivered" (peer's client has the message)
 *
 * Pure + total: unparseable inputs degrade to the weaker state, never throw.
 */
export function deliveryState(
  createdAt: string,
  optimistic: boolean,
  peerLastReadAt: string | null | undefined,
  peerLastSeenAt: string | null | undefined
): DeliveryState {
  if (optimistic) return "sending";
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return "sent";
  const read = peerLastReadAt ? Date.parse(peerLastReadAt) : NaN;
  if (!Number.isNaN(read) && read >= created) return "seen";
  const seen = peerLastSeenAt ? Date.parse(peerLastSeenAt) : NaN;
  if (!Number.isNaN(seen) && seen >= created) return "delivered";
  return "sent";
}

/* ── Unread / last-read derivation ─────────────────────────────────────────── */

/** A minimal message shape for unread derivation (server + client share it). */
export interface UnreadMessage {
  senderId: string;
  createdAt: string;
}

/**
 * Counts how many messages in a thread are unread for `viewerId`, given their
 * last-read ISO timestamp. A message is unread when (a) it was NOT sent by the
 * viewer and (b) its createdAt is strictly after the last-read mark. A null/absent
 * last-read means everything from the peer is unread. Pure + deterministic.
 */
export function countUnread(
  messages: UnreadMessage[],
  viewerId: string,
  lastReadAt: string | null | undefined
): number {
  const mark = lastReadAt ? Date.parse(lastReadAt) : NaN;
  let count = 0;
  for (const m of messages) {
    if (m.senderId === viewerId) continue;
    const t = Date.parse(m.createdAt);
    if (Number.isNaN(t)) continue;
    if (Number.isNaN(mark) || t > mark) count++;
  }
  return count;
}

/**
 * The new last-read timestamp after the viewer opens/reads a thread: the latest
 * createdAt across ALL messages (so both sides advance to the head), or the
 * current `floor` (the existing mark) when there are no messages. Never moves
 * backwards. Used to set a participant's last-read on mark-read.
 */
export function nextLastRead(
  messages: { createdAt: string }[],
  floor: string | null | undefined
): string | null {
  let best = floor ?? null;
  let bestMs = floor ? Date.parse(floor) : -Infinity;
  for (const m of messages) {
    const t = Date.parse(m.createdAt);
    if (!Number.isNaN(t) && t > bestMs) {
      bestMs = t;
      best = m.createdAt;
    }
  }
  return best;
}

/* ── Soft-delete tombstone ─────────────────────────────────────────────────── */

/** The tombstone copy shown in place of a soft-deleted message (UI + tests). */
export const DELETED_MESSAGE_TEXT = "This message was deleted";

/** True when a message row has been soft-deleted (a non-null deletedAt). */
export function isDeleted(deletedAt: string | null | undefined): boolean {
  return Boolean(deletedAt);
}

/* ── Inline image / link detection (zero-infra image sharing) ──────────────── */

// A URL inside a message body. http(s) only — mirrors the post unfurl/linkifier
// regexes so the first link we treat is exactly the first link a reader sees.
const URL_IN_TEXT = /https?:\/\/[^\s<>"')\]]+/g;

/** Common raster image extensions we render inline (lazy-loaded, capped size). */
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;

/**
 * True when an https URL points at an image we can render inline. We require
 * https (the next/image loader + CSP both demand it) and an image extension on
 * the PATH (querystrings are ignored for the extension test). `.svg` is matched
 * but the renderer routes it through next/image like any other remote image, so
 * the browser only ever loads it same-origin via `/_next/image` (no inline SVG
 * script execution — the strict img-src CSP is never relaxed).
 */
export function isImageUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return IMAGE_EXT.test(parsed.pathname);
}

/** Extracts the FIRST link in a message body, or null (trailing punctuation trimmed). */
export function extractFirstLink(body: string): string | null {
  const m = body.match(URL_IN_TEXT);
  if (!m || !m[0]) return null;
  const url = m[0].replace(/[.,;:!?)\]}'"]+$/, "");
  return url.length >= 11 ? url : null; // "https://a.b" is the shortest plausible
}

/**
 * Classifies the FIRST link in a message body for rendering:
 *   • { kind: "image", url } — render an inline image preview (via next/image)
 *   • { kind: "link",  url } — render a link/unfurl card
 *   • null                   — no link in the body
 * The body text itself is always rendered too (the preview is additive); this
 * only decides which (if any) rich attachment to show beneath it.
 */
export function classifyAttachment(body: string): { kind: "image" | "link"; url: string } | null {
  const link = extractFirstLink(body);
  if (!link) return null;
  return { kind: isImageUrl(link) ? "image" : "link", url: link };
}
