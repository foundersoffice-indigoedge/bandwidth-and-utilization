import type { ProjectType } from '@/types';

export const FELLOWS_TABLE_ID = 'tbl2EquvDVwvSaGVy';

export const TABLE_CONFIG: Record<ProjectType, {
  tableId: string;
  nameField: string;
  stageField: string;
  vpAvpFields: string[];
  associateFields: string[];
  bandwidthField: string;
  isVpRunField?: string;
  activeStages: string[];
  label: string;
}> = {
  mandate: {
    tableId: 'tblETYHFy9FnXG9TH',
    nameField: 'Mandate Name',
    stageField: 'Current Stage of Mandate',
    vpAvpFields: ['Mandate VP / AVP 1', 'Mandate VP / AVP 2'],
    associateFields: ['Mandate Associate 1', 'Mandate Associate 2'],
    bandwidthField: 'Mandate Bandwidth Situation',
    isVpRunField: 'Is this a VP run mandate?',
    activeStages: [
      'Not Started',
      'In Production',
      'In GTM',
      'In Docs',
      'Closing',
      'Term Sheet Signed',
      'DD Started',
    ],
    label: 'Mandates',
  },
  dde: {
    tableId: 'tblxyEcXA5piBJKyP',
    nameField: 'DDE Name',
    stageField: 'Current Stage of DDE',
    vpAvpFields: ['DDE VP / AVP'],
    associateFields: ['DDE Associate'],
    bandwidthField: 'DDE Bandwidth Situation',
    activeStages: [
      'Not Started',
      'DDE In Progress',
    ],
    label: 'DDEs',
  },
  pitch: {
    tableId: 'tblOMIyzJZYUMrJ2N',
    nameField: 'Name',
    stageField: 'Pitch Status',
    vpAvpFields: ['Pitch VP / AVP', 'Pitch VP / AVP 2'],
    associateFields: ['Pitch Associate 1', 'Pitch Associate 2'],
    bandwidthField: 'Pitch Bandwidth Situation',
    activeStages: [
      'Pitch Work in Progress',
      'Pitch Done - Awaiting Outcome',
    ],
    label: 'Pitches',
  },
};
