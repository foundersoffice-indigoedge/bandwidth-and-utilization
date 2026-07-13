import type { ProjectAssignment, Fellow, ProjectType } from '@/types';
import { isVpOrAvp } from '@/lib/airtable/fellows';
import { getPerformedRoleLabel, resolveProjectRole, type MandateRole } from '@/lib/project-role';

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

    // "Led by X" names the lead VP, and only ever shows on VP-run mandates: Airtable
    // populates `leadFellowName` solely for those. A director-led mandate's lead is the
    // director, which isn't surfaced on this form — so leave it undefined there.
    return {
      projectRecordId: project.projectRecordId,
      projectName: project.projectName,
      projectType: project.projectType,
      stage: project.stage,
      associates,
      isVpRun: project.isVpRun,
      leadFellowName: project.leadFellowName,
      performedRole: role,
      performedRoleLabel: getPerformedRoleLabel(role, isVpOrAvp(fellowDesignation)),
    };
  });
}
