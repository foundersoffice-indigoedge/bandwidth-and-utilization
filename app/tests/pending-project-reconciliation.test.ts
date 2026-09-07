import { describe, expect, it } from 'vitest';
import {
  PendingProjectReconciliationHold,
  isExactSubmissionDuplicate,
  planSnapshotRepairs,
  planSubmissionReconciliation,
} from '@/lib/pending-project-reconciliation';

const source = {
  id: '11111111-1111-4111-8111-111111111111',
  cycleId: '22222222-2222-4222-8222-222222222222',
  fellowRecordId: 'recAdit',
  projectRecordId: 'pending_33333333-3333-4333-8333-333333333333',
  projectName: 'GPS Renewables',
  projectType: 'pitch' as const,
  hoursValue: 1,
  hoursUnit: 'per_day' as const,
  hoursPerDay: 1,
  hoursPerWeek: 6,
  autoScore: null,
  isSelfReport: true,
  targetFellowId: null,
  remarks: null,
  remarksClaimedAt: null,
  remarksProcessedAt: null,
};

describe('pending project reconciliation plan', () => {
  it('promotes a pending-only submission', () => {
    expect(planSubmissionReconciliation([source], [])).toEqual({
      collapseSubmissionIds: [],
      promoteSubmissionIds: [source.id],
    });
  });

  it('collapses one exact pending and canonical duplicate', () => {
    const canonical = { ...source, id: '44444444-4444-4444-8444-444444444444', projectRecordId: 'recCanonical' };
    expect(isExactSubmissionDuplicate(source, canonical)).toBe(true);
    expect(planSubmissionReconciliation([source], [canonical])).toEqual({
      collapseSubmissionIds: [source.id],
      promoteSubmissionIds: [],
    });
  });

  it('holds without partial planning when hours differ', () => {
    const canonical = { ...source, id: '44444444-4444-4444-8444-444444444444', projectRecordId: 'recCanonical', hoursValue: 2, hoursPerDay: 2, hoursPerWeek: 12 };
    expect(() => planSubmissionReconciliation([source], [canonical])).toThrow(PendingProjectReconciliationHold);
  });

  it('does not collapse when remarks differ', () => {
    const canonical = { ...source, id: '44444444-4444-4444-8444-444444444444', projectRecordId: 'recCanonical', remarks: 'Confirmed' };
    expect(() => planSubmissionReconciliation([source], [canonical])).toThrow(PendingProjectReconciliationHold);
  });

  it('removes an exact duplicate from a frozen snapshot and recalculates its total', () => {
    const snapshot = {
      id: '55555555-5555-4555-8555-555555555555',
      cycleId: source.cycleId,
      fellowRecordId: source.fellowRecordId,
      projectBreakdown: [
        { projectName: 'GPS Renewables', projectType: 'pitch' as const, hoursPerDay: 1, hoursPerWeek: 6 },
        { projectName: 'GPS Renewables Pitch | Aug 2026', projectType: 'pitch' as const, hoursPerDay: 1, hoursPerWeek: 6 },
      ],
      totalHoursPerWeek: 78,
      hoursUtilizationPct: 78 / 84,
      hoursLoadTag: 'At Capacity',
    } as Parameters<typeof planSnapshotRepairs>[0][number];
    const [repair] = planSnapshotRepairs(
      [snapshot],
      [source],
      new Set([source.id]),
      'recCanonical',
      'GPS Renewables Pitch | Aug 2026',
      source.projectRecordId,
    );
    expect(repair.newBreakdown).toEqual([
      { projectName: 'GPS Renewables Pitch | Aug 2026', projectType: 'pitch', hoursPerDay: 1, hoursPerWeek: 6 },
    ]);
    expect(repair.totalHoursPerWeek).toBe(72);
    expect(repair.hoursUtilizationPct).toBeCloseTo(72 / 84);
    expect(repair.hoursLoadTag).toBe('At Capacity');
  });

  it('renames a pending-only frozen snapshot line without changing totals', () => {
    const snapshot = {
      id: '55555555-5555-4555-8555-555555555555',
      cycleId: source.cycleId,
      fellowRecordId: source.fellowRecordId,
      projectBreakdown: [
        { projectName: 'GPS Renewables', projectType: 'pitch' as const, hoursPerDay: 1, hoursPerWeek: 6 },
      ],
      totalHoursPerWeek: 48,
      hoursUtilizationPct: 48 / 84,
      hoursLoadTag: 'Comfortable',
    } as Parameters<typeof planSnapshotRepairs>[0][number];
    const [repair] = planSnapshotRepairs(
      [snapshot],
      [source],
      new Set(),
      'recCanonical',
      'GPS Renewables Pitch | Aug 2026',
      source.projectRecordId,
    );
    expect(repair.newBreakdown[0]).toMatchObject({
      projectRecordId: 'recCanonical',
      projectName: 'GPS Renewables Pitch | Aug 2026',
    });
    expect(repair.totalHoursPerWeek).toBe(48);
  });

  it('repairs only the self-report line when a pending project also has a teammate projection', () => {
    const peerProjection = {
      ...source,
      id: '66666666-6666-4666-8666-666666666666',
      isSelfReport: false,
      targetFellowId: 'recTeammate',
      hoursValue: 3,
      hoursPerDay: 3,
      hoursPerWeek: 18,
    };
    const snapshot = {
      id: '55555555-5555-4555-8555-555555555555',
      cycleId: source.cycleId,
      fellowRecordId: source.fellowRecordId,
      projectBreakdown: [
        { projectRecordId: source.projectRecordId, projectName: source.projectName, projectType: 'pitch' as const, hoursPerDay: 1, hoursPerWeek: 6 },
      ],
      totalHoursPerWeek: 48,
      hoursUtilizationPct: 48 / 84,
      hoursLoadTag: 'Comfortable',
    } as Parameters<typeof planSnapshotRepairs>[0][number];

    const [repair] = planSnapshotRepairs(
      [snapshot],
      [source, peerProjection],
      new Set(),
      'recCanonical',
      'GPS Renewables Pitch | Aug 2026',
      source.projectRecordId,
    );

    expect(repair.newBreakdown).toEqual([
      { projectRecordId: 'recCanonical', projectName: 'GPS Renewables Pitch | Aug 2026', projectType: 'pitch', hoursPerDay: 1, hoursPerWeek: 6 },
    ]);
    expect(repair.totalHoursPerWeek).toBe(48);
  });

  it('does not require a frozen personal snapshot line for a peer-only projection', () => {
    const peerProjection = {
      ...source,
      id: '66666666-6666-4666-8666-666666666666',
      isSelfReport: false,
      targetFellowId: 'recTeammate',
      hoursValue: 3,
      hoursPerDay: 3,
      hoursPerWeek: 18,
    };
    const snapshot = {
      id: '55555555-5555-4555-8555-555555555555',
      cycleId: source.cycleId,
      fellowRecordId: source.fellowRecordId,
      projectBreakdown: [
        { projectRecordId: 'recOther', projectName: 'Other work', projectType: 'mandate' as const, hoursPerDay: 2, hoursPerWeek: 12 },
      ],
      totalHoursPerWeek: 48,
      hoursUtilizationPct: 48 / 84,
      hoursLoadTag: 'Comfortable',
    } as Parameters<typeof planSnapshotRepairs>[0][number];

    expect(planSnapshotRepairs(
      [snapshot],
      [peerProjection],
      new Set(),
      'recCanonical',
      'GPS Renewables Pitch | Aug 2026',
      source.projectRecordId,
    )).toEqual([]);
  });

  it('does not subtract a collapsed peer projection from the reporter snapshot', () => {
    const peerProjection = {
      ...source,
      id: '66666666-6666-4666-8666-666666666666',
      isSelfReport: false,
      targetFellowId: 'recTeammate',
      hoursValue: 3,
      hoursPerDay: 3,
      hoursPerWeek: 18,
    };
    const canonicalPeer = { ...peerProjection, id: '77777777-7777-4777-8777-777777777777', projectRecordId: 'recCanonical' };
    const plan = planSubmissionReconciliation([peerProjection], [canonicalPeer]);
    expect(plan.collapseSubmissionIds).toEqual([peerProjection.id]);

    const snapshot = {
      id: '55555555-5555-4555-8555-555555555555',
      cycleId: source.cycleId,
      fellowRecordId: source.fellowRecordId,
      projectBreakdown: [
        { projectRecordId: 'recOther', projectName: 'Other work', projectType: 'mandate' as const, hoursPerDay: 2, hoursPerWeek: 12 },
      ],
      totalHoursPerWeek: 12,
      hoursUtilizationPct: 12 / 84,
      hoursLoadTag: 'Comfortable',
    } as Parameters<typeof planSnapshotRepairs>[0][number];
    expect(planSnapshotRepairs(
      [snapshot],
      [peerProjection],
      new Set(plan.collapseSubmissionIds),
      'recCanonical',
      'GPS Renewables Pitch | Aug 2026',
      source.projectRecordId,
    )).toEqual([]);
    expect(snapshot.totalHoursPerWeek).toBe(12);
  });
});
