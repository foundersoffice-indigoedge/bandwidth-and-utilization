import { describe, expect, it } from 'vitest';
import { validateAndResolveSubmissionEntries } from '../src/lib/submission-validation';
import type { ProjectAssignment } from '../src/types';

const seniorId = 'recSenior';
const teammateId = 'recTeammate';
const otherId = 'recOther';

const regularProject: ProjectAssignment = {
  projectRecordId: 'recRegular',
  projectName: 'Regular DDE',
  projectType: 'dde',
  stage: 'DDE In Progress',
  vpAvpIds: [seniorId],
  associateIds: [teammateId],
  directorIds: [],
};

function validate(entries: unknown, overrides: Partial<Parameters<typeof validateAndResolveSubmissionEntries>[1]> = {}) {
  return validateAndResolveSubmissionEntries(entries, {
    token: {
      cycleId: 'cycle-1',
      fellowRecordId: teammateId,
      fellowDesignation: 'Associate 2',
    },
    allProjects: [regularProject],
    pendingProjects: [{
      id: 'pending-1',
      cycleId: 'cycle-1',
      type: 'dde',
      name: 'Rubick AI',
      teammateRecordIds: [teammateId],
      createdByFellowId: seniorId,
    }],
    isEligibleVpAvp: id => id === seniorId,
    ...overrides,
  });
}

describe('pending-project submission validation', () => {
  it('accepts a teammate self-report even when no self-report was pre-created', () => {
    const result = validate([{
      projectRecordId: 'pending_pending-1',
      targetFellowId: null,
      hoursValue: 2,
      hoursUnit: 'per_day',
    }]);

    expect(result).toMatchObject({
      ok: true,
      entries: [{
        projectRecordId: 'pending_pending-1',
        projectName: 'Rubick AI',
        projectType: 'dde',
        isSelfReport: true,
        seniorFellowId: seniorId,
        hoursPerDay: 2,
        hoursPerWeek: 12,
      }],
    });
  });

  it('allows the senior creator to project for a listed teammate', () => {
    const result = validate([{
      projectRecordId: 'pending_pending-1',
      targetFellowId: teammateId,
      hoursValue: 12,
      hoursUnit: 'per_week',
    }], {
      token: { cycleId: 'cycle-1', fellowRecordId: seniorId, fellowDesignation: 'AVP' },
    });

    expect(result).toMatchObject({ ok: true, entries: [{ isSelfReport: false, hoursPerDay: 2, hoursPerWeek: 12 }] });
  });

  it('rejects a projection from a non-creator participant before any persistence can begin', () => {
    const result = validate([{
      projectRecordId: 'pending_pending-1',
      targetFellowId: seniorId,
      hoursValue: 2,
      hoursUnit: 'per_day',
    }]);

    expect(result).toEqual({
      ok: false,
      error: 'You are not allowed to report bandwidth for this pending-project teammate.',
    });
  });

  it('rejects a non-participant, an unknown project, malformed hours, and duplicate entries', () => {
    const nonParticipant = validate([{
      projectRecordId: 'pending_pending-1', targetFellowId: null, hoursValue: 1, hoursUnit: 'per_day',
    }], { token: { cycleId: 'cycle-1', fellowRecordId: otherId, fellowDesignation: 'Associate 2' } });
    expect(nonParticipant).toMatchObject({ ok: false, error: 'You are not a participant on this pending project.' });

    const unknownProject = validate([{
      projectRecordId: 'pending_missing', targetFellowId: null, hoursValue: 1, hoursUnit: 'per_day',
    }]);
    expect(unknownProject).toMatchObject({ ok: false, error: expect.stringContaining('no longer available') });

    const badHours = validate([{
      projectRecordId: 'pending_pending-1', targetFellowId: null, hoursValue: -1, hoursUnit: 'per_day',
    }]);
    expect(badHours).toEqual({ ok: false, error: 'Hours must be a valid non-negative number.' });

    const duplicate = validate([
      { projectRecordId: 'pending_pending-1', targetFellowId: null, hoursValue: 1, hoursUnit: 'per_day' },
      { projectRecordId: 'pending_pending-1', targetFellowId: null, hoursValue: 2, hoursUnit: 'per_day' },
    ]);
    expect(duplicate).toEqual({ ok: false, error: 'Each project and fellow combination can be submitted only once.' });
  });

  it('keeps regular-project membership and senior target rules intact', () => {
    const self = validate([{
      projectRecordId: 'recRegular', targetFellowId: null, hoursValue: 12, hoursUnit: 'per_week',
    }]);
    expect(self).toMatchObject({ ok: true, entries: [{ isSelfReport: true, hoursPerWeek: 12 }] });

    const unauthorizedProjection = validate([{
      projectRecordId: 'recRegular', targetFellowId: seniorId, hoursValue: 2, hoursUnit: 'per_day',
    }]);
    expect(unauthorizedProjection).toEqual({ ok: false, error: 'You are not allowed to submit that project entry.' });
  });
});
