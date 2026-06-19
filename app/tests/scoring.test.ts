import { describe, it, expect } from 'vitest';
import { normalizeToHoursPerDay, normalizeToHoursPerWeek } from '../src/lib/scoring';

describe('normalizeToHoursPerDay', () => {
  it('returns per_day values unchanged', () => {
    expect(normalizeToHoursPerDay(4, 'per_day')).toBe(4);
  });

  it('divides per_week by 6', () => {
    expect(normalizeToHoursPerDay(12, 'per_week')).toBe(2);
  });

  it('handles zero', () => {
    expect(normalizeToHoursPerDay(0, 'per_week')).toBe(0);
  });
});

describe('normalizeToHoursPerWeek', () => {
  it('multiplies per_day by 6', () => {
    expect(normalizeToHoursPerWeek(4, 'per_day')).toBe(24);
  });

  it('returns per_week values unchanged', () => {
    expect(normalizeToHoursPerWeek(10, 'per_week')).toBe(10);
  });

  it('handles zero', () => {
    expect(normalizeToHoursPerWeek(0, 'per_day')).toBe(0);
  });

  it('handles fractional hours', () => {
    expect(normalizeToHoursPerWeek(1.5, 'per_day')).toBe(9);
  });
});
