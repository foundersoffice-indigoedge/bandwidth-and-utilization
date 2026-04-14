import { fetchAllRecords } from './client';
import { TABLE_CONFIG } from './config';
import type { ProjectType, ProjectAssignment } from '@/types';

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

          return {
            projectRecordId: r.id,
            projectName: r.fields[cfg.nameField] as string,
            projectType: type,
            stage: (r.fields[cfg.stageField] as string) || '',
            vpAvpIds,
            associateIds,
          };
        });
    })
  );

  return results.flat();
}

export function getProjectsForFellow(
  projects: ProjectAssignment[],
  fellowRecordId: string
): ProjectAssignment[] {
  return projects.filter(
    p => p.vpAvpIds.includes(fellowRecordId) || p.associateIds.includes(fellowRecordId)
  );
}
