import { describe, expect, it } from "vitest";
import { groupActorLabel, groupNotifications, groupVerb } from "./notifications";
import type { NotificationView } from "./types";

let seq = 0;
const notif = (
  type: NotificationView["type"],
  actorName: string,
  opts: Partial<Pick<NotificationView, "postId" | "read" | "createdAt" | "id">> = {}
): NotificationView => ({
  id: opts.id ?? `n${++seq}`,
  type,
  actor: {
    username: actorName.toLowerCase().replace(/\s+/g, "_"),
    displayName: actorName,
  },
  postId: opts.postId !== undefined ? opts.postId : "post-1",
  read: opts.read ?? false,
  createdAt: opts.createdAt ?? `2026-06-12T10:00:${String(60 - ++seq).padStart(2, "0")}.000Z`,
});

describe("groupNotifications", () => {
  it("collapses likes on the same post into one group", () => {
    const groups = groupNotifications([
      notif("like", "Asha", { id: "a", createdAt: "2026-06-12T10:03:00.000Z" }),
      notif("like", "Vik", { id: "b", createdAt: "2026-06-12T10:02:00.000Z" }),
      notif("like", "Tara", { id: "c", createdAt: "2026-06-12T10:01:00.000Z" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.ids).toEqual(["a", "b", "c"]);
    expect(groups[0]!.actors.map((a) => a.displayName)).toEqual(["Asha", "Vik", "Tara"]);
    expect(groups[0]!.createdAt).toBe("2026-06-12T10:03:00.000Z");
  });

  it("never merges different types, even on the same post", () => {
    const groups = groupNotifications([
      notif("like", "Asha"),
      notif("comment", "Vik"),
      notif("reply", "Tara"),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.type)).toEqual(["like", "comment", "reply"]);
  });

  it("never merges the same type across different posts", () => {
    const groups = groupNotifications([
      notif("like", "Asha", { postId: "post-1" }),
      notif("like", "Vik", { postId: "post-2" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("leaves singletons untouched", () => {
    const groups = groupNotifications([notif("follow", "Asha", { postId: null })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.ids).toHaveLength(1);
    expect(groupActorLabel(groups[0]!)).toBe("Asha");
    expect(groupVerb(groups[0]!)).toBe("followed you");
  });

  it("partitions read from unread — an unread group never absorbs read members", () => {
    const groups = groupNotifications([
      notif("like", "Asha", { id: "u1", read: false, createdAt: "2026-06-12T10:04:00.000Z" }),
      notif("like", "Vik", { id: "u2", read: false, createdAt: "2026-06-12T10:03:00.000Z" }),
      notif("like", "Tara", { id: "r1", read: true, createdAt: "2026-06-12T10:02:00.000Z" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.read).toBe(false);
    expect(groups[0]!.ids).toEqual(["u1", "u2"]);
    expect(groups[1]!.read).toBe(true);
    expect(groups[1]!.ids).toEqual(["r1"]);
  });

  it("collapses follows together (no post attached)", () => {
    const groups = groupNotifications([
      notif("follow", "Asha", { postId: null }),
      notif("follow", "Vik", { postId: null }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.postId).toBeNull();
  });

  it("dedupes repeat actors but keeps every member id for mark-read", () => {
    const groups = groupNotifications([
      notif("like", "Asha", { id: "x1" }),
      notif("like", "Asha", { id: "x2" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.ids).toEqual(["x1", "x2"]);
    expect(groups[0]!.actors).toHaveLength(1);
  });

  it("orders groups by their newest member, newest first", () => {
    const groups = groupNotifications([
      notif("like", "Asha", { postId: "old", createdAt: "2026-06-12T09:00:00.000Z" }),
      notif("comment", "Vik", { postId: "new", createdAt: "2026-06-12T11:00:00.000Z" }),
      notif("like", "Tara", { postId: "old", createdAt: "2026-06-12T10:00:00.000Z" }),
    ]);
    expect(groups.map((g) => g.type)).toEqual(["comment", "like"]);
    expect(groups[1]!.createdAt).toBe("2026-06-12T10:00:00.000Z");
  });

  it("handles an empty list", () => {
    expect(groupNotifications([])).toEqual([]);
  });
});

describe("groupActorLabel", () => {
  const actors = (...names: string[]) => ({
    actors: names.map((n) => ({ username: n.toLowerCase(), displayName: n })),
  });

  it("formats one, two, three and many actors", () => {
    expect(groupActorLabel(actors("Asha"))).toBe("Asha");
    expect(groupActorLabel(actors("Asha", "Vik"))).toBe("Asha and Vik");
    expect(groupActorLabel(actors("Asha", "Vik", "Tara"))).toBe("Asha, Vik and 1 other");
    expect(groupActorLabel(actors("Asha", "Vik", "Tara", "Mo", "Ria"))).toBe(
      "Asha, Vik and 3 others"
    );
  });
});
