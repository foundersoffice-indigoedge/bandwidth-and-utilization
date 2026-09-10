import { describe, expect, it } from 'vitest';
import {
  filterLiveSelfReports,
  reconcileLiveSelfReports,
} from '../src/lib/airtable/projects';
import type { ProjectAssignment } from '../src/types';

const active: ProjectAssignment[] = [];
const sub = (projectRecordId: string) => ({ projectRecordId });

describe('submitted-work preservation', () => {
  it.each([
    ['a project that is now inactive', 'recInactive'],
    ['a project that is now deleted', 'recDeleted'],
    ['a project whose team has changed', 'recReassignedOff'],
    ['a pending project', 'pending_new'],
  ])('keeps %s', (_label, projectRecordId) => {
    expect(filterLiveSelfReports(
      [sub(projectRecordId)], active, 'recFormerEmployee', 'Former designation',
    )).toEqual([sub(projectRecordId)]);
  });

  it('keeps every submitted entry and reports no new exclusion', () => {
    const submitted = [sub('recClosed'), sub('recOffTeam'), sub('pending_x')];
    expect(reconcileLiveSelfReports(
      submitted, active, 'recFormerEmployee', 'Former designation',
    )).toEqual({ submissions: submitted, excludedProjectCount: 0 });
  });
});
