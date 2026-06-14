/**
 * NSE/BSE trading-holiday tables 2021–2027 + per-index data-start anchors — DATA
 * for the backtest market calendar (modelled on brokers.ts: a verifiable, dated
 * table the pure calendar functions read, never an external API at runtime).
 *
 * Scope: FULL-DAY equity/F&O closures on the NSE/BSE cash+derivatives segments.
 * Muhurat (special evening) sessions are NOT trading days for an intraday
 * backtest and are intentionally excluded — the engine treats them as closed.
 * Holiday dates are the published NSE/BSE trading-holiday lists for each year
 * (cross-checked against Zerodha/Groww/exchange circulars). 2026 mirrors the
 * NSE/BSE entries already vetted in src/lib/market-calendar.ts.
 *
 * 2027 is forward-looking and based on the announced/expected closures; it is
 * marked clearly so a future correction is a one-line data edit, never an
 * engine change. The engine never queries beyond the dataset tail anyway.
 *
 * Keys are years; values are IST calendar days "YYYY-MM-DD". A date appearing
 * here is closed for BOTH NSE and BSE (their equity-segment holiday lists are
 * identical). The list is the authority used by isTradingDay().
 */

import type { IndexSymbol } from "../../../features/backtest/shared/instruments";

/** Full-day NSE/BSE equity+F&O trading holidays, by year. */
export const NSE_BSE_HOLIDAYS: Record<number, readonly string[]> = {
  2021: [
    "2021-01-26", // Republic Day
    "2021-03-11", // Mahashivratri
    "2021-03-29", // Holi
    "2021-04-02", // Good Friday
    "2021-04-14", // Dr. Ambedkar Jayanti
    "2021-04-21", // Ram Navami
    "2021-05-13", // Id-ul-Fitr (Ramzan Id)
    "2021-07-21", // Bakri Id
    "2021-08-19", // Muharram
    "2021-09-10", // Ganesh Chaturthi
    "2021-10-15", // Dussehra
    "2021-11-04", // Diwali Laxmi Pujan (Muhurat — daytime closed)
    "2021-11-05", // Diwali Balipratipada
    "2021-11-19", // Guru Nanak Jayanti
  ],
  2022: [
    "2022-01-26", // Republic Day
    "2022-03-01", // Mahashivratri
    "2022-03-18", // Holi
    "2022-04-14", // Dr. Ambedkar Jayanti / Mahavir Jayanti
    "2022-04-15", // Good Friday
    "2022-05-03", // Id-ul-Fitr (Ramzan Id)
    "2022-08-09", // Muharram
    "2022-08-15", // Independence Day
    "2022-08-31", // Ganesh Chaturthi
    "2022-10-05", // Dussehra
    "2022-10-24", // Diwali Laxmi Pujan (Muhurat — daytime closed)
    "2022-10-26", // Diwali Balipratipada
    "2022-11-08", // Guru Nanak Jayanti
  ],
  2023: [
    "2023-01-26", // Republic Day
    "2023-03-07", // Holi
    "2023-03-30", // Ram Navami
    "2023-04-04", // Mahavir Jayanti
    "2023-04-07", // Good Friday
    "2023-04-14", // Dr. Ambedkar Jayanti
    "2023-05-01", // Maharashtra Day
    "2023-06-28", // Bakri Id
    "2023-08-15", // Independence Day
    "2023-09-19", // Ganesh Chaturthi
    "2023-10-02", // Mahatma Gandhi Jayanti
    "2023-10-24", // Dussehra
    "2023-11-14", // Diwali Balipratipada
    "2023-11-27", // Guru Nanak Jayanti
    "2023-12-25", // Christmas
  ],
  2024: [
    "2024-01-26", // Republic Day
    "2024-03-08", // Mahashivratri
    "2024-03-25", // Holi
    "2024-03-29", // Good Friday
    "2024-04-11", // Id-ul-Fitr (Ramzan Id)
    "2024-04-17", // Ram Navami
    "2024-05-01", // Maharashtra Day
    "2024-05-20", // General Elections (Mumbai voting)
    "2024-06-17", // Bakri Id
    "2024-07-17", // Muharram
    "2024-08-15", // Independence Day
    "2024-10-02", // Mahatma Gandhi Jayanti
    "2024-11-01", // Diwali Laxmi Pujan (Muhurat — daytime closed)
    "2024-11-15", // Guru Nanak Jayanti
    "2024-12-25", // Christmas
  ],
  2025: [
    "2025-02-26", // Mahashivratri
    "2025-03-14", // Holi
    "2025-03-31", // Id-ul-Fitr (Ramzan Id)
    "2025-04-10", // Mahavir Jayanti
    "2025-04-14", // Dr. Ambedkar Jayanti
    "2025-04-18", // Good Friday
    "2025-05-01", // Maharashtra Day
    "2025-08-15", // Independence Day
    "2025-08-27", // Ganesh Chaturthi
    "2025-10-02", // Mahatma Gandhi Jayanti / Dussehra
    "2025-10-21", // Diwali Laxmi Pujan (Muhurat — daytime closed)
    "2025-10-22", // Diwali Balipratipada
    "2025-11-05", // Guru Nanak Jayanti
    "2025-12-25", // Christmas
  ],
  2026: [
    "2026-01-15", // Maharashtra Municipal Corporation Elections
    "2026-01-26", // Republic Day
    "2026-03-03", // Holi
    "2026-03-26", // Ram Navami
    "2026-03-31", // Mahavir Jayanti
    "2026-04-03", // Good Friday
    "2026-04-14", // Dr. Ambedkar Jayanti
    "2026-05-01", // Maharashtra Day
    "2026-05-28", // Bakri Id
    "2026-06-26", // Muharram
    "2026-09-14", // Ganesh Chaturthi
    "2026-10-02", // Mahatma Gandhi Jayanti
    "2026-10-20", // Dussehra
    "2026-11-10", // Diwali Balipratipada
    "2026-11-24", // Guru Nanak Jayanti
    "2026-12-25", // Christmas
  ],
  // 2027 is forward-looking (announced/expected closures). The dataset does not
  // extend here yet; correct in one line if the published list differs.
  2027: [
    "2027-01-26", // Republic Day
    "2027-03-08", // Holi (expected)
    "2027-03-26", // Good Friday (expected)
    "2027-04-14", // Dr. Ambedkar Jayanti
    "2027-08-15", // Independence Day (Sunday — informational)
    "2027-10-02", // Mahatma Gandhi Jayanti
    "2027-12-25", // Christmas (Saturday — informational)
  ],
};

/**
 * Per-index first calendar day the dataset has data for. The engine returns
 * isTradingDay() === false before this so it never queries an empty partition.
 *   NIFTY / BANKNIFTY index data begins 2021-05; SENSEX begins 2022.
 */
export const DATA_START: Record<IndexSymbol, string> = {
  NIFTY: "2021-05-01",
  BANKNIFTY: "2021-05-01",
  SENSEX: "2022-01-01",
};

/** Flattened set of every holiday across all years for O(1) lookup. */
export const ALL_HOLIDAYS: ReadonlySet<string> = new Set(Object.values(NSE_BSE_HOLIDAYS).flat());
