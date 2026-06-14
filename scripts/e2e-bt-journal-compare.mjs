/**
 * Feature e2e (BT-12): JOURNAL-COMPARE — overlay real journaled trades against a
 * mechanical backtest of the same idea. Runs in real Chromium against a PROD
 * build (strict CSP breaks `next dev`; CSP allows worker/wasm/sql.js).
 *
 * The compare surface reads the user's LOCAL journal (demo/local mode, sql.js in
 * IndexedDB) through the existing query layer. We seed that journal directly with
 * real NIFTY trades overlapping the committed golden window, then:
 *
 *   A) POPULATED: seed NIFTY trades on the golden days → run comparison →
 *      assert the equity overlay, the discipline-metrics table, and the
 *      divergences list all render; honest framing present.
 *   B) NO-COMPARABLE-DATA: seed only RELIANCE/CRUDE → run → assert the honest
 *      "no comparable backtest data" state (we never fabricate a baseline).
 *   C) LOW-SAMPLE note renders on the small populated seed (< 10 trades).
 *   + 360px clean, zero console errors / page errors / failed requests.
 *
 * Run (with a PROD build already serving):
 *   BASE_URL=http://localhost:3600 node scripts/e2e-bt-journal-compare.mjs
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQLJS_UMD = path.resolve(__dirname, "../node_modules/sql.js/dist/sql-wasm.js");

const BASE = process.env.BASE_URL ?? "http://localhost:3600";
const issues = [];
const browser = await chromium.launch();

let passed = 0;
let failed = 0;
const step = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    issues.push(`[step] ${name} :: ${String(e.message).slice(0, 240)}`);
    console.log(`  FAIL ${name}: ${String(e.message).slice(0, 240)}`);
  }
};

const wireListeners = (page) => {
  page.on("console", (m) => {
    if (m.type() === "error") issues.push(`[console] ${page.url()} :: ${m.text().slice(0, 250)}`);
  });
  page.on("pageerror", (e) =>
    issues.push(`[pageerror] ${page.url()} :: ${String(e.message).slice(0, 250)}`)
  );
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().includes("/_vercel"))
      issues.push(`[http ${r.status()}] ${r.url()}`);
  });
};

const noOverflow = async (page) => {
  const o = await page.evaluate(() => {
    const el = document.scrollingElement;
    return { sw: el.scrollWidth, cw: el.clientWidth };
  });
  if (o.sw > o.cw) throw new Error(`horizontal overflow ${o.sw} > ${o.cw}`);
};

/**
 * Start LOCAL (demo) mode so a sql.js journal DB + the real migrated schema get
 * provisioned and persisted to IndexedDB. The ?mode=demo deep link calls
 * startLocal() which runs the migrations (which persist the DB bytes).
 */
const startLocalMode = async (page) => {
  await page.goto(`${BASE}/app/onboarding`, { waitUntil: "domcontentloaded" });
  // Click the real "Try without an account" mode card → startLocal() runs the
  // migrations (which persist the DB bytes to IndexedDB).
  await page.getByText("Try without an account").click({ timeout: 60000 });
  // After startLocal() the new-journal flow routes to setup or the app; either
  // way the migrated DB is now persisted. Wait until the trades table exists.
  await page.waitForFunction(
    () =>
      new Promise((resolve) => {
        try {
          // Use the SAME open semantics as the app's local adapter (version 1 +
          // create-store-on-upgrade) so our probe can never leave a malformed,
          // store-less DB that would break the app's own open.
          const req = indexedDB.open("trademarkk-local", 1);
          req.onupgradeneeded = () => req.result.createObjectStore("files");
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("files")) {
              db.close();
              return resolve(false);
            }
            const tx = db.transaction("files", "readonly");
            const g = tx.objectStore("files").get("journal.db");
            g.onsuccess = () => {
              db.close();
              resolve(!!g.result && g.result.byteLength > 0);
            };
            g.onerror = () => {
              db.close();
              resolve(false);
            };
          };
          req.onerror = () => resolve(false);
        } catch {
          resolve(false);
        }
      }),
    { timeout: 60000 }
  );
  // Let the LocalDbClient finish persisting ALL migration steps (it re-exports
  // while dirty); seeding/navigating mid-persist can race the IndexedDB write.
  await page.waitForTimeout(1500);
};

