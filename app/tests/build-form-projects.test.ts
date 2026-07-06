import { describe, it, expect } from 'vitest';
import { buildFormProjects } from '../src/app/submit/[token]/build-form-projects';
import type { ProjectAssignment, Fellow } from '../src/types';

const fellows: Fellow[] = [
  { recordId: 'recTanya', name: 'Tanya', email: 't@x.com', designation: 'AVP' },
  { recordId: 'recAdit', name: 'Adit', email: 'a@x.com', designation: 'AVP' },
  { recordId: 'recAssoc', name: 'Assoc', email: 'c@x.com', designation: 'Associate 2' },
];

function project(o: Partial<ProjectAssignment>): ProjectAssignment {
  return { projectRecordId: 'recP', projectName: 'P', projectType: 'mandate',
    stage: 'Mandate Signed', vpAvpIds: [], associateIds: [], directorIds: [], ...o };
}

describe('buildFormProjects', () => {
  it('senior AVP sees associate inputs and no role pill (director-led → no lead line)', () => {
    const p = project({ projectRecordId: 'fresh', vpAvpIds: ['recAdit'], associateIds: ['recAssoc'] });
    const [fp] = buildFormProjects([p], 'recAdit', 'AVP', fellows);
    expect(fp.associates.map(a => a.recordId)).toEqual(['recAssoc']);
    expect(fp.performedRole).toBe('senior');
    expect(fp.performedRoleLabel).toBeNull();
    expect(fp.leadFellowName).toBeUndefined(); // not VP-run → no "Led by" line
  });

  it('AVP in the associate slot sees self only and a "Performing Associate role" pill; no lead line on a director-led mandate', () => {
    const p = project({ projectRecordId: 'pant', vpAvpIds: ['recTanya'], associateIds: ['recAdit'] });
    const [fp] = buildFormProjects([p], 'recAdit', 'AVP', fellows);
    expect(fp.associates).toEqual([]);
    expect(fp.performedRole).toBe('associate');
    expect(fp.performedRoleLabel).toBe('Performing Associate role');
    expect(fp.leadFellowName).toBeUndefined(); // director-led → the director leads, not shown here
  });

  it('second VP/AVP sees self only', () => {
    const p = project({ projectRecordId: 'two', vpAvpIds: ['recTanya', 'recAdit'], associateIds: ['recAssoc'] });
    const [fp] = buildFormProjects([p], 'recAdit', 'AVP', fellows);
    expect(fp.associates).toEqual([]);
    expect(fp.performedRole).toBe('second_senior');
  });

  it('shows "Led by <lead VP>" only on a VP-run mandate (from the Airtable-populated lead)', () => {
    // Airtable sets leadFellowName only for VP-run mandates; buildFormProjects passes it through verbatim.
    const p = project({
      projectRecordId: 'vprun', vpAvpIds: ['recTanya'], associateIds: ['recAssoc'],
      isVpRun: true, leadFellowRecordId: 'recTanya', leadFellowName: 'Tanya',
    });
    const [fp] = buildFormProjects([p], 'recAssoc', 'Associate 2', fellows);
    expect(fp.isVpRun).toBe(true);
    expect(fp.leadFellowName).toBe('Tanya');
  });
});
