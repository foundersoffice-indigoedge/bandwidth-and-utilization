import { WORKING_DAYS_PER_WEEK } from '@/lib/scoring';
import { calculateHoursUtilization, getLoadTag } from '@/lib/utilization';
import type { ProjectBreakdownItem, ProjectType } from '@/types';

export interface HistoricalSelfReport {
  projectRecordId: string;
  projectName: string;
  projectType: string;
  hoursPerDay: number;
  hoursPerWeek: number | null;
}

export function rebuildHistoricalSnapshot(submissions: HistoricalSelfReport[], existing: ProjectBreakdownItem[] = []) {
  const existingByProjectId = new Map(
    existing.filter(item => item.projectRecordId).map(item => [item.projectRecordId!, item]),
  );
  const projectBreakdown: ProjectBreakdownItem[] = submissions.map(submission => ({
    ...existingByProjectId.get(submission.projectRecordId),
    projectRecordId: submission.projectRecordId,
    projectName: submission.projectName,
    projectType: submission.projectType as ProjectType,
    hoursPerDay: submission.hoursPerDay,
    hoursPerWeek: submission.hoursPerWeek ?? submission.hoursPerDay * WORKING_DAYS_PER_WEEK,
  }));
  const totalHoursPerWeek = projectBreakdown.reduce((sum, item) => sum + item.hoursPerWeek, 0);
  const hoursUtilizationPct = calculateHoursUtilization(totalHoursPerWeek);
  return {
    projectBreakdown,
    totalHoursPerWeek,
    hoursUtilizationPct,
    hoursLoadTag: getLoadTag(hoursUtilizationPct),
  };
}
