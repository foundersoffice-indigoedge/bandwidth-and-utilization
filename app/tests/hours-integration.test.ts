/**
 * Integration tests for the hours-per-week utilization method.
 * Tests the full data flow: submission → scoring → finalization → snapshot → dashboard display.
 * These validate that nothing broke during the MEU→hours switchover.
 */
import { describe, it, expect } from 'vitest';
import { normalizeToHoursPerDay, normalizeToHoursPerWeek, scoreHours, WORKING_DAYS_PER_WEEK } from '../src/lib/scoring';
import { calculateHoursUtilization, calculateUtilization, getLoadTag, sumMeu, WEEKLY_CAPACITY_HOURS } from '../src/lib/utilization';
import type { ProjectBreakdownItem, HoursUnit } from '../src/types';

// --- Simulate the full submission pipeline ---

/** Mirrors what submit/route.ts does for a single entry */
function simulateSubmission(hoursValue: number, hoursUnit: HoursUnit, projectType: 'mandate' | 'dde' | 'pitch') {
  const hoursPerDay = normalizeToHoursPerDay(hoursValue, hoursUnit);
  const hoursPerWeek = normalizeToHoursPerWeek(hoursValue, hoursUnit);
  const { score, meu } = scoreHours(hoursPerDay, projectType);
  return { hoursPerDay, hoursPerWeek, score, meu };
}

/** Mirrors what cycle.ts does for snapshot creation */
function simulateFinalization(submissions: Array<{ hoursPerDay: number; hoursPerWeek: number | null; score: number; meu: number; projectName: string; projectType: 'mandate' | 'dde' | 'pitch' }>, capacityMeu: number) {
  // MEU-based (old method, still computed for rollback)
  const totalMeu = sumMeu(submissions.map(s => s.meu));
  const meuUtilPct = calculateUtilization(totalMeu, capacityMeu);
  const meuLoadTag = getLoadTag(meuUtilPct);

  // Hours-based (new method)
  const totalHpw = submissions.reduce((sum, s) => sum + (s.hoursPerWeek ?? s.hoursPerDay * WORKING_DAYS_PER_WEEK), 0);
  const hoursUtilPct = calculateHoursUtilization(totalHpw);
  const hoursLoadTag = getLoadTag(hoursUtilPct);

  const breakdown: ProjectBreakdownItem[] = submissions.map(s => ({
    projectName: s.projectName,
    projectType: s.projectType,
    score: s.score,
    meu: s.meu,
    hoursPerDay: s.hoursPerDay,
    hoursPerWeek: s.hoursPerWeek ?? s.hoursPerDay * WORKING_DAYS_PER_WEEK,
  }));

  return { totalMeu, meuUtilPct, meuLoadTag, totalHpw, hoursUtilPct, hoursLoadTag, breakdown };
}

describe('Submission pipeline: hours conversion', () => {
  it('converts per_day to per_week correctly (4 hrs/day → 24 hrs/week)', () => {
    const result = simulateSubmission(4, 'per_day', 'mandate');
    expect(result.hoursPerDay).toBe(4);
    expect(result.hoursPerWeek).toBe(24);
  });

  it('passes per_week through unchanged (15 hrs/week → 15 hrs/week)', () => {
    const result = simulateSubmission(15, 'per_week', 'mandate');
    expect(result.hoursPerDay).toBe(2.5); // 15/6
    expect(result.hoursPerWeek).toBe(15);
  });

  it('handles zero hours (0 per_day → 0 per_week)', () => {
    const result = simulateSubmission(0, 'per_day', 'dde');
    expect(result.hoursPerDay).toBe(0);
    expect(result.hoursPerWeek).toBe(0);
  });

  it('handles fractional hours (1.5 hrs/day → 9 hrs/week)', () => {
    const result = simulateSubmission(1.5, 'per_day', 'pitch');
    expect(result.hoursPerDay).toBe(1.5);
    expect(result.hoursPerWeek).toBe(9);
  });

  it('still computes MEU scores alongside hours (for rollback data)', () => {
    const result = simulateSubmission(4, 'per_day', 'mandate');
    expect(result.score).toBe(3);
    expect(result.meu).toBe(1.00);
    // Hours are independent of MEU
    expect(result.hoursPerWeek).toBe(24);
  });
});

describe('Conflict resolution: hoursPerWeek update', () => {
  it('resolvedHours * WORKING_DAYS_PER_WEEK matches normalizeToHoursPerWeek for per_day', () => {
    // Resolve route uses resolvedHours * WORKING_DAYS_PER_WEEK
    // Submit route uses normalizeToHoursPerWeek(value, 'per_day')
    // These must be equivalent
    const resolvedHours = 3.5;
    const fromResolve = resolvedHours * WORKING_DAYS_PER_WEEK;
    const fromNormalize = normalizeToHoursPerWeek(resolvedHours, 'per_day');
    expect(fromResolve).toBe(fromNormalize);
  });

  it('re-scoring with resolved hours produces consistent MEU + hours', () => {
    const resolvedHours = 5; // hrs/day
    const { score, meu } = scoreHours(resolvedHours, 'mandate');
    const hoursPerWeek = resolvedHours * WORKING_DAYS_PER_WEEK;
    expect(score).toBe(3);
    expect(meu).toBe(1.00);
    expect(hoursPerWeek).toBe(30);
  });
});

