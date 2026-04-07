import { describe, it, expect } from 'vitest';
import { normalizeToHoursPerDay, scoreHours } from '../src/lib/scoring';

describe('normalizeToHoursPerDay', () => {
  it('returns per_day values unchanged', () => {
    expect(normalizeToHoursPerDay(4, 'per_day')).toBe(4);
  });

  it('divides per_week by 5', () => {
    expect(normalizeToHoursPerDay(10, 'per_week')).toBe(2);
  });

  it('handles zero', () => {
    expect(normalizeToHoursPerDay(0, 'per_week')).toBe(0);
  });
});

describe('scoreHours — mandates', () => {
  it('scores 0 hrs/day as 1, MEU 0.25', () => {
    expect(scoreHours(0, 'mandate')).toEqual({ score: 1, meu: 0.25 });
  });

  it('scores 1.49 hrs/day as 1', () => {
    expect(scoreHours(1.49, 'mandate')).toEqual({ score: 1, meu: 0.25 });
  });

  it('scores exactly 1.5 hrs/day as 2 (boundary goes up)', () => {
    expect(scoreHours(1.5, 'mandate')).toEqual({ score: 2, meu: 0.75 });
  });

  it('scores 2 hrs/day as 2', () => {
    expect(scoreHours(2, 'mandate')).toEqual({ score: 2, meu: 0.75 });
  });

  it('scores exactly 3 hrs/day as 3', () => {
    expect(scoreHours(3, 'mandate')).toEqual({ score: 3, meu: 1.00 });
  });

  it('scores 5 hrs/day as 3', () => {
    expect(scoreHours(5, 'mandate')).toEqual({ score: 3, meu: 1.00 });
  });

  it('scores exactly 6 hrs/day as 4', () => {
    expect(scoreHours(6, 'mandate')).toEqual({ score: 4, meu: 1.25 });
  });

  it('scores 7.5 hrs/day as 4', () => {
    expect(scoreHours(7.5, 'mandate')).toEqual({ score: 4, meu: 1.25 });
  });

  it('scores exactly 8 hrs/day as 5', () => {
    expect(scoreHours(8, 'mandate')).toEqual({ score: 5, meu: 1.50 });
  });

  it('scores 10 hrs/day as 5', () => {
    expect(scoreHours(10, 'mandate')).toEqual({ score: 5, meu: 1.50 });
  });
});

describe('scoreHours — dde/pitch (1/3 intensity)', () => {
  it('scores 0 hrs/day as 1, MEU 0.10', () => {
    expect(scoreHours(0, 'dde')).toEqual({ score: 1, meu: 0.10 });
  });

  it('scores 0.49 hrs/day as 1', () => {
    expect(scoreHours(0.49, 'dde')).toEqual({ score: 1, meu: 0.10 });
  });

  it('scores exactly 0.5 hrs/day as 2', () => {
    expect(scoreHours(0.5, 'dde')).toEqual({ score: 2, meu: 0.20 });
  });

  it('scores exactly 1 hr/day as 3', () => {
    expect(scoreHours(1, 'pitch')).toEqual({ score: 3, meu: 0.30 });
  });

  it('scores 1.5 hrs/day as 3', () => {
    expect(scoreHours(1.5, 'dde')).toEqual({ score: 3, meu: 0.30 });
  });

  it('scores exactly 2 hrs/day as 4', () => {
    expect(scoreHours(2, 'dde')).toEqual({ score: 4, meu: 0.40 });
  });

  it('scores exactly 3 hrs/day as 5', () => {
    expect(scoreHours(3, 'pitch')).toEqual({ score: 5, meu: 0.50 });
  });

  it('scores 5 hrs/day as 5', () => {
    expect(scoreHours(5, 'pitch')).toEqual({ score: 5, meu: 0.50 });
  });
});
