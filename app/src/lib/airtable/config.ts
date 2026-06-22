import {
  stagesWithBehavior,
  teamRoleFields,
  getVpRunFlag,
  getNameField,
  getStageRule,
} from 'ie-ai-rulebook';
import type { ProjectType } from '@/types';

// Every Airtable field reference here is derived from the rules store, not
// hardcoded: name fields from utilization-mis.field-map.name-fields, stage
// fields + active-stage lists from shared.stages.*, team-role fields from
// shared.fields.team-roles, the VP-run flag from shared.flags.vp-run. So
// Utilization MIS and ie-checkin read the same Airtable contract from one
// source. Util MIS queries by field name.

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
    nameField: getNameField('mandate'),
    stageField: getStageRule('shared.stages.mandate').field.name,
    vpAvpFields: teamRoleFields('mandate', 'vpAvp').map((f) => f.name),
    associateFields: teamRoleFields('mandate', 'associate').map((f) => f.name),
    directorFields: teamRoleFields('mandate', 'director').map((f) => f.name),
    isVpRunField: getVpRunFlag().field.name,
    activeStages: stagesWithBehavior('shared.stages.mandate', 'active'),
    label: 'Mandates',
  },
  dde: {
    tableId: 'tblxyEcXA5piBJKyP',
    nameField: getNameField('dde'),
    stageField: getStageRule('shared.stages.dde').field.name,
    vpAvpFields: teamRoleFields('dde', 'vpAvp').map((f) => f.name),
    associateFields: teamRoleFields('dde', 'associate').map((f) => f.name),
    directorFields: teamRoleFields('dde', 'director').map((f) => f.name),
    activeStages: stagesWithBehavior('shared.stages.dde', 'active'),
    label: 'DDEs',
  },
  pitch: {
    tableId: 'tblOMIyzJZYUMrJ2N',
    nameField: getNameField('pitch'),
    stageField: getStageRule('shared.stages.pitch').field.name,
    vpAvpFields: teamRoleFields('pitch', 'vpAvp').map((f) => f.name),
    associateFields: teamRoleFields('pitch', 'associate').map((f) => f.name),
    directorFields: teamRoleFields('pitch', 'director').map((f) => f.name),
    activeStages: stagesWithBehavior('shared.stages.pitch', 'active'),
    label: 'Pitches',
  },
};
