import { describe, it, expect } from 'vitest';
import { getProjectsForFellow } from '../src/lib/airtable/projects';
import type { ProjectAssignment } from '../src/types';

function project(overrides: Partial<ProjectAssignment>): ProjectAssignment {
  return {
    projectRecordId: 'recProj',
    projectName: 'Test Project',
    projectType: 'dde',
    stage: 'DDE In Progress',
    vpAvpIds: [],
    associateIds: [],
    directorIds: [],
    ...overrides,
  };
}

describe('getProjectsForFellow', () => {
  it('includes a project where the fellow is in vpAvpIds', () => {
    const p = project({ projectRecordId: 'p1', vpAvpIds: ['recVishnu'] });
    expect(getProjectsForFellow([p], 'recVishnu', 'VP')).toEqual([p]);
  });

  it('includes a project where the fellow is in associateIds', () => {
    const p = project({ projectRecordId: 'p1', associateIds: ['recAssoc'] });
    expect(getProjectsForFellow([p], 'recAssoc', 'Associate 2')).toEqual([p]);
  });

  it('excludes a project where the fellow appears in no role array', () => {
    const p = project({ projectRecordId: 'p1', vpAvpIds: ['recOther'] });
    expect(getProjectsForFellow([p], 'recVishnu', 'VP')).toEqual([]);
  });

  // Core fix: a VP/AVP who leads a DDE sits in the Director slot.
  it('includes a DDE where a VP is in the Director slot (and not the VP/AVP slot)', () => {
    const dde = project({ projectRecordId: 'shrinithi', directorIds: ['recVishnu'] });
    expect(getProjectsForFellow([dde], 'recVishnu', 'VP')).toEqual([dde]);
  });

  it('includes a director-slot project for an AVP too', () => {
    const dde = project({ projectRecordId: 'shrinithi', directorIds: ['recAvp'] });
    expect(getProjectsForFellow([dde], 'recAvp', 'AVP')).toEqual([dde]);
  });

  // Real Directors are excluded from the form upstream (not eligible fellows), but the
  // designation gate is the explicit guard: a true Director in the Director slot is never
  // pulled in via the director branch.
  it('excludes a project where a true Director sits in the Director slot', () => {
    const dde = project({ projectRecordId: 'shrinithi', directorIds: ['recRealDir'] });
    expect(getProjectsForFellow([dde], 'recRealDir', 'Director')).toEqual([]);
    expect(getProjectsForFellow([dde], 'recRealDir', 'Associate Director')).toEqual([]);
  });

  it('does not let an associate-grade fellow qualify via the Director slot', () => {
    const dde = project({ projectRecordId: 'shrinithi', directorIds: ['recAssoc'] });
    expect(getProjectsForFellow([dde], 'recAssoc', 'Associate 1')).toEqual([]);
  });

  // A polluted record may list the same VP in both Director and VP/AVP columns.
  // The filter must still return the project exactly once.
  it('returns the project once when the fellow is in both Director and VP/AVP columns', () => {
    const dde = project({
      projectRecordId: 'shrinithi',
      vpAvpIds: ['recVishnu'],
      directorIds: ['recVishnu'],
    });
    expect(getProjectsForFellow([dde], 'recVishnu', 'VP')).toEqual([dde]);
  });

  // Applies to all project types, not just DDEs (e.g. a VP leading a pitch).
  it('includes a pitch where a VP is in the Director slot', () => {
    const pitch = project({
      projectRecordId: 'p9',
      projectType: 'pitch',
      directorIds: ['recVishnu'],
    });
    expect(getProjectsForFellow([pitch], 'recVishnu', 'VP')).toEqual([pitch]);
  });

  it('returns empty when a VP leads nothing they are not on', () => {
    const dde = project({ projectRecordId: 'p1', directorIds: ['recOther'] });
    expect(getProjectsForFellow([dde], 'recVishnu', 'VP')).toEqual([]);
  });
});
