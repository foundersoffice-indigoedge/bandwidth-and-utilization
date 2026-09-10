import { describe, expect, it } from 'vitest';
import {
  findSubmissionRemarks,
  formatExcludedProjectsNotice,
} from '../src/lib/dashboard-reconciliation';

describe('formatExcludedProjectsNotice', () => {
  it('uses singular wording for one excluded project', () => {
    expect(formatExcludedProjectsNotice(1)).toBe(
      '1 project entry was excluded by an older report. Its submitted hours remain in the underlying record.',
    );
  });

  it('uses plural wording for multiple excluded projects', () => {
    expect(formatExcludedProjectsNotice(2)).toBe(
      '2 project entries were excluded by an older report. Their submitted hours remain in the underlying records.',
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
