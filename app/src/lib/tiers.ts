import { getStringList } from 'ie-ai-rulebook';

export type Tier = 'VP' | 'AVP' | 'Associate' | 'Analyst';

// Tier order is governed (utilization-mis.vocab.tier-order). The getTier mapping
// logic below (the Associate-prefix match) stays in code.
export const TIER_ORDER: Tier[] = getStringList('utilization-mis.vocab.tier-order') as Tier[];

export function getTier(designation: string): Tier {
  if (designation === 'VP') return 'VP';
  if (designation === 'AVP') return 'AVP';
  if (designation.startsWith('Associate')) return 'Associate';
  if (designation === 'Analyst') return 'Analyst';
  return 'Analyst';
}