/**
 * Seed trades straight into the local sql.js journal DB in IndexedDB. Seeds on
 * the CURRENT page (the onboarding page, where the migrated DB is already
 * persisted and no further writes are pending) so a hard navigation can't race
 * an in-flight persist. Injects the sql.js UMD loader (from node_modules), loads
 * the existing migrated DB bytes, inserts rows into the real `trades` table,
 * exports, and saves back — the same bytes the app's local adapter reads on boot.
 */
const seedTrades = async (page, rows) => {
  await page.addScriptTag({ path: SQLJS_UMD });
  const result = await page.evaluate(async (rows) => {
    const SQL = await window.initSqlJs({ locateFile: (f) => `/sqljs/${f}` });

    const IDB_NAME = "trademarkk-local";
    const IDB_STORE = "files";
    const IDB_KEY = "journal.db";
    const openIdb = () =>
      new Promise((resolve, reject) => {
        // Match the app's local adapter exactly (version 1 + create-store).
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    const idbLoad = async () => {
      const db = await openIdb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const r = tx.objectStore(IDB_STORE).get(IDB_KEY);
        r.onsuccess = () => resolve(r.result ? new Uint8Array(r.result) : null);
        r.onerror = () => reject(r.error);
      });
    };
    const idbSave = async (bytes) => {
      const db = await openIdb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    };

    const existing = await idbLoad();
    if (!existing) return { ok: false, reason: "no local db yet" };
    const db = new SQL.Database(existing);

    // Ensure a demo account exists (the adapter does not enforce FKs, but keep it tidy).
    db.run(
      `INSERT OR IGNORE INTO accounts (id, name, broker, starting_capital, charge_profile, created_at, updated_at)
       VALUES ('demo','Demo','zerodha',100000,'zerodha','2024-07-01T00:00:00.000Z','2024-07-01T00:00:00.000Z')`
    );
    for (const t of rows) {
      db.run(
        `INSERT OR REPLACE INTO trades
          (id, account_id, symbol, exchange, segment, product, direction, status, qty,
           avg_entry, avg_exit, opened_at, closed_at, gross_pnl, charges, net_pnl, created_at, updated_at)
         VALUES (?, 'demo', ?, 'NSE', ?, ?, ?, 'closed', ?, 100, 120, ?, ?, ?, ?, ?, ?, ?)`,
        [
          t.id,
          t.symbol,
          t.segment,
          t.product,
          t.direction,
          t.qty,
          t.opened_at,
          t.closed_at,
          t.gross,
          t.charges,
          t.net,
          "2024-07-01T00:00:00.000Z",
          "2024-07-01T00:00:00.000Z",
        ]
      );
    }
    const out = db.export();
    await idbSave(out);
    // Count back.
    const res = db.exec("SELECT COUNT(*) AS c FROM trades");
    db.close();
    return { ok: true, count: res[0]?.values?.[0]?.[0] ?? 0 };
  }, rows);
  if (!result.ok) throw new Error(`seed failed: ${result.reason}`);
  return result.count;
};

const clearLocal = async (page) => {
  await page.goto(`${BASE}/backtesting`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        try {
          localStorage.clear();
        } catch {}
        const req = indexedDB.deleteDatabase("trademarkk-local");
        req.onsuccess = req.onerror = req.onblocked = () => resolve(true);
      })
  );
};

const runComparison = async (page) => {
  await page.goto(`${BASE}/backtesting/compare`, { waitUntil: "domcontentloaded" });
  const runBtn = page.getByTestId("bt-compare-run");
  await runBtn.waitFor({ timeout: 30000 });
  // Wait until the journal has loaded (button enabled once trades are read).
  await page.waitForFunction(
    () => {
      const b = document.querySelector('[data-testid="bt-compare-run"]');
      return b && !b.hasAttribute("disabled");
    },
    { timeout: 30000 }
  );
  await runBtn.click();
};

