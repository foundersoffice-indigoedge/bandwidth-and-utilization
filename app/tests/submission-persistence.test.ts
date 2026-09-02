import { describe, expect, it, vi } from 'vitest';
import { createSubmissionConflict, upsertSubmission } from '../src/lib/submission-persistence';

const savedRow = {
  id: 'sub-1', cycleId: 'cycle-1', fellowRecordId: 'recFellow', projectRecordId: 'pending-1',
  projectName: 'Rubick AI', projectType: 'dde' as const, hoursValue: 2, hoursUnit: 'per_day' as const,
  hoursPerDay: 2, hoursPerWeek: 12, isSelfReport: true, targetFellowId: null, remarks: null,
};

const upsertInput = {
  ...savedRow,
  seniorFellowId: 'recSenior',
  remarks: null,
};

describe('submission persistence', () => {
  it('returns the row produced by an atomic self-report upsert', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [savedRow] });
    await expect(upsertSubmission({ execute }, upsertInput)).resolves.toEqual(savedRow);
    expect(execute).toHaveBeenCalledOnce();
  });

  it('returns the row produced by an atomic projection upsert', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ ...savedRow, isSelfReport: false, targetFellowId: 'recTarget' }] });
    await expect(upsertSubmission({ execute }, {
      ...upsertInput,
      isSelfReport: false,
      targetFellowId: 'recTarget',
    })).resolves.toMatchObject({ isSelfReport: false, targetFellowId: 'recTarget' });
  });

  it('fails loudly when an upsert does not return the saved row', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    await expect(upsertSubmission({ execute }, upsertInput)).rejects.toThrow('did not return a row');
  });

  it('returns null when an existing conflict makes a retry a no-op', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    await expect(createSubmissionConflict({ execute }, {
      cycleId: 'cycle-1', projectRecordId: 'pending-1', vpSubmissionId: 'vp-1', associateSubmissionId: 'assoc-1',
      vpHoursPerDay: 4, associateHoursPerDay: 2, resolutionToken: 'resolution-1',
    })).resolves.toBeNull();
  });
});
