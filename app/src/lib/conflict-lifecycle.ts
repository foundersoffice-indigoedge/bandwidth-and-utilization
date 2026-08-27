import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { conflicts, submissions } from '@/lib/db/schema';
import { determineSeniorId, resolveProjectRole, type IsEligibleVpAvp } from '@/lib/project-role';
import type { ProjectAssignment } from '@/types';

type SubmissionConflict = Pick<typeof conflicts.$inferSelect,
  'id' | 'cycleId' | 'projectRecordId' | 'source' | 'status' | 'vpSubmissionId' | 'associateSubmissionId'>;
type ConflictSubmission = Pick<typeof submissions.$inferSelect,
  'id' | 'cycleId' | 'projectRecordId' | 'fellowRecordId' | 'isSelfReport' | 'targetFellowId'>;

export type SubmissionConflictLifecycle = 'active' | 'obsolete' | 'ambiguous';

export interface ConflictLifecycleContext {
  activeProjects: ProjectAssignment[];
  isEligibleVpAvp: IsEligibleVpAvp;
}

export interface ConflictReconciliationResult {
  resolvedConflictIds: string[];
  activeConflictIds: string[];
  ambiguousConflictIds: string[];
}

/**
 * Classifies only submission-source conflicts. Airtable's active-stage projection is
 * authoritative: a project missing from it is inactive, deleted, paused, terminal,
 * superseded, or reassigned for this workflow. Mid-cycle pending projects stay live
 * because their lifecycle is owned by the setup queue, not Airtable.
 */
export function classifySubmissionConflict(
  conflict: SubmissionConflict,
  submissionsById: Map<string, ConflictSubmission>,
  context: ConflictLifecycleContext,
): SubmissionConflictLifecycle {
  if (conflict.source !== 'submission') return 'active';
  if (conflict.projectRecordId.startsWith('pending_')) return 'active';
  if (!conflict.vpSubmissionId || !conflict.associateSubmissionId) return 'ambiguous';

  const vpSubmission = submissionsById.get(conflict.vpSubmissionId);
  const associateSubmission = submissionsById.get(conflict.associateSubmissionId);
  if (!vpSubmission || !associateSubmission) return 'ambiguous';

  const rowsMatchConflict =
    vpSubmission.cycleId === conflict.cycleId &&
    associateSubmission.cycleId === conflict.cycleId &&
    vpSubmission.projectRecordId === conflict.projectRecordId &&
    associateSubmission.projectRecordId === conflict.projectRecordId &&
    vpSubmission.isSelfReport === false &&
    associateSubmission.isSelfReport === true &&
    vpSubmission.targetFellowId === associateSubmission.fellowRecordId;
  if (!rowsMatchConflict) return 'ambiguous';

  const project = context.activeProjects.find(p => p.projectRecordId === conflict.projectRecordId);
  if (!project) return 'obsolete';

  const currentSeniorId = determineSeniorId(
    project.vpAvpIds,
    project.directorIds,
    context.isEligibleVpAvp,
  );
  if (currentSeniorId !== vpSubmission.fellowRecordId) return 'obsolete';

  const role = resolveProjectRole(project, currentSeniorId, context.isEligibleVpAvp);
  return role.targetFellowIds.includes(associateSubmission.fellowRecordId) ? 'active' : 'obsolete';
}

/** Resolve only verified obsolete submission conflicts. It never changes submissions or reminder history. */
export async function reconcilePendingSubmissionConflicts(
  cycleId: string,
  context: ConflictLifecycleContext,
): Promise<ConflictReconciliationResult> {
  const pending = await db
    .select({
      id: conflicts.id,
      cycleId: conflicts.cycleId,
      projectRecordId: conflicts.projectRecordId,
      source: conflicts.source,
      status: conflicts.status,
      vpSubmissionId: conflicts.vpSubmissionId,
      associateSubmissionId: conflicts.associateSubmissionId,
    })
    .from(conflicts)
    .where(and(
      eq(conflicts.cycleId, cycleId),
      eq(conflicts.status, 'pending'),
      eq(conflicts.source, 'submission'),
    ));

  const submissionIds = pending.flatMap(conflict => [
    conflict.vpSubmissionId,
    conflict.associateSubmissionId,
  ]).filter((id): id is string => id !== null);
  const relatedSubmissions = submissionIds.length === 0
    ? []
    : await db
      .select({
        id: submissions.id,
        cycleId: submissions.cycleId,
        projectRecordId: submissions.projectRecordId,
        fellowRecordId: submissions.fellowRecordId,
        isSelfReport: submissions.isSelfReport,
        targetFellowId: submissions.targetFellowId,
      })
      .from(submissions)
      .where(inArray(submissions.id, submissionIds));
  const submissionsById = new Map(relatedSubmissions.map(submission => [submission.id, submission]));

  const activeConflictIds: string[] = [];
  const ambiguousConflictIds: string[] = [];
  const obsoleteConflictIds: string[] = [];
  for (const conflict of pending) {
    const lifecycle = classifySubmissionConflict(conflict, submissionsById, context);
    if (lifecycle === 'active') activeConflictIds.push(conflict.id);
    if (lifecycle === 'ambiguous') ambiguousConflictIds.push(conflict.id);
    if (lifecycle === 'obsolete') obsoleteConflictIds.push(conflict.id);
  }

  if (obsoleteConflictIds.length === 0) {
    return { resolvedConflictIds: [], activeConflictIds, ambiguousConflictIds };
  }

  const resolved = await db
    .update(conflicts)
    .set({
      status: 'resolved' as const,
      resolvedHoursPerDay: null,
      resolvedBy: 'project_inactive',
    })
    .where(and(
      inArray(conflicts.id, obsoleteConflictIds),
      eq(conflicts.status, 'pending'),
      eq(conflicts.source, 'submission'),
    ))
    .returning({ id: conflicts.id });

  return {
    resolvedConflictIds: resolved.map(conflict => conflict.id),
    activeConflictIds,
    ambiguousConflictIds,
  };
}
