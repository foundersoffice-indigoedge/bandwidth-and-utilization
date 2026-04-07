import { describe, it, expect } from 'vitest';
import { generateNarrative } from '../src/lib/airtable/writeback';

describe('generateNarrative', () => {
  it('formats a mandate narrative with multiple fellows', () => {
    const result = generateNarrative('Acme Corp', 'mandate', '2026-05-04', [
      { fellowName: 'Sai K', score: 3, hoursPerDay: 4, stage: 'Live' },
      { fellowName: 'Ravi P', score: 2, hoursPerDay: 2, stage: 'Live' },
    ]);

    expect(result).toContain('Acme Corp');
    expect(result).toContain('2026-05-04');
    expect(result).toContain('Sai K');
    expect(result).toContain('Score 3');
    expect(result).toContain('4 hrs/day');
    expect(result).toContain('Ravi P');
    expect(result).toContain('Score 2');
    expect(result).toContain('2 hrs/day');
  });

  it('includes stage context when provided', () => {
    const result = generateNarrative('Beta Inc', 'dde', '2026-05-04', [
      { fellowName: 'Jay M', score: 1, hoursPerDay: 0.3, stage: 'Research' },
    ]);

    expect(result).toContain('Research');
  });
});
