import { updateRecord } from './client';
import { TABLE_CONFIG } from './config';
import type { ProjectType } from '@/types';

export interface FellowBandwidthEntry {
  fellowName: string;
  score: number;
  hoursPerDay: number;
  stage: string;
}

export function generateNarrative(
  projectName: string,
  projectType: ProjectType,
  dateStr: string,
  entries: FellowBandwidthEntry[]
): string {
  const lines = entries.map(e => {
    const stageNote = e.stage ? ` ${e.stage}.` : '';
    return `- ${e.fellowName} – Score ${e.score}; ${e.hoursPerDay} hrs/day.${stageNote}`;
  });

  return [
    projectName,
    `Current Bandwidth Situation for ${projectName} as on ${dateStr}`,
    '',
    ...lines,
  ].join('\n');
}

export async function writeBandwidthToAirtable(
  projectRecordId: string,
  projectType: ProjectType,
  narrative: string
): Promise<void> {
  const cfg = TABLE_CONFIG[projectType];
  await updateRecord(cfg.tableId, projectRecordId, {
    [cfg.bandwidthField]: narrative,
  });
}
