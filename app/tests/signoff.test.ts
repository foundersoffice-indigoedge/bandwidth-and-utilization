import { describe, it, expect } from 'vitest';
import { getDirectorSliceStatus, type SliceInput } from '../src/lib/signoff';
import type { ProjectAssignment } from '../src/types';

const baseProject = (id: string, overrides: Partial<ProjectAssignment> = {}): ProjectAssignment => ({
  projectRecordId: id,
  projectName: id,
  projectType: 'mandate',
  stage: 'In Production',
  vpAvpIds: [],
  associateIds: [],
  directorIds: [],
  ...overrides,
});

describe('getDirectorSliceStatus', () => {
  it('returns incomplete when a project has a pending token', () => {
    const input: SliceInput = {
      directorFellowId: 'recDirector1',
      projects: [baseProject('p1', { directorIds: ['recDirector1'], associateIds: ['recA'] })],
      tokens: [{ projectRecordId: 'p1', fellowRecordId: 'recA', status: 'pending' }],
      submissions: [],
      conflicts: [],
    };
    expect(getDirectorSliceStatus(input)).toBe('incomplete');
  });

  it('returns complete when all tokens are non-pending and no conflicts on the project', () => {
    const input: SliceInput = {
      directorFellowId: 'recDirector1',
      projects: [baseProject('p1', { directorIds: ['recDirector1'], associateIds: ['recA'] })],
      tokens: [{ projectRecordId: 'p1', fellowRecordId: 'recA', status: 'submitted' }],
      submissions: [{ id: 'sub1', projectRecordId: 'p1', fellowRecordId: 'recA' }],
      conflicts: [],
    };
    expect(getDirectorSliceStatus(input)).toBe('complete');
  });

  it('returns incomplete when a submission-level conflict on the project is pending', () => {
    const input: SliceInput = {
      directorFellowId: 'recDirector1',
      projects: [baseProject('p1', { directorIds: ['recDirector1'], associateIds: ['recA'] })],
      tokens: [{ projectRecordId: 'p1', fellowRecordId: 'recA', status: 'submitted' }],
      submissions: [{ id: 'sub1', projectRecordId: 'p1', fellowRecordId: 'recA' }],
      conflicts: [{ projectRecordId: 'p1', status: 'pending', source: 'submission' }],
    };
    expect(getDirectorSliceStatus(input)).toBe('incomplete');
  });

  it('ignores resolved conflicts on the project', () => {
    const input: SliceInput = {
      directorFellowId: 'recDirector1',
      projects: [baseProject('p1', { directorIds: ['recDirector1'], associateIds: ['recA'] })],
      tokens: [{ projectRecordId: 'p1', fellowRecordId: 'recA', status: 'submitted' }],
      submissions: [{ id: 'sub1', projectRecordId: 'p1', fellowRecordId: 'recA' }],
      conflicts: [{ projectRecordId: 'p1', status: 'resolved', source: 'submission' }],
    };
    expect(getDirectorSliceStatus(input)).toBe('complete');
  });

  it('ignores pending director_flag conflicts (defensive — should not block re-check)', () => {
    const input: SliceInput = {
      directorFellowId: 'recDirector1',
      projects: [baseProject('p1', { directorIds: ['recDirector1'], associateIds: ['recA'] })],
      tokens: [{ projectRecordId: 'p1', fellowRecordId: 'recA', status: 'submitted' }],
      submissions: [{ id: 'sub1', projectRecordId: 'p1', fellowRecordId: 'recA' }],
      conflicts: [{ projectRecordId: 'p1', status: 'pending', source: 'director_flag' }],
    };
    expect(getDirectorSliceStatus(input)).toBe('complete');
  });

  it('excludes projects with zero submissions (no team to sign off on)', () => {
    const input: SliceInput = {
      directorFellowId: 'recDirector1',
      projects: [
        baseProject('p1', { directorIds: ['recDirector1'], associateIds: ['recA'] }),
        baseProject('p2', { directorIds: ['recDirector1'], associateIds: [] }),  // no team
      ],
      tokens: [{ projectRecordId: 'p1', fellowRecordId: 'recA', status: 'submitted' }],
      submissions: [{ id: 'sub1', projectRecordId: 'p1', fellowRecordId: 'recA' }],
      conflicts: [],
    };
    expect(getDirectorSliceStatus(input)).toBe('complete');
  });

  it('returns incomplete when director has multiple projects and one has a pending token', () => {
    const input: SliceInput = {
      directorFellowId: 'recDirector1',
      projects: [
        baseProject('p1', { directorIds: ['recDirector1'], associateIds: ['recA'] }),
        baseProject('p2', { directorIds: ['recDirector1'], associateIds: ['recB'] }),
      ],
      tokens: [
        { projectRecordId: 'p1', fellowRecordId: 'recA', status: 'submitted' },
        { projectRecordId: 'p2', fellowRecordId: 'recB', status: 'pending' },
      ],
      submissions: [{ id: 'sub1', projectRecordId: 'p1', fellowRecordId: 'recA' }],
      conflicts: [],
    };
    expect(getDirectorSliceStatus(input)).toBe('incomplete');
  });

  it('returns complete when director has no projects in scope (vacuous)', () => {
    const input: SliceInput = {
      directorFellowId: 'recDirector1',
      projects: [baseProject('p1', { directorIds: ['recOther'] })],  // different director
      tokens: [],
      submissions: [],
      conflicts: [],
    };
    expect(getDirectorSliceStatus(input)).toBe('complete');
  });
});
