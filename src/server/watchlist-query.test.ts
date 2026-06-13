import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type Client } from "@libsql/client";

/**
 * Integration test for the Watchlist-feed scope SQL: it must return posts that
 * TAG a watched symbol (via the post_symbols join) OR are BY a followed author,
 * exclude blocked users, and return a post that matches BOTH (watched symbol AND
 * followed author) exactly once.
 *
 * We exercise the same query shape `queryFeed` builds (the correlated EXISTS
 * over post_symbols joined to watched_symbols, OR the followed-author IN
 * subquery, minus the blocked-user filter) against an in-memory libsql DB so the
 * logic is verified without standing up the whole platform DB. This mirrors the
 * rank-8 Following-scope union test, on the symbol axis.
 */
describe("Watchlist-feed scope: watched symbols OR followed authors", () => {
  let db: Client;
  const VIEWER = "viewer";

  beforeAll(async () => {
    db = createClient({ url: ":memory:" });
    await db.execute(`CREATE TABLE posts (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT)`);
    await db.execute(`CREATE TABLE post_symbols (post_id TEXT, symbol TEXT)`);
    await db.execute(`CREATE TABLE follows (follower_id TEXT, following_id TEXT)`);
    await db.execute(`CREATE TABLE watched_symbols (user_id TEXT, symbol TEXT)`);
    await db.execute(`CREATE TABLE blocks (blocker_id TEXT, blocked_id TEXT)`);

    // viewer follows author "alice" and watches the symbol "NIFTY".
    await db.execute(`INSERT INTO follows VALUES ('viewer','alice')`);
    await db.execute(`INSERT INTO watched_symbols VALUES ('viewer','NIFTY')`);
    // viewer has blocked "mallory".
    await db.execute(`INSERT INTO blocks VALUES ('viewer','mallory')`);

    // p1: by alice (followed author), tags $RELIANCE (NOT watched).
    await db.execute(`INSERT INTO posts VALUES ('p1','alice','2026-06-14T10:00:00.000Z')`);
    await db.execute(`INSERT INTO post_symbols VALUES ('p1','RELIANCE')`);
    // p2: by bob (NOT followed), tags $NIFTY (watched) — stranger's watched post.
    await db.execute(`INSERT INTO posts VALUES ('p2','bob','2026-06-14T11:00:00.000Z')`);
    await db.execute(`INSERT INTO post_symbols VALUES ('p2','NIFTY')`);
    // p3: by alice (followed) AND tags $NIFTY (watched) — must appear ONCE.
    await db.execute(`INSERT INTO posts VALUES ('p3','alice','2026-06-14T12:00:00.000Z')`);
    await db.execute(`INSERT INTO post_symbols VALUES ('p3','NIFTY')`);
    // p4: by carol (NOT followed), tags $TCS (NOT watched) — must NOT appear.
    await db.execute(`INSERT INTO posts VALUES ('p4','carol','2026-06-14T13:00:00.000Z')`);
    await db.execute(`INSERT INTO post_symbols VALUES ('p4','TCS')`);
    // p5: by mallory (blocked) tagging $NIFTY (watched) — blocked author wins.
    await db.execute(`INSERT INTO posts VALUES ('p5','mallory','2026-06-14T14:00:00.000Z')`);
    await db.execute(`INSERT INTO post_symbols VALUES ('p5','NIFTY')`);
  });

  afterAll(() => db.close());

  const watchlistFeed = async () => {
    const res = await db.execute({
      sql: `SELECT id FROM posts
            WHERE user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
              AND (
                user_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
                OR EXISTS (
                  SELECT 1 FROM post_symbols ps
                  JOIN watched_symbols ws ON ws.symbol = ps.symbol
                  WHERE ps.post_id = posts.id AND ws.user_id = ?
                )
              )
            ORDER BY created_at DESC`,
      args: [VIEWER, VIEWER, VIEWER],
    });
    return res.rows.map((r) => String(r.id));
  };

  it("includes posts by followed authors and posts tagging a watched symbol", async () => {
    const ids = await watchlistFeed();
    expect(ids).toContain("p1"); // followed author (untagged-by-watched)
    expect(ids).toContain("p2"); // watched symbol by a stranger
    expect(ids).toContain("p3"); // both
  });

  it("excludes posts that match neither", async () => {
    expect(await watchlistFeed()).not.toContain("p4");
  });

  it("excludes blocked authors even when they tag a watched symbol", async () => {
    expect(await watchlistFeed()).not.toContain("p5");
  });

  it("returns a post matching BOTH a watched symbol and a followed author exactly once", async () => {
    const ids = await watchlistFeed();
    expect(ids.filter((id) => id === "p3")).toHaveLength(1);
    // newest-first ordering is preserved across the union.
    expect(ids).toEqual(["p3", "p2", "p1"]);
  });

  it("empty watchlist with no follows yields nothing (honest empty state)", async () => {
    const res = await db.execute({
      sql: `SELECT id FROM posts
            WHERE user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
              AND (
                user_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
                OR EXISTS (
                  SELECT 1 FROM post_symbols ps
                  JOIN watched_symbols ws ON ws.symbol = ps.symbol
                  WHERE ps.post_id = posts.id AND ws.user_id = ?
                )
              )`,
      // A user who follows no one and watches nothing.
      args: ["nobody", "nobody", "nobody"],
    });
    expect(res.rows).toHaveLength(0);
  });

  it("an empty watchlist still surfaces the viewer's OWN-followed authors' posts", async () => {
    // A viewer who watches nothing but follows alice still sees alice's posts —
    // the union degrades gracefully to the Following set, never to nothing.
    const res = await db.execute({
      sql: `SELECT id FROM posts
            WHERE user_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
              OR EXISTS (
                SELECT 1 FROM post_symbols ps
                JOIN watched_symbols ws ON ws.symbol = ps.symbol
                WHERE ps.post_id = posts.id AND ws.user_id = ?
              )
            ORDER BY created_at DESC`,
      args: ["onlyfollows", "onlyfollows"],
    });
    // onlyfollows follows alice but watches nothing.
    await db.execute(`INSERT INTO follows VALUES ('onlyfollows','alice')`);
    const res2 = await db.execute({
      sql: `SELECT id FROM posts
            WHERE user_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
              OR EXISTS (
                SELECT 1 FROM post_symbols ps
                JOIN watched_symbols ws ON ws.symbol = ps.symbol
                WHERE ps.post_id = posts.id AND ws.user_id = ?
              )
            ORDER BY created_at DESC`,
      args: ["onlyfollows", "onlyfollows"],
    });
    expect(res.rows).toHaveLength(0); // before the follow row existed
    const ids2 = res2.rows.map((r) => String(r.id));
    expect(ids2).toEqual(["p3", "p1"]); // both of alice's posts, no watched-only posts
  });
});

