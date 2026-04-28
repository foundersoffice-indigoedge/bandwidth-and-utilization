import { describe, it, expect } from 'vitest';
import { deriveEntries, type ProjectShape, type HoursEntry } from '../src/app/submit/[token]/form-entries';

const mandate: ProjectShape = {
  projectRecordId: 'recMandate1',
  projectType: 'mandate',
  associates: [{ recordId: 'recAssoc1', name: 'Assoc One' }],
};

const dde: ProjectShape = {
  projectRecordId: 'recDde1',
  projectType: 'dde',
  associates: [{ recordId: 'recAssoc2', name: 'Assoc Two' }],
};

const pitch: ProjectShape = {
  projectRecordId: 'recPitch1',
  projectType: 'pitch',
  associates: [],
};

const newMandate: ProjectShape = {
  projectRecordId: 'pending_abc123',
  projectType: 'mandate',
  associates: [{ recordId: 'recAssoc3', name: 'Assoc Three' }],
  isNew: true,
};

const newDde: ProjectShape = {
  projectRecordId: 'pending_def456',
  projectType: 'dde',
  associates: [],
  isNew: true,
};

const newPitch: ProjectShape = {
  projectRecordId: 'pending_ghi789',
  projectType: 'pitch',
  associates: [{ recordId: 'recAssoc4', name: 'Assoc Four' }],
  isNew: true,
};

describe('deriveEntries — non-VP fellow', () => {
  it('creates one :self entry per project, ignoring associates', () => {
    const result = deriveEntries([mandate, dde, pitch], false, {});
    expect(Object.keys(result).sort()).toEqual([
      'recDde1:self',
      'recMandate1:self',
      'recPitch1:self',
    ]);
  });

  it('self entry has null targetFellowId and empty hours', () => {
    const result = deriveEntries([mandate], false, {});
    expect(result['recMandate1:self']).toEqual({
      projectRecordId: 'recMandate1',
      targetFellowId: null,
      hoursValue: '',
      hoursUnit: 'per_day',
    });
  });

  it('preserves prior user input for existing keys', () => {
    const prior: Record<string, HoursEntry> = {
      'recMandate1:self': {
        projectRecordId: 'recMandate1',
        targetFellowId: null,
        hoursValue: '4.5',
        hoursUnit: 'per_week',
      },
    };
    const result = deriveEntries([mandate, dde], false, prior);
    expect(result['recMandate1:self'].hoursValue).toBe('4.5');
    expect(result['recMandate1:self'].hoursUnit).toBe('per_week');
    expect(result['recDde1:self'].hoursValue).toBe('');
  });
});

describe('deriveEntries — VP fellow', () => {
  it('creates :self + one entry per associate for each project', () => {
    const result = deriveEntries([mandate, dde], true, {});
    expect(Object.keys(result).sort()).toEqual([
      'recDde1:recAssoc2',
      'recDde1:self',
      'recMandate1:recAssoc1',
      'recMandate1:self',
    ]);
  });

  it('associate entry has correct targetFellowId', () => {
    const result = deriveEntries([mandate], true, {});
    expect(result['recMandate1:recAssoc1']).toEqual({
      projectRecordId: 'recMandate1',
      targetFellowId: 'recAssoc1',
      hoursValue: '',
      hoursUnit: 'per_day',
    });
  });

  it('handles project with zero associates', () => {
    const result = deriveEntries([pitch], true, {});
    expect(Object.keys(result)).toEqual(['recPitch1:self']);
  });
});

describe('deriveEntries — adding a new project after mount', () => {
  it('covers new mandate for non-VP fellow without losing prior input', () => {
    const prior: Record<string, HoursEntry> = {
      'recMandate1:self': {
        projectRecordId: 'recMandate1',
        targetFellowId: null,
        hoursValue: '3',
        hoursUnit: 'per_day',
      },
    };
    const result = deriveEntries([mandate, newMandate], false, prior);
    expect(result['recMandate1:self'].hoursValue).toBe('3');
    expect(result['pending_abc123:self']).toEqual({
      projectRecordId: 'pending_abc123',
      targetFellowId: null,
      hoursValue: '',
      hoursUnit: 'per_day',
    });
  });

  it('covers new DDE for non-VP fellow', () => {
    const result = deriveEntries([dde, newDde], false, {});
    expect(result['pending_def456:self']).toBeDefined();
    expect(result['pending_def456:self'].targetFellowId).toBeNull();
  });

  it('covers new pitch for non-VP fellow', () => {
    const result = deriveEntries([pitch, newPitch], false, {});
    expect(result['pending_ghi789:self']).toBeDefined();
  });

  it('covers new mandate + associate entries for VP fellow', () => {
    const prior: Record<string, HoursEntry> = {
      'recMandate1:self': { projectRecordId: 'recMandate1', targetFellowId: null, hoursValue: '2', hoursUnit: 'per_day' },
      'recMandate1:recAssoc1': { projectRecordId: 'recMandate1', targetFellowId: 'recAssoc1', hoursValue: '4', hoursUnit: 'per_day' },
    };
    const result = deriveEntries([mandate, newMandate], true, prior);
    expect(result['recMandate1:self'].hoursValue).toBe('2');
    expect(result['recMandate1:recAssoc1'].hoursValue).toBe('4');
    expect(result['pending_abc123:self']).toBeDefined();
    expect(result['pending_abc123:recAssoc3']).toEqual({
      projectRecordId: 'pending_abc123',
      targetFellowId: 'recAssoc3',
      hoursValue: '',
      hoursUnit: 'per_day',
    });
  });

  it('covers new DDE with associates for VP fellow', () => {
    const withAssoc: ProjectShape = {
      projectRecordId: 'pending_ddex',
      projectType: 'dde',
      associates: [{ recordId: 'recA', name: 'A' }, { recordId: 'recB', name: 'B' }],
      isNew: true,
    };
    const result = deriveEntries([withAssoc], true, {});
    expect(Object.keys(result).sort()).toEqual([
      'pending_ddex:recA',
      'pending_ddex:recB',
      'pending_ddex:self',
    ]);
  });

  it('never leaves a project key undefined (regression for router.refresh crash)', () => {
    // The exact scenario from the April 21 bug: add new project,
    // component re-renders with expanded `projects` prop, entries lookup
    // must NOT miss the new key on the first render pass.
    const priorAfterMount: Record<string, HoursEntry> = {
      'recMandate1:self': { projectRecordId: 'recMandate1', targetFellowId: null, hoursValue: '2', hoursUnit: 'per_day' },
      'recDde1:self': { projectRecordId: 'recDde1', targetFellowId: null, hoursValue: '1', hoursUnit: 'per_day' },
    };
    const afterAddingNew = deriveEntries(
      [mandate, dde, newMandate, newDde, newPitch],
      false,
      priorAfterMount,
    );
    for (const p of [mandate, dde, newMandate, newDde, newPitch]) {
      expect(afterAddingNew[`${p.projectRecordId}:self`]).toBeDefined();
    }
  });
});

