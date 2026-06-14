import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type Client } from "@libsql/client";
import {
  rankFollowSuggestions,
  type FollowCandidate,
} from "@/features/community/follow-suggestions";

/**
 * Integration test for the "Who to follow" data layer: it exercises the SAME SQL
 * shapes `queryFollowSuggestions` builds (the 2nd-degree mutual-count scan, the
 * shared-followed-tag author scan, the shared-watched-symbol author scan, and the
 * exclude-set: already-followed / blocked-either-way / banned / self) against an
 * in-memory libsql DB, then feeds the rows through the PURE ranker to assert the
 * end-to-end suggestions — without standing up the real platform DB.
 */
describe("Who-to-follow data layer (candidate scan + exclude-set + ranking)", () => {
  let db: Client;
  const VIEWER = "viewer";
  const SINCE = "2026-05-15T00:00:00.000Z"; // 30d window for the activity scans
  const RECENT = "2026-06-10T10:00:00.000Z";

  beforeAll(async () => {
    db = createClient({ url: ":memory:" });
    await db.execute(`CREATE TABLE follows (follower_id TEXT, following_id TEXT)`);
    await db.execute(`CREATE TABLE followed_tags (user_id TEXT, tag TEXT)`);
    await db.execute(`CREATE TABLE watched_symbols (user_id TEXT, symbol TEXT)`);
    await db.execute(`CREATE TABLE blocks (blocker_id TEXT, blocked_id TEXT)`);
    await db.execute(`CREATE TABLE user (id TEXT PRIMARY KEY, status TEXT)`);
    await db.execute(
      `CREATE TABLE posts (id TEXT PRIMARY KEY, user_id TEXT, tags TEXT, quality_flag TEXT, created_at TEXT)`
    );
    await db.execute(`CREATE TABLE post_symbols (post_id TEXT, symbol TEXT)`);
    await db.execute(
      `CREATE TABLE profiles (user_id TEXT PRIMARY KEY, username TEXT, display_name TEXT, avatar TEXT, reputation_score INTEGER, reputation_tier TEXT, reputation_computed_at TEXT)`
    );

    // ── accounts (some with profiles, one banned) ──
    const users = [
      "viewer",
      "alice", // 1st-degree follow of viewer
      "dave", // 2nd-degree (alice follows dave)
      "erin", // 2nd-degree via two mutuals
      "bob", // alice + carol both follow (stronger 2nd-degree)
      "carol", // another 1st-degree follow
      "tagger", // shares a followed tag, no mutuals
      "symboler", // shares a watched symbol, no mutuals
      "banned1", // banned 2nd-degree (must be excluded)
      "blockedByViewer", // viewer blocked them
      "blockerOfViewer", // they blocked viewer
    ];
    for (const u of users) {
      await db.execute({ sql: `INSERT INTO user VALUES (?, ?)`, args: [u, null] });
      await db.execute({
        sql: `INSERT INTO profiles VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [u, u, u, null, u === "stranger" ? 100 : 30, "contributing", null],
      });
    }
    await db.execute({ sql: `UPDATE user SET status='banned' WHERE id=?`, args: ["banned1"] });

    // ── viewer's graph ──
    await db.execute(`INSERT INTO follows VALUES ('viewer','alice')`);
    await db.execute(`INSERT INTO follows VALUES ('viewer','carol')`);
    // alice's follows -> 2nd-degree candidates
    await db.execute(`INSERT INTO follows VALUES ('alice','dave')`);
    await db.execute(`INSERT INTO follows VALUES ('alice','erin')`);
    await db.execute(`INSERT INTO follows VALUES ('alice','bob')`);
    await db.execute(`INSERT INTO follows VALUES ('alice','banned1')`); // banned 2nd-degree
    await db.execute(`INSERT INTO follows VALUES ('alice','blockedByViewer')`);
    await db.execute(`INSERT INTO follows VALUES ('alice','blockerOfViewer')`);
    await db.execute(`INSERT INTO follows VALUES ('alice','viewer')`); // viewer is NOT their own 2nd-degree
    await db.execute(`INSERT INTO follows VALUES ('alice','carol')`); // carol already followed -> excluded
    // carol also follows bob + erin -> erin & bob reachable by 2 mutuals
    await db.execute(`INSERT INTO follows VALUES ('carol','bob')`);
    await db.execute(`INSERT INTO follows VALUES ('carol','erin')`);

    // ── blocks (both directions) ──
    await db.execute(`INSERT INTO blocks VALUES ('viewer','blockedByViewer')`);
    await db.execute(`INSERT INTO blocks VALUES ('blockerOfViewer','viewer')`);

    // ── viewer's interests ──
    await db.execute(`INSERT INTO followed_tags VALUES ('viewer','options')`);
    await db.execute(`INSERT INTO watched_symbols VALUES ('viewer','NIFTY')`);

    // ── posts (recent, live) ──
    // tagger posts about #options
    await db.execute({
      sql: `INSERT INTO posts VALUES (?, ?, ?, ?, ?)`,
      args: ["p_tagger", "tagger", '["options","psychology"]', null, RECENT],
    });
    // symboler posts tagging $NIFTY
    await db.execute({
      sql: `INSERT INTO posts VALUES (?, ?, ?, ?, ?)`,
      args: ["p_symboler", "symboler", "[]", null, RECENT],
    });
    await db.execute(`INSERT INTO post_symbols VALUES ('p_symboler','NIFTY')`);
    // a FLAGGED post about #options by a stranger -> must not make them a candidate
    await db.execute({
      sql: `INSERT INTO posts VALUES (?, ?, ?, ?, ?)`,
      args: ["p_flagged", "flagger", '["options"]', "tip", RECENT],
    });
    // dave + erin + bob have some recent activity (genuine)
    for (const u of ["dave", "erin", "bob"]) {
      await db.execute({
        sql: `INSERT INTO posts VALUES (?, ?, ?, ?, ?)`,
        args: [`p_${u}`, u, "[]", null, RECENT],
      });
    }
  });

  afterAll(() => db.close());

  // ── The exact 2nd-degree mutual-count query the server runs ──
  const secondDegree = async () => {
    const r = await db.execute({
      sql: `SELECT f2.following_id AS id, COUNT(DISTINCT f2.follower_id) AS mutuals
            FROM follows f1
            JOIN follows f2 ON f2.follower_id = f1.following_id
            WHERE f1.follower_id = ?
              AND f2.following_id <> ?
              AND f2.following_id NOT IN (SELECT following_id FROM follows WHERE follower_id = ?)
              AND f2.following_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
              AND f2.following_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ?)
              AND f2.following_id NOT IN (SELECT id FROM user WHERE status = 'banned')
            GROUP BY f2.following_id
            ORDER BY mutuals DESC`,
      args: [VIEWER, VIEWER, VIEWER, VIEWER, VIEWER],
    });
    return r.rows.map((x) => ({ id: String(x.id), mutuals: Number(x.mutuals) }));
  };

  it("2nd-degree excludes self, already-followed, banned, and blocked (both ways)", async () => {
    const rows = await secondDegree();
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(["dave", "erin", "bob"]));
    expect(ids).not.toContain("viewer"); // self
    expect(ids).not.toContain("carol"); // already followed
    expect(ids).not.toContain("alice"); // already followed
    expect(ids).not.toContain("banned1"); // banned
    expect(ids).not.toContain("blockedByViewer"); // viewer blocked them
    expect(ids).not.toContain("blockerOfViewer"); // they blocked viewer
  });

  it("weights 2nd-degree by distinct mutuals (bob/erin via 2 > dave via 1)", async () => {
    const rows = await secondDegree();
    const byId = new Map(rows.map((r) => [r.id, r.mutuals]));
    expect(byId.get("bob")).toBe(2);
    expect(byId.get("erin")).toBe(2);
    expect(byId.get("dave")).toBe(1);
  });

  const sharedTagAuthors = async () => {
    const r = await db.execute({
      sql: `SELECT DISTINCT p.user_id AS id
            FROM posts p, json_each(p.tags) je
            WHERE p.tags IS NOT NULL AND p.quality_flag IS NULL AND p.created_at >= ?
              AND lower(je.value) IN ('options')
              AND p.user_id <> ?
              AND p.user_id NOT IN (SELECT following_id FROM follows WHERE follower_id = ?)
              AND p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
              AND p.user_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ?)
              AND p.user_id NOT IN (SELECT id FROM user WHERE status='banned')`,
      args: [SINCE, VIEWER, VIEWER, VIEWER, VIEWER],
    });
    return r.rows.map((x) => String(x.id));
  };

  it("shared-tag authors match the followed tag, excluding flagged-post authors", async () => {
    const ids = await sharedTagAuthors();
    expect(ids).toContain("tagger");
    expect(ids).not.toContain("flagger"); // their #options post is quality-flagged
  });

  const sharedSymbolAuthors = async () => {
    const r = await db.execute({
      sql: `SELECT DISTINCT p.user_id AS id
            FROM post_symbols ps JOIN posts p ON p.id = ps.post_id
            WHERE ps.symbol IN ('NIFTY') AND p.quality_flag IS NULL AND p.created_at >= ?
              AND p.user_id <> ?
              AND p.user_id NOT IN (SELECT following_id FROM follows WHERE follower_id = ?)`,
      args: [SINCE, VIEWER, VIEWER],
    });
    return r.rows.map((x) => String(x.id));
  };

  it("shared-symbol authors match the watched symbol", async () => {
    expect(await sharedSymbolAuthors()).toContain("symboler");
  });

  it("end-to-end: a high-affinity shared-interest member outranks a 1-mutual 2nd-degree, and an already-followed user never appears", async () => {
    const second = await secondDegree();
    const tagAuthors = await sharedTagAuthors();
    const symAuthors = await sharedSymbolAuthors();
    const secondStrength = new Map(second.map((r) => [r.id, r.mutuals]));
    const tagSet = new Set(tagAuthors);
    const symSet = new Set(symAuthors);

    const ids = Array.from(new Set([...second.map((r) => r.id), ...tagAuthors, ...symAuthors]));
    const candidates: FollowCandidate[] = ids.map((id) => ({
      userId: id,
      username: id,
      displayName: id,
      avatar: null,
      reputationTier: "contributing",
      reputationScore: 30,
      secondDegreeCount: secondStrength.get(id) ?? 0,
      sharedTags: tagSet.has(id) ? ["options"] : [],
      sharedSymbols: symSet.has(id) ? ["NIFTY"] : [],
      recentQualityPosts: 1,
    }));

    const ranked = rankFollowSuggestions(candidates, { limit: 5 });
    const rankedIds = ranked.map((s) => s.userId);

    // tagger (followed-tag overlap, weight 8) outranks dave (1 mutual, ~ weight 10*0.36)
    expect(rankedIds.indexOf("tagger")).toBeLessThan(rankedIds.indexOf("dave"));
    // an already-followed user (carol/alice) is never present
    expect(rankedIds).not.toContain("carol");
    expect(rankedIds).not.toContain("alice");
    // reasons are honest + relevance-based
    const tagger = ranked.find((s) => s.userId === "tagger");
    expect(tagger?.reason).toBe("Also posts about #options");
    const bob = ranked.find((s) => s.userId === "bob");
    expect(bob?.reason).toBe("Followed by 2 people you follow");
  });
});