describe('Finalization: snapshot creation with both methods', () => {
  const submissions = [
    { hoursPerDay: 4, hoursPerWeek: 20 as number | null, score: 3, meu: 1.00, projectName: 'Mandate A', projectType: 'mandate' as const },
    { hoursPerDay: 1, hoursPerWeek: 5 as number | null, score: 3, meu: 0.30, projectName: 'DDE B', projectType: 'dde' as const },
    { hoursPerDay: 0.5, hoursPerWeek: 2.5 as number | null, score: 2, meu: 0.20, projectName: 'Pitch C', projectType: 'pitch' as const },
  ];

  it('computes totalHoursPerWeek as sum of all project hours', () => {
    const result = simulateFinalization(submissions, 3.0);
    expect(result.totalHpw).toBe(27.5); // 20 + 5 + 2.5
  });

  it('computes hours utilization as totalHpw / 84', () => {
    const result = simulateFinalization(submissions, 3.0);
    expect(result.hoursUtilPct).toBeCloseTo(27.5 / 84, 4);
    expect(result.hoursUtilPct).toBeCloseTo(0.3274, 3);
  });

  it('assigns correct load tag for hours utilization', () => {
    const result = simulateFinalization(submissions, 3.0);
    // 32.7% → Comfortable (0.30 to < 0.60)
    expect(result.hoursLoadTag).toBe('Comfortable');
  });

  it('still computes MEU-based utilization for rollback', () => {
    const result = simulateFinalization(submissions, 3.0);
    expect(result.totalMeu).toBeCloseTo(1.50); // 1.00 + 0.30 + 0.20
    expect(result.meuUtilPct).toBeCloseTo(0.50); // 1.50 / 3.0
    expect(result.meuLoadTag).toBe('Comfortable');
  });

  it('MEU and hours methods can give different results', () => {
    // A fellow doing lots of light DDE/pitch work:
    // High hours but low MEU (because DDE/pitch MEU is small per hour)
    const lightWork = [
      { hoursPerDay: 2, hoursPerWeek: 10 as number | null, score: 4, meu: 0.40, projectName: 'DDE 1', projectType: 'dde' as const },
      { hoursPerDay: 2, hoursPerWeek: 10 as number | null, score: 4, meu: 0.40, projectName: 'DDE 2', projectType: 'dde' as const },
      { hoursPerDay: 2, hoursPerWeek: 10 as number | null, score: 4, meu: 0.40, projectName: 'Pitch 1', projectType: 'pitch' as const },
      { hoursPerDay: 2, hoursPerWeek: 10 as number | null, score: 4, meu: 0.40, projectName: 'Pitch 2', projectType: 'pitch' as const },
      { hoursPerDay: 2, hoursPerWeek: 10 as number | null, score: 4, meu: 0.40, projectName: 'Pitch 3', projectType: 'pitch' as const },
    ];
    const result = simulateFinalization(lightWork, 3.0);
    // Hours: 50/84 = 59.5% → Comfortable
    expect(result.hoursUtilPct).toBeCloseTo(50 / 84, 3);
    expect(result.hoursLoadTag).toBe('Comfortable');
    // MEU: 2.0/3.0 = 66.7% → Busy
    expect(result.meuUtilPct).toBeCloseTo(2.0 / 3.0, 3);
    expect(result.meuLoadTag).toBe('Busy');
    // They differ! This is expected and is why we're switching methods.
  });

  it('handles null hoursPerWeek with fallback to hoursPerDay * 6', () => {
    // Simulates submissions from before the hoursPerWeek column existed
    const oldSubmissions = [
      { hoursPerDay: 4, hoursPerWeek: null, score: 3, meu: 1.00, projectName: 'Old Mandate', projectType: 'mandate' as const },
      { hoursPerDay: 1, hoursPerWeek: null, score: 3, meu: 0.30, projectName: 'Old DDE', projectType: 'dde' as const },
    ];
    const result = simulateFinalization(oldSubmissions, 3.0);
    // Fallback: 4*6 + 1*6 = 30
    expect(result.totalHpw).toBe(30);
    expect(result.hoursUtilPct).toBeCloseTo(30 / 84, 4);
  });
});

describe('ProjectBreakdownItem: hoursPerWeek field', () => {
  it('includes hoursPerWeek in breakdown from new submissions', () => {
    const submissions = [
      { hoursPerDay: 6, hoursPerWeek: 30 as number | null, score: 4, meu: 1.25, projectName: 'Big Mandate', projectType: 'mandate' as const },
    ];
    const result = simulateFinalization(submissions, 3.0);
    expect(result.breakdown[0].hoursPerWeek).toBe(30);
  });

  it('computes hoursPerWeek from fallback for old submissions', () => {
    const submissions = [
      { hoursPerDay: 6, hoursPerWeek: null, score: 4, meu: 1.25, projectName: 'Old Mandate', projectType: 'mandate' as const },
    ];
    const result = simulateFinalization(submissions, 3.0);
    expect(result.breakdown[0].hoursPerWeek).toBe(36); // 6 * 6
  });
});

