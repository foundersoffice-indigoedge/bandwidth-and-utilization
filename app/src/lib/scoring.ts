import { getNumber, scoreFromCurve } from 'ie-agent-rules';
import type { ProjectType, HoursUnit } from '@/types';

// Working days per week and both hours-to-score curves are governed rules
// (utilization-mis.calc.*). scoreFromCurve reproduces the old if-chains exactly.
export const WORKING_DAYS_PER_WEEK = getNumber('utilization-mis.calc.working-days-per-week');

export function normalizeToHoursPerDay(value: number, unit: HoursUnit): number {
  return unit === 'per_week' ? value / WORKING_DAYS_PER_WEEK : value;
}

export function normalizeToHoursPerWeek(value: number, unit: HoursUnit): number {
  return unit === 'per_day' ? value * WORKING_DAYS_PER_WEEK : value;
}

export function scoreHours(hoursPerDay: number, projectType: ProjectType): { score: number } {
  if (projectType === 'mandate') return { score: scoreMandateHours(hoursPerDay) };
  return { score: scoreDdePitchHours(hoursPerDay) };
}

function scoreMandateHours(h: number): number {
  return scoreFromCurve(h, 'utilization-mis.calc.score-curve.mandate');
}

function scoreDdePitchHours(h: number): number {
  return scoreFromCurve(h, 'utilization-mis.calc.score-curve.dde-pitch');
}
