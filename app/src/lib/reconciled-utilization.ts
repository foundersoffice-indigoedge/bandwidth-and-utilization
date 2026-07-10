import { reconcileLiveSelfReports } from '@/lib/airtable/projects';
import { WORKING_DAYS_PER_WEEK } from '@/lib/scoring';
import { calculateHoursUtilization, getLoadTag } from '@/lib/utilization';
import type { LoadTag, ProjectAssignment } from '@/types';

export interface ReconciledSubmission {
  projectRecordId: string;
  hoursPerDay: number;
  hoursPerWeek: number | null;
}

export interface ReconciledUtilization<T> {
  submissions: T[];
  excludedProjectCount: number;
  totalHoursPerWeek: number;
  hoursUtilizationPct: number;
  loadTag: LoadTag;
}

export function buildReconciledUtilization<T extends ReconciledSubmission>(
  rawSelfReports: T[],
  activeProjects: ProjectAssignment[],
  fellowRecordId: string,
  fellowDesignation: string,
): ReconciledUtilization<T> | null {
  if (rawSelfReports.length === 0) return null;

  const { submissions, excludedProjectCount } = reconcileLiveSelfReports(
    rawSelfReports,
    activeProjects,
    fellowRecordId,
    fellowDesignation,
  );
  const totalHoursPerWeek = submissions.reduce(
    (sum, submission) => sum + (
      submission.hoursPerWeek ?? submission.hoursPerDay * WORKING_DAYS_PER_WEEK
    ),
    0,
  );
  const hoursUtilizationPct = calculateHoursUtilization(totalHoursPerWeek);

  return {
    submissions,
    excludedProjectCount,
    totalHoursPerWeek,
    hoursUtilizationPct,
    loadTag: getLoadTag(hoursUtilizationPct),
  };
}
