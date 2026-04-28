export type ProjectType = 'mandate' | 'dde' | 'pitch';
export type HoursUnit = 'per_day' | 'per_week';
export type LoadTag = 'Free' | 'Comfortable' | 'Busy' | 'At Capacity' | 'Overloaded';
export type TokenStatus = 'pending' | 'submitted' | 'not_needed';
export type CycleStatus = 'collecting' | 'complete';
export type ConflictStatus = 'pending' | 'resolved';
export type ConflictResolution = 'vp_number' | 'associate_number' | 'custom';

export interface Fellow {
  recordId: string;
  name: string;
  email: string;
  designation: string;
}

export interface ProjectAssignment {
  projectRecordId: string;
  projectName: string;
  projectType: ProjectType;
  stage: string;
  vpAvpIds: string[];
  associateIds: string[];
  isVpRun?: boolean;
  leadFellowRecordId?: string;
  leadFellowName?: string;
}

export interface SubmissionEntry {
  projectRecordId: string;
  projectName: string;
  projectType: ProjectType;
  targetFellowId: string | null;
  hoursValue: number;
  hoursUnit: HoursUnit;
}

export interface ProjectBreakdownItem {
  projectName: string;
  projectType: ProjectType;
  score: number;
  hoursPerDay: number;
  hoursPerWeek: number;
  isVpRun?: boolean;
  leadFellowName?: string;
  hasConflict?: boolean;
}
