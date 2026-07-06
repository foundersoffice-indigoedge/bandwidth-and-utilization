import { describe, it, expect } from 'vitest';
import {
  determineSeniorId,
  resolveProjectRole,
  computeAllowedTargets,
  isAllowedSubmissionEntry,
} from '../src/lib/project-role';
import type { ProjectAssignment } from '../src/types';

function project(o: Partial<ProjectAssignment>): ProjectAssignment {
  return {
    projectRecordId: 'recP', projectName: 'P', projectType: 'mandate',
    stage: 'Mandate Signed', vpAvpIds: [], associateIds: [], directorIds: [], ...o,
  };
}

// Eligibility predicate: everyone listed here is an eligible VP/AVP.
const eligible = (ids: string[]) => (id: string) => ids.includes(id);

describe('determineSeniorId', () => {
  it('picks the first eligible VP/AVP in slot order', () => {
    expect(determineSeniorId(['recA', 'recB'], [], eligible(['recA', 'recB']))).toBe('recA');
  });
  it('skips a non-eligible slot-1 occupant (e.g. a Director) for the next eligible VP/AVP', () => {
    expect(determineSeniorId(['recDir', 'recAvp'], [], eligible(['recAvp']))).toBe('recAvp');
  });
  it('falls back to an eligible VP/AVP in the director slot when no VP/AVP occupant', () => {
    expect(determineSeniorId([], ['recLeadVp'], eligible(['recLeadVp']))).toBe('recLeadVp');
  });
  it('returns null when there is no eligible senior anywhere', () => {
    expect(determineSeniorId(['recDir'], ['recDir2'], eligible([]))).toBeNull();
  });
});

describe('resolveProjectRole', () => {
  it('senior projects for all associate-slot occupants', () => {
    const p = project({ vpAvpIds: ['recSenior'], associateIds: ['recA1', 'recA2'] });
    expect(resolveProjectRole(p, 'recSenior', eligible(['recSenior']))).toEqual({
      role: 'senior', isSenior: true, targetFellowIds: ['recA1', 'recA2'],
    });
  });
  it('second VP/AVP submits self only, projects for nobody', () => {
    const p = project({ vpAvpIds: ['recSenior', 'recSecond'], associateIds: ['recA1'] });
    expect(resolveProjectRole(p, 'recSecond', eligible(['recSenior', 'recSecond']))).toEqual({
      role: 'second_senior', isSenior: false, targetFellowIds: [],
    });
  });
  it('AVP in an associate slot is an associate here (self only), covered by the senior', () => {
    // Adit (AVP) sits in the associate column; Tanya is the senior.
    const p = project({ vpAvpIds: ['recTanya'], associateIds: ['recAdit'] });
    expect(resolveProjectRole(p, 'recAdit', eligible(['recTanya', 'recAdit']))).toEqual({
      role: 'associate', isSenior: false, targetFellowIds: [],
    });
    // And the senior's targets include Adit:
    expect(resolveProjectRole(p, 'recTanya', eligible(['recTanya', 'recAdit'])).targetFellowIds)
      .toContain('recAdit');
  });
  it('no eligible senior → an associate still self-only, nobody projects', () => {
    const p = project({ vpAvpIds: [], associateIds: ['recAdit'], directorIds: ['recRealDirector'] });
    expect(resolveProjectRole(p, 'recAdit', eligible([]))).toEqual({
      role: 'associate', isSenior: false, targetFellowIds: [],
    });
  });
});

describe('computeAllowedTargets', () => {
  it('maps each project to the set of ids the fellow may project for', () => {
    const p1 = project({ projectRecordId: 'p1', vpAvpIds: ['recMe'], associateIds: ['recA1'] });
    const p2 = project({ projectRecordId: 'p2', vpAvpIds: ['recOther'], associateIds: ['recMe'] });
    const map = computeAllowedTargets([p1, p2], 'recMe', eligible(['recMe', 'recOther']));
    expect(map.get('p1')).toEqual(new Set(['recA1'])); // senior on p1
    expect(map.get('p2')).toEqual(new Set());          // associate on p2
  });
});

describe('isAllowedSubmissionEntry', () => {
  const p1 = project({ projectRecordId: 'p1', vpAvpIds: ['recMe'], associateIds: ['recA1'] });
  const p2 = project({ projectRecordId: 'p2', vpAvpIds: ['recOther'], associateIds: ['recMe'] });
  const allowed = computeAllowedTargets([p1, p2], 'recMe', eligible(['recMe', 'recOther']));
  const onProjects = new Set(['p1', 'p2']);

  it('allows a self-report on a project the fellow is on', () => {
    expect(isAllowedSubmissionEntry({ projectRecordId: 'p1', targetFellowId: null }, allowed, onProjects)).toBe(true);
  });
  it('rejects a self-report on a project the fellow is NOT on', () => {
    expect(isAllowedSubmissionEntry({ projectRecordId: 'pX', targetFellowId: null }, allowed, onProjects)).toBe(false);
  });
  it('allows a senior projection to a real associate', () => {
    expect(isAllowedSubmissionEntry({ projectRecordId: 'p1', targetFellowId: 'recA1' }, allowed, onProjects)).toBe(true);
  });
  it('rejects a projection where the fellow is only an associate (p2)', () => {
    expect(isAllowedSubmissionEntry({ projectRecordId: 'p2', targetFellowId: 'recSomeone' }, allowed, onProjects)).toBe(false);
  });
});
