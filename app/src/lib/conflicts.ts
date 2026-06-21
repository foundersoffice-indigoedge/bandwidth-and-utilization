// Conflict threshold is workflow config (re-inlined from rules store).
export const CONFLICT_THRESHOLD_HOURS = 1;

export function isConflict(vpHoursPerDay: number, associateHoursPerDay: number): boolean {
  return Math.abs(vpHoursPerDay - associateHoursPerDay) > CONFLICT_THRESHOLD_HOURS;
}
