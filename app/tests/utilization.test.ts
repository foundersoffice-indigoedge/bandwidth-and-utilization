import { describe, it, expect } from 'vitest';
import { sumMeu, calculateUtilization, getLoadTag } from '../src/lib/utilization';

describe('sumMeu', () => {
  it('sums an array of MEU values', () => {
    expect(sumMeu([1.00, 0.75, 0.30])).toBeCloseTo(2.05);
  });

  it('returns 0 for empty array', () => {
    expect(sumMeu([])).toBe(0);
  });

  it('handles single value', () => {
    expect(sumMeu([1.50])).toBe(1.50);
  });
});

describe('calculateUtilization', () => {
  it('calculates totalMeu / capacityMeu', () => {
    expect(calculateUtilization(2.25, 3.0)).toBeCloseTo(0.75);
  });

  it('returns 0 when capacity is 0', () => {
    expect(calculateUtilization(1.0, 0)).toBe(0);
  });

  it('can exceed 1.0 for overloaded fellows', () => {
    expect(calculateUtilization(4.0, 3.0)).toBeCloseTo(1.333, 2);
  });

  it('returns 0 when totalMeu is 0', () => {
    expect(calculateUtilization(0, 3.0)).toBe(0);
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
