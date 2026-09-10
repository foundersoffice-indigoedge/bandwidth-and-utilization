import { describe, expect, it } from 'vitest';
import { buildReconciledUtilization } from '../src/lib/reconciled-utilization';
import type { ProjectAssignment } from '../src/types';

const activeProjects: ProjectAssignment[] = [{
  projectRecordId: 'recActive',
  projectName: 'Active Mandate',
  projectType: 'mandate',
  stage: 'Mandate Signed',
  vpAvpIds: [],
  associateIds: ['recMe'],
  directorIds: [],
}];

const sub = (projectRecordId: string, hoursPerWeek: number) => ({
  projectRecordId,
  projectName: projectRecordId,
  projectType: 'mandate' as const,
  hoursPerDay: hoursPerWeek / 6,
  hoursPerWeek,
});

describe('buildReconciledUtilization', () => {
  it('returns null when the fellow has no raw self-report', () => {
    expect(buildReconciledUtilization(
      [], activeProjects, 'recMe', 'Associate 1',
    )).toBeNull();
  });

  it('preserves submitted work when the project is no longer active', () => {
    const result = buildReconciledUtilization(
      [sub('recInactive', 60)],
      activeProjects,
      'recMe',
      'Associate 1',
    );

    expect(result).toMatchObject({
      totalHoursPerWeek: 60,
      excludedProjectCount: 0,
    });
  });

  it('calculates load from every submitted project', () => {
    const result = buildReconciledUtilization(
      [sub('recActive', 26), sub('recInactive', 60)],
      activeProjects,
      'recMe',
      'Associate 1',
    );

    expect(result?.submissions.map(s => s.projectRecordId)).toEqual(['recActive', 'recInactive']);
    expect(result?.totalHoursPerWeek).toBe(86);
    expect(result?.hoursUtilizationPct).toBeCloseTo(86 / 84, 4);
    expect(result?.loadTag).toBe('Overloaded');
    expect(result?.excludedProjectCount).toBe(0);
  });

  it('falls back to canonical weekly hours when hoursPerWeek is null', () => {
    const result = buildReconciledUtilization(
      [{
        projectRecordId: 'recActive',
        projectName: 'Active Mandate',
        projectType: 'mandate' as const,
        hoursPerDay: 4,
        hoursPerWeek: null,
      }],
      activeProjects,
      'recMe',
      'Associate 1',
    );

    expect(result).toMatchObject({
      totalHoursPerWeek: 24,
      loadTag: 'Free',
    });
    expect(result?.hoursUtilizationPct).toBeCloseTo(24 / 84, 4);
  });

  it('keeps a pending project that is absent from active Airtable projects', () => {
    const pendingSubmission = sub('pending_new_pitch', 18);
    const result = buildReconciledUtilization(
      [pendingSubmission],
      activeProjects,
      'recMe',
      'Associate 1',
    );

    expect(result?.totalHoursPerWeek).toBe(18);
    expect(result?.submissions).toEqual([pendingSubmission]);
    expect(result?.excludedProjectCount).toBe(0);
  });
});
