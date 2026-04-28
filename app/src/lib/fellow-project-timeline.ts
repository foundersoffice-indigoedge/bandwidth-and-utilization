import { WEEKLY_CAPACITY_HOURS } from './utilization';

export interface TimelineSubmission {
  cycleId: string;
  cycleStart: string;
  fellowRecordId: string;
  targetFellowId: string | null;
  isSelfReport: boolean;
  projectRecordId: string;
  projectName: string;
  projectType: 'mandate' | 'dde' | 'pitch';
  hoursPerWeek: number;
  hoursPerDay: number;
  autoScore: number;
}

export interface TimelinePoint {
  cycleId: string;
  cycleStart: string;
  projectName: string;
  projectType: 'mandate' | 'dde' | 'pitch';
  hoursPerWeek: number;
  capacityPct: number;
  autoScore: number;
  source: 'self' | 'projection';
}

export function iyOf(dateStr: string): number {
  const d = new Date(dateStr);
  return d.getUTCMonth() >= 6 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
}

export function buildTimeline(
  submissions: TimelineSubmission[],
  fellowRecordId: string,
  projectRecordId: string,
): TimelinePoint[] {
  const relevant = submissions.filter(s => {
    if (s.projectRecordId !== projectRecordId) return false;
    const isOwn = s.isSelfReport && s.fellowRecordId === fellowRecordId;
    const isProjection = !s.isSelfReport && s.targetFellowId === fellowRecordId;
    return isOwn || isProjection;
  });

  const byCycle = new Map<string, TimelineSubmission>();
  for (const s of relevant) {
    const existing = byCycle.get(s.cycleId);
    if (!existing) {
      byCycle.set(s.cycleId, s);
      continue;
    }
    // Prefer self-report over projection
    if (s.isSelfReport && !existing.isSelfReport) {
      byCycle.set(s.cycleId, s);
    }
  }

  return Array.from(byCycle.values())
    .sort((a, b) => a.cycleStart.localeCompare(b.cycleStart))
    .map(s => ({
      cycleId: s.cycleId,
      cycleStart: s.cycleStart,
      projectName: s.projectName,
      projectType: s.projectType,
      hoursPerWeek: s.hoursPerWeek,
      capacityPct: s.hoursPerWeek / WEEKLY_CAPACITY_HOURS,
      autoScore: s.autoScore,
      source: s.isSelfReport ? 'self' : 'projection',
    }));
}

export function listProjectsForFellow(
  submissions: TimelineSubmission[],
  fellowRecordId: string,
  iys: number[],
): { projectRecordId: string; projectName: string; projectType: 'mandate' | 'dde' | 'pitch' }[] {
  const iySet = new Set(iys);
  const projectMap = new Map<string, { projectRecordId: string; projectName: string; projectType: 'mandate' | 'dde' | 'pitch'; latestStart: string }>();

  for (const s of submissions) {
    if (!iySet.has(iyOf(s.cycleStart))) continue;
    const isOwn = s.isSelfReport && s.fellowRecordId === fellowRecordId;
    const isProjection = !s.isSelfReport && s.targetFellowId === fellowRecordId;
    if (!isOwn && !isProjection) continue;

    const existing = projectMap.get(s.projectRecordId);
    if (!existing || s.cycleStart > existing.latestStart) {
      projectMap.set(s.projectRecordId, {
        projectRecordId: s.projectRecordId,
        projectName: s.projectName,
        projectType: s.projectType,
        latestStart: s.cycleStart,
      });
    }
  }

  return Array.from(projectMap.values())
    .sort((a, b) => a.projectName.localeCompare(b.projectName))
    .map(({ projectRecordId, projectName, projectType }) => ({ projectRecordId, projectName, projectType }));
}