describe('deriveEntries — initialEntries pre-fill', () => {
  it('pre-fills self entry from initialEntries when no user input', () => {
    const initial = {
      'pending_abc123:self': { hoursValue: '5', hoursUnit: 'per_day' as const },
    };
    const result = deriveEntries([newMandate], false, {}, initial);
    expect(result['pending_abc123:self']).toEqual({
      projectRecordId: 'pending_abc123',
      targetFellowId: null,
      hoursValue: '5',
      hoursUnit: 'per_day',
    });
  });

  it('pre-fills associate entries for VP from initialEntries', () => {
    const initial = {
      'pending_abc123:self': { hoursValue: '3', hoursUnit: 'per_day' as const },
      'pending_abc123:recAssoc3': { hoursValue: '6', hoursUnit: 'per_week' as const },
    };
    const result = deriveEntries([newMandate], true, {}, initial);
    expect(result['pending_abc123:self'].hoursValue).toBe('3');
    expect(result['pending_abc123:recAssoc3']).toEqual({
      projectRecordId: 'pending_abc123',
      targetFellowId: 'recAssoc3',
      hoursValue: '6',
      hoursUnit: 'per_week',
    });
  });

  it('user input takes precedence over initialEntries', () => {
    const initial = {
      'pending_abc123:self': { hoursValue: '5', hoursUnit: 'per_day' as const },
    };
    const prior: Record<string, HoursEntry> = {
      'pending_abc123:self': {
        projectRecordId: 'pending_abc123',
        targetFellowId: null,
        hoursValue: '7',
        hoursUnit: 'per_week',
      },
    };
    const result = deriveEntries([newMandate], false, prior, initial);
    expect(result['pending_abc123:self'].hoursValue).toBe('7');
    expect(result['pending_abc123:self'].hoursUnit).toBe('per_week');
  });

  it('ignores initialEntries for keys that have no matching project', () => {
    const initial = {
      'pending_ghost:self': { hoursValue: '9', hoursUnit: 'per_day' as const },
    };
    const result = deriveEntries([mandate], false, {}, initial);
    expect(result['pending_ghost:self']).toBeUndefined();
    expect(result['recMandate1:self'].hoursValue).toBe('');
  });

  it('falls back to empty default when a project has no initialEntries entry', () => {
    const initial = {
      'pending_abc123:self': { hoursValue: '5', hoursUnit: 'per_day' as const },
    };
    const result = deriveEntries([mandate, newMandate], false, {}, initial);
    expect(result['recMandate1:self'].hoursValue).toBe('');
    expect(result['pending_abc123:self'].hoursValue).toBe('5');
  });
});

describe('deriveEntries — edge cases', () => {
  it('returns empty object for empty projects list', () => {
    expect(deriveEntries([], false, {})).toEqual({});
    expect(deriveEntries([], true, {})).toEqual({});
  });

  it('ignores orphan keys in userInput that no longer match any project', () => {
    const stale: Record<string, HoursEntry> = {
      'recDeleted:self': { projectRecordId: 'recDeleted', targetFellowId: null, hoursValue: '9', hoursUnit: 'per_day' },
    };
    const result = deriveEntries([mandate], false, stale);
    expect(result['recDeleted:self']).toBeUndefined();
    expect(Object.keys(result)).toEqual(['recMandate1:self']);
  });

  it('drops associate entries when fellow transitions from VP to non-VP', () => {
    const priorAsVp: Record<string, HoursEntry> = {
      'recMandate1:self': { projectRecordId: 'recMandate1', targetFellowId: null, hoursValue: '2', hoursUnit: 'per_day' },
      'recMandate1:recAssoc1': { projectRecordId: 'recMandate1', targetFellowId: 'recAssoc1', hoursValue: '4', hoursUnit: 'per_day' },
    };
    const result = deriveEntries([mandate], false, priorAsVp);
    expect(result['recMandate1:recAssoc1']).toBeUndefined();
    expect(result['recMandate1:self'].hoursValue).toBe('2');
  });
});
