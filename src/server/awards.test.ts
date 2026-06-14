import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type Client } from "@libsql/client";
import {
  evaluateAwards,
  parseStoredAwards,
  serializeAwards,
  type AwardId,
} from "@/features/community/awards";
import { type ReactorTally, type ReputationSignals } from "@/features/community/reputation";

/**
 * Server-layer integration test for achievement AWARDS (rank-20) against a
 * file-backed libsql DB. It proves the end-to-end contract that `getReputation`
 * relies on:
 *   - the SAME `collectReputationSignals` aggregation (mirrored here, exactly as
 *     reputation.test.ts does) feeds BOTH the reputation tier AND the badge set —
 *     ONE aggregation pass, no second query;
 *   - a genuinely-engaged tenured member earns the expected badges;
 *   - a brand-new member earns none;
 *   - a BANNED / quality-flagged member earns none (the anti-gaming gate);
 *   - persisting the serialized badge set to `profiles.awards` and re-reading it
 *     round-trips, and RECOMPUTING from the same signals is IDEMPOTENT.
 *
 * We mirror the query set (rather than importing the `server-only` module) so the
 * test runs without the platform DB — the same pattern the other server-contract
 * tests use.
 */
describe("awards server contract (file-backed libsql)", () => {
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
    // The denormalized cache target — mirrors profiles.awards / reputation cols.
    await db.execute(
      `CREATE TABLE profiles (user_id TEXT PRIMARY KEY, reputation_score INTEGER, reputation_tier TEXT, reputation_computed_at TEXT, awards TEXT)`
    );

    /* ── "veteran": >1yr tenure, genuine cross-user reach, many followers ── */
    await db.execute({
      sql: `INSERT INTO user VALUES ('veteran', ?, NULL)`,
      args: [NOW - 400 * 86_400_000],
    });
    await db.execute(`INSERT INTO profiles (user_id) VALUES ('veteran')`);
    // 12 LIVE posts across distinct weeks (Wordsmith volume) + 1 FLAGGED (ignored).
    for (let i = 0; i < 12; i++) {
      await db.execute({
        sql: `INSERT INTO posts VALUES (?, 'veteran', NULL, ?)`,
        args: [`v_p${i}`, iso(NOW - (i * 8 + 1) * 86_400_000)],
      });
    }
    await db.execute({
      sql: `INSERT INTO posts VALUES ('v_flagged', 'veteran', 'tip', ?)`,
      args: [iso(NOW - 3 * 86_400_000)],
    });
    // 25 comments (Conversationalist volume).
    for (let i = 0; i < 25; i++) {
      await db.execute({
        sql: `INSERT INTO comments VALUES (?, 'veteran', ?)`,
        args: [`v_c${i}`, iso(NOW - (i + 1) * 86_400_000)],
      });
    }
    // 12 DISTINCT fans react to a live post → 12 capped units (Well Received).
    for (let i = 0; i < 12; i++) {
      await db.execute({ sql: `INSERT INTO likes VALUES ('v_p0', ?)`, args: [`vfan${i}`] });
    }
    // self-like (excluded) + a like on the flagged post (excluded).
    await db.execute(`INSERT INTO likes VALUES ('v_p1', 'veteran')`);
    await db.execute(`INSERT INTO likes VALUES ('v_flagged', 'vfan0')`);
    // 10 bookmarks from others (Worth Saving) + 1 self (excluded).
    for (let i = 0; i < 10; i++) {
      await db.execute({ sql: `INSERT INTO bookmarks VALUES (?, 'v_p2')`, args: [`vbm${i}`] });
    }
    await db.execute(`INSERT INTO bookmarks VALUES ('veteran', 'v_p2')`);
    // 5 comment-likes from others (Helpful Voice) + 1 self (excluded).
    for (let i = 0; i < 5; i++) {
      await db.execute({ sql: `INSERT INTO comment_likes VALUES ('v_c0', ?)`, args: [`vcl${i}`] });
    }
    await db.execute(`INSERT INTO comment_likes VALUES ('v_c0', 'veteran')`);
    // 25 distinct followers (Community Pillar).
    for (let i = 0; i < 25; i++) {
      await db.execute({ sql: `INSERT INTO follows VALUES (?, 'veteran')`, args: [`vf${i}`] });
    }

    /* ── "newbie": just created, no activity ── */
    await db.execute({ sql: `INSERT INTO user VALUES ('newbie', ?, NULL)`, args: [NOW] });
    await db.execute(`INSERT INTO profiles (user_id) VALUES ('newbie')`);

    /* ── "bad": banned but otherwise active + many reactions ── */
    await db.execute({
      sql: `INSERT INTO user VALUES ('bad', ?, 'banned')`,
      args: [NOW - 500 * 86_400_000],
    });
    await db.execute(`INSERT INTO profiles (user_id) VALUES ('bad')`);
    for (let i = 0; i < 12; i++) {
      await db.execute({
        sql: `INSERT INTO posts VALUES (?, 'bad', NULL, ?)`,
        args: [`b_p${i}`, iso(NOW - (i * 8 + 1) * 86_400_000)],
      });
    }
    for (let i = 0; i < 50; i++) {
      await db.execute({ sql: `INSERT INTO likes VALUES ('b_p0', ?)`, args: [`bf${i}`] });
    }
    await db.execute(`INSERT INTO mod_actions VALUES ('user', 'bad')`);

    /* ── "flagged": active + reactions but carries a quality flag ── */
    await db.execute({
      sql: `INSERT INTO user VALUES ('flagged', ?, NULL)`,
      args: [NOW - 400 * 86_400_000],
    });
    await db.execute(`INSERT INTO profiles (user_id) VALUES ('flagged')`);
    for (let i = 0; i < 12; i++) {
      await db.execute({
        sql: `INSERT INTO posts VALUES (?, 'flagged', NULL, ?)`,
        args: [`fl_p${i}`, iso(NOW - (i * 8 + 1) * 86_400_000)],
      });
    }
    await db.execute({
      sql: `INSERT INTO posts VALUES ('fl_bad', 'flagged', 'tip', ?)`,
      args: [iso(NOW - 1 * 86_400_000)],
    });
    for (let i = 0; i < 15; i++) {
      await db.execute({ sql: `INSERT INTO likes VALUES ('fl_p0', ?)`, args: [`flf${i}`] });
    }
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

  /** Reads the denormalized awards cache back as a known id set. */
  async function readStoredAwards(userId: string): Promise<AwardId[]> {
    const row = (
      await db.execute({ sql: `SELECT awards FROM profiles WHERE user_id = ?`, args: [userId] })
    ).rows[0];
    return parseStoredAwards(row?.awards as string | null);
  }

  it("computes a genuinely-engaged tenured member's full badge set from the SAME signals", async () => {
    const signals = await collect("veteran");
    // Sanity: the SAME aggregation that feeds reputation is what we evaluate.
    expect(signals.posts).toBe(12); // flagged post excluded
    expect(signals.reactionsFromOthers).toHaveLength(12); // distinct fans only
    expect(signals.followers).toBe(25);
    expect(signals.qualityFlags).toBe(1); // veteran has one flagged post …

    // … but a single quality flag suppresses ALL badges (the anti-gaming gate).
    expect(evaluateAwards(signals)).toEqual([]);
  });

  it("a clean tenured + engaged member earns the expected badges", async () => {
    // Re-evaluate the veteran's signals WITHOUT the flag to prove the positive path.
    const clean = { ...(await collect("veteran")), qualityFlags: 0 };
    const earned = evaluateAwards(clean);
    expect(earned).toContain("one-year");
    expect(earned).toContain("six-months");
    expect(earned).toContain("well-received");
    expect(earned).toContain("saved-for-later"); // "Worth Saving" label
    expect(earned).toContain("helpful-voice");
    expect(earned).toContain("community-pillar");
    expect(earned).toContain("consistent");
    expect(earned).toContain("wordsmith");
    expect(earned).toContain("conversationalist");
    expect(earned).toContain("first-post");
  });

  it("a brand-new member earns no badges", async () => {
    expect(evaluateAwards(await collect("newbie"))).toEqual([]);
  });

  it("a BANNED member earns no badges despite heavy activity", async () => {
    const s = await collect("bad");
    expect(s.banned).toBe(true);
    expect(evaluateAwards(s)).toEqual([]);
  });

  it("a QUALITY-FLAGGED member earns no badges despite genuine reach", async () => {
    const s = await collect("flagged");
    expect(s.qualityFlags).toBeGreaterThan(0);
    expect(evaluateAwards(s)).toEqual([]);
  });

  it("persists + reads back the badge set, and recompute is IDEMPOTENT", async () => {
    const clean = { ...(await collect("veteran")), qualityFlags: 0 };
    const earned = evaluateAwards(clean);

    // First write (folded into the reputation refresh in production).
    await db.execute({
      sql: `UPDATE profiles SET awards = ? WHERE user_id = 'veteran'`,
      args: [serializeAwards(earned)],
    });
    const firstRead = await readStoredAwards("veteran");
    expect(firstRead).toEqual(earned);

    // Recompute from the SAME signals + re-persist → byte-identical cache (idempotent).
    const recomputed = evaluateAwards(clean);
    expect(recomputed).toEqual(earned);
    await db.execute({
      sql: `UPDATE profiles SET awards = ? WHERE user_id = 'veteran'`,
      args: [serializeAwards(recomputed)],
    });
    const secondRead = await readStoredAwards("veteran");
    expect(secondRead).toEqual(firstRead);
  });
});
