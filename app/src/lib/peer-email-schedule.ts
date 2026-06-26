/**
 * peer-email-schedule.ts — pure (no I/O), unit-testable.
 *
 * Time-trigger logic for the peer bandwidth email. The email is decoupled from
 * cycle finalization (which still waits on director sign-off): it goes out at the
 * first Tuesday IST checkpoint where everyone has submitted and no conflicts are
 * open, otherwise unconditionally on Wednesday morning IST.
 *
 * Vercel crons fire in UTC; these helpers convert to IST (UTC+5:30) so the route
 * never relies on raw `Date.getDay()` (which would read the UTC day).
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Day-of-week in IST: 0=Sun, 1=Mon, … 6=Sat. */
export function istDayOfWeek(now: Date): number {
  return new Date(now.getTime() + IST_OFFSET_MS).getUTCDay();
}

/**
 * The `startDate` (YYYY-MM-DD) of the cycle that owns the current IST week — i.e.
 * this week's Monday in IST. Cycles are stamped with their Monday start date, so
 * the route looks the cycle up by this instead of grabbing the latest DB row
 * (which could be a stale or test cycle).
 */
export function currentCycleStartDate(now: Date): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const day = ist.getUTCDay(); // 0=Sun..6=Sat, in IST
  const diffToMonday = day === 0 ? -6 : 1 - day; // Monday = 1
  const monday = new Date(ist);
  monday.setUTCDate(ist.getUTCDate() + diffToMonday);
  return monday.toISOString().split('T')[0];
}

export type PeerEmailDecision =
  | { send: false; reason: string }
  | { send: true; trigger: 'tuesday' | 'wednesday' };

/**
 * Decide whether the peer email should go out now, given the IST weekday and the
 * cycle's outstanding work. Tuesday is conditional (all submitted AND no open
 * conflicts; director sign-off is intentionally ignored). Wednesday is the
 * unconditional fallback. Idempotency (send-once) is enforced by the caller via
 * the `peerEmailsSent` claim, not here.
 */
export function decidePeerEmail(params: {
  istDay: number;
  pendingTokens: number;
  pendingConflicts: number;
}): PeerEmailDecision {
  const { istDay, pendingTokens, pendingConflicts } = params;

  if (istDay === 2) {
    if (pendingTokens > 0) return { send: false, reason: `${pendingTokens} pending submission(s)` };
    if (pendingConflicts > 0) return { send: false, reason: `${pendingConflicts} pending conflict(s)` };
    return { send: true, trigger: 'tuesday' };
  }

  if (istDay === 3) {
    return { send: true, trigger: 'wednesday' };
  }

  return { send: false, reason: `IST day ${istDay} is not a peer-email checkpoint` };
}
