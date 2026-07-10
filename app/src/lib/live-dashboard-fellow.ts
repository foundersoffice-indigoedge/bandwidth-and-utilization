import { findSubmissionRemarks } from '@/lib/dashboard-reconciliation';
import {
  buildReconciledUtilization,
  type ReconciledSubmission,
  type ReconciledUtilization,
} from '@/lib/reconciled-utilization';
import type { ProjectAssignment } from '@/types';

export interface LiveDashboardSubmission extends ReconciledSubmission {
  remarks: string | null;
}

export interface LiveDashboardFellowResult<T> extends ReconciledUtilization<T> {
  remarks: string | null;
}

export function buildLiveDashboardFellow<T extends LiveDashboardSubmission>(
  rawSelfReports: T[],
  activeProjects: ProjectAssignment[],
  fellowRecordId: string,
  fellowDesignation: string,
): LiveDashboardFellowResult<T> | null {
  const utilization = buildReconciledUtilization(
    rawSelfReports,
    activeProjects,
    fellowRecordId,
    fellowDesignation,
  );
  if (!utilization) return null;

  return {
    ...utilization,
    remarks: findSubmissionRemarks(rawSelfReports),
  };
}
