const REFERENCE_DATE = new Date('2026-04-27');

export const CYCLE_LENGTH_DAYS = 7;

export function isCycleMonday(date: Date): boolean {
  if (date.getDay() !== 1) return false;
  return date.getTime() >= REFERENCE_DATE.getTime();
}

/**
 * Returns the inclusive last day of the cycle that started on `startDate`.
 * End = day before the next cycle starts. For cycles before the weekly anchor
 * (2026-04-27), the next cycle is the anchor itself — handles the biweekly →
 * weekly transition (e.g. Apr 17 cycle → ends Apr 26, not Apr 23).
 */
export function getCycleEndDate(startDate: Date | string): Date {
  const start = typeof startDate === 'string' ? new Date(startDate) : new Date(startDate);
  let nextStart: Date;
  if (start.getTime() < REFERENCE_DATE.getTime()) {
    nextStart = new Date(REFERENCE_DATE);
  } else {
    nextStart = new Date(start);
    nextStart.setDate(nextStart.getDate() + CYCLE_LENGTH_DAYS);
  }
  const end = new Date(nextStart);
  end.setDate(end.getDate() - 1);
  return end;
}
