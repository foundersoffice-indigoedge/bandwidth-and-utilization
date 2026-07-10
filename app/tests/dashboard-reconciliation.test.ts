import { describe, expect, it } from 'vitest';
import { formatExcludedProjectsNotice } from '../src/lib/dashboard-reconciliation';

describe('formatExcludedProjectsNotice', () => {
  it('uses singular wording for one excluded project', () => {
    expect(formatExcludedProjectsNotice(1)).toBe(
      '1 submitted project was excluded because its Airtable stage or team assignment changed after submission.',
    );
  });

  it('uses plural wording for multiple excluded projects', () => {
    expect(formatExcludedProjectsNotice(2)).toBe(
      '2 submitted projects were excluded because their Airtable stage or team assignment changed after submission.',
    );
  });
});
