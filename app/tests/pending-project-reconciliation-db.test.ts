import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockWhere, mockTransaction } = vi.hoisted(() => ({
  mockWhere: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: mockWhere }) }),
  },
  getSql: () => ({ transaction: mockTransaction }),
}));

import { reconcileCompletedPendingProject } from '@/lib/pending-project-reconciliation';

describe('pending project reconciliation database guards', () => {
  beforeEach(() => {
    mockWhere.mockReset();
    mockTransaction.mockReset();
  });

  it('snapshots existing canonical submissions and conflicts when the pending sets are empty', async () => {
    const canonicalSubmission = {
      id: '11111111-1111-4111-8111-111111111111',
      cycleId: '22222222-2222-4222-8222-222222222222',
      fellowRecordId: 'recFellow',
      projectRecordId: 'recCanonical',
      projectName: 'Canonical project',
      projectType: 'dde',
      hoursValue: 1,
      hoursUnit: 'per_day',
      hoursPerDay: 1,
      hoursPerWeek: 6,
      isSelfReport: true,
      targetFellowId: null,
      remarks: null,
    };
    const canonicalConflict = {
      id: '33333333-3333-4333-8333-333333333333',
      cycleId: canonicalSubmission.cycleId,
      projectRecordId: 'recCanonical',
      vpSubmissionId: canonicalSubmission.id,
      associateSubmissionId: '44444444-4444-4444-8444-444444444444',
      source: 'submission',
    };
    mockWhere
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([canonicalSubmission])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([canonicalConflict]);

    const captured: Array<{ sql: string; values: unknown[] }> = [];
    mockTransaction.mockImplementationOnce(async (build) => build((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = { sql: strings.join('?'), values };
      captured.push(query);
      return query;
    }));

    const result = await reconcileCompletedPendingProject({
      id: '55555555-5555-4555-8555-555555555555',
      status: 'awaiting_setup',
      airtableRecordId: 'recCanonical',
      airtableProjectName: 'Canonical project',
      referencesReconciledAt: null,
      name: 'Pending project',
    } as Parameters<typeof reconcileCompletedPendingProject>[0]);

    expect(mockWhere).toHaveBeenCalledTimes(4);
    const canonicalFingerprint = captured.find((query) => query.sql.includes('canonical_guard'))
      ?.values.find((value) => typeof value === 'string' && value.startsWith('['));
    const canonicalConflictFingerprint = captured.find((query) => query.sql.includes('canonical_conflict_guard'))
      ?.values.find((value) => typeof value === 'string' && value.startsWith('['));
    expect(JSON.parse(canonicalFingerprint as string)).toEqual([
      expect.objectContaining({ id: canonicalSubmission.id }),
    ]);
    expect(JSON.parse(canonicalConflictFingerprint as string)).toEqual([
      expect.objectContaining({ id: canonicalConflict.id }),
    ]);
    expect(result).toEqual({
      promotedSubmissions: 0,
      collapsedDuplicates: 0,
      updatedConflicts: 0,
      repairedSnapshots: 0,
    });
  });
});
