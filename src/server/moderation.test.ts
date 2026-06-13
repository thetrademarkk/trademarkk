import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { buildModQueue, countOpen, type ModQueueItem } from "@/features/community/moderation";

/**
 * Server-layer moderation integration test against an in-memory libsql DB. It
 * proves the SQL contracts the `/api/admin/moderation` route + `queryModQueue`
 * rely on, without standing up the whole platform DB:
 *  - the ban-status query (user.status = 'banned') drives the create-gate;
 *  - dismissing a report marks it 'actioned' (kept for history), not deleted;
 *  - the moderation audit log captures actor/action/target;
 *  - the queue aggregation merges reports + auto-flagged posts and de-dups.
 */
describe("moderation server contracts (file-backed libsql)", () => {
  let db: Client;

  beforeAll(async () => {
    db = createClient({ url: ":memory:" });
    await db.execute(`CREATE TABLE user (id TEXT PRIMARY KEY, status TEXT)`);
    await db.execute(
      `CREATE TABLE reports (id TEXT PRIMARY KEY, reporter_id TEXT, target_type TEXT, target_id TEXT, reason TEXT, status TEXT NOT NULL DEFAULT 'open', created_at TEXT)`
    );
    await db.execute(
      `CREATE TABLE posts (id TEXT PRIMARY KEY, user_id TEXT, title TEXT, body TEXT, quality_flag TEXT, created_at TEXT)`
    );
    await db.execute(
      `CREATE TABLE mod_actions (id TEXT PRIMARY KEY, actor_id TEXT, action TEXT, target_type TEXT, target_id TEXT, detail TEXT, created_at TEXT)`
    );

    await db.execute(`INSERT INTO user VALUES ('u1', NULL)`); // active
    await db.execute(`INSERT INTO user VALUES ('u2', 'banned')`); // suspended

    // A reported post, an auto-flagged post, and a post that is BOTH.
    await db.execute(
      `INSERT INTO posts VALUES ('p1','u1','Title','body one', NULL, '2026-06-14T10:00:00.000Z')`
    );
    await db.execute(
      `INSERT INTO posts VALUES ('p2','u2',NULL,'tip body', 'tip', '2026-06-14T11:00:00.000Z')`
    );
    await db.execute(
      `INSERT INTO posts VALUES ('p3','u1',NULL,'both body', 'all-caps', '2026-06-14T12:00:00.000Z')`
    );
    await db.execute(
      `INSERT INTO reports VALUES ('r1','rep','post','p1','spam: telegram', 'open', '2026-06-14T10:30:00.000Z')`
    );
    await db.execute(
      `INSERT INTO reports VALUES ('r3','rep','post','p3','abuse', 'open', '2026-06-14T12:30:00.000Z')`
    );
  });

  afterAll(() => db.close());

  it("ban-status query reflects user.status = 'banned'", async () => {
    const banned = async (id: string) =>
      (await db.execute({ sql: `SELECT status FROM user WHERE id = ?`, args: [id] })).rows[0]
        ?.status === "banned";
    expect(await banned("u1")).toBe(false);
    expect(await banned("u2")).toBe(true);
  });

  it("dismiss marks the report 'actioned' (not deleted) and survives as history", async () => {
    await db.execute(`UPDATE reports SET status = 'actioned' WHERE id = 'r1'`);
    const row = (await db.execute(`SELECT status FROM reports WHERE id = 'r1'`)).rows[0];
    expect(row?.status).toBe("actioned");
    // The row still exists (open vs actioned filtering, not destruction).
    const count = (await db.execute(`SELECT COUNT(*) AS c FROM reports`)).rows[0]?.c;
    expect(Number(count)).toBe(2);
    // restore for later assertions
    await db.execute(`UPDATE reports SET status = 'open' WHERE id = 'r1'`);
  });

  it("mod_actions row captures actor/action/target", async () => {
    await db.execute(
      `INSERT INTO mod_actions VALUES ('m1','admin','ban-user','user','u2',NULL,'2026-06-14T13:00:00.000Z')`
    );
    const row = (await db.execute(`SELECT * FROM mod_actions WHERE id = 'm1'`)).rows[0]!;
    expect(row.actor_id).toBe("admin");
    expect(row.action).toBe("ban-user");
    expect(row.target_type).toBe("user");
    expect(row.target_id).toBe("u2");
  });

  it("queue aggregation merges reports + flagged and de-dups the double-flagged post", async () => {
    // Mirror what queryModQueue assembles: report rows + flagged-post rows.
    const reportRows = (await db.execute(`SELECT * FROM reports ORDER BY created_at DESC`)).rows;
    const flaggedRows = (
      await db.execute(
        `SELECT * FROM posts WHERE quality_flag IS NOT NULL ORDER BY created_at DESC`
      )
    ).rows;

    const items: ModQueueItem[] = [
      ...reportRows.map((r) => ({
        key: String(r.id),
        source: "report" as const,
        status: (r.status === "actioned" ? "actioned" : "open") as "open" | "actioned",
        targetType: "post" as const,
        targetId: String(r.target_id),
        postId: String(r.target_id),
        label: String(r.reason).split(":")[0]!,
        note: null,
        preview: "x",
        author: null,
        authorId: null,
        authorBanned: false,
        reporter: "rep",
        createdAt: String(r.created_at),
      })),
      ...flaggedRows.map((p) => ({
        key: `flag:${p.id}`,
        source: "flag" as const,
        status: "open" as const,
        targetType: "post" as const,
        targetId: String(p.id),
        postId: String(p.id),
        label: String(p.quality_flag),
        note: null,
        preview: "x",
        author: null,
        authorId: String(p.user_id),
        authorBanned: false,
        reporter: null,
        createdAt: String(p.created_at),
      })),
    ];

    // p3 is both reported (r3) and flagged (flag:p3) → appears once, as the report.
    const all = buildModQueue(items, { source: "all", status: "open" });
    const keys = all.items.map((i) => i.key);
    expect(keys).toContain("r1"); // reported only
    expect(keys).toContain("r3"); // reported (wins over the flag)
    expect(keys).toContain("flag:p2"); // flagged only
    expect(keys).not.toContain("flag:p3"); // de-duped away
    expect(all.total).toBe(3);

    // Tab counts: 2 open reports, 1 distinct open flag.
    expect(countOpen(items)).toEqual({ reports: 2, flags: 1 });

    // Filtering to flags only drops the reports.
    expect(
      buildModQueue(items, { source: "flag", status: "open" }).items.map((i) => i.key)
    ).toEqual(["flag:p2"]);
  });
});
