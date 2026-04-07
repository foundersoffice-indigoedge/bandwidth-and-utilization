export const CONFLICT_THRESHOLD_HOURS = 2;

export function isConflict(vpHoursPerDay: number, associateHoursPerDay: number): boolean {
  return Math.abs(vpHoursPerDay - associateHoursPerDay) > CONFLICT_THRESHOLD_HOURS;
}
