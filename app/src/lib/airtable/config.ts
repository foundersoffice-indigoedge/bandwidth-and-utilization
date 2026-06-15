import { stagesWithBehavior, teamRoleFields, getVpRunFlag } from 'ie-agent-rules';
import type { ProjectType } from '@/types';

// Team-role field names and the VP-run flag are derived from the shared rules
// (shared.fields.team-roles, shared.flags.vp-run) so Utilization MIS and
// ie-checkin read the same fields from one source. Util MIS queries by name.

export const FELLOWS_TABLE_ID = 'tbl2EquvDVwvSaGVy';

export const TABLE_CONFIG: Record<ProjectType, {
  tableId: string;
  nameField: string;
  stageField: string;
  vpAvpFields: string[];
  associateFields: string[];
  directorFields: string[];
  isVpRunField?: string;
  activeStages: string[];
  label: string;
}> = {
  mandate: {
    tableId: 'tblETYHFy9FnXG9TH',
    nameField: 'Mandate Name',
    stageField: 'Current Stage of Mandate',
    vpAvpFields: teamRoleFields('mandate', 'vpAvp').map((f) => f.name),
    associateFields: teamRoleFields('mandate', 'associate').map((f) => f.name),
    directorFields: teamRoleFields('mandate', 'director').map((f) => f.name),
    isVpRunField: getVpRunFlag().field.name,
    activeStages: stagesWithBehavior('shared.stages.mandate', 'active'),
    label: 'Mandates',
  },
  dde: {
    tableId: 'tblxyEcXA5piBJKyP',
    nameField: 'DDE Name',
    stageField: 'Current Stage of DDE',
    vpAvpFields: teamRoleFields('dde', 'vpAvp').map((f) => f.name),
    associateFields: teamRoleFields('dde', 'associate').map((f) => f.name),
    directorFields: teamRoleFields('dde', 'director').map((f) => f.name),
    activeStages: stagesWithBehavior('shared.stages.dde', 'active'),
    label: 'DDEs',
  },
  pitch: {
    tableId: 'tblOMIyzJZYUMrJ2N',
    nameField: 'Name',
    stageField: 'Pitch Status',
    vpAvpFields: teamRoleFields('pitch', 'vpAvp').map((f) => f.name),
    associateFields: teamRoleFields('pitch', 'associate').map((f) => f.name),
    directorFields: teamRoleFields('pitch', 'director').map((f) => f.name),
    activeStages: stagesWithBehavior('shared.stages.pitch', 'active'),
    label: 'Pitches',
  },
};
