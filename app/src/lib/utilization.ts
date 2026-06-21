import { getNumber, loadTagFromBands } from 'ie-agent-rules';
import type { LoadTag } from '@/types';

// Weekly capacity and the load-tag bands are governed rules
// (utilization-mis.calc.*). loadTagFromBands reproduces the old thresholds
// exactly, including the final <= band.
export const WEEKLY_CAPACITY_HOURS = getNumber('utilization-mis.calc.weekly-capacity-hours');

// Investment-year start month (0-based; 6 = July). A date in this month or later
// belongs to the next IY. Re-inlined from the rules store as workflow config.
export const INVESTMENT_YEAR_START_MONTH = 6;

export function calculateHoursUtilization(totalHoursPerWeek: number): number {
  return totalHoursPerWeek / WEEKLY_CAPACITY_HOURS;
}

export function getLoadTag(utilization: number): LoadTag {
  return loadTagFromBands(utilization, 'utilization-mis.calc.load-tag-bands') as LoadTag;
}
