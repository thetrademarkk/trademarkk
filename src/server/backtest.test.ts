import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as schema from "./db/platform-schema";
import { makeDefaultStrategy } from "@/features/backtest/shared/strategy-def";
import { RUN_RESULT_VERSION, type RunResult } from "@/features/backtest/shared/run-result";

/**
 * File-backed integration test for the BT-09 server module: save (claim) +
 * share-create (idempotent) + public-read + non-owner-cannot-mutate. Uses a
 * real libsql file DB (same idiom as community-reshare.test.ts) so the actual
 * `src/server/backtest.ts` SQL runs end-to-end.
 */
const TMP_DIR = mkdtempSync(join(tmpdir(), "tm-bt-"));
const DB_FILE = join(TMP_DIR, "bt.db");

let client: Client;
let db: ReturnType<typeof drizzle<typeof schema>>;

vi.mock("./db/platform", () => ({
  platformDb: new Proxy(
    {},
    {
      get(_t, prop) {
        return Reflect.get(db, prop, db);
      },
    }
  ),
}));

import {
  saveRun,
  saveStrategy,
  getRunById,
  getRunByShareId,
  shareRun,
  canViewRun,
  deleteRun,
  shareUrl,
} from "./backtest";

// The two backtest tables + a minimal user table for the FK target.
const DDL = [
  `CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL)`,
  `CREATE TABLE backtest_strategies (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
    strategy_def TEXT NOT NULL, engine_version TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE backtest_runs (
    id TEXT PRIMARY KEY, user_id TEXT, strategy_id TEXT, run_result TEXT NOT NULL,
    data_snapshot_id TEXT NOT NULL, engine_version TEXT NOT NULL,
    share_id TEXT UNIQUE, created_at TEXT NOT NULL
  )`,
];

function makeRunResult(): RunResult {
  const config = makeDefaultStrategy("s1", "NIFTY");
  return {
    resultVersion: RUN_RESULT_VERSION,
    runId: "run-1",
    config,
    engineVersion: "1.0.0",
    dataSnapshotId: "snap-2026-06",
    ranAt: 1_700_000_000_000,
    coverage: {
      overall: 0.82,
      byLeg: { "s1-leg1": 0.82 },
      substitutions: 1,
      illiquidDays: 0,
      excludedDays: 0,
      filledBarFraction: 0.91,
    },
    stats: {
      netPnl: 1899.29,
      winRate: 1,
      maxDrawdown: 0,
      expectancy: 949.65,
      profitFactor: 5,
      sharpe: 0,
    },
    qualityChips: [{ kind: "coverage", level: "good", label: "82% data coverage" }],
    equityCurve: [{ ts: 1_700_000_000_000, equity: 0 }],
    monthlyReturns: [{ month: "2024-07", pnl: 1899.29 }],
    tradeReturns: [{ day: "2024-07-25", net: 1899.29 }],
    blotter: [
      {
        day: "2024-07-25",
        entryTs: 1_700_000_000_000,
        exitTs: 1_700_020_000_000,
        legs: [
          {
            legId: "s1-leg1",
            optionType: "PE",
            side: "sell",
            qty: 75,
            resolution: {
              requested: 21500,
              served: 21500,
              coverage: 0.82,
              confidence: "high",
              fallbackSteps: 0,
            },
            entryPrice: 120,
            exitPrice: 80,
            gross: 3000,
            charges: 60,
            net: 2940,
            reentries: 0,
          },
        ],
        gross: 3000,
        charges: 60,
        net: 2940,
        substituted: false,
        flags: [],
      },
    ],
    perLeg: [
      {
        legId: "s1-leg1",
        optionType: "PE",
        side: "sell",
        net: 1899.29,
        trades: 1,
        meanCoverage: 0.82,
      },
    ],
    flags: [],
  };
}

beforeAll(async () => {
  client = createClient({ url: `file:${DB_FILE.replace(/\\/g, "/")}` });
  db = drizzle(client, { schema });
  for (const ddl of DDL) await client.execute(ddl);
});
afterAll(() => {
  client.close();
  // Best-effort: Windows may still hold the file handle right after close().
  try {
    rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    /* OS reaps the temp dir later */
  }
});
beforeEach(async () => {
  await client.execute("DELETE FROM backtest_runs");
  await client.execute("DELETE FROM backtest_strategies");
  await client.execute("DELETE FROM user");
  await client.execute(
    "INSERT INTO user (id, name, email) VALUES ('owner','Owner','o@x'),('intruder','Intruder','i@x')"
  );
});