/* ── Pass A: populated comparison ──────────────────────────────────────────── */
{
  const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
  const page = await ctx.newPage();
  wireListeners(page);

  console.log("— Journal-compare · POPULATED —");

  await step("the compare entry point is on the backtesting landing", async () => {
    await page.goto(`${BASE}/backtesting`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("bt-compare-entry").waitFor({ timeout: 15000 });
  });

  await step("local journal seeds with NIFTY trades overlapping the golden window", async () => {
    await clearLocal(page);
    await startLocalMode(page);
    const count = await seedTrades(page, [
      // Day 1 (golden 2024-07-24): two NIFTY trades (one a discretionary extra).
      {
        id: "n1",
        symbol: "NIFTY",
        segment: "FUT",
        product: "NRML",
        direction: "long",
        qty: 75,
        opened_at: "2024-07-24T04:00:00.000Z",
        closed_at: "2024-07-24T09:30:00.000Z",
        gross: 600,
        charges: 100,
        net: 500,
      },
      {
        id: "n2",
        symbol: "NIFTY 24500 CE",
        segment: "OPT",
        product: "MIS",
        direction: "short",
        qty: 75,
        opened_at: "2024-07-24T04:10:00.000Z",
        closed_at: "2024-07-24T09:25:00.000Z",
        gross: 200,
        charges: 60,
        net: 140,
      },
      // Day 2 (golden 2024-07-25): one NIFTY trade (a loss).
      {
        id: "n3",
        symbol: "NIFTY",
        segment: "FUT",
        product: "NRML",
        direction: "short",
        qty: 75,
        opened_at: "2024-07-25T04:00:00.000Z",
        closed_at: "2024-07-25T09:30:00.000Z",
        gross: -200,
        charges: 100,
        net: -300,
      },
      // An out-of-window NIFTY trade (older) → out-of-range caveat.
      {
        id: "n4",
        symbol: "NIFTY",
        segment: "FUT",
        product: "NRML",
        direction: "long",
        qty: 75,
        opened_at: "2023-01-10T04:00:00.000Z",
        closed_at: "2023-01-10T09:30:00.000Z",
        gross: 800,
        charges: 100,
        net: 700,
      },
      // A non-comparable trade (ignored by the NIFTY comparison).
      {
        id: "r1",
        symbol: "RELIANCE",
        segment: "EQ",
        product: "CNC",
        direction: "long",
        qty: 50,
        opened_at: "2024-07-24T04:00:00.000Z",
        closed_at: "2024-07-26T09:30:00.000Z",
        gross: 1000,
        charges: 50,
        net: 950,
      },
    ]);
    if (count < 5) throw new Error(`expected >=5 seeded trades, got ${count}`);
  });

  await step("running the comparison renders the result", async () => {
    await runComparison(page);
    await page.getByTestId("bt-compare-result").waitFor({ timeout: 30000 });
  });

  await step("the two-color equity overlay renders", async () => {
    await page.getByTestId("bt-compare-overlay").waitFor({ timeout: 10000 });
  });

  await step("the discipline-metrics table renders the 6 metrics", async () => {
    await page.getByTestId("bt-compare-metrics").waitFor({ timeout: 10000 });
    const metrics = await page.locator("[data-metric]").count();
    if (metrics < 6) throw new Error(`expected 6 discipline metrics, got ${metrics}`);
    // Total net P&L row present.
    if ((await page.locator('[data-metric="totalPnl"]').count()) < 1)
      throw new Error("missing totalPnl metric row");
  });

  await step("the divergences section renders (with rows for skipped/discretionary)", async () => {
    await page.getByTestId("bt-compare-divergences").waitFor({ timeout: 10000 });
  });

  await step("honest framing is present (mirror, not a verdict)", async () => {
    const txt = (await page.getByTestId("bt-compare-result").textContent())?.toLowerCase() ?? "";
    if (!txt.includes("mirror for self-review"))
      throw new Error("honest 'mirror for self-review' framing missing");
    if (!txt.includes("not a verdict") && !txt.includes("verdict"))
      throw new Error("honest verdict caveat missing");
    // Never evaluative / advice.
    for (const banned of [
      "you were wrong",
      "you should have",
      "we recommend",
      "buy this",
      "sell this",
    ]) {
      if (txt.includes(banned)) throw new Error(`compare view is evaluative: "${banned}"`);
    }
  });

  await step("low-sample note renders (< 10 comparable trades)", async () => {
    await page.getByTestId("bt-compare-lowsample").waitFor({ timeout: 8000 });
  });

  await step("out-of-range caveat renders (the 2023 trade is excluded honestly)", async () => {
    await page.getByTestId("bt-compare-outofrange").waitFor({ timeout: 8000 });
  });

  await ctx.close();
}

/* ── Pass B: no comparable data (honest state) ─────────────────────────────── */
{
  const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
  const page = await ctx.newPage();
  wireListeners(page);

  console.log("— Journal-compare · NO-COMPARABLE-DATA —");

  await step("a non-index-only book → honest 'no comparable backtest data'", async () => {
    await clearLocal(page);
    await startLocalMode(page);
    await seedTrades(page, [
      {
        id: "r1",
        symbol: "RELIANCE",
        segment: "EQ",
        product: "CNC",
        direction: "long",
        qty: 50,
        opened_at: "2024-07-24T04:00:00.000Z",
        closed_at: "2024-07-24T09:30:00.000Z",
        gross: 500,
        charges: 50,
        net: 450,
      },
      {
        id: "c1",
        symbol: "CRUDEOIL",
        segment: "COMM",
        product: "MIS",
        direction: "long",
        qty: 100,
        opened_at: "2024-07-25T04:00:00.000Z",
        closed_at: "2024-07-25T09:30:00.000Z",
        gross: 300,
        charges: 40,
        net: 260,
      },
    ]);
    await runComparison(page);
    await page.getByTestId("bt-compare-nodata").waitFor({ timeout: 30000 });
    const txt = (await page.getByTestId("bt-compare-nodata").textContent())?.toLowerCase() ?? "";
    if (!txt.includes("no comparable backtest data") && !txt.includes("nothing to compare"))
      throw new Error(`no-comparable-data copy missing: "${txt.slice(0, 120)}"`);
  });

  await ctx.close();
}

/* ── Pass C: 360px ─────────────────────────────────────────────────────────── */
{
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const page = await ctx.newPage();
  wireListeners(page);

  console.log("— 360px —");
  await step("the populated compare result fits 360px with no overflow", async () => {
    await clearLocal(page);
    await startLocalMode(page);
    await seedTrades(page, [
      {
        id: "n1",
        symbol: "NIFTY",
        segment: "FUT",
        product: "NRML",
        direction: "long",
        qty: 75,
        opened_at: "2024-07-24T04:00:00.000Z",
        closed_at: "2024-07-24T09:30:00.000Z",
        gross: 600,
        charges: 100,
        net: 500,
      },
      {
        id: "n3",
        symbol: "NIFTY",
        segment: "FUT",
        product: "NRML",
        direction: "short",
        qty: 75,
        opened_at: "2024-07-25T04:00:00.000Z",
        closed_at: "2024-07-25T09:30:00.000Z",
        gross: -200,
        charges: 100,
        net: -300,
      },
    ]);
    await runComparison(page);
    await page.getByTestId("bt-compare-result").waitFor({ timeout: 30000 });
    await page.getByTestId("bt-compare-overlay").waitFor({ timeout: 10000 });
    await noOverflow(page);
  });

  await ctx.close();
}

await browser.close();

console.log(`\n${passed} passed, ${failed} failed`);
if (issues.length) {
  console.log(`\n— ${issues.length} issue(s) —`);
  for (const i of [...new Set(issues)]) console.log("  " + i);
  process.exit(1);
} else {
  console.log("\nNo console errors, no failed requests. ✅");
}
