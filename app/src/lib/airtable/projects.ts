import { fetchAllRecords } from './client';
import { TABLE_CONFIG } from './config';
import { fetchEligibleFellows, isVpOrAvp } from './fellows';
import type { ProjectType, ProjectAssignment } from '@/types';

/** Extract director record ids from an Airtable project row. Returns [] for VP-led mandates. */
export function extractDirectorIds(
  type: ProjectType,
  fields: Record<string, unknown>,
  isVpRun: boolean
): string[] {
  if (type === 'mandate' && isVpRun) return [];
  const cfg = TABLE_CONFIG[type];
  const ids: string[] = [];
  for (const fieldName of cfg.directorFields) {
    const raw = fields[fieldName];
    if (Array.isArray(raw)) ids.push(...(raw as string[]));
  }
  return ids;
}

export async function fetchAllProjects(): Promise<ProjectAssignment[]> {
  const types: ProjectType[] = ['mandate', 'dde', 'pitch'];

  const results = await Promise.all(
    types.map(async (type) => {
      const cfg = TABLE_CONFIG[type];
      const records = await fetchAllRecords(cfg.tableId);

      return records
        .filter(r => {
          const stage = (r.fields[cfg.stageField] as string) || '';
          return cfg.activeStages.includes(stage);
        })
        .map((r): ProjectAssignment => {
          const vpAvpIds: string[] = [];
          for (const field of cfg.vpAvpFields) {
            const ids = r.fields[field] as string[] | undefined;
            if (ids?.length) vpAvpIds.push(...ids);
          }

          const associateIds: string[] = [];
          for (const field of cfg.associateFields) {
            const ids = r.fields[field] as string[] | undefined;
            if (ids?.length) associateIds.push(...ids);
          }

          let isVpRun: boolean | undefined;
          let leadFellowRecordId: string | undefined;
          if (type === 'mandate' && cfg.isVpRunField) {
            const raw = r.fields[cfg.isVpRunField];
            isVpRun = raw === 'Yes';
            if (isVpRun) {
              const vp1Ids = (r.fields['Mandate VP / AVP 1'] as string[] | undefined) || [];
              if (vp1Ids.length > 0) leadFellowRecordId = vp1Ids[0];
            }
          }

          const directorIds = extractDirectorIds(type, r.fields, isVpRun === true);

          return {
            projectRecordId: r.id,
            projectName: r.fields[cfg.nameField] as string,
            projectType: type,
            stage: (r.fields[cfg.stageField] as string) || '',
            vpAvpIds,
            associateIds,
            directorIds,
            isVpRun,
            leadFellowRecordId,
          };
        });
    })
  );

  const projects = results.flat();

  const needsLeadName = projects.some(p => p.leadFellowRecordId);
  if (needsLeadName) {
    const fellows = await fetchEligibleFellows();
    const nameMap = new Map(fellows.map(f => [f.recordId, f.name]));
    for (const p of projects) {
      if (p.leadFellowRecordId) {
        p.leadFellowName = nameMap.get(p.leadFellowRecordId);
      }
    }
  }

  return projects;
}

/**
 * Projects a fellow should report bandwidth on. Matches the VP/AVP and Associate
 * columns, plus the Director column when the fellow is themselves a VP/AVP — a VP/AVP
 * who *leads* a project sits in the Director slot, and must still be asked for hours.
 * The designation gate keeps true Directors out of the director branch (they are not
 * eligible fellows upstream, but this is the explicit guard). `.filter` returns each
 * project at most once, so a fellow listed in both Director and VP/AVP columns of the
 * same record is never asked twice.
 */
export function getProjectsForFellow(
  projects: ProjectAssignment[],
  fellowRecordId: string,
  fellowDesignation: string
): ProjectAssignment[] {
  const leadsFromDirectorSlot = isVpOrAvp(fellowDesignation);
  return projects.filter(
    p =>
      p.vpAvpIds.includes(fellowRecordId) ||
      p.associateIds.includes(fellowRecordId) ||
      (leadsFromDirectorSlot && p.directorIds.includes(fellowRecordId))
  );
}
