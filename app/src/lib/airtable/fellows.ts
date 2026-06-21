import { fetchAllRecords } from './client';
import { FELLOWS_TABLE_ID } from './config';
import { getStringList, getString, getStringMap } from 'ie-agent-rules';
import type { AirtableRecord } from './client';
import type { Fellow } from '@/types';

// Designations, the fellows field names, and the eligibility filter are all
// governed rules (utilization-mis.vocab.*, .field-map.fellows-fields,
// .policy.fellow-eligibility) instead of hardcoded literals.
const FELLOW_FIELDS = getStringMap('utilization-mis.field-map.fellows-fields');
const ELIGIBILITY = getStringMap('utilization-mis.policy.fellow-eligibility');

// The shared "current employee on the IB team" clause, used by both queries.
function eligibilityClause(): string {
  return `{${ELIGIBILITY.employmentField}} = '${ELIGIBILITY.employedValue}', {${ELIGIBILITY.teamField}} = '${ELIGIBILITY.teamValue}'`;
}

function toFellow(r: AirtableRecord): Fellow {
  return {
    recordId: r.id,
    name: r.fields[FELLOW_FIELDS.name] as string,
    email: r.fields[FELLOW_FIELDS.email] as string,
    designation: r.fields[FELLOW_FIELDS.designation] as string,
  };
}

export async function fetchEligibleFellows(): Promise<Fellow[]> {
  const records = await fetchAllRecords(FELLOWS_TABLE_ID, {
    filterByFormula: `AND(${eligibilityClause()})`,
  });

  const eligible = getStringList('utilization-mis.vocab.eligible-designations');
  return records
    .filter(r => eligible.includes(r.fields[FELLOW_FIELDS.designation] as string))
    .map(toFellow);
}

export function isVpOrAvp(designation: string): boolean {
  return getStringList('utilization-mis.vocab.vp-avp').includes(designation);
}

export async function fetchDirectors(): Promise<Fellow[]> {
  const marker = getString('utilization-mis.vocab.director-marker');
  const records = await fetchAllRecords(FELLOWS_TABLE_ID, {
    filterByFormula: `AND(${eligibilityClause()}, FIND('${marker}', {${FELLOW_FIELDS.designation}}) > 0)`,
  });

  return records.map(toFellow);
}
