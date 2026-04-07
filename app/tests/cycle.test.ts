import { describe, it, expect } from 'vitest';
import { isCycleMonday } from '../src/lib/schedule';

describe('isCycleMonday', () => {
  it('returns true for the reference date Apr 20 2026', () => {
    expect(isCycleMonday(new Date('2026-04-20'))).toBe(true);
  });

  it('returns false for Apr 27 2026 (off-week Monday)', () => {
    expect(isCycleMonday(new Date('2026-04-27'))).toBe(false);
  });

  it('returns true for May 4 2026 (2 weeks after reference)', () => {
    expect(isCycleMonday(new Date('2026-05-04'))).toBe(true);
  });

  it('returns true for May 18 2026 (4 weeks after reference)', () => {
    expect(isCycleMonday(new Date('2026-05-18'))).toBe(true);
  });

  it('returns false for a Tuesday', () => {
    expect(isCycleMonday(new Date('2026-04-21'))).toBe(false);
  });

  it('returns false for dates before the reference', () => {
    expect(isCycleMonday(new Date('2026-04-06'))).toBe(false);
  });
});
