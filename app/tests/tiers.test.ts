import { describe, it, expect } from 'vitest';
import { getTier, TIER_ORDER } from '../src/lib/tiers';

describe('getTier', () => {
  it('maps VP/AVP directly', () => {
    expect(getTier('VP')).toBe('VP');
    expect(getTier('AVP')).toBe('AVP');
  });

  it('maps all Associate sub-tiers to Associate', () => {
    expect(getTier('Associate 1')).toBe('Associate');
    expect(getTier('Associate 2')).toBe('Associate');
    expect(getTier('Associate 3')).toBe('Associate');
  });

  it('maps Analyst', () => {
    expect(getTier('Analyst')).toBe('Analyst');
  });

  it('maps unknown designations to Analyst', () => {
    expect(getTier('Intern')).toBe('Analyst');
    expect(getTier('')).toBe('Analyst');
  });

  it('exports TIER_ORDER in expected order', () => {
    expect(TIER_ORDER).toEqual(['VP', 'AVP', 'Associate', 'Analyst']);
  });
});
