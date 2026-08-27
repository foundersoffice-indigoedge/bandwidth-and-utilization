const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
export const CONFLICT_REMINDER_MIN_AGE_MS = 24 * 60 * 60 * 1000;

export function isSameIstDay(a: Date | null, b: Date): boolean {
  if (!a) return false;
  const aDay = new Date(a.getTime() + IST_OFFSET_MS).toISOString().split('T')[0];
  const bDay = new Date(b.getTime() + IST_OFFSET_MS).toISOString().split('T')[0];
  return aDay === bDay;
}

/** A reminder needs a successful original email, a full 24-hour grace period, and a new IST day. */
export function isConflictReminderEligible(input: {
  now: Date;
  emailSentAt: Date | null;
  lastReminderSentAt: Date | null;
}): boolean {
  const { now, emailSentAt, lastReminderSentAt } = input;
  if (!emailSentAt) return false;
  if (now.getTime() - emailSentAt.getTime() < CONFLICT_REMINDER_MIN_AGE_MS) return false;
  return !isSameIstDay(lastReminderSentAt, now);
}
