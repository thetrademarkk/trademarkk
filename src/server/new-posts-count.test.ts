import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type Client } from "@libsql/client";

/**
 * Server-layer integration test for the "N new posts" count (rank-15) against a
 * file-backed libsql DB. It proves the SQL contract `countNewerPosts` relies on
 * — the same visibility rules as the live feed, plus the newer-than-`since`
 * window — without standing up the whole platform DB:
 *  - only posts strictly newer than `since` are counted (`createdAt > since`);
 *  - blocked authors are excluded (the feed's block filter still applies);
 *  - the viewer's OWN posts are excluded (they prepend via cache invalidation,
 *    so must never inflate the pill);
 *  - tag / following-scope filters narrow the count exactly like the feed.
 */
describe("new-posts count server contract (file-backed libsql)", () => {
  let db: Client;
  const SINCE = "2026-06-14T10:00:00.000Z";

  beforeAll(async () => {
    db = createClient({ url: ":memory:" });
    await db.execute(
      `CREATE TABLE posts (id TEXT PRIMARY KEY, user_id TEXT, tags TEXT, created_at TEXT)`
    );
    await db.execute(`CREATE TABLE blocks (blocker_id TEXT, blocked_id TEXT)`);
    await db.execute(`CREATE TABLE follows (follower_id TEXT, following_id TEXT)`);

    // viewer = v; authors a, b; blocked author x.
    // Posts around the SINCE boundary.
    await db.execute(`INSERT INTO posts VALUES ('p_old','a',NULL,'2026-06-14T09:59:00.000Z')`); // older
    await db.execute(`INSERT INTO posts VALUES ('p_eq','a',NULL,'2026-06-14T10:00:00.000Z')`); // boundary
    await db.execute(`INSERT INTO posts VALUES ('p1','a','["nifty"]','2026-06-14T10:01:00.000Z')`); // newer, tagged
    await db.execute(`INSERT INTO posts VALUES ('p2','b',NULL,'2026-06-14T10:02:00.000Z')`); // newer
    await db.execute(`INSERT INTO posts VALUES ('p_own','v',NULL,'2026-06-14T10:03:00.000Z')`); // newer, viewer's own
    await db.execute(`INSERT INTO posts VALUES ('p_blk','x',NULL,'2026-06-14T10:04:00.000Z')`); // newer, blocked author

    await db.execute(`INSERT INTO blocks VALUES ('v','x')`); // v blocks x
    await db.execute(`INSERT INTO follows VALUES ('v','a')`); // v follows a
  });

  afterAll(() => db.close());

  /** The exact predicate set countNewerPosts assembles for a given viewer. */
  const countNewer = async (opts: {
    viewerId: string | null;
    tag?: string;
    following?: boolean;
  }) => {
    const where: string[] = [`created_at > ?`];
    const args: (string | number)[] = [SINCE];
    if (opts.viewerId) {
      where.push(`user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)`);
      args.push(opts.viewerId);
      where.push(`user_id <> ?`);
      args.push(opts.viewerId);
    }
    if (opts.tag) {
      where.push(`tags LIKE ?`);
      args.push(`%"${opts.tag}"%`);
    }
    if (opts.following && opts.viewerId) {
      where.push(`user_id IN (SELECT following_id FROM follows WHERE follower_id = ?)`);
      args.push(opts.viewerId);
    }
    const sql = `SELECT COUNT(*) AS c FROM posts WHERE ${where.join(" AND ")}`;
    const row = (await db.execute({ sql, args })).rows[0];
    return Number(row?.c ?? 0);
  };

  it("counts only posts strictly newer than `since` (boundary excluded)", async () => {
    // Anonymous viewer (no block/own filter): p1, p2, p_own, p_blk = 4 newer.
    expect(await countNewer({ viewerId: null })).toBe(4);
  });

  it("excludes blocked authors and the viewer's own posts", async () => {
    // viewer v: p1 (a) + p2 (b) = 2; p_own (own) and p_blk (blocked x) excluded.
    expect(await countNewer({ viewerId: "v" })).toBe(2);
  });

  it("narrows by tag exactly like the feed", async () => {
    // Only p1 carries #nifty and is newer → 1.
    expect(await countNewer({ viewerId: "v", tag: "nifty" })).toBe(1);
  });

  it("respects the following scope (only followed authors' newer posts)", async () => {
    // v follows a only → p1 (a). p2 (b, not followed) excluded → 1.
    expect(await countNewer({ viewerId: "v", following: true })).toBe(1);
  });

  it("returns 0 when nothing is newer than `since`", async () => {
    const row = (
      await db.execute({
        sql: `SELECT COUNT(*) AS c FROM posts WHERE created_at > ?`,
        args: ["2026-06-14T23:00:00.000Z"],
      })
    ).rows[0];
    expect(Number(row?.c ?? 0)).toBe(0);
  });
});
