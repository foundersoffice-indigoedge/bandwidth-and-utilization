import { describe, it, expect } from 'vitest';
import {
  buildTimeline,
  iyOf,
  listProjectsForFellow,
  type TimelineSubmission,
} from '../src/lib/fellow-project-timeline';

const FELLOW = 'recFellowA';
const OTHER_FELLOW = 'recFellowB';
const VP = 'recVP';
const PROJ_A = 'recProjA';
const PROJ_B = 'recProjB';

function sub(overrides: Partial<TimelineSubmission>): TimelineSubmission {
  return {
    cycleId: 'c1',
    cycleStart: '2026-01-05',
    fellowRecordId: FELLOW,
    targetFellowId: null,
    isSelfReport: true,
    projectRecordId: PROJ_A,
    projectName: 'Project A',
    projectType: 'mandate',
    hoursPerWeek: 24,
    hoursPerDay: 4,
    autoScore: 3,
    ...overrides,
  };
}

describe('iyOf', () => {
  it('maps July–Dec to next year IY', () => {
    expect(iyOf('2025-07-01')).toBe(2026);
    expect(iyOf('2025-12-31')).toBe(2026);
  });

  it('maps Jan–June to same year IY', () => {
    expect(iyOf('2026-01-05')).toBe(2026);
    expect(iyOf('2026-06-30')).toBe(2026);
  });

  it('handles year boundaries correctly', () => {
    expect(iyOf('2026-07-01')).toBe(2027);
    expect(iyOf('2025-06-30')).toBe(2025);
  });
});

describe('buildTimeline — dedup & ordering', () => {
  it('returns empty array when fellow has no submissions on project', () => {
    const subs = [sub({ projectRecordId: PROJ_B })];
    expect(buildTimeline(subs, FELLOW, PROJ_A)).toEqual([]);
  });

  it('includes own self-reports', () => {
    const subs = [
      sub({ cycleId: 'c1', cycleStart: '2026-01-05' }),
      sub({ cycleId: 'c2', cycleStart: '2026-01-12' }),
    ];
    const result = buildTimeline(subs, FELLOW, PROJ_A);
    expect(result.map(p => p.cycleId)).toEqual(['c1', 'c2']);
    expect(result.every(p => p.source === 'self')).toBe(true);
  });

  it('includes VP projections when no self-report exists', () => {
    const subs = [
      sub({
        cycleId: 'c1',
        fellowRecordId: VP,
        targetFellowId: FELLOW,
        isSelfReport: false,
        hoursPerWeek: 30,
      }),
    ];
    const result = buildTimeline(subs, FELLOW, PROJ_A);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('projection');
    expect(result[0].hoursPerWeek).toBe(30);
  });

  it('prefers self-report over VP projection in same cycle', () => {
    const subs = [
      sub({ cycleId: 'c1', hoursPerWeek: 24 }),
      sub({
        cycleId: 'c1',
        fellowRecordId: VP,
        targetFellowId: FELLOW,
        isSelfReport: false,
        hoursPerWeek: 40,
      }),
    ];
    const result = buildTimeline(subs, FELLOW, PROJ_A);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('self');
    expect(result[0].hoursPerWeek).toBe(24);
  });

  it('prefers self-report regardless of array order', () => {
    const projection = sub({
      cycleId: 'c1',
      fellowRecordId: VP,
      targetFellowId: FELLOW,
      isSelfReport: false,
      hoursPerWeek: 40,
    });
    const self = sub({ cycleId: 'c1', hoursPerWeek: 24 });
    expect(buildTimeline([projection, self], FELLOW, PROJ_A)[0].source).toBe('self');
    expect(buildTimeline([self, projection], FELLOW, PROJ_A)[0].source).toBe('self');
  });

  it('sorts points by cycleStart ascending', () => {
    const subs = [
      sub({ cycleId: 'c3', cycleStart: '2026-03-02' }),
      sub({ cycleId: 'c1', cycleStart: '2026-01-05' }),
      sub({ cycleId: 'c2', cycleStart: '2026-02-05' }),
    ];
    const result = buildTimeline(subs, FELLOW, PROJ_A);
    expect(result.map(p => p.cycleId)).toEqual(['c1', 'c2', 'c3']);
  });

  it("ignores another fellow's submissions on the same project", () => {
    const subs = [
      sub({ fellowRecordId: OTHER_FELLOW }),
      sub({ cycleId: 'c2', cycleStart: '2026-01-12' }),
    ];
    const result = buildTimeline(subs, FELLOW, PROJ_A);
    expect(result).toHaveLength(1);
    expect(result[0].cycleId).toBe('c2');
  });

  it("ignores VP projections aimed at other fellows", () => {
    const subs = [
      sub({
        fellowRecordId: VP,
        targetFellowId: OTHER_FELLOW,
        isSelfReport: false,
      }),
    ];
    expect(buildTimeline(subs, FELLOW, PROJ_A)).toEqual([]);
  });

  it('computes capacityPct as hoursPerWeek / 84', () => {
    const subs = [sub({ hoursPerWeek: 42 })];
    const [point] = buildTimeline(subs, FELLOW, PROJ_A);
    expect(point.capacityPct).toBeCloseTo(0.5, 5);
  });
});

