import "server-only";
import { and, eq, or } from "drizzle-orm";
import { platformDb } from "./db/platform";
import { blocks, conversations } from "./db/platform-schema";

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
