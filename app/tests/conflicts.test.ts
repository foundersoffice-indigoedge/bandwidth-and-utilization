import { describe, it, expect } from 'vitest';
import { isConflict, CONFLICT_THRESHOLD_HOURS } from '../src/lib/conflicts';

describe('isConflict', () => {
  it('exports threshold as 1 hour', () => {
    expect(CONFLICT_THRESHOLD_HOURS).toBe(1);
  });

  it('returns false when difference is 0', () => {
    expect(isConflict(4, 4)).toBe(false);
  });

  it('returns false when difference is under 1 hr', () => {
    expect(isConflict(4, 3.5)).toBe(false);
    expect(isConflict(3, 3.8)).toBe(false);
  });

  it('returns false when difference is exactly 1 hr', () => {
    expect(isConflict(4, 3)).toBe(false);
  });

  it('returns true when difference exceeds 1 hr', () => {
    expect(isConflict(4, 2.5)).toBe(true);
  });

  it('detects conflict regardless of direction', () => {
    expect(isConflict(1, 2.5)).toBe(true);
  });

  it('handles small decimals', () => {
    expect(isConflict(2.01, 1)).toBe(true);
    expect(isConflict(2.0, 1)).toBe(false);
  });
});
