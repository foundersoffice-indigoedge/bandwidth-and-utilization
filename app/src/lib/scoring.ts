import { getNumber } from 'ie-agent-rules';
import type { HoursUnit } from '@/types';

// Working days per week is a governed rule (utilization-mis.calc.*).
// The old intensity-score curves are retired: utilization is measured purely as
// hours/week against the 84-hour benchmark (see utilization.ts). The
// submissions.auto_score column is now unused and slated for removal.
export const WORKING_DAYS_PER_WEEK = getNumber('utilization-mis.calc.working-days-per-week');

export function normalizeToHoursPerDay(value: number, unit: HoursUnit): number {
  return unit === 'per_week' ? value / WORKING_DAYS_PER_WEEK : value;
}

export function normalizeToHoursPerWeek(value: number, unit: HoursUnit): number {
  return unit === 'per_day' ? value * WORKING_DAYS_PER_WEEK : value;
}
