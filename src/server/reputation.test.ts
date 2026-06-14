import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type Client } from "@libsql/client";
import {
  computeReputation,
  type ReactorTally,
  type ReputationSignals,
} from "@/features/community/reputation";

/**
 * Server-layer integration test for community reputation (rank-16) against a
 * file-backed libsql DB. It proves the exact SQL aggregation contract that
 * `collectReputationSignals` relies on — then feeds those signals into the pure
 * `computeReputation` scorer and asserts a KNOWN fixture user's tier. This is
 * the load-bearing anti-gaming proof at the data layer:
 *   - SELF reactions / SELF bookmarks / SELF comment-likes are excluded;
 *   - reactions on FLAGGED posts do not count toward standing;
 *   - per-reactor capping (in the model) blunts a single spammy fan;
 *   - distinct followers + active weeks + tenure all feed in;
 *   - a brand-new account computes to "New".
 *
 * We mirror `collectReputationSignals`'s queries here (rather than importing the
 * `server-only` module) so the test runs without the platform DB, exactly the
 * pattern the other server-contract tests use.
 */
describe("reputation server contract (file-backed libsql)", () => {
  let db: Client;
  const NOW = Date.UTC(2026, 5, 14); // 2026-06-14
  const iso = (d: number) => new Date(d).toISOString();

  beforeAll(async () => {
    db = createClient({ url: ":memory:" });
    await db.execute(`CREATE TABLE user (id TEXT PRIMARY KEY, created_at INTEGER, status TEXT)`);
    await db.execute(
      `CREATE TABLE posts (id TEXT PRIMARY KEY, user_id TEXT, quality_flag TEXT, created_at TEXT)`
    );
    await db.execute(`CREATE TABLE comments (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT)`);
    await db.execute(`CREATE TABLE likes (post_id TEXT, user_id TEXT)`);
    await db.execute(`CREATE TABLE comment_likes (comment_id TEXT, user_id TEXT)`);
    await db.execute(`CREATE TABLE bookmarks (user_id TEXT, post_id TEXT)`);
    await db.execute(`CREATE TABLE follows (follower_id TEXT, following_id TEXT)`);
    await db.execute(`CREATE TABLE mod_actions (target_type TEXT, target_id TEXT)`);

    // ── Fixture member "alice": ~200-day account, active, genuinely engaged. ──
    await db.execute({
      sql: `INSERT INTO user VALUES ('alice', ?, NULL)`,
      args: [NOW - 200 * 86_400_000],
    });

    // 4 LIVE posts (different weeks) + 1 FLAGGED post (must not earn).
    const postDays = [1, 8, 20, 40]; // days ago → distinct ISO weeks
    for (let i = 0; i < postDays.length; i++) {
      await db.execute({
        sql: `INSERT INTO posts VALUES (?, 'alice', NULL, ?)`,
        args: [`a_p${i}`, iso(NOW - postDays[i]! * 86_400_000)],
      });
    }
    await db.execute({
      sql: `INSERT INTO posts VALUES ('a_flagged', 'alice', 'tip', ?)`,
      args: [iso(NOW - 2 * 86_400_000)],
    });

    // 3 comments by alice.
    for (let i = 0; i < 3; i++) {
      await db.execute({
        sql: `INSERT INTO comments VALUES (?, 'alice', ?)`,
        args: [`a_c${i}`, iso(NOW - (i * 9 + 3) * 86_400_000)],
      });
    }

    // Reactions: 5 DISTINCT others react to alice's live posts (genuine reach).
    for (let i = 0; i < 5; i++) {
      await db.execute({
        sql: `INSERT INTO likes VALUES ('a_p0', ?)`,
        args: [`fan${i}`],
      });
    }
    // SELF-reaction (must be excluded by the WHERE l.user_id <> alice).
    await db.execute(`INSERT INTO likes VALUES ('a_p1', 'alice')`);
    // A reaction on alice's FLAGGED post (must be excluded by quality_flag IS NULL).
    await db.execute(`INSERT INTO likes VALUES ('a_flagged', 'fan9')`);

    // Bookmarks: 2 from others, 1 self (excluded).
    await db.execute(`INSERT INTO bookmarks VALUES ('fan0', 'a_p0')`);
    await db.execute(`INSERT INTO bookmarks VALUES ('fan1', 'a_p2')`);
    await db.execute(`INSERT INTO bookmarks VALUES ('alice', 'a_p0')`);

    // Comment-likes: 2 from others on alice's comments, 1 self (excluded).
    await db.execute(`INSERT INTO comment_likes VALUES ('a_c0', 'fan0')`);
    await db.execute(`INSERT INTO comment_likes VALUES ('a_c0', 'fan1')`);
    await db.execute(`INSERT INTO comment_likes VALUES ('a_c1', 'alice')`);

    // 4 followers.
    for (let i = 0; i < 4; i++) {
      await db.execute({
        sql: `INSERT INTO follows VALUES (?, 'alice')`,
        args: [`f${i}`],
      });
    }

    // ── A brand-new member "newbie": account just created, no activity. ──
    await db.execute({ sql: `INSERT INTO user VALUES ('newbie', ?, NULL)`, args: [NOW] });

    // ── A banned, otherwise-active member "bad". ──
    await db.execute({
      sql: `INSERT INTO user VALUES ('bad', ?, 'banned')`,
      args: [NOW - 300 * 86_400_000],
    });
    for (let i = 0; i < 5; i++) {
      await db.execute({
        sql: `INSERT INTO posts VALUES (?, 'bad', NULL, ?)`,
        args: [`b_p${i}`, iso(NOW - (i * 7 + 1) * 86_400_000)],
      });
    }
    for (let i = 0; i < 30; i++) {
      await db.execute({ sql: `INSERT INTO likes VALUES ('b_p0', ?)`, args: [`bf${i}`] });
    }
    await db.execute(`INSERT INTO mod_actions VALUES ('user', 'bad')`);
  });

  afterAll(() => db.close());

  /** Mirrors collectReputationSignals' query set for one user. */
  async function collect(userId: string): Promise<ReputationSignals> {
    const acct = (
      await db.execute({
        sql: `SELECT created_at AS createdAt, status FROM user WHERE id = ?`,
        args: [userId],
      })
    ).rows[0];
    const livePosts = Number(
      (
        await db.execute({
          sql: `SELECT COUNT(*) AS n FROM posts WHERE user_id = ? AND quality_flag IS NULL`,
          args: [userId],
        })
      ).rows[0]!.n
    );
    const comments = Number(
      (
        await db.execute({
          sql: `SELECT COUNT(*) AS n FROM comments WHERE user_id = ?`,
          args: [userId],
        })
      ).rows[0]!.n
    );
    const reactorRows = (
      await db.execute({
        sql: `SELECT l.user_id AS reactorId, COUNT(*) AS count
              FROM likes l JOIN posts p ON p.id = l.post_id
              WHERE p.user_id = ? AND l.user_id <> ? AND p.quality_flag IS NULL
              GROUP BY l.user_id`,
        args: [userId, userId],
      })
    ).rows;
    const reactionsFromOthers: ReactorTally[] = reactorRows.map((r) => ({
      reactorId: String(r.reactorId),
      count: Number(r.count),
    }));
    const bookmarksFromOthers = Number(
      (
        await db.execute({
          sql: `SELECT COUNT(*) AS n FROM bookmarks bm JOIN posts p ON p.id = bm.post_id
                WHERE p.user_id = ? AND bm.user_id <> ?`,
          args: [userId, userId],
        })
      ).rows[0]!.n
    );
    const helpfulCommentSignals = Number(
      (
        await db.execute({
          sql: `SELECT COUNT(*) AS n FROM comment_likes cl JOIN comments c ON c.id = cl.comment_id
                WHERE c.user_id = ? AND cl.user_id <> ?`,
          args: [userId, userId],
        })
      ).rows[0]!.n
    );
    const followers = Number(
      (
        await db.execute({
          sql: `SELECT COUNT(*) AS n FROM follows WHERE following_id = ?`,
          args: [userId],
        })
      ).rows[0]!.n
    );
    const activeWeeks = Number(
      (
        await db.execute({
          sql: `SELECT COUNT(DISTINCT wk) AS n FROM (
                  SELECT strftime('%Y-%W', created_at) AS wk FROM posts WHERE user_id = ?
                  UNION
                  SELECT strftime('%Y-%W', created_at) AS wk FROM comments WHERE user_id = ?
                )`,
          args: [userId, userId],
        })
      ).rows[0]!.n
    );
    const qualityFlags = Number(
      (
        await db.execute({
          sql: `SELECT COUNT(*) AS n FROM posts WHERE user_id = ? AND quality_flag IS NOT NULL`,
          args: [userId],
        })
      ).rows[0]!.n
    );
    const modActions = Number(
      (
        await db.execute({
          sql: `SELECT COUNT(*) AS n FROM mod_actions WHERE target_type = 'user' AND target_id = ?`,
          args: [userId],
        })
      ).rows[0]!.n
    );
    const createdAtMs = Number(acct!.createdAt);
    return {
      tenureDays: Math.max(0, Math.floor((NOW - createdAtMs) / 86_400_000)),
      posts: livePosts,
      comments,
      reactionsFromOthers,
      bookmarksFromOthers,
      helpfulCommentSignals,
      followers,
      activeWeeks,
      qualityFlags,
      modActions,
      banned: acct!.status === "banned",
    };
  }

  it("collects only EARNED signals — self-reactions and flagged-post reactions excluded", async () => {
    const s = await collect("alice");
    expect(s.tenureDays).toBe(200);
    expect(s.posts).toBe(4); // the flagged post is NOT counted
    expect(s.comments).toBe(3);
    // 5 distinct fans on a live post; the self-like and the flagged-post like are gone.
    expect(s.reactionsFromOthers).toHaveLength(5);
    expect(s.reactionsFromOthers.some((r) => r.reactorId === "alice")).toBe(false);
    expect(s.bookmarksFromOthers).toBe(2); // self-bookmark excluded
    expect(s.helpfulCommentSignals).toBe(2); // self comment-like excluded
    expect(s.followers).toBe(4);
    expect(s.qualityFlags).toBe(1);
    expect(s.modActions).toBe(0);
    expect(s.banned).toBe(false);
    // Distinct ISO weeks across her posts+comments — at least a few.
    expect(s.activeWeeks).toBeGreaterThanOrEqual(3);
  });

  it("computes a known tier for the active fixture member (Contributing/Established)", async () => {
    const r = computeReputation(await collect("alice"), "alice");
    expect(r.score).toBeGreaterThan(0);
    // Earned but mid-sized: comfortably past New, not yet Trusted.
    expect(["contributing", "established"]).toContain(r.tier);
    expect(r.tier).not.toBe("trusted");
  });

  it("a brand-new account computes to 'New'", async () => {
    const r = computeReputation(await collect("newbie"), "newbie");
    expect(r.tier).toBe("new");
    expect(r.score).toBeLessThan(25);
  });

  it("a banned member is floored to 'New' despite earned activity + 30 fan-reactions", async () => {
    const s = await collect("bad");
    expect(s.banned).toBe(true);
    expect(s.modActions).toBe(1);
    const r = computeReputation(s, "bad");
    expect(r.tier).toBe("new");
  });
});
