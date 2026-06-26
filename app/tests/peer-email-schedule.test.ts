import { describe, it, expect } from 'vitest';
import {
  istDayOfWeek,
  currentCycleStartDate,
  decidePeerEmail,
} from '../src/lib/peer-email-schedule';

describe('istDayOfWeek', () => {
  it('maps a Monday 09:00 IST instant to Monday (1)', () => {
    // 2026-04-27 03:30 UTC = 09:00 IST Monday
    expect(istDayOfWeek(new Date('2026-04-27T03:30:00Z'))).toBe(1);
  });

  it('rolls into the next IST day across UTC midnight', () => {
    // 2026-04-27 20:00 UTC = 2026-04-28 01:30 IST (Tuesday)
    expect(istDayOfWeek(new Date('2026-04-27T20:00:00Z'))).toBe(2);
  });

  it('maps the Tuesday 10:00 IST checkpoint to Tuesday (2)', () => {
    // 04:30 UTC = 10:00 IST
    expect(istDayOfWeek(new Date('2026-04-28T04:30:00Z'))).toBe(2);
  });

  it('maps the Wednesday 09:00 IST checkpoint to Wednesday (3)', () => {
    // 03:30 UTC = 09:00 IST
    expect(istDayOfWeek(new Date('2026-04-29T03:30:00Z'))).toBe(3);
  });
});

describe('currentCycleStartDate', () => {
  it("returns this IST week's Monday for a Tuesday checkpoint", () => {
    expect(currentCycleStartDate(new Date('2026-04-28T04:30:00Z'))).toBe('2026-04-27');
  });

  it("returns this IST week's Monday for a Wednesday checkpoint", () => {
    expect(currentCycleStartDate(new Date('2026-04-29T03:30:00Z'))).toBe('2026-04-27');
  });

  it('returns the same Monday when evaluated on that Monday', () => {
    expect(currentCycleStartDate(new Date('2026-04-27T03:30:00Z'))).toBe('2026-04-27');
  });
});

describe('decidePeerEmail', () => {
  it('sends on Tuesday when no pending tokens and no pending conflicts', () => {
    expect(decidePeerEmail({ istDay: 2, pendingTokens: 0, pendingConflicts: 0 }))
      .toEqual({ send: true, trigger: 'tuesday' });
  });

  it('holds on Tuesday when a submission is still pending', () => {
    const d = decidePeerEmail({ istDay: 2, pendingTokens: 1, pendingConflicts: 0 });
    expect(d.send).toBe(false);
  });

  it('holds on Tuesday when a conflict is still pending', () => {
    const d = decidePeerEmail({ istDay: 2, pendingTokens: 0, pendingConflicts: 1 });
    expect(d.send).toBe(false);
  });

  it('sends on Wednesday unconditionally even with pending submissions and conflicts', () => {
    expect(decidePeerEmail({ istDay: 3, pendingTokens: 3, pendingConflicts: 2 }))
      .toEqual({ send: true, trigger: 'wednesday' });
  });

  it('does not send on any other day', () => {
    for (const istDay of [0, 1, 4, 5, 6]) {
      expect(decidePeerEmail({ istDay, pendingTokens: 0, pendingConflicts: 0 }).send).toBe(false);
    }
  });
});
