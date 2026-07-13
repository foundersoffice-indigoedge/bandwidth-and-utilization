import { INVESTMENT_YEAR_START_MONTH } from '@/lib/utilization';

function investmentYearForDate(date: string): number {
  const [year, month] = date.split('-').map(Number);
  const zeroBasedMonth = month - 1;
  return zeroBasedMonth >= INVESTMENT_YEAR_START_MONTH ? year + 1 : year;
}

export function getAvailableInvestmentYears(
  snapshotDates: string[],
  currentInvestmentYear: number,
): number[] {
  const years = new Set(snapshotDates.map(investmentYearForDate));
  years.add(currentInvestmentYear);
  return [...years].sort((a, b) => a - b);
}
