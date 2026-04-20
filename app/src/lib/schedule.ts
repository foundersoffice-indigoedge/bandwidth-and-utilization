const REFERENCE_DATE = new Date('2026-04-27');

export function isCycleMonday(date: Date): boolean {
  if (date.getDay() !== 1) return false;
  return date.getTime() >= REFERENCE_DATE.getTime();
}
