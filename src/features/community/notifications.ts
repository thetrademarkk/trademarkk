import type { AuthorView, NotificationView } from "./types";

/**
 * One collapsed notification row — "Asha, Vik and 3 others liked your post".
 *
 * Grouping key is (type, postId, read): same-type events on the same post
 * collapse; different types never merge; read rows never absorb unread ones,
 * so the unread state of every underlying notification survives grouping.
 */
export interface NotificationGroup {
  /** Stable render key: `type|postId|read`. */
  key: string;
  type: NotificationView["type"];
  postId: string | null;
  /** Every member notification id, newest first — the mark-read payload. */
  ids: string[];
  /** Distinct actors, newest first (first three feed the avatar stack). */
  actors: AuthorView[];
  read: boolean;
  /** Newest member's timestamp — what the row displays and sorts by. */
  createdAt: string;
}

/**
 * Collapses raw notifications into grouped rows, newest activity first.
 * Pure and order-safe: input is re-sorted defensively so the newest member
 * always leads each group regardless of API ordering.
 */
export function groupNotifications(items: NotificationView[]): NotificationGroup[] {
  const sorted = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const groups = new Map<string, NotificationGroup>();

  for (const n of sorted) {
    const key = `${n.type}|${n.postId ?? ""}|${n.read ? "r" : "u"}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        type: n.type,
        postId: n.postId,
        ids: [n.id],
        actors: [n.actor],
        read: n.read,
        createdAt: n.createdAt,
      });
      continue;
    }
    existing.ids.push(n.id);
    if (!existing.actors.some((a) => a.username === n.actor.username)) {
      existing.actors.push(n.actor);
    }
  }

  // Map preserves insertion order; insertion follows the newest-first scan,
  // so groups already sort by their newest member.
  return [...groups.values()];
}

/** "Asha" · "Asha and Vik" · "Asha, Vik and 1 other" · "Asha, Vik and 3 others". */
export function groupActorLabel(group: Pick<NotificationGroup, "actors">): string {
  const names = group.actors.map((a) => a.displayName);
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  const rest = names.length - 2;
  return `${names[0]}, ${names[1]} and ${rest} ${rest === 1 ? "other" : "others"}`;
}

const VERBS: Record<NotificationView["type"], string> = {
  like: "liked your post",
  comment: "commented on your post",
  reply: "replied to your comment",
  follow: "followed you",
  mention: "mentioned you",
};

/** Action copy for a group — reads naturally for one actor or many. */
export function groupVerb(group: Pick<NotificationGroup, "type">): string {
  return VERBS[group.type] ?? group.type;
}
