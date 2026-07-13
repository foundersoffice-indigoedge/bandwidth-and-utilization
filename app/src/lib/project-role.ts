import type { ProjectAssignment } from '@/types';
import { getStringList } from 'ie-ai-rulebook';

export type MandateRole = 'senior' | 'second_senior' | 'associate';

export interface ResolvedProjectRole {
  role: MandateRole;
  isSenior: boolean;
  /** Fellow ids this fellow must project bandwidth for (associate-slot occupants when senior; else []). */
  targetFellowIds: string[];
}

export function getPerformedRoleLabel(
  role: MandateRole,
  isEligibleVpAvp: boolean,
): string | null {
  return role === 'associate' && isEligibleVpAvp ? 'Performing Associate role' : null;
}

export type IsEligibleVpAvp = (recordId: string) => boolean;

/** First eligible VP/AVP in slot order, then an eligible VP/AVP leading from the director slot, else null. */
export function determineSeniorId(
  vpAvpIds: string[],
  directorIds: string[],
  isEligible: IsEligibleVpAvp,
): string | null {
  for (const id of vpAvpIds) if (isEligible(id)) return id;
  for (const id of directorIds) if (isEligible(id)) return id;
  return null;
}

export function resolveProjectRole(
  project: ProjectAssignment,
  fellowRecordId: string,
  isEligible: IsEligibleVpAvp,
): ResolvedProjectRole {
  const seniorId = determineSeniorId(project.vpAvpIds, project.directorIds, isEligible);
  if (seniorId && fellowRecordId === seniorId) {
    const vpRunTeamIds = project.isVpRun
      ? project.vpAvpIds.filter(id => id !== seniorId && isEligible(id))
      : [];
    return {
      role: 'senior',
      isSenior: true,
      targetFellowIds: [...new Set([...vpRunTeamIds, ...project.associateIds])],
    };
  }
  if (project.vpAvpIds.includes(fellowRecordId) || project.directorIds.includes(fellowRecordId)) {
    return { role: 'second_senior', isSenior: false, targetFellowIds: [] };
  }
  return { role: 'associate', isSenior: false, targetFellowIds: [] };
}

/** projectRecordId → set of fellow ids this fellow is allowed to project for. Used to validate submit payloads. */
export function computeAllowedTargets(
  projects: ProjectAssignment[],
  fellowRecordId: string,
  isEligible: IsEligibleVpAvp,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const p of projects) {
    const { targetFellowIds } = resolveProjectRole(p, fellowRecordId, isEligible);
    map.set(p.projectRecordId, new Set(targetFellowIds));
  }
  return map;
}

/** Pending (mid-cycle) projects have no Airtable columns; the creator is senior iff they are a VP/AVP.
 *  Reads the vocab directly from the rulebook to keep this module free of the airtable client import. */
export function isPendingProjectSenior(designation: string): boolean {
  return getStringList('utilization-mis.vocab.vp-avp').includes(designation);
}

/** Server-side gate for a posted (non-pending) submission entry. Self-reports are allowed only for
 *  projects the fellow is actually on; projections only to an authorized target on that project. */
export function isAllowedSubmissionEntry(
  entry: { projectRecordId: string; targetFellowId: string | null },
  allowedTargets: Map<string, Set<string>>,
  fellowProjectIds: Set<string>,
): boolean {
  if (entry.targetFellowId === null) return fellowProjectIds.has(entry.projectRecordId);
  return allowedTargets.get(entry.projectRecordId)?.has(entry.targetFellowId) ?? false;
}
