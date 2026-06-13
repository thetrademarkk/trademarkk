import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type Client } from "@libsql/client";
import {
  buildInterestProfile,
  rankForYou,
  scoreCandidate,
  type ForYouCandidate,
} from "@/features/community/foryou";

/**
 * Integration test for the For-You feed's data layer: it exercises the same SQL
 * shapes `buildViewerInterestProfile` + `queryForYou` build (the engaged-post
 * UNION, the 2nd-degree follows JOIN, the block-aware/own-excluded candidate
 * scan) against an in-memory libsql DB, then feeds the rows through the PURE
 * scorer to assert the end-to-end ranking — without standing up the platform DB.
 */
describe("For-You data layer (engaged signals + 2nd-degree + candidate scan)", () => {
  let db: Client;
  const VIEWER = "viewer";

  beforeAll(async () => {
    db = createClient({ url: ":memory:" });
    await db.execute(
      `CREATE TABLE posts (id TEXT PRIMARY KEY, user_id TEXT, body TEXT, tags TEXT, quote_post_id TEXT, created_at TEXT)`
    );
    await db.execute(`CREATE TABLE post_symbols (post_id TEXT, symbol TEXT)`);
    await db.execute(`CREATE TABLE follows (follower_id TEXT, following_id TEXT)`);
    await db.execute(`CREATE TABLE followed_tags (user_id TEXT, tag TEXT)`);
    await db.execute(`CREATE TABLE watched_symbols (user_id TEXT, symbol TEXT)`);
    await db.execute(`CREATE TABLE likes (post_id TEXT, user_id TEXT, created_at TEXT)`);
    await db.execute(`CREATE TABLE bookmarks (post_id TEXT, user_id TEXT, created_at TEXT)`);
    await db.execute(`CREATE TABLE blocks (blocker_id TEXT, blocked_id TEXT)`);

    // ── viewer's explicit signals ──
    await db.execute(`INSERT INTO follows VALUES ('viewer','alice')`); // 1st-degree
    await db.execute(`INSERT INTO followed_tags VALUES ('viewer','options')`);
    await db.execute(`INSERT INTO watched_symbols VALUES ('viewer','NIFTY')`);
    // alice follows dave -> dave is 2nd-degree for viewer.
    await db.execute(`INSERT INTO follows VALUES ('alice','dave')`);
    // alice also follows the viewer (must NOT count viewer as their own 2nd-degree).
    await db.execute(`INSERT INTO follows VALUES ('alice','viewer')`);

    // ── viewer's engagement (liked + bookmarked + authored) for implicit tags/symbols ──
    // A post the viewer LIKED, carrying tag "psychology" and symbol "TCS".
    await db.execute(
      `INSERT INTO posts VALUES ('liked1','someone','b','["psychology"]',NULL,'2026-06-10T10:00:00.000Z')`
    );
    await db.execute(`INSERT INTO post_symbols VALUES ('liked1','TCS')`);
    await db.execute(`INSERT INTO likes VALUES ('liked1','viewer','t')`);

    // ── candidate posts (recent, by others) ──
    await db.execute(`INSERT INTO blocks VALUES ('viewer','mallory')`);
    await db.execute(
      `INSERT INTO posts VALUES ('c_own','viewer','b','["options"]',NULL,'2026-06-14T10:00:00.000Z')`
    );
    await db.execute(
      `INSERT INTO posts VALUES ('c_blocked','mallory','b','["options"]',NULL,'2026-06-14T10:00:00.000Z')`
    );
    await db.execute(
      `INSERT INTO posts VALUES ('c_reshare','bob','','[]','root1','2026-06-14T10:00:00.000Z')`
    );
    await db.execute(
      `INSERT INTO posts VALUES ('c_tag','bob','b','["options"]',NULL,'2026-06-14T10:00:00.000Z')`
    );
    await db.execute(
      `INSERT INTO posts VALUES ('c_author','alice','b','[]',NULL,'2026-06-14T11:00:00.000Z')`
    );
    await db.execute(
      `INSERT INTO posts VALUES ('c_plain','carol','b','[]',NULL,'2026-06-14T12:00:00.000Z')`
    );
  });

  afterAll(() => db.close());

  const engagedPostIds = async () => {
    const r = await db.execute({
      sql: `SELECT id FROM (
              SELECT post_id AS id, created_at FROM likes WHERE user_id = ?
              UNION
              SELECT post_id AS id, created_at FROM bookmarks WHERE user_id = ?
              UNION
              SELECT id, created_at FROM posts WHERE user_id = ?
            ) ORDER BY created_at DESC LIMIT 60`,
      args: [VIEWER, VIEWER, VIEWER],
    });
    return r.rows.map((x) => String(x.id));
  };

  it("collects engaged posts (liked + authored), capped & deduped by UNION", async () => {
    const ids = await engagedPostIds();
    expect(ids).toContain("liked1"); // liked
    expect(ids).toContain("c_own"); // authored
  });

  it("resolves 2nd-degree authors, excluding the viewer and 1st-degree follows", async () => {
    const r = await db.execute({
      sql: `SELECT DISTINCT f2.following_id AS id
            FROM follows f1
            JOIN follows f2 ON f2.follower_id = f1.following_id
            WHERE f1.follower_id = ?
              AND f2.following_id != ?
              AND f2.following_id NOT IN (SELECT following_id FROM follows WHERE follower_id = ?)`,
      args: [VIEWER, VIEWER, VIEWER],
    });
    const ids = r.rows.map((x) => String(x.id));
    expect(ids).toEqual(["dave"]); // dave only; viewer + alice (1st-degree) excluded
  });

  const candidateScan = async () => {
    const since = "2026-06-13T00:00:00.000Z";
    const r = await db.execute({
      sql: `SELECT id, user_id AS userId, tags FROM posts
            WHERE created_at >= ?
              AND user_id != ?
              AND quote_post_id IS NULL
              AND user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
            ORDER BY created_at DESC`,
      args: [since, VIEWER, VIEWER],
    });
    return r.rows.map((x) => ({
      id: String(x.id),
      userId: String(x.userId),
      tags: String(x.tags),
    }));
  };

  it("the candidate scan excludes own posts, blocked authors and reshares", async () => {
    const ids = (await candidateScan()).map((c) => c.id);
    expect(ids).not.toContain("c_own"); // viewer's own
    expect(ids).not.toContain("c_blocked"); // blocked author
    expect(ids).not.toContain("c_reshare"); // empty reshare
    expect(ids).toEqual(expect.arrayContaining(["c_tag", "c_author", "c_plain"]));
  });

  it("end-to-end: a followed-tag post and a followed-author post outrank a plain one", async () => {
    // Build the profile from the same reads the server makes.
    const engaged = await engagedPostIds();
    const symRows = await db.execute({
      sql: `SELECT symbol FROM post_symbols WHERE post_id IN (${engaged.map(() => "?").join(",")})`,
      args: engaged,
    });
    const tagRows = await db.execute({
      sql: `SELECT tags FROM posts WHERE id IN (${engaged.map(() => "?").join(",")})`,
      args: engaged,
    });
    const engagedTags = tagRows.rows.flatMap((r) =>
      r.tags ? (JSON.parse(String(r.tags)) as string[]) : []
    );
    const profile = buildInterestProfile({
      followedTags: ["options"],
      watchedSymbols: ["NIFTY"],
      followedAuthors: ["alice"],
      secondDegreeAuthors: ["dave"],
      engagedTags,
      engagedSymbols: symRows.rows.map((r) => String(r.symbol)),
    });
    // engaged signals must have picked up the liked post's tag + symbol.
    expect(profile.tags.get("psychology")).toBeGreaterThan(0);
    expect(profile.symbols.get("TCS")).toBeGreaterThan(0);

    const candidates: ForYouCandidate[] = (await candidateScan()).map((c) => ({
      id: c.id,
      authorId: c.userId,
      tags: c.tags ? (JSON.parse(c.tags) as string[]) : [],
      symbols: [],
      hotScore: 0,
    }));
    const ranked = rankForYou(candidates, profile).map((s) => s.candidate.id);
    // c_tag (followed tag, weight 3) and c_author (followed author, 2.5) both
    // rank above the plain c_plain (prior-only, 0).
    expect(ranked.indexOf("c_tag")).toBeLessThan(ranked.indexOf("c_plain"));
    expect(ranked.indexOf("c_author")).toBeLessThan(ranked.indexOf("c_plain"));
    // and the followed-tag post outranks the followed-author post (3 > 2.5).
    expect(ranked.indexOf("c_tag")).toBeLessThan(ranked.indexOf("c_author"));
  });

  it("cold-start: a viewer with no signals yields an empty (cold) profile", () => {
    const profile = buildInterestProfile({
      followedTags: [],
      watchedSymbols: [],
      followedAuthors: [],
      secondDegreeAuthors: [],
      engagedTags: [],
      engagedSymbols: [],
    });
    // Every candidate scores only the (zero) prior -> the caller falls back to Top.
    const s = scoreCandidate(
      { id: "x", authorId: "z", tags: ["options"], symbols: ["NIFTY"], hotScore: 0 },
      profile
    );
    expect(s.score).toBe(0);
  });
});
