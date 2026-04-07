import { describe, it, expect } from 'vitest';
import { isConflict, CONFLICT_THRESHOLD_HOURS } from '../src/lib/conflicts';

describe('isConflict', () => {
  it('exports threshold as 2 hours', () => {
    expect(CONFLICT_THRESHOLD_HOURS).toBe(2);
  });

  it('returns false when difference is 0', () => {
    expect(isConflict(4, 4)).toBe(false);
  });

  it('returns false when difference is under 2 hrs', () => {
    expect(isConflict(4, 3)).toBe(false);
    expect(isConflict(3, 4.5)).toBe(false);
  });

  it('returns false when difference is exactly 2 hrs', () => {
    expect(isConflict(5, 3)).toBe(false);
  });

  it('returns true when difference exceeds 2 hrs', () => {
    expect(isConflict(6, 3)).toBe(true);
  });

  it('detects conflict regardless of direction', () => {
    expect(isConflict(1, 4)).toBe(true);
  });

  it('handles small decimals', () => {
    expect(isConflict(3.01, 1)).toBe(true);
    expect(isConflict(3.0, 1)).toBe(false);
  });
});
