/**
 * Generate the static market-calendar asset consumed by the backtest engine
 * (and any edge route) WITHOUT a runtime import of the TS data modules.
 *
 *   node scripts/gen-market-calendar.mjs
 *     → public/backtest/calendar/nse-bse-calendar.json
 *
 * The JSON is the single shipped artifact: NSE/BSE holidays 2021–2027, the
 * dated per-index expiry-weekday rules (incl. the 2024–25 weekly churn +
 * BANKNIFTY weekly discontinuation + BSE SENSEX), and per-index data starts.
 * Re-run this whenever calendar.data.ts / expiry-rules.ts change; the file is
 * committed so the build never needs the generator.
 *
 * It re-derives the tables here (mirroring the TS source) rather than importing
 * TS, so the script is dependency-free Node ESM. A guard test asserts the JSON
 * matches the TS source of truth, so drift is caught in CI/local gates.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "public", "backtest", "calendar", "nse-bse-calendar.json");

const NSE_BSE_HOLIDAYS = {
  2021: [
    "2021-01-26",
    "2021-03-11",
    "2021-03-29",
    "2021-04-02",
    "2021-04-14",
    "2021-04-21",
    "2021-05-13",
    "2021-07-21",
    "2021-08-19",
    "2021-09-10",
    "2021-10-15",
    "2021-11-04",
    "2021-11-05",
    "2021-11-19",
  ],
  2022: [
    "2022-01-26",
    "2022-03-01",
    "2022-03-18",
    "2022-04-14",
    "2022-04-15",
    "2022-05-03",
    "2022-08-09",
    "2022-08-15",
    "2022-08-31",
    "2022-10-05",
    "2022-10-24",
    "2022-10-26",
    "2022-11-08",
  ],
  2023: [
    "2023-01-26",
    "2023-03-07",
    "2023-03-30",
    "2023-04-04",
    "2023-04-07",
    "2023-04-14",
    "2023-05-01",
    "2023-06-28",
    "2023-08-15",
    "2023-09-19",
    "2023-10-02",
    "2023-10-24",
    "2023-11-14",
    "2023-11-27",
    "2023-12-25",
  ],
  2024: [
    "2024-01-26",
    "2024-03-08",
    "2024-03-25",
    "2024-03-29",
    "2024-04-11",
    "2024-04-17",
    "2024-05-01",
    "2024-05-20",
    "2024-06-17",
    "2024-07-17",
    "2024-08-15",
    "2024-10-02",
    "2024-11-01",
    "2024-11-15",
    "2024-12-25",
  ],
  2025: [
    "2025-02-26",
    "2025-03-14",
    "2025-03-31",
    "2025-04-10",
    "2025-04-14",
    "2025-04-18",
    "2025-05-01",
    "2025-08-15",
    "2025-08-27",
    "2025-10-02",
    "2025-10-21",
    "2025-10-22",
    "2025-11-05",
    "2025-12-25",
  ],
  2026: [
    "2026-01-15",
    "2026-01-26",
    "2026-03-03",
    "2026-03-26",
    "2026-03-31",
    "2026-04-03",
    "2026-04-14",
    "2026-05-01",
    "2026-05-28",
    "2026-06-26",
    "2026-09-14",
    "2026-10-02",
    "2026-10-20",
    "2026-11-10",
    "2026-11-24",
    "2026-12-25",
  ],
  2027: [
    "2027-01-26",
    "2027-03-08",
    "2027-03-26",
    "2027-04-14",
    "2027-08-15",
    "2027-10-02",
    "2027-12-25",
  ],
};

const EXPIRY_RULES = {
  NIFTY: [
    { from: "2021-01-01", to: "9999-12-31", weekday: 4, monthlyWeekday: 4, weeklyAvailable: true },
  ],
  BANKNIFTY: [
    { from: "2021-01-01", to: "2024-11-20", weekday: 4, monthlyWeekday: 4, weeklyAvailable: true },
    { from: "2024-11-20", to: "9999-12-31", weekday: 4, monthlyWeekday: 4, weeklyAvailable: false },
  ],
  SENSEX: [
    { from: "2022-01-01", to: "2025-01-01", weekday: 5, monthlyWeekday: 5, weeklyAvailable: true },
    { from: "2025-01-01", to: "9999-12-31", weekday: 2, monthlyWeekday: 2, weeklyAvailable: true },
  ],
};

const DATA_START = { NIFTY: "2021-05-01", BANKNIFTY: "2021-05-01", SENSEX: "2022-01-01" };

const payload = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: "src/lib/backtest/calendar (calendar.data.ts + expiry-rules.ts)",
  timezone: "Asia/Kolkata",
  session: { open: "09:15", close: "15:30", openMin: 555, closeMin: 930 },
  dataStart: DATA_START,
  expiryRules: EXPIRY_RULES,
  holidays: NSE_BSE_HOLIDAYS,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");
const total = Object.values(NSE_BSE_HOLIDAYS).reduce((n, a) => n + a.length, 0);
console.log(`wrote ${OUT}`);
console.log(`  ${total} holidays across ${Object.keys(NSE_BSE_HOLIDAYS).length} years`);
console.log(`  expiry rules for ${Object.keys(EXPIRY_RULES).length} indices`);
