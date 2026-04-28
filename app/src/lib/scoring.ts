import type { ProjectType, HoursUnit } from '@/types';

export const WORKING_DAYS_PER_WEEK = 6;

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
  if (h < 1.5) return 1;
  if (h < 3)   return 2;
  if (h < 6)   return 3;
  if (h < 8)   return 4;
  return 5;
}

function scoreDdePitchHours(h: number): number {
  if (h < 0.5) return 1;
  if (h < 1)   return 2;
  if (h < 2)   return 3;
  if (h < 3)   return 4;
  return 5;
}
