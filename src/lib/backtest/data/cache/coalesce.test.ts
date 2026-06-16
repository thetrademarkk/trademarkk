/**
 * coalesce.ts unit tests — request COALESCING + the HF sliding-window rate-limit
 * "busy" signal (07-data-layer.md §3a). Pure logic only: the coalescer is tested
 * with deferred promises, the limiter with an INJECTED fake clock — no real
 * timers or network.
 */

import { describe, expect, it, vi } from "vitest";
import {
  HF_MAX_REQUESTS,
  HF_SOFT_LIMIT,
  HF_WINDOW_MS,
  RateLimiter,
  RequestCoalescer,
} from "./coalesce";

describe("RequestCoalescer", () => {
  it("coalesces identical in-flight reads onto one factory call", async () => {
    const c = new RequestCoalescer();
    const factory = vi.fn(async () => {
      await Promise.resolve();
      return 42;
    });
    const [a, b, d] = await Promise.all([
      c.run("k", factory),
      c.run("k", factory),
      c.run("k", factory),
    ]);
    expect(factory).toHaveBeenCalledTimes(1);
    expect([a, b, d]).toEqual([42, 42, 42]);
  });

  it("clears the key after settling so a later read re-runs", async () => {
    const c = new RequestCoalescer();
    let calls = 0;
    const factory = async () => ++calls;
    await c.run("k", factory);
    expect(c.has("k")).toBe(false);
    const second = await c.run("k", factory);
    expect(second).toBe(2);
    expect(calls).toBe(2);
  });

  it("clears the key on failure (a 429 blip never poisons the key)", async () => {
    const c = new RequestCoalescer();
    await expect(
      c.run("k", async () => {
        throw new Error("429");
      })
    ).rejects.toThrow("429");
    expect(c.has("k")).toBe(false);
    // A retry succeeds.
    await expect(c.run("k", async () => "ok")).resolves.toBe("ok");
  });

  it("keeps distinct keys independent", async () => {
    const c = new RequestCoalescer();
    const fa = vi.fn(async () => "a");
    const fb = vi.fn(async () => "b");
    await Promise.all([c.run("a", fa), c.run("b", fb)]);
    expect(fa).toHaveBeenCalledTimes(1);
    expect(fb).toHaveBeenCalledTimes(1);
  });
});

describe("RateLimiter — sliding window", () => {
  function fakeClock(start = 0) {
    let t = start;
    return { now: () => t, set: (v: number) => (t = v), add: (v: number) => (t += v) };
  }

  it("counts reads inside the window and ages them out", () => {
    const clk = fakeClock(0);
    const rl = new RateLimiter(3000, 1000, 2700, clk.now);
    rl.record();
    rl.record();
    expect(rl.count()).toBe(2);
    // Advance past the window — both age out.
    clk.set(1001);
    expect(rl.count()).toBe(0);
  });

  it("reports busy once the soft limit is crossed", () => {
    const clk = fakeClock(0);
    const rl = new RateLimiter(10, 1000, 8, clk.now);
    for (let i = 0; i < 7; i++) rl.record();
    expect(rl.state().busy).toBe(false);
    expect(rl.canRequest()).toBe(true);
    rl.record(); // 8 → at soft limit
    const s = rl.state();
    expect(s.busy).toBe(true);
    expect(s.requestsInWindow).toBe(8);
    expect(rl.canRequest()).toBe(false);
  });

  it("computes retryAfterMs from the oldest stamp aging out", () => {
    const clk = fakeClock(0);
    const rl = new RateLimiter(10, 1000, 2, clk.now);
    rl.record(); // t=0
    clk.set(100);
    rl.record(); // t=100 → 2 in window → busy
    clk.set(200);
    const s = rl.state();
    expect(s.busy).toBe(true);
    // Oldest stamp (t=0) ages out at t=1000; now=200 → retry in 800ms.
    expect(s.retryAfterMs).toBe(800);
  });

  it("flags the hard limit separately from the soft limit", () => {
    const clk = fakeClock(0);
    const rl = new RateLimiter(3, 1000, 2, clk.now);
    rl.record();
    rl.record();
    expect(rl.atHardLimit()).toBe(false);
    rl.record();
    expect(rl.atHardLimit()).toBe(true);
  });

  it("reset clears the window", () => {
    const clk = fakeClock(0);
    const rl = new RateLimiter(10, 1000, 2, clk.now);
    rl.record();
    rl.record();
    rl.reset();
    expect(rl.count()).toBe(0);
    expect(rl.state().busy).toBe(false);
  });

  it("default knobs match the HF 3000/300s contract", () => {
    expect(HF_MAX_REQUESTS).toBe(3000);
    expect(HF_WINDOW_MS).toBe(300_000);
    expect(HF_SOFT_LIMIT).toBe(2700);
  });
});
