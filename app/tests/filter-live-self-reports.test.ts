import { describe, it, expect } from 'vitest';
import { filterLiveSelfReports } from '../src/lib/airtable/projects';
import type { ProjectAssignment } from '../src/types';

function project(o: Partial<ProjectAssignment>): ProjectAssignment {
  return {
    projectRecordId: 'recP', projectName: 'P', projectType: 'mandate',
    stage: 'Mandate Signed', vpAvpIds: [], associateIds: [], directorIds: [], ...o,
  };
}

// active-stage project set (as fetchAllProjects would return — already stage-filtered)
const active: ProjectAssignment[] = [
  project({ projectRecordId: 'recOnAsVp', vpAvpIds: ['recMe'] }),
  project({ projectRecordId: 'recOnAsAssoc', vpAvpIds: ['recOther'], associateIds: ['recMe'] }),
  project({ projectRecordId: 'recLedFromDirector', directorIds: ['recMe'] }),
  project({ projectRecordId: 'recReassignedOff', vpAvpIds: ['recOther'], associateIds: ['recSomeoneElse'] }),
];

// note: 'recDeleted' and 'recInactive' are deliberately absent from `active`.
const sub = (projectRecordId: string) => ({ projectRecordId });

describe('filterLiveSelfReports', () => {
  it('keeps a project the fellow is on as a VP/AVP', () => {
    const out = filterLiveSelfReports([sub('recOnAsVp')], active, 'recMe', 'VP');
    expect(out.map(s => s.projectRecordId)).toEqual(['recOnAsVp']);
  });

  it('keeps a project the fellow is on as an associate', () => {
    const out = filterLiveSelfReports([sub('recOnAsAssoc')], active, 'recMe', 'Associate 2');
    expect(out.map(s => s.projectRecordId)).toEqual(['recOnAsAssoc']);
  });

  it('keeps a VP/AVP who leads from the director slot', () => {
    const out = filterLiveSelfReports([sub('recLedFromDirector')], active, 'recMe', 'VP');
    expect(out.map(s => s.projectRecordId)).toEqual(['recLedFromDirector']);
  });

  it('does NOT grant director-slot membership to a non-VP/AVP', () => {
    const out = filterLiveSelfReports([sub('recLedFromDirector')], active, 'recMe', 'Associate 1');
    expect(out).toEqual([]);
  });

  it('always keeps a mid-cycle pending project (even though it is not in activeProjects)', () => {
    const out = filterLiveSelfReports([sub('pending_abc123')], active, 'recMe', 'VP');
    expect(out.map(s => s.projectRecordId)).toEqual(['pending_abc123']);
  });

  it('drops a deleted / inactive-stage project (absent from activeProjects)', () => {
    const out = filterLiveSelfReports([sub('recDeleted'), sub('recInactive')], active, 'recMe', 'VP');
    expect(out).toEqual([]);
  });

  it('drops a project the fellow was reassigned off of (present, but not on the team)', () => {
    const out = filterLiveSelfReports([sub('recReassignedOff')], active, 'recMe', 'VP');
    expect(out).toEqual([]);
  });

  it('filters a mixed batch to exactly the live rows', () => {
    const batch = [
      sub('recOnAsVp'),        // keep
      sub('recDeleted'),       // drop (deleted)
      sub('recReassignedOff'), // drop (off team)
      sub('pending_x'),        // keep (pending)
      sub('recOnAsAssoc'),     // keep
    ];
    const out = filterLiveSelfReports(batch, active, 'recMe', 'VP');
    expect(out.map(s => s.projectRecordId)).toEqual(['recOnAsVp', 'pending_x', 'recOnAsAssoc']);
  });
});
