import type { LoadTag } from '@/types';

export function sumMeu(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0);
}

export function calculateUtilization(totalMeu: number, capacityMeu: number): number {
  if (capacityMeu <= 0) return 0;
  return totalMeu / capacityMeu;
}

export function getLoadTag(utilization: number): LoadTag {
  if (utilization < 0.30) return 'Free';
  if (utilization < 0.60) return 'Comfortable';
  if (utilization < 0.85) return 'Busy';
  if (utilization <= 1.00) return 'At Capacity';
  return 'Overloaded';
}
