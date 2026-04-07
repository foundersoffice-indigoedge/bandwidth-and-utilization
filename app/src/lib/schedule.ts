const REFERENCE_DATE = new Date('2026-04-20');

export function isCycleMonday(date: Date): boolean {
  if (date.getDay() !== 1) return false;
  const diffMs = date.getTime() - REFERENCE_DATE.getTime();
  if (diffMs < 0) return false;
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return diffDays % 14 === 0;
}
