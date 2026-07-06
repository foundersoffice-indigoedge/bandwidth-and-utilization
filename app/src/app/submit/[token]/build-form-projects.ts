import type { ProjectAssignment, Fellow, ProjectType } from '@/types';
import { isVpOrAvp } from '@/lib/airtable/fellows';
import { resolveProjectRole, determineSeniorId, type MandateRole } from '@/lib/project-role';

export interface FormProject {
  projectRecordId: string;
  projectName: string;
  projectType: ProjectType;
  stage: string;
  associates: { recordId: string; name: string }[];
  isVpRun?: boolean;
  leadFellowName?: string;
  performedRole: MandateRole;
  performedRoleLabel: string | null;
}

/** Show a pill only when the mandate role differs from the person's own designation tier. */
function pillFor(role: MandateRole, designation: string): string | null {
  const actingAssociate = role === 'associate' && isVpOrAvp(designation);
  return actingAssociate ? 'acting as Associate' : null;
}

export function buildFormProjects(
  fellowProjects: ProjectAssignment[],
  fellowRecordId: string,
  fellowDesignation: string,
  fellows: Fellow[],
): FormProject[] {
  const byId = new Map(fellows.map(f => [f.recordId, f]));
  const isEligible = (id: string) => {
    const f = byId.get(id);
    return !!f && isVpOrAvp(f.designation);
  };

  return fellowProjects.map(project => {
    const { role, targetFellowIds } = resolveProjectRole(project, fellowRecordId, isEligible);
    const associates = targetFellowIds
      .map(id => byId.get(id))
      .filter((f): f is Fellow => f != null)
      .map(f => ({ recordId: f.recordId, name: f.name }));

    // Lead line: the project's senior, computed the same way for every mandate type
    // (the Airtable `leadFellowName` is only populated for VP-run mandates, so don't rely on it).
    const seniorId = determineSeniorId(project.vpAvpIds, project.directorIds, isEligible);
    const leadFellowName = seniorId ? byId.get(seniorId)?.name : undefined;

    return {
      projectRecordId: project.projectRecordId,
      projectName: project.projectName,
      projectType: project.projectType,
      stage: project.stage,
      associates,
      isVpRun: project.isVpRun,
      leadFellowName,
      performedRole: role,
      performedRoleLabel: pillFor(role, fellowDesignation),
    };
  });
}