/** watched_symbols upsert/remove behaves as an idempotent (user, symbol) toggle. */
describe("watched_symbols upsert/remove", () => {
  let db: Client;
  beforeAll(async () => {
    db = createClient({ url: ":memory:" });
    await db.execute(
      `CREATE TABLE watched_symbols (user_id TEXT, symbol TEXT, created_at TEXT, PRIMARY KEY (user_id, symbol))`
    );
  });
  afterAll(() => db.close());

  const count = async (user: string) => {
    const r = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM watched_symbols WHERE user_id = ?`,
      args: [user],
    });
    return Number(r.rows[0]!.n);
  };

  it("inserts a watch, is idempotent, and removes on unwatch", async () => {
    await db.execute(`INSERT OR IGNORE INTO watched_symbols VALUES ('u1','NIFTY','t')`);
    expect(await count("u1")).toBe(1);
    // Re-inserting the same (user, symbol) is a no-op (PK conflict ignored).
    await db.execute(`INSERT OR IGNORE INTO watched_symbols VALUES ('u1','NIFTY','t2')`);
    expect(await count("u1")).toBe(1);
    // Unwatch.
    await db.execute(`DELETE FROM watched_symbols WHERE user_id='u1' AND symbol='NIFTY'`);
    expect(await count("u1")).toBe(0);
  });
});