describe('listProjectsForFellow', () => {
  it('returns empty when no submissions match', () => {
    expect(listProjectsForFellow([], FELLOW, [2026])).toEqual([]);
  });

  it('dedupes projects across cycles', () => {
    const subs = [
      sub({ cycleId: 'c1', cycleStart: '2026-01-05', projectRecordId: PROJ_A, projectName: 'Project A' }),
      sub({ cycleId: 'c2', cycleStart: '2026-01-12', projectRecordId: PROJ_A, projectName: 'Project A' }),
    ];
    const result = listProjectsForFellow(subs, FELLOW, [2026]);
    expect(result).toHaveLength(1);
    expect(result[0].projectRecordId).toBe(PROJ_A);
  });

  it('filters by selected IYs', () => {
    const subs = [
      sub({ cycleStart: '2025-08-01', projectRecordId: PROJ_A, projectName: 'IY2026 project' }),
      sub({ cycleStart: '2026-01-05', projectRecordId: PROJ_B, projectName: 'IY2026 project B' }),
      sub({ cycleStart: '2024-08-01', projectRecordId: 'recOld', projectName: 'Old project' }),
    ];
    // IY2026 = July 2025 - June 2026
    const result = listProjectsForFellow(subs, FELLOW, [2026]);
    expect(result.map(p => p.projectRecordId).sort()).toEqual([PROJ_A, PROJ_B]);
  });

  it('includes projects where fellow appears as target of VP projection', () => {
    const subs = [
      sub({
        fellowRecordId: VP,
        targetFellowId: FELLOW,
        isSelfReport: false,
        projectRecordId: PROJ_A,
      }),
    ];
    const result = listProjectsForFellow(subs, FELLOW, [2026]);
    expect(result).toHaveLength(1);
    expect(result[0].projectRecordId).toBe(PROJ_A);
  });

  it('sorts projects alphabetically by name', () => {
    const subs = [
      sub({ projectRecordId: 'rec1', projectName: 'Zeta Mandate' }),
      sub({ projectRecordId: 'rec2', projectName: 'Alpha Pitch' }),
      sub({ projectRecordId: 'rec3', projectName: 'Mu DDE' }),
    ];
    const result = listProjectsForFellow(subs, FELLOW, [2026]);
    expect(result.map(p => p.projectName)).toEqual(['Alpha Pitch', 'Mu DDE', 'Zeta Mandate']);
  });

  it('supports multi-IY selection', () => {
    const subs = [
      sub({ cycleStart: '2024-08-01', projectRecordId: 'projIY25', projectName: 'IY25' }),
      sub({ cycleStart: '2025-08-01', projectRecordId: 'projIY26', projectName: 'IY26' }),
      sub({ cycleStart: '2023-08-01', projectRecordId: 'projIY24', projectName: 'IY24' }),
    ];
    const result = listProjectsForFellow(subs, FELLOW, [2025, 2026]);
    expect(result.map(p => p.projectRecordId).sort()).toEqual(['projIY25', 'projIY26']);
  });
});
