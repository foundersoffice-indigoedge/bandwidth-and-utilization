import { describe, it, expect } from 'vitest';
import { TABLE_CONFIG } from '@/lib/airtable/config';

// The mandate active-stage list is now derived from the shared rule
// (shared.stages.mandate in ie-agent-rules), not hardcoded here. This locks the
// derived values to exactly what Utilization MIS relied on before the migration,
// so a bad rule edit fails CI instead of silently changing utilization.
describe('shared mandate stage contract', () => {
  it('derives exactly the active mandate stages', () => {
    expect(new Set(TABLE_CONFIG.mandate.activeStages)).toEqual(
      new Set([
        'Not Started',
        'In Production',
        'In GTM',
        'In Docs',
        'Closing',
        'Term Sheet Signed',
        'DD Started',
      ]),
    );
  });
});
