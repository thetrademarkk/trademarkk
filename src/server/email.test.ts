import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

let client: Client;
const db = (() => {
  client = createClient({ url: ":memory:" });
  return drizzle(client);
})();

vi.mock("./db/platform", () => ({ platformDb: db }));

beforeAll(async () => {
  // Only the columns the throttle touches are needed.
  await client.execute(
    `CREATE TABLE user (
      email TEXT PRIMARY KEY,
      last_password_reset_email_at INTEGER,
      password_reset_email_count_today INTEGER NOT NULL DEFAULT 0,
      last_verification_email_at INTEGER,
      verification_email_count_today INTEGER NOT NULL DEFAULT 0,
      last_otp_email_at INTEGER,
      otp_email_count_today INTEGER NOT NULL DEFAULT 0
    )`
  );
});

afterAll(() => client.close());

const EMAIL = "user@example.com";

beforeEach(async () => {
  await client.execute(`DELETE FROM user`);
  await client.execute({ sql: `INSERT INTO user (email) VALUES (?)`, args: [EMAIL] });
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-13T06:00:00.000Z")); // ~11:30 IST
});

afterEach(() => vi.useRealTimers());

async function resetCount() {
  const r = await client.execute({
    sql: `SELECT password_reset_email_count_today AS c, last_password_reset_email_at AS t FROM user WHERE email = ?`,
    args: [EMAIL],
  });
  return { count: Number(r.rows[0]!.c), lastAt: r.rows[0]!.t as number | null };
}

describe("emailDayKey", () => {
  it("returns the IST calendar date for an epoch", async () => {
    const { emailDayKey } = await import("./email");
    // 2026-06-13 19:00 UTC = 2026-06-14 00:30 IST → next day.
    expect(emailDayKey(Date.parse("2026-06-13T19:00:00Z"))).toBe("2026-06-14");
    // 2026-06-13 17:00 UTC = 2026-06-13 22:30 IST → same day.
    expect(emailDayKey(Date.parse("2026-06-13T17:00:00Z"))).toBe("2026-06-13");
  });
});

describe("checkEmailThrottle", () => {
  it("allows the first send and records lastAt + count", async () => {
    const { checkEmailThrottle } = await import("./email");
    expect(await checkEmailThrottle(EMAIL, "reset")).toBe(true);
    const { count, lastAt } = await resetCount();
    expect(count).toBe(1);
    expect(lastAt).toBe(Date.now());
  });

  it("blocks a second send inside the cooldown window", async () => {
    const { checkEmailThrottle } = await import("./email");
    expect(await checkEmailThrottle(EMAIL, "reset")).toBe(true);
    // 1h later — still inside the 6h reset cooldown.
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    expect(await checkEmailThrottle(EMAIL, "reset")).toBe(false);
    // Count must not advance on a blocked send.
    expect((await resetCount()).count).toBe(1);
  });

  it("allows again once the cooldown has elapsed", async () => {
    const { checkEmailThrottle } = await import("./email");
    expect(await checkEmailThrottle(EMAIL, "reset")).toBe(true);
    // 6h + 1min later — cooldown cleared (still same IST day so count climbs).
    vi.setSystemTime(Date.now() + (6 * 60 + 1) * 60 * 1000);
    expect(await checkEmailThrottle(EMAIL, "reset")).toBe(true);
    expect((await resetCount()).count).toBe(2);
  });

  it("blocks once the daily cap is reached", async () => {
    const { checkEmailThrottle } = await import("./email");
    // OTP: 5min cooldown, daily cap 3. Step past cooldown each time, same day.
    expect(await checkEmailThrottle(EMAIL, "otp")).toBe(true); // 1
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    expect(await checkEmailThrottle(EMAIL, "otp")).toBe(true); // 2
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    expect(await checkEmailThrottle(EMAIL, "otp")).toBe(true); // 3 (cap)
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    expect(await checkEmailThrottle(EMAIL, "otp")).toBe(false); // 4 > cap
  });

  it("resets the daily counter on a new IST day", async () => {
    const { checkEmailThrottle } = await import("./email");
    // Exhaust the verification daily cap (5) on day 1.
    for (let i = 0; i < 5; i++) {
      expect(await checkEmailThrottle(EMAIL, "verification")).toBe(true);
      vi.setSystemTime(Date.now() + 61 * 60 * 1000); // > 1h cooldown
    }
    // 6th send same day is capped.
    expect(await checkEmailThrottle(EMAIL, "verification")).toBe(false);

    // Jump to the next IST day → counter resets inline, send allowed, count = 1.
    vi.setSystemTime(new Date("2026-06-14T06:00:00.000Z"));
    expect(await checkEmailThrottle(EMAIL, "verification")).toBe(true);
    const r = await client.execute({
      sql: `SELECT verification_email_count_today AS c FROM user WHERE email = ?`,
      args: [EMAIL],
    });
    expect(Number(r.rows[0]!.c)).toBe(1);
  });

  it("allows (no-throttle) when the account does not exist", async () => {
    const { checkEmailThrottle } = await import("./email");
    expect(await checkEmailThrottle("ghost@example.com", "reset")).toBe(true);
  });

  it("tracks each kind independently", async () => {
    const { checkEmailThrottle } = await import("./email");
    expect(await checkEmailThrottle(EMAIL, "reset")).toBe(true);
    // A reset send does not consume the verification or otp allowance.
    expect(await checkEmailThrottle(EMAIL, "verification")).toBe(true);
    expect(await checkEmailThrottle(EMAIL, "otp")).toBe(true);
  });
});
