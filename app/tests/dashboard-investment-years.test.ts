import { describe, expect, it } from 'vitest';
import { getAvailableInvestmentYears } from '../src/lib/dashboard-investment-years';

describe('getAvailableInvestmentYears', () => {
  it('keeps prior investment years available alongside the current IY', () => {
    expect(getAvailableInvestmentYears(
      ['2025-07-01', '2026-06-30', '2026-07-01'],
      2027,
    )).toEqual([2026, 2027]);
  });

  it('deduplicates years and always includes the current IY', () => {
    expect(getAvailableInvestmentYears(
      ['2025-08-04', '2025-09-01'],
      2027,
    )).toEqual([2026, 2027]);
  });
});
