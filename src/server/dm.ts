import "server-only";
import { and, eq, or } from "drizzle-orm";
import { platformDb } from "./db/platform";
import { blocks, conversations, dmMessages } from "./db/platform-schema";
import { classifyAttachment, parseMessageReactions } from "@/features/community/dm-v2";
import { parseEditHistory, type CommentEditSnapshot } from "@/features/community/edit-window";
import type { DmAttachment, DmMessageView } from "@/features/community/types";

type Conversation = typeof conversations.$inferSelect;
type DmMessageRow = typeof dmMessages.$inferSelect;

/**
 * Projects a stored dm_messages row into the public DmMessageView. A soft-
 * deleted row collapses to an empty-body tombstone (its prior body, reactions
 * and attachment are SUPPRESSED — never leaked after deletion) so the thread
 * keeps its continuity. The attachment is the classified FIRST link (image →
 * inline preview, link → card resolved lazily client-side); images need no
 * network here. Pure given the row.
 */
export function toMessageView(row: DmMessageRow, viewerId: string): DmMessageView {
  const deleted = Boolean(row.deletedAt);
  const attachment: DmAttachment | null = deleted ? null : classifyAttachment(row.body);
  return {
    id: row.id,
    body: deleted ? "" : row.body,
    mine: row.senderId === viewerId,
    createdAt: row.createdAt,
    reactions: deleted ? {} : parseMessageReactions(row.reactions),
    editedAt: deleted ? null : (row.editedAt ?? null),
    editHistory: deleted ? [] : parseEditHistory<CommentEditSnapshot>(row.editHistory),
    deletedAt: row.deletedAt ?? null,
    attachment,
  };
}

/**
 * Which canonical side a participant occupies in a conversation row. The A/B
 * suffix on last_read_*, last_seen_* and typing_* maps to userA/userB, so one
 * row holds both participants' state. Returns null when `userId` isn't in the
 * conversation (the caller must already have authorized participation).
 */
export function sideOf(convo: Conversation, userId: string): "a" | "b" | null {
  if (convo.userA === userId) return "a";
  if (convo.userB === userId) return "b";
  return null;
}

/** The OTHER participant's id (or null when `userId` isn't a participant). */
export function peerId(convo: Conversation, userId: string): string | null {
  if (convo.userA === userId) return convo.userB;
  if (convo.userB === userId) return convo.userA;
  return null;
}

/**
 * Resolves the viewer's and peer's read/seen/typing columns from a conversation
 * row into a side-agnostic view. `mine.*` is the viewer's own state, `peer.*` is
 * the other participant's — so the route never has to branch on A/B. Pure.
 */
export function conversationState(convo: Conversation, userId: string) {
  const side = sideOf(convo, userId);
  if (side === "a") {
    return {
      side,
      mine: { lastRead: convo.lastReadA, lastSeen: convo.lastSeenA, typing: convo.typingA },
      peer: { lastRead: convo.lastReadB, lastSeen: convo.lastSeenB, typing: convo.typingB },
    };
  }
  return {
    side: "b" as const,
    mine: { lastRead: convo.lastReadB, lastSeen: convo.lastSeenB, typing: convo.typingB },
    peer: { lastRead: convo.lastReadA, lastSeen: convo.lastSeenA, typing: convo.typingA },
  };
}

/** Column accessors for a participant's per-side state (drizzle update payloads). */
export function sideColumns(side: "a" | "b") {
  return side === "a"
    ? { lastRead: "lastReadA" as const, lastSeen: "lastSeenA" as const, typing: "typingA" as const }
    : {
        lastRead: "lastReadB" as const,
        lastSeen: "lastSeenB" as const,
        typing: "typingB" as const,
      };
}

/** True when either user has blocked the other — DMs are refused both ways. */
export async function isBlockedEitherWay(userId: string, otherId: string): Promise<boolean> {
  const row = await platformDb
    .select({ blockerId: blocks.blockerId })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerId, userId), eq(blocks.blockedId, otherId)),
        and(eq(blocks.blockerId, otherId), eq(blocks.blockedId, userId))
      )
    )
    .get();
  return Boolean(row);
}

/** Participants are stored in canonical order so (a,b) and (b,a) map to one row. */
export function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** Loads a conversation only when `userId` is a participant (else null). */
export async function getConversationForUser(conversationId: string, userId: string) {
  const convo = await platformDb
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .get();
  if (!convo || (convo.userA !== userId && convo.userB !== userId)) return null;
  return convo;
}

/**
 * Marks `userId` as having seen the thread up to `nowIso` (sets BOTH last_seen
 * — they loaded the thread — and last_read — they read up to the head). Updates
 * the viewer's own A/B columns. Best-effort: never throws into the caller (the
 * thread still renders if the write fails). `readUpTo` is the timestamp to
 * advance last_read to (usually the newest message createdAt, or now).
 */
export async function markThreadRead(
  convo: Conversation,
  userId: string,
  nowIso: string,
  readUpTo: string | null
): Promise<void> {
  const side = sideOf(convo, userId);
  if (!side) return;
  const cols = sideColumns(side);
  // last_read never moves backwards; readUpTo null keeps the existing mark.
  const set: Record<string, string> = { [cols.lastSeen]: nowIso };
  if (readUpTo) set[cols.lastRead] = readUpTo;
  await platformDb
    .update(conversations)
    .set(set)
    .where(eq(conversations.id, convo.id))
    .catch(() => undefined);
}

/** Records `userId`'s typing heartbeat (ephemeral, TTL-checked on read). */
export async function setTyping(
  convo: Conversation,
  userId: string,
  nowIso: string
): Promise<void> {
  const side = sideOf(convo, userId);
  if (!side) return;
  const cols = sideColumns(side);
  await platformDb
    .update(conversations)
    .set({ [cols.typing]: nowIso })
    .where(eq(conversations.id, convo.id))
    .catch(() => undefined);
}
