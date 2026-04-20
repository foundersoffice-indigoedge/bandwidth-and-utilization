import { describe, it, expect } from 'vitest';
import { isCycleMonday } from '../src/lib/schedule';

describe('isCycleMonday (weekly cadence from 2026-04-27)', () => {
  it('returns false for 2026-04-20 — April 20 exception', () => {
    expect(isCycleMonday(new Date('2026-04-20'))).toBe(false);
  });

  it('returns true for 2026-04-27 (first weekly Monday)', () => {
    expect(isCycleMonday(new Date('2026-04-27'))).toBe(true);
  });

  it('returns true for every Monday after 2026-04-27', () => {
    expect(isCycleMonday(new Date('2026-05-04'))).toBe(true);
    expect(isCycleMonday(new Date('2026-05-11'))).toBe(true);
    expect(isCycleMonday(new Date('2026-06-08'))).toBe(true);
  });

  it('returns false for non-Mondays', () => {
    expect(isCycleMonday(new Date('2026-04-28'))).toBe(false);
    expect(isCycleMonday(new Date('2026-05-03'))).toBe(false);
  });

  it('returns false for Mondays before 2026-04-27', () => {
    expect(isCycleMonday(new Date('2026-04-13'))).toBe(false);
    expect(isCycleMonday(new Date('2026-04-06'))).toBe(false);
  });
});