describe("saveRun — claim a client-computed run (never re-run)", () => {
  it("persists the immutable result + creates a backing strategy", async () => {
    const { runId, strategyId } = await saveRun(
      "owner",
      makeDefaultStrategy("s1"),
      makeRunResult()
    );
    expect(runId).toBeTruthy();
    expect(strategyId).toBeTruthy();

    const run = await getRunById(runId);
    expect(run).not.toBeNull();
    expect(run!.userId).toBe("owner");
    expect(run!.strategyId).toBe(strategyId);
    // The stored result round-trips byte-identically — not re-derived.
    expect(run!.result).toEqual(makeRunResult());
    expect(run!.result.stats.netPnl).toBe(1899.29); // paise-correct

    const strat = await client.execute("SELECT * FROM backtest_strategies WHERE id = ?", [
      strategyId,
    ] as never);
    expect(strat.rows).toHaveLength(1);
  });

  it("links to an existing OWNED strategy instead of creating a new one", async () => {
    const stratId = await saveStrategy("owner", makeDefaultStrategy("s1"));
    const { strategyId } = await saveRun(
      "owner",
      makeDefaultStrategy("s1"),
      makeRunResult(),
      stratId
    );
    expect(strategyId).toBe(stratId);
    const all = await client.execute("SELECT id FROM backtest_strategies");
    expect(all.rows).toHaveLength(1); // no duplicate strategy created
  });

  it("ignores a strategyId the caller does not own (creates a fresh one)", async () => {
    const intruderStrat = await saveStrategy("intruder", makeDefaultStrategy("s1"));
    const { strategyId } = await saveRun(
      "owner",
      makeDefaultStrategy("s1"),
      makeRunResult(),
      intruderStrat
    );
    expect(strategyId).not.toBe(intruderStrat); // never attaches to someone else's
  });
});

describe("shareRun — opt-in, immutable, idempotent public link", () => {
  it("mints an unguessable share-id on first share; re-share returns the SAME id", async () => {
    const { runId } = await saveRun("owner", makeDefaultStrategy("s1"), makeRunResult());

    const first = await shareRun(runId, "owner", true);
    expect(first.ok).toBe(true);
    expect(first.shareId).toMatch(/^[0-9a-z]{21}$/);

    const second = await shareRun(runId, "owner", true);
    expect(second.shareId).toBe(first.shareId); // idempotent — no new link

    expect(shareUrl("https://x.app", first.shareId!)).toBe(
      `https://x.app/backtesting/r/${first.shareId}`
    );
  });

  it("publicly reads a shared run by share-id with NO auth", async () => {
    const { runId } = await saveRun("owner", makeDefaultStrategy("s1"), makeRunResult());
    const { shareId } = await shareRun(runId, "owner", true);

    const pub = await getRunByShareId(shareId!);
    expect(pub).not.toBeNull();
    expect(pub!.result.stats.netPnl).toBe(1899.29);
    // Anyone (viewerId null) can view a shared run.
    expect(canViewRun(pub!, null)).toBe(true);
  });

  it("an UN-shared run is private — not reachable by share-id, hidden from non-owners", async () => {
    const { runId } = await saveRun("owner", makeDefaultStrategy("s1"), makeRunResult());
    const run = await getRunById(runId);
    expect(run!.shareId).toBeNull();
    expect(canViewRun(run!, null)).toBe(false); // anonymous can't see it
    expect(canViewRun(run!, "intruder")).toBe(false); // neither can a non-owner
    expect(canViewRun(run!, "owner")).toBe(true); // only the owner
  });

  it("disabling a share clears the link (run becomes owner-only again)", async () => {
    const { runId } = await saveRun("owner", makeDefaultStrategy("s1"), makeRunResult());
    const { shareId } = await shareRun(runId, "owner", true);
    expect(await getRunByShareId(shareId!)).not.toBeNull();

    const off = await shareRun(runId, "owner", false);
    expect(off.ok).toBe(true);
    expect(off.shareId).toBeNull();
    expect(await getRunByShareId(shareId!)).toBeNull(); // link no longer resolves
  });
});

describe("immutability — a non-owner cannot mutate a shared run", () => {
  it("a non-owner cannot toggle the share (no shareId minted/cleared)", async () => {
    const { runId } = await saveRun("owner", makeDefaultStrategy("s1"), makeRunResult());
    const res = await shareRun(runId, "intruder", true);
    expect(res.ok).toBe(false);
    expect(res.shareId).toBeNull();
    // The run is still un-shared (the intruder changed nothing).
    expect((await getRunById(runId))!.shareId).toBeNull();
  });

  it("a non-owner cannot delete the run", async () => {
    const { runId } = await saveRun("owner", makeDefaultStrategy("s1"), makeRunResult());
    expect(await deleteRun(runId, "intruder")).toBe(false);
    expect(await getRunById(runId)).not.toBeNull(); // still there
    expect(await deleteRun(runId, "owner")).toBe(true); // owner can
    expect(await getRunById(runId)).toBeNull();
  });

  it("there is no path to overwrite a stored run_result (immutable artifact)", async () => {
    // The server module exposes save/share/delete only — no update of run_result.
    // Asserted by surface: re-saving creates a NEW run row, never edits the old.
    const a = await saveRun("owner", makeDefaultStrategy("s1"), makeRunResult());
    const b = await saveRun("owner", makeDefaultStrategy("s1"), makeRunResult());
    expect(b.runId).not.toBe(a.runId);
    const rows = await client.execute("SELECT id FROM backtest_runs");
    expect(rows.rows).toHaveLength(2);
  });
});
