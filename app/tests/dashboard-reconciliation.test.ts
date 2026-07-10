import { describe, expect, it } from 'vitest';
import {
  findSubmissionRemarks,
  formatExcludedProjectsNotice,
} from '../src/lib/dashboard-reconciliation';

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

describe('findSubmissionRemarks', () => {
  it('keeps a raw self-report remark when every reconciled project is excluded', () => {
    const rawSelfReports = [
      { projectRecordId: 'recExcluded1', remarks: null },
      { projectRecordId: 'recExcluded2', remarks: '   ' },
      { projectRecordId: 'recExcluded3', remarks: '  Follow up on outreach  ' },
      { projectRecordId: 'recExcluded4', remarks: 'Later remark' },
    ];
    const reconciledSubmissions: typeof rawSelfReports = [];

    expect(reconciledSubmissions).toEqual([]);
    expect(findSubmissionRemarks(rawSelfReports)).toBe('Follow up on outreach');
  });

  it('returns null when raw self-reports contain no remark', () => {
    expect(findSubmissionRemarks([
      { remarks: null },
      { remarks: '' },
      { remarks: '   ' },
    ])).toBeNull();
  });
});
