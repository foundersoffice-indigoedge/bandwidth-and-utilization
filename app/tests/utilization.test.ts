import { describe, it, expect } from 'vitest';
import { getLoadTag, calculateHoursUtilization, WEEKLY_CAPACITY_HOURS } from '../src/lib/utilization';

describe('calculateHoursUtilization', () => {
  it('returns totalHoursPerWeek / 84', () => {
    expect(calculateHoursUtilization(42)).toBeCloseTo(0.5);
  });

  it('returns 0 for 0 hours', () => {
    expect(calculateHoursUtilization(0)).toBe(0);
  });

  it('returns 1.0 at exactly 84 hours', () => {
    expect(calculateHoursUtilization(84)).toBe(1.0);
  });

  it('exceeds 1.0 for hours over 84', () => {
    expect(calculateHoursUtilization(100)).toBeCloseTo(1.190, 2);
  });

  it('uses the correct constant (84)', () => {
    expect(WEEKLY_CAPACITY_HOURS).toBe(84);
  });
});

describe('getLoadTag', () => {
  it('Free for < 0.30', () => {
    expect(getLoadTag(0)).toBe('Free');
    expect(getLoadTag(0.15)).toBe('Free');
    expect(getLoadTag(0.29)).toBe('Free');
  });

  it('Comfortable for 0.30 to < 0.60', () => {
    expect(getLoadTag(0.30)).toBe('Comfortable');
    expect(getLoadTag(0.45)).toBe('Comfortable');
    expect(getLoadTag(0.59)).toBe('Comfortable');
  });

  it('Busy for 0.60 to < 0.85', () => {
    expect(getLoadTag(0.60)).toBe('Busy');
    expect(getLoadTag(0.75)).toBe('Busy');
    expect(getLoadTag(0.84)).toBe('Busy');
  });

  it('At Capacity for 0.85 to 1.00', () => {
    expect(getLoadTag(0.85)).toBe('At Capacity');
    expect(getLoadTag(0.95)).toBe('At Capacity');
    expect(getLoadTag(1.00)).toBe('At Capacity');
  });

  it('Overloaded for > 1.00', () => {
    expect(getLoadTag(1.01)).toBe('Overloaded');
    expect(getLoadTag(1.50)).toBe('Overloaded');
  });
});
