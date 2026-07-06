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

// A project the fellow is on only as an associate: buildFormProjects leaves
// `associates` empty, so deriveEntries produces just a :self entry.
const mandateSelfOnly: ProjectShape = {
  projectRecordId: 'recMandate1',
  projectType: 'mandate',
  associates: [],
};

describe('deriveEntries — self + associate keys from project.associates', () => {
  it('creates :self for every project and an entry per listed associate', () => {
    const result = deriveEntries([mandate, dde, pitch], {});
    expect(Object.keys(result).sort()).toEqual([
      'recDde1:recAssoc2',
      'recDde1:self',
      'recMandate1:recAssoc1',
      'recMandate1:self',
      'recPitch1:self',
    ]);
  });

  it('creates associate entries whenever the project lists associates (no global VP flag)', () => {
    const result = deriveEntries([mandate], {});
    expect(result['recMandate1:self']).toBeDefined();
    expect(result['recMandate1:recAssoc1']).toBeDefined();
  });

  it('creates only a self entry when the project lists no associates', () => {
    const result = deriveEntries([pitch], {});
    expect(Object.keys(result).filter(k => k.startsWith('recPitch1:'))).toEqual(['recPitch1:self']);
  });

  it('self entry has null targetFellowId and empty hours', () => {
    const result = deriveEntries([mandateSelfOnly], {});
    expect(result['recMandate1:self']).toEqual({
      projectRecordId: 'recMandate1',
      targetFellowId: null,
      hoursValue: '',
      hoursUnit: 'per_day',
    });
  });

  it('associate entry has correct targetFellowId', () => {
    const result = deriveEntries([mandate], {});
    expect(result['recMandate1:recAssoc1']).toEqual({
      projectRecordId: 'recMandate1',
      targetFellowId: 'recAssoc1',
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
    const result = deriveEntries([mandateSelfOnly, dde], prior);
    expect(result['recMandate1:self'].hoursValue).toBe('4.5');
    expect(result['recMandate1:self'].hoursUnit).toBe('per_week');
    expect(result['recDde1:self'].hoursValue).toBe('');
  });
});

describe('deriveEntries — adding a new project after mount', () => {
  it('covers a new self-only mandate without losing prior input', () => {
    const prior: Record<string, HoursEntry> = {
      'recMandate1:self': {
        projectRecordId: 'recMandate1',
        targetFellowId: null,
        hoursValue: '3',
        hoursUnit: 'per_day',
      },
    };
    const newSelfOnly: ProjectShape = {
      projectRecordId: 'pending_abc123',
      projectType: 'mandate',
      associates: [],
      isNew: true,
    };
    const result = deriveEntries([mandateSelfOnly, newSelfOnly], prior);
    expect(result['recMandate1:self'].hoursValue).toBe('3');
    expect(result['pending_abc123:self']).toEqual({
      projectRecordId: 'pending_abc123',
      targetFellowId: null,
      hoursValue: '',
      hoursUnit: 'per_day',
    });
  });

  it('covers a new DDE', () => {
    const result = deriveEntries([dde, newDde], {});
    expect(result['pending_def456:self']).toBeDefined();
    expect(result['pending_def456:self'].targetFellowId).toBeNull();
  });

  it('covers a new pitch with associates', () => {
    const result = deriveEntries([pitch, newPitch], {});
    expect(result['pending_ghi789:self']).toBeDefined();
    expect(result['pending_ghi789:recAssoc4']).toBeDefined();
  });

  it('covers a new mandate + associate entries without losing prior input', () => {
    const prior: Record<string, HoursEntry> = {
      'recMandate1:self': { projectRecordId: 'recMandate1', targetFellowId: null, hoursValue: '2', hoursUnit: 'per_day' },
      'recMandate1:recAssoc1': { projectRecordId: 'recMandate1', targetFellowId: 'recAssoc1', hoursValue: '4', hoursUnit: 'per_day' },
    };
    const result = deriveEntries([mandate, newMandate], prior);
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

  it('covers a new DDE with multiple associates', () => {
    const withAssoc: ProjectShape = {
      projectRecordId: 'pending_ddex',
      projectType: 'dde',
      associates: [{ recordId: 'recA', name: 'A' }, { recordId: 'recB', name: 'B' }],
      isNew: true,
    };
    const result = deriveEntries([withAssoc], {});
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
    const newSelfOnly: ProjectShape = {
      projectRecordId: 'pending_abc123',
      projectType: 'mandate',
      associates: [],
      isNew: true,
    };
    const result = deriveEntries([newSelfOnly], {}, initial);
    expect(result['pending_abc123:self']).toEqual({
      projectRecordId: 'pending_abc123',
      targetFellowId: null,
      hoursValue: '5',
      hoursUnit: 'per_day',
    });
  });

  it('pre-fills associate entries from initialEntries', () => {
    const initial = {
      'pending_abc123:self': { hoursValue: '3', hoursUnit: 'per_day' as const },
      'pending_abc123:recAssoc3': { hoursValue: '6', hoursUnit: 'per_week' as const },
    };
    const result = deriveEntries([newMandate], {}, initial);
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
    const result = deriveEntries([newMandate], prior, initial);
    expect(result['pending_abc123:self'].hoursValue).toBe('7');
    expect(result['pending_abc123:self'].hoursUnit).toBe('per_week');
  });

  it('ignores initialEntries for keys that have no matching project', () => {
    const initial = {
      'pending_ghost:self': { hoursValue: '9', hoursUnit: 'per_day' as const },
    };
    const result = deriveEntries([mandateSelfOnly], {}, initial);
    expect(result['pending_ghost:self']).toBeUndefined();
    expect(result['recMandate1:self'].hoursValue).toBe('');
  });

  it('falls back to empty default when a project has no initialEntries entry', () => {
    const initial = {
      'pending_abc123:self': { hoursValue: '5', hoursUnit: 'per_day' as const },
    };
    const result = deriveEntries([mandateSelfOnly, newMandate], {}, initial);
    expect(result['recMandate1:self'].hoursValue).toBe('');
    expect(result['pending_abc123:self'].hoursValue).toBe('5');
  });
});

describe('deriveEntries — edge cases', () => {
  it('returns empty object for empty projects list', () => {
    expect(deriveEntries([], {})).toEqual({});
  });

  it('ignores orphan keys in userInput that no longer match any project', () => {
    const stale: Record<string, HoursEntry> = {
      'recDeleted:self': { projectRecordId: 'recDeleted', targetFellowId: null, hoursValue: '9', hoursUnit: 'per_day' },
    };
    const result = deriveEntries([mandateSelfOnly], stale);
    expect(result['recDeleted:self']).toBeUndefined();
    expect(Object.keys(result)).toEqual(['recMandate1:self']);
  });

  it('drops associate entries when the project no longer lists that associate', () => {
    // Models the old "VP → non-VP" transition: the same project now arrives
    // with an empty associates list (the fellow is an associate here now),
    // so the stale associate key must be dropped.
    const priorWithAssoc: Record<string, HoursEntry> = {
      'recMandate1:self': { projectRecordId: 'recMandate1', targetFellowId: null, hoursValue: '2', hoursUnit: 'per_day' },
      'recMandate1:recAssoc1': { projectRecordId: 'recMandate1', targetFellowId: 'recAssoc1', hoursValue: '4', hoursUnit: 'per_day' },
    };
    const result = deriveEntries([mandateSelfOnly], priorWithAssoc);
    expect(result['recMandate1:recAssoc1']).toBeUndefined();
    expect(result['recMandate1:self'].hoursValue).toBe('2');
  });
});
