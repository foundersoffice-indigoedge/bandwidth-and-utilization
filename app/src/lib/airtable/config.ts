import type { ProjectType } from '@/types';

export const FELLOWS_TABLE_ID = 'tbl2EquvDVwvSaGVy';

export const TABLE_CONFIG: Record<ProjectType, {
  tableId: string;
  nameField: string;
  stageField: string;
  vpAvpFields: string[];
  associateFields: string[];
  bandwidthField: string;
}> = {
  mandate: {
    tableId: 'tblETYHFy9FnXG9TH',
    nameField: 'Mandate Name',
    stageField: 'Current Stage of Mandate',
    vpAvpFields: ['Mandate VP / AVP 1', 'Mandate VP / AVP 2'],
    associateFields: ['Mandate Associate 1', 'Mandate Associate 2'],
    bandwidthField: 'Mandate Bandwidth Situation',
  },
  dde: {
    tableId: 'tblxyEcXA5piBJKyP',
    nameField: 'DDE Name',
    stageField: 'Current Stage of DDE',
    vpAvpFields: ['DDE VP / AVP'],
    associateFields: ['DDE Associate'],
    bandwidthField: 'DDE Bandwidth Situation',
  },
  pitch: {
    tableId: 'tblOMIyzJZYUMrJ2N',
    nameField: 'Name',
    stageField: 'Pitch Status',
    vpAvpFields: ['Pitch VP / AVP', 'Pitch VP / AVP 2'],
    associateFields: ['Pitch Associate 1', 'Pitch Associate 2'],
    bandwidthField: 'Pitch Bandwidth Situation',
  },
};
