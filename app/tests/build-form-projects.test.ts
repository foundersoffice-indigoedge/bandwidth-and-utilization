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
  it('senior AVP sees associate inputs and no acting-as pill', () => {
    const p = project({ projectRecordId: 'fresh', vpAvpIds: ['recAdit'], associateIds: ['recAssoc'] });
    const [fp] = buildFormProjects([p], 'recAdit', 'AVP', fellows);
    expect(fp.associates.map(a => a.recordId)).toEqual(['recAssoc']);
    expect(fp.performedRole).toBe('senior');
    expect(fp.performedRoleLabel).toBeNull();
    expect(fp.leadFellowName).toBe('Adit'); // senior on this mandate
  });

  it('AVP in the associate slot sees self only, an "acting as Associate" pill, and the real senior as lead', () => {
    const p = project({ projectRecordId: 'pant', vpAvpIds: ['recTanya'], associateIds: ['recAdit'] });
    const [fp] = buildFormProjects([p], 'recAdit', 'AVP', fellows);
    expect(fp.associates).toEqual([]);
    expect(fp.performedRole).toBe('associate');
    expect(fp.performedRoleLabel).toBe('acting as Associate');
    expect(fp.leadFellowName).toBe('Tanya'); // lead line shows the senior even on a director-led mandate
  });

  it('second VP/AVP sees self only', () => {
    const p = project({ projectRecordId: 'two', vpAvpIds: ['recTanya', 'recAdit'], associateIds: ['recAssoc'] });
    const [fp] = buildFormProjects([p], 'recAdit', 'AVP', fellows);
    expect(fp.associates).toEqual([]);
    expect(fp.performedRole).toBe('second_senior');
  });
});
