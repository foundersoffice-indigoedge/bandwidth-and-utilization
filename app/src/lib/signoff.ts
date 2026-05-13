import type { ProjectAssignment } from '@/types';

export interface SliceInput {
  directorFellowId: string;
  projects: ProjectAssignment[];
  tokens: Array<{ projectRecordId: string; fellowRecordId: string; status: string }>;
  submissions: Array<{ id: string; projectRecordId: string; fellowRecordId: string }>;
  conflicts: Array<{ projectRecordId: string; status: string; source: string }>;
}

/**
 * Determine whether a director's slice is complete.
 * Complete = every project where the director is in directorIds has had all team members submit
 * (no pending tokens) AND has no pending submission-level conflicts. Projects with zero
 * submissions are excluded from the check.
 */
export function getDirectorSliceStatus(input: SliceInput): 'complete' | 'incomplete' {
  const { directorFellowId, projects, tokens, submissions, conflicts } = input;

  // Director's projects only
  const directorProjects = projects.filter(p => p.directorIds.includes(directorFellowId));

  // Build per-project submission count
  const submissionsByProject = new Map<string, number>();
  for (const s of submissions) {
    submissionsByProject.set(s.projectRecordId, (submissionsByProject.get(s.projectRecordId) || 0) + 1);
  }

  // Exclude projects with zero team members AND zero submissions (truly empty — no one to sign off on)
  const inScope = directorProjects.filter(p => {
    const hasTeam = p.vpAvpIds.length > 0 || p.associateIds.length > 0;
    const hasSubmissions = (submissionsByProject.get(p.projectRecordId) || 0) > 0;
    return hasTeam || hasSubmissions;
  });

  for (const project of inScope) {
    const teamIds = new Set([...project.vpAvpIds, ...project.associateIds]);

    // Pending tokens for anyone on this project's team
    const hasPendingToken = tokens.some(
      t => t.projectRecordId === project.projectRecordId
           && teamIds.has(t.fellowRecordId)
           && t.status === 'pending'
    );
    if (hasPendingToken) return 'incomplete';

    // Pending submission-level conflicts on this project
    const hasPendingConflict = conflicts.some(
      c => c.projectRecordId === project.projectRecordId
           && c.status === 'pending'
           && c.source === 'submission'
    );
    if (hasPendingConflict) return 'incomplete';
  }

  return 'complete';
}
