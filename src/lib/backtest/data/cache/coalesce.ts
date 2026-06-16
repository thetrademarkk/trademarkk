/**
 * Request COALESCING + the HF rate-limit "data busy" signal (07-data-layer.md §3a
 * caveats). HuggingFace enforces 3000 requests / 300s per IP against the dataset
 * CDN; a backtest can fan out many identical reads (the same expiry file, the same
 * coverage manifest) across legs/days. This module:
 *
 *   1. COALESCES identical in-flight reads onto ONE promise (keyed by the logical
 *      request key) so N callers asking for the same slice trigger ONE network
 *      read — the single biggest lever against the rate limit.
 *   2. Tracks a SLIDING 300s request window and exposes a graceful `busy` signal
 *      the UI can surface ("data engine is catching up…") before HF returns 429,
 *      plus a throttle that delays new reads when the window is near the cap.
 *
 * Pure + injectable: the clock is a `now()` seam so the sliding window is fully
 * unit-testable with a fake clock and no real timers/network.
 */

/* ───────────────────────────── rate-limit knobs ──────────────────────────── */

/** HF limit: requests allowed per window, per IP (07-data-layer §3a). */
export const HF_MAX_REQUESTS = 3000;
/** HF window length in milliseconds (300 seconds). */
export const HF_WINDOW_MS = 300_000;
/**
 * Soft ceiling we self-throttle at — a safety margin below the hard 3000 so we
 * surface `busy` and slow down BEFORE HF starts returning 429s. 90% of the cap.
 */
export const HF_SOFT_LIMIT = Math.floor(HF_MAX_REQUESTS * 0.9);

/* ───────────────────────────── coalescing map ────────────────────────────── */

/**
 * Coalesces identical in-flight async reads. Callers pass a stable `key` (the
 * cache key works) and a factory; concurrent callers with the same key share the
 * one in-flight promise. The entry is dropped when it settles (success OR
 * failure) so a later read can retry — a transient 429/network blip never poisons
 * the key permanently.
 */
export class RequestCoalescer {
  private readonly inflight = new Map<string, Promise<unknown>>();

  /** Number of reads currently in flight (distinct keys). */
  get size(): number {
    return this.inflight.size;
  }

  /** Is a read for this key already running? */
  has(key: string): boolean {
    return this.inflight.has(key);
  }

  /**
   * Run `factory` for `key`, or join the existing in-flight promise. The shared
   * promise is removed once it settles.
   */
  run<T>(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const p = factory().finally(() => {
      // Only clear if it's still THIS promise (a re-entrant run could have swapped).
      if (this.inflight.get(key) === p) this.inflight.delete(key);
    });
    this.inflight.set(key, p);
    return p;
  }

  /** Drop all in-flight tracking (does NOT cancel the underlying promises). */
  clear(): void {
    this.inflight.clear();
  }
}

/* ─────────────────────────── sliding-window limiter ──────────────────────── */

/** Snapshot of the limiter the UI consumes for its busy/coverage state. */
export interface BusyState {
  /** Reads counted inside the current 300s window. */
  requestsInWindow: number;
  /** True once the window crosses the soft limit — surface a busy banner. */
  busy: boolean;
  /** Ms until at least one request ages out of the window (0 when not busy). */
  retryAfterMs: number;
}

/**
 * A sliding-window request counter over the HF 300s budget. `record()` stamps each
 * NETWORK read (coalesced reads count once — call it inside the coalescer factory,
 * not per joined caller). `state()` reports whether we should throttle. Pure
 * w.r.t. an injected `now()` clock so it is unit-testable with a fake clock.
 */
export class RateLimiter {
  /** Ascending epoch-ms timestamps of reads still inside the window. */
  private readonly stamps: number[] = [];

  constructor(
    private readonly maxRequests: number = HF_MAX_REQUESTS,
    private readonly windowMs: number = HF_WINDOW_MS,
    private readonly softLimit: number = HF_SOFT_LIMIT,
    private readonly now: () => number = Date.now
  ) {}

  /** Drop timestamps older than the window relative to `at`. */
  private prune(at: number): void {
    const cutoff = at - this.windowMs;
    let i = 0;
    while (i < this.stamps.length && this.stamps[i]! <= cutoff) i++;
    if (i > 0) this.stamps.splice(0, i);
  }

  /** Record one network read at the current time. */
  record(): void {
    const t = this.now();
    this.prune(t);
    this.stamps.push(t);
  }

  /** Count of reads inside the live window. */
  count(): number {
    this.prune(this.now());
    return this.stamps.length;
  }

  /**
   * Can we issue another read right now without crossing the SOFT limit? When this
   * is false the caller should serve from cache only or show the busy state and
   * retry after `state().retryAfterMs`.
   */
  canRequest(): boolean {
    return this.count() < this.softLimit;
  }

  /** True once we've hit the HARD cap — issuing more would risk a 429. */
  atHardLimit(): boolean {
    return this.count() >= this.maxRequests;
  }

  /** The UI-facing snapshot. */
  state(): BusyState {
    const t = this.now();
    this.prune(t);
    const n = this.stamps.length;
    const busy = n >= this.softLimit;
    // The oldest stamp ages out one window-length after it was recorded.
    const oldest = this.stamps[0];
    const retryAfterMs = busy && oldest !== undefined ? Math.max(0, oldest + this.windowMs - t) : 0;
    return { requestsInWindow: n, busy, retryAfterMs };
  }

  /** Reset the window (e.g. on a hard error recovery). */
  reset(): void {
    this.stamps.length = 0;
  }
}
