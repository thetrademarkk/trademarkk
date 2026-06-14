/**
 * Shared polling policy for the community's many live surfaces.
 *
 * The app polls in several places — notifications (~60s), the DM inbox (~30s),
 * an open DM thread (~5s) and the "N new posts" feed pill (~25s). Left
 * unmanaged, every one of those keeps firing on a backgrounded tab, stacking
 * into a thundering herd that drains battery and burns serverless invocations
 * for nothing. This helper centralises ONE policy so every poll behaves the
 * same: it pauses while the tab is hidden and does a single fresh fetch the
 * moment focus returns. TanStack Query implements the hidden-tab pause via
 * `refetchIntervalInBackground: false` (it listens to `visibilitychange`
 * internally), and the focus refetch via `refetchOnWindowFocus: true`.
 *
 * Keeping the policy in a tiny pure function means it is unit-testable and can
 * never silently drift between hooks again.
 */

export interface PollOptions {
  /** Poll cadence in ms. */
  refetchInterval: number;
  /** Never poll while the tab is hidden. */
  refetchIntervalInBackground: false;
  /** Do one fresh fetch the moment the tab regains focus. */
  refetchOnWindowFocus: true;
}

/**
 * Standard background-aware poll options for a community live surface.
 *
 * @param intervalMs the poll cadence in milliseconds (must be a positive,
 *   finite number — a non-positive or non-finite value would either disable or
 *   busy-loop the poll, so it is rejected loudly).
 */
export function backgroundAwarePoll(intervalMs: number): PollOptions {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error(`backgroundAwarePoll: interval must be a positive number, got ${intervalMs}`);
  }
  return {
    refetchInterval: intervalMs,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  };
}
