import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type Client } from "@libsql/client";

/**
 * Integration test for the Following-feed scope SQL: it must return posts BY a
 * followed user OR carrying a followed tag, exclude blocked users, and return a
 * post that matches BOTH (followed user AND followed tag) exactly once.
 *
 * We exercise the same query shape `queryFeed` builds (the JSON `tags` array
 * matched per followed tag via json_each, OR the followed-user IN subquery,
 * minus the blocked-user filter) against an in-memory libsql DB so the logic is
 * verified without standing up the whole platform DB.
 */
describe("Following-feed scope: followed users OR followed tags", () => {
  let db: Client;
  const VIEWER = "viewer";

  beforeAll(async () => {
    db = createClient({ url: ":memory:" });
    await db.execute(
      `CREATE TABLE posts (id TEXT PRIMARY KEY, user_id TEXT, tags TEXT, created_at TEXT)`
    );
    await db.execute(`CREATE TABLE follows (follower_id TEXT, following_id TEXT)`);
    await db.execute(`CREATE TABLE followed_tags (user_id TEXT, tag TEXT)`);
    await db.execute(`CREATE TABLE blocks (blocker_id TEXT, blocked_id TEXT)`);

    // viewer follows user "alice" and the tag "options".
    await db.execute(`INSERT INTO follows VALUES ('viewer','alice')`);
    await db.execute(`INSERT INTO followed_tags VALUES ('viewer','options')`);
    // viewer has blocked "mallory".
    await db.execute(`INSERT INTO blocks VALUES ('viewer','mallory')`);

    // p1: by alice (followed user), no followed tag.
    await db.execute(
      `INSERT INTO posts VALUES ('p1','alice','["nifty"]','2026-06-13T10:00:00.000Z')`
    );
    // p2: by bob (NOT followed), carries #options (followed tag).
    await db.execute(
      `INSERT INTO posts VALUES ('p2','bob','["options","scalp"]','2026-06-13T11:00:00.000Z')`
    );
    // p3: by alice (followed user) AND carries #options (followed tag) — must appear ONCE.
    await db.execute(
      `INSERT INTO posts VALUES ('p3','alice','["options"]','2026-06-13T12:00:00.000Z')`
    );
    // p4: by carol (NOT followed), no followed tag — must NOT appear.
    await db.execute(
      `INSERT INTO posts VALUES ('p4','carol','["futures"]','2026-06-13T13:00:00.000Z')`
    );
    // p5: by mallory (blocked) carrying #options — blocked author wins, must NOT appear.
    await db.execute(
      `INSERT INTO posts VALUES ('p5','mallory','["options"]','2026-06-13T14:00:00.000Z')`
    );
  });

  afterAll(() => db.close());

  const followingFeed = async () => {
    const res = await db.execute({
      sql: `SELECT id FROM posts
            WHERE user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
              AND (
                user_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
                OR EXISTS (
                  SELECT 1 FROM followed_tags ft
                  WHERE ft.user_id = ?
                    AND EXISTS (SELECT 1 FROM json_each(posts.tags) je WHERE je.value = ft.tag)
                )
              )
            ORDER BY created_at DESC`,
      args: [VIEWER, VIEWER, VIEWER],
    });
    return res.rows.map((r) => String(r.id));
  };

  it("includes posts by followed users and posts with followed tags", async () => {
    const ids = await followingFeed();
    expect(ids).toContain("p1"); // followed user
    expect(ids).toContain("p2"); // followed tag (unfollowed author)
    expect(ids).toContain("p3"); // both
  });

  it("excludes posts that match neither", async () => {
    expect(await followingFeed()).not.toContain("p4");
  });

  it("excludes blocked authors even when they carry a followed tag", async () => {
    expect(await followingFeed()).not.toContain("p5");
  });

  it("returns a post matching BOTH a followed user and a followed tag exactly once", async () => {
    const ids = await followingFeed();
    expect(ids.filter((id) => id === "p3")).toHaveLength(1);
    // newest-first ordering is preserved across the union.
    expect(ids).toEqual(["p3", "p2", "p1"]);
  });
});

/** followed_tags upsert/remove behaves as an idempotent (user, tag) toggle. */
describe("followed_tags upsert/remove", () => {
  let db: Client;
  beforeAll(async () => {
    db = createClient({ url: ":memory:" });
    await db.execute(
      `CREATE TABLE followed_tags (user_id TEXT, tag TEXT, created_at TEXT, PRIMARY KEY (user_id, tag))`
    );
  });
  afterAll(() => db.close());

  const count = async (user: string) => {
    const r = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM followed_tags WHERE user_id = ?`,
      args: [user],
    });
    return Number(r.rows[0]!.n);
  };

  it("inserts a follow, is idempotent, and removes on unfollow", async () => {
    await db.execute(`INSERT OR IGNORE INTO followed_tags VALUES ('u1','options','t')`);
    expect(await count("u1")).toBe(1);
    // Re-inserting the same (user, tag) is a no-op (PK conflict ignored).
    await db.execute(`INSERT OR IGNORE INTO followed_tags VALUES ('u1','options','t2')`);
    expect(await count("u1")).toBe(1);
    // Unfollow.
    await db.execute(`DELETE FROM followed_tags WHERE user_id='u1' AND tag='options'`);
    expect(await count("u1")).toBe(0);
  });
});
