import type { ProjectType, HoursUnit } from '@/types';

export const WORKING_DAYS_PER_WEEK = 6;

export function normalizeToHoursPerDay(value: number, unit: HoursUnit): number {
  return unit === 'per_week' ? value / WORKING_DAYS_PER_WEEK : value;
}

export function normalizeToHoursPerWeek(value: number, unit: HoursUnit): number {
  return unit === 'per_day' ? value * WORKING_DAYS_PER_WEEK : value;
}

export function scoreHours(hoursPerDay: number, projectType: ProjectType): { score: number; meu: number } {
  if (projectType === 'mandate') return scoreMandateHours(hoursPerDay);
  return scoreDdePitchHours(hoursPerDay);
}

function scoreMandateHours(h: number): { score: number; meu: number } {
  if (h < 1.5) return { score: 1, meu: 0.25 };
  if (h < 3)   return { score: 2, meu: 0.75 };
  if (h < 6)   return { score: 3, meu: 1.00 };
  if (h < 8)   return { score: 4, meu: 1.25 };
  return { score: 5, meu: 1.50 };
}

function scoreDdePitchHours(h: number): { score: number; meu: number } {
  if (h < 0.5) return { score: 1, meu: 0.10 };
  if (h < 1)   return { score: 2, meu: 0.20 };
  if (h < 2)   return { score: 3, meu: 0.30 };
  if (h < 3)   return { score: 4, meu: 0.40 };
  return { score: 5, meu: 0.50 };
}
