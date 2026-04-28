import { fetchAllRecords } from './client';
import { FELLOWS_TABLE_ID } from './config';
import type { Fellow } from '@/types';

const ELIGIBLE_DESIGNATIONS = ['VP', 'AVP', 'Associate 3', 'Associate 2', 'Associate 1'];

export async function fetchEligibleFellows(): Promise<Fellow[]> {
  const records = await fetchAllRecords(FELLOWS_TABLE_ID, {
    filterByFormula: "AND({Current Employee} = 'Yes', {Team} = 'Investment Banking')",
  });

  return records
    .filter(r => ELIGIBLE_DESIGNATIONS.includes(r.fields['Designation of Fellow'] as string))
    .map(r => ({
      recordId: r.id,
      name: r.fields['Name of Fellow'] as string,
      email: r.fields['Email ID of Fellow'] as string,
      designation: r.fields['Designation of Fellow'] as string,
    }));
}

export function isVpOrAvp(designation: string): boolean {
  return designation === 'VP' || designation === 'AVP';
}

export async function fetchDirectors(): Promise<Array<{ recordId: string; name: string }>> {
  const records = await fetchAllRecords(FELLOWS_TABLE_ID, {
    filterByFormula: "AND({Current Employee} = 'Yes', {Team} = 'Investment Banking', FIND('Director', {Designation of Fellow}) > 0)",
  });

  return records.map(r => ({
    recordId: r.id,
    name: r.fields['Name of Fellow'] as string,
  }));
}
