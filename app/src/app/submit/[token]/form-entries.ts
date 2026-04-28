export interface AssociateShape {
  recordId: string;
  name: string;
}

export interface ProjectShape {
  projectRecordId: string;
  projectType: string;
  associates: AssociateShape[];
  isNew?: boolean;
}

export interface HoursEntry {
  projectRecordId: string;
  targetFellowId: string | null;
  hoursValue: string;
  hoursUnit: 'per_day' | 'per_week';
}

function defaultEntry(projectRecordId: string, targetFellowId: string | null): HoursEntry {
  return {
    projectRecordId,
    targetFellowId,
    hoursValue: '',
    hoursUnit: 'per_day',
  };
}

/**
 * Builds the full entries lookup the form renders against. Merges user-typed
 * input with initial values already persisted (e.g. submissions saved at
 * add-time for new projects), falling back to empty defaults. Every project —
 * including newly-added projects — always has an entry by the time render
 * reads it. Pure — safe to call during render via useMemo.
 */
export function deriveEntries(
  projects: ProjectShape[],
  isVp: boolean,
  userInput: Record<string, HoursEntry>,
  initialEntries: Record<string, { hoursValue: string; hoursUnit: 'per_day' | 'per_week' }> = {},
): Record<string, HoursEntry> {
  const result: Record<string, HoursEntry> = {};
  for (const project of projects) {
    const selfKey = `${project.projectRecordId}:self`;
    result[selfKey] = userInput[selfKey] ?? withInitial(defaultEntry(project.projectRecordId, null), initialEntries[selfKey]);
    if (isVp) {
      for (const assoc of project.associates) {
        const key = `${project.projectRecordId}:${assoc.recordId}`;
        result[key] = userInput[key] ?? withInitial(defaultEntry(project.projectRecordId, assoc.recordId), initialEntries[key]);
      }
    }
  }
  return result;
}

function withInitial(base: HoursEntry, initial?: { hoursValue: string; hoursUnit: 'per_day' | 'per_week' }): HoursEntry {
  if (!initial) return base;
  return { ...base, hoursValue: initial.hoursValue, hoursUnit: initial.hoursUnit };
}