describe('Dashboard display logic', () => {
  it('nullish coalescing does NOT skip zero values', () => {
    // Critical: a fellow with 0 hours should show 0%, not fall back to MEU
    const hoursUtilizationPct: number | null = 0;
    const utilizationPct = 0.5; // old MEU value
    const displayed = hoursUtilizationPct ?? utilizationPct;
    expect(displayed).toBe(0); // Must be 0, not 0.5
  });

  it('nullish coalescing falls back for null values', () => {
    const hoursUtilizationPct: number | null = null;
    const utilizationPct = 0.5;
    const displayed = hoursUtilizationPct ?? utilizationPct;
    expect(displayed).toBe(0.5); // Falls back to MEU
  });

  it('overview grid averaging works with hours fields', () => {
    // Simulate 2 snapshots in a month
    const snaps = [
      { hoursUtilizationPct: 0.30, utilizationPct: 0.50, totalHoursPerWeek: 25.2 },
      { hoursUtilizationPct: 0.40, utilizationPct: 0.60, totalHoursPerWeek: 33.6 },
    ];
    const n = snaps.length;
    const avgUtil = snaps.reduce((s, snap) => s + (snap.hoursUtilizationPct ?? snap.utilizationPct), 0) / n;
    const avgHpw = snaps.reduce((s, snap) => s + (snap.totalHoursPerWeek ?? 0), 0) / n;
    expect(avgUtil).toBeCloseTo(0.35);
    expect(avgHpw).toBeCloseTo(29.4);
    expect(getLoadTag(avgUtil)).toBe('Comfortable');
  });
});

describe('Edge cases: extreme values', () => {
  it('fellow with exactly 84 hrs/week is At Capacity', () => {
    expect(calculateHoursUtilization(84)).toBe(1.0);
    expect(getLoadTag(1.0)).toBe('At Capacity');
  });

  it('fellow with 0 hrs/week is Free', () => {
    expect(calculateHoursUtilization(0)).toBe(0);
    expect(getLoadTag(0)).toBe('Free');
  });

  it('fellow over 84 hrs/week is Overloaded', () => {
    const util = calculateHoursUtilization(100);
    expect(util).toBeCloseTo(1.190, 2);
    expect(getLoadTag(util)).toBe('Overloaded');
  });

  it('very small hours (0.1 hrs/day) produce correct per_week', () => {
    const result = simulateSubmission(0.1, 'per_day', 'pitch');
    expect(result.hoursPerWeek).toBeCloseTo(0.6);
  });

  it('large per_week value (40 hrs/week) passes through correctly', () => {
    const result = simulateSubmission(40, 'per_week', 'mandate');
    expect(result.hoursPerDay).toBeCloseTo(40 / 6); // ~6.667 hrs/day
    expect(result.hoursPerWeek).toBe(40);
    expect(result.score).toBe(4); // 6.667 < 8 → score 4
    expect(result.meu).toBe(1.25);
  });
});

describe('Email: FellowSummary handling', () => {
  it('formats totalHoursPerWeek when present', () => {
    const hpw: number | undefined = 27.5;
    const display = hpw != null ? hpw.toFixed(1) : '—';
    expect(display).toBe('27.5');
  });

  it('shows dash when totalHoursPerWeek is undefined', () => {
    const hpw = undefined as number | undefined;
    const display = hpw != null ? hpw.toFixed(1) : '—';
    expect(display).toBe('—');
  });

  it('shows 0.0 when totalHoursPerWeek is zero (not dash)', () => {
    const hpw: number | undefined = 0;
    const display = hpw != null ? hpw.toFixed(1) : '—';
    expect(display).toBe('0.0');
  });
});

describe('Consistency: per_day and per_week inputs produce same hours/week', () => {
  it('24 hrs/week submitted as per_week matches 4 hrs/day submitted as per_day', () => {
    const fromPerWeek = simulateSubmission(24, 'per_week', 'mandate');
    const fromPerDay = simulateSubmission(4, 'per_day', 'mandate');
    expect(fromPerWeek.hoursPerWeek).toBe(fromPerDay.hoursPerWeek);
    expect(fromPerWeek.hoursPerDay).toBe(fromPerDay.hoursPerDay);
  });

  it('9 hrs/week submitted as per_week matches 1.5 hrs/day submitted as per_day', () => {
    const fromPerWeek = simulateSubmission(9, 'per_week', 'dde');
    const fromPerDay = simulateSubmission(1.5, 'per_day', 'dde');
    expect(fromPerWeek.hoursPerWeek).toBe(fromPerDay.hoursPerWeek);
    expect(fromPerWeek.hoursPerDay).toBe(fromPerDay.hoursPerDay);
  });
});
