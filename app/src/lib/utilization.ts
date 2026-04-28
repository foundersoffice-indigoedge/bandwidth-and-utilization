import type { LoadTag } from '@/types';

export const WEEKLY_CAPACITY_HOURS = 84;

export function calculateHoursUtilization(totalHoursPerWeek: number): number {
  return totalHoursPerWeek / WEEKLY_CAPACITY_HOURS;
}

export function getLoadTag(utilization: number): LoadTag {
  if (utilization < 0.30) return 'Free';
  if (utilization < 0.60) return 'Comfortable';
  if (utilization < 0.85) return 'Busy';
  if (utilization <= 1.00) return 'At Capacity';
  return 'Overloaded';
}
