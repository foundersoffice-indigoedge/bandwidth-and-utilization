import { getNumber } from 'ie-agent-rules';

// Conflict threshold is a governed rule (utilization-mis.calc.conflict-threshold-hours).
export const CONFLICT_THRESHOLD_HOURS = getNumber('utilization-mis.calc.conflict-threshold-hours');

export function isConflict(vpHoursPerDay: number, associateHoursPerDay: number): boolean {
  return Math.abs(vpHoursPerDay - associateHoursPerDay) > CONFLICT_THRESHOLD_HOURS;
}
