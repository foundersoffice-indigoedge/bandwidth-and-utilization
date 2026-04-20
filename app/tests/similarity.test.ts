import { describe, it, expect } from 'vitest';
import { similarity } from '../src/lib/similarity';

describe('similarity', () => {
  it('returns 1 for identical strings', () => {
    expect(similarity('acme', 'acme')).toBe(1);
  });

  it('returns high score for near matches', () => {
    expect(similarity('Acme Fundraise', 'Acme Corp Fundraise')).toBeGreaterThan(0.5);
  });

  it('returns low score for unrelated strings', () => {
    expect(similarity('Zomato pitch', 'Healthcare DDE')).toBeLessThan(0.2);
  });
});
