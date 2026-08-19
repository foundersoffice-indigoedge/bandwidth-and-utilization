import { describe, expect, it } from 'vitest';
import {
  deadlineAt,
  deadlineOutcome,
  evaluateCompliance,
  evaluateTransition,
  missedEpisodes,
} from '@/lib/submission-compliance';

const missed = (...dates: string[]) => dates.map(cycleStartDate => ({ cycleStartDate, outcome: 'missed' as const }));
const onTime = (...dates: string[]) => dates.map(cycleStartDate => ({ cycleStartDate, outcome: 'on_time' as const }));

describe('submission deadline boundary', () => {
  const deadline = deadlineAt('2026-08-24');

  it('counts an exact 1:00 p.m. IST submission as on time', () => {
    expect(deadlineOutcome({ status: 'submitted', submittedAt: deadline, deadline })).toBe('on_time');
  });

  it('counts a submission one second after the deadline as missed', () => {
    expect(deadlineOutcome({ status: 'submitted', submittedAt: new Date(deadline.getTime() + 1000), deadline })).toBe('missed');
  });

  it('counts pending and timestamp-less submitted tokens as missed', () => {
    expect(deadlineOutcome({ status: 'pending', submittedAt: null, deadline })).toBe('missed');
    expect(deadlineOutcome({ status: 'submitted', submittedAt: null, deadline })).toBe('missed');
  });

  it('exempts only tokens marked not_needed before the deadline', () => {
    expect(deadlineOutcome({
      status: 'not_needed',
      submittedAt: null,
      notNeededAt: new Date(deadline.getTime() - 1000),
      statusUpdatedAt: new Date(deadline.getTime() - 1000),
      deadline,
    })).toBeNull();
    expect(deadlineOutcome({
      status: 'not_needed',
      submittedAt: null,
      notNeededAt: new Date(deadline.getTime() + 1000),
      statusUpdatedAt: new Date(deadline.getTime() + 1000),
      deadline,
    })).toBe('missed');
  });

  it('keeps a before-deadline exemption when the token is re-enabled later', () => {
    expect(deadlineOutcome({
      status: 'pending',
      submittedAt: null,
      notNeededAt: new Date(deadline.getTime() - 1000),
      statusUpdatedAt: new Date(deadline.getTime() + 1000),
      deadline,
    })).toBeNull();
  });
});

describe('submission compliance classification', () => {
  it('does not flag an on-time record', () => {
    expect(evaluateCompliance(onTime('2026-08-24')).classification).toBe('none');
  });

  it('flags Category 1 after a three-Monday miss streak', () => {
    const result = evaluateCompliance(missed('2026-08-24', '2026-08-31', '2026-09-07'));
    expect(result.classification).toBe('category_1');
    expect(result.category1Streaks).toEqual([['2026-08-24', '2026-08-31', '2026-09-07']]);
  });

  it('flags Category 2 after three separate two-Monday miss episodes', () => {
    const result = evaluateCompliance([
      ...missed('2026-08-24', '2026-08-31'),
      ...onTime('2026-09-07'),
      ...missed('2026-09-14', '2026-09-21'),
      ...onTime('2026-09-28'),
      ...missed('2026-10-05', '2026-10-12'),
    ]);
    expect(result.classification).toBe('category_2');
    expect(result.category2Episodes).toHaveLength(3);
  });

  it('counts a longer uninterrupted streak as one Category 2 episode', () => {
    const result = evaluateCompliance(missed('2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14'));
    expect(result.classification).toBe('category_1');
    expect(result.category2Episodes).toEqual([['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14']]);
  });

  it('reports Both when both persistent rules are earned', () => {
    const result = evaluateCompliance([
      ...missed('2026-08-24', '2026-08-31', '2026-09-07'),
      ...onTime('2026-09-14'),
      ...missed('2026-09-21', '2026-09-28'),
      ...onTime('2026-10-05'),
      ...missed('2026-10-12', '2026-10-19'),
    ]);
    expect(result.classification).toBe('both');
  });

  it('breaks a miss episode across an on-time week or a missing weekly check', () => {
    expect(missedEpisodes([
      ...missed('2026-08-24'),
      ...onTime('2026-08-31'),
      ...missed('2026-09-07'),
    ])).toEqual([['2026-08-24'], ['2026-09-07']]);

    expect(missedEpisodes(missed('2026-08-24', '2026-09-07'))).toEqual([
      ['2026-08-24'],
      ['2026-09-07'],
    ]);
  });
});

describe('submission compliance notification transitions', () => {
  it('alerts only when classification changes', () => {
    const checks = missed('2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14');
    const thirdMiss = evaluateTransition(checks.slice(0, 3), '2026-09-07');
    const unchangedFourthMiss = evaluateTransition(checks, '2026-09-14');

    expect(thirdMiss).toMatchObject({ previousClassification: 'none', classification: 'category_1', changed: true });
    expect(unchangedFourthMiss).toMatchObject({ previousClassification: 'category_1', classification: 'category_1', changed: false });
  });

  it('alerts once when a Category 1 person moves into Both', () => {
    const checks = [
      ...missed('2026-08-24', '2026-08-31', '2026-09-07'),
      ...onTime('2026-09-14'),
      ...missed('2026-09-21', '2026-09-28'),
      ...onTime('2026-10-05'),
      ...missed('2026-10-12', '2026-10-19'),
    ];
    expect(evaluateTransition(checks, '2026-10-19')).toMatchObject({
      previousClassification: 'category_1',
      classification: 'both',
      changed: true,
    });
  });
});
