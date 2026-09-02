import { normalizeToHoursPerDay, normalizeToHoursPerWeek } from '@/lib/scoring';
import {
  computeAllowedTargets,
  determineSeniorId,
  isAllowedSubmissionEntry,
  isPendingProjectSenior,
} from '@/lib/project-role';
import type { ProjectAssignment, ProjectType } from '@/types';

export interface SubmittedEntry {
  projectRecordId: string;
  targetFellowId: string | null;
  hoursValue: number;
  hoursUnit: 'per_day' | 'per_week';
}

export interface SubmissionTokenContext {
  cycleId: string;
  fellowRecordId: string;
  fellowDesignation: string;
}

export interface PendingProjectForSubmission {
  id: string;
  cycleId: string;
  type: ProjectType;
  name: string;
  teammateRecordIds: string[];
  createdByFellowId: string;
}

export interface ResolvedSubmissionEntry {
  projectRecordId: string;
  projectName: string;
  projectType: ProjectType;
  targetFellowId: string | null;
  hoursValue: number;
  hoursUnit: 'per_day' | 'per_week';
  hoursPerDay: number;
  hoursPerWeek: number;
  isSelfReport: boolean;
  /** The fellow who may make a projection authoritative for conflict checks. */
  seniorFellowId: string | null;
}

export type SubmissionValidationResult =
  | { ok: true; entries: ResolvedSubmissionEntry[] }
  | { ok: false; error: string };

interface ValidationContext {
  token: SubmissionTokenContext;
  allProjects: ProjectAssignment[];
  pendingProjects: PendingProjectForSubmission[];
  isEligibleVpAvp: (fellowRecordId: string) => boolean;
}

/**
 * Resolve every submitted row from server-owned project data before persisting
 * anything. The form may only submit entries it could legitimately render.
 */
export function validateAndResolveSubmissionEntries(
  rawEntries: unknown,
  context: ValidationContext,
): SubmissionValidationResult {
  if (!Array.isArray(rawEntries)) {
    return { ok: false, error: 'Submission entries are required.' };
  }

  const projectById = new Map(context.allProjects.map(project => [project.projectRecordId, project]));
  const pendingByProjectId = new Map(
    context.pendingProjects
      .filter(project => project.cycleId === context.token.cycleId)
      .map(project => [`pending_${project.id}`, project]),
  );
  const fellowProjects = context.allProjects.filter(project =>
    project.vpAvpIds.includes(context.token.fellowRecordId) ||
    project.associateIds.includes(context.token.fellowRecordId) ||
    project.directorIds.includes(context.token.fellowRecordId),
  );
  const fellowProjectIds = new Set(fellowProjects.map(project => project.projectRecordId));
  const allowedTargets = computeAllowedTargets(
    fellowProjects,
    context.token.fellowRecordId,
    context.isEligibleVpAvp,
  );

  const seenEntries = new Set<string>();
  const entries: ResolvedSubmissionEntry[] = [];

  for (const rawEntry of rawEntries) {
    if (!isSubmittedEntry(rawEntry)) {
      return { ok: false, error: 'Each project entry must include a project, target, hours, and unit.' };
    }

    if (!Number.isFinite(rawEntry.hoursValue) || rawEntry.hoursValue < 0) {
      return { ok: false, error: 'Hours must be a valid non-negative number.' };
    }

    const key = `${rawEntry.projectRecordId}\u0000${rawEntry.targetFellowId ?? 'self'}`;
    if (seenEntries.has(key)) {
      return { ok: false, error: 'Each project and fellow combination can be submitted only once.' };
    }
    seenEntries.add(key);

    const pending = pendingByProjectId.get(rawEntry.projectRecordId);
    if (pending) {
      const participantIds = new Set([pending.createdByFellowId, ...pending.teammateRecordIds]);
      if (!participantIds.has(context.token.fellowRecordId)) {
        return { ok: false, error: 'You are not a participant on this pending project.' };
      }

      if (
        rawEntry.targetFellowId !== null &&
        (
          pending.createdByFellowId !== context.token.fellowRecordId ||
          !isPendingProjectSenior(context.token.fellowDesignation) ||
          !participantIds.has(rawEntry.targetFellowId) ||
          rawEntry.targetFellowId === context.token.fellowRecordId
        )
      ) {
        return { ok: false, error: 'You are not allowed to report bandwidth for this pending-project teammate.' };
      }

      entries.push(resolveEntry(rawEntry, pending.name, pending.type, rawEntry.targetFellowId === null,
        context.isEligibleVpAvp(pending.createdByFellowId) ? pending.createdByFellowId : null));
      continue;
    }

    const project = projectById.get(rawEntry.projectRecordId);
    if (!project) {
      return { ok: false, error: 'One of the listed projects is no longer available. Refresh the form and try again.' };
    }

    if (!isAllowedSubmissionEntry(rawEntry, allowedTargets, fellowProjectIds)) {
      return { ok: false, error: 'You are not allowed to submit that project entry.' };
    }

    entries.push(resolveEntry(
      rawEntry,
      project.projectName,
      project.projectType,
      rawEntry.targetFellowId === null,
      determineSeniorId(project.vpAvpIds, project.directorIds, context.isEligibleVpAvp),
    ));
  }

  return { ok: true, entries };
}

function isSubmittedEntry(value: unknown): value is SubmittedEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.projectRecordId === 'string' && entry.projectRecordId.length > 0 &&
    (entry.targetFellowId === null || (typeof entry.targetFellowId === 'string' && entry.targetFellowId.length > 0)) &&
    typeof entry.hoursValue === 'number' &&
    (entry.hoursUnit === 'per_day' || entry.hoursUnit === 'per_week');
}

function resolveEntry(
  entry: SubmittedEntry,
  projectName: string,
  projectType: ProjectType,
  isSelfReport: boolean,
  seniorFellowId: string | null,
): ResolvedSubmissionEntry {
  return {
    ...entry,
    projectName,
    projectType,
    hoursPerDay: normalizeToHoursPerDay(entry.hoursValue, entry.hoursUnit),
    hoursPerWeek: normalizeToHoursPerWeek(entry.hoursValue, entry.hoursUnit),
    isSelfReport,
    seniorFellowId,
  };
}
