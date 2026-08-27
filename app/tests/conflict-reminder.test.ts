import { describe, expect, it } from 'vitest';
import { isConflictReminderEligible } from '../src/lib/conflict-reminder';

describe('conflict reminder eligibility', () => {
  const sentAt = new Date('2026-08-25T04:30:00.000Z');

  it('holds a new conflict for a full 24 hours after its original email', () => {
    expect(isConflictReminderEligible({
      now: new Date('2026-08-26T04:29:59.999Z'),
      emailSentAt: sentAt,
      lastReminderSentAt: null,
    })).toBe(false);
  });

  it('allows a genuine active conflict after 24 hours', () => {
    expect(isConflictReminderEligible({
      now: new Date('2026-08-26T04:30:00.000Z'),
      emailSentAt: sentAt,
      lastReminderSentAt: null,
    })).toBe(true);
  });

  it('keeps the once-per-IST-day cadence after the grace period', () => {
    expect(isConflictReminderEligible({
      now: new Date('2026-08-27T04:30:00.000Z'),
      emailSentAt: sentAt,
      lastReminderSentAt: new Date('2026-08-27T01:00:00.000Z'),
    })).toBe(false);
    expect(isConflictReminderEligible({
      now: new Date('2026-08-27T19:00:00.000Z'),
      emailSentAt: sentAt,
      lastReminderSentAt: new Date('2026-08-27T01:00:00.000Z'),
    })).toBe(true);
  });
});
