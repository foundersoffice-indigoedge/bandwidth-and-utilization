/**
 * Single source of truth for whether a director's flag is submittable.
 *
 * A flag is valid when it carries *something* to act on: either a proposed
 * correct value (0 or more — 0 means "should be zero / unallocated") or a
 * non-empty comment (e.g. "allocation not yet decided"). Shared by the server
 * guard in submitFlags and the client sign-off form so the two can't drift.
 *
 * Keep this module free of server-only imports (db, Slack, email) — it is
 * imported into the client bundle by the sign-off form.
 */
export function flagHasContent(f: { proposedHoursPerDay?: number; comment?: string }): boolean {
  const hasValue =
    typeof f.proposedHoursPerDay === 'number' &&
    Number.isFinite(f.proposedHoursPerDay) &&
    f.proposedHoursPerDay >= 0;
  const hasComment = typeof f.comment === 'string' && f.comment.trim() !== '';
  return hasValue || hasComment;
}
