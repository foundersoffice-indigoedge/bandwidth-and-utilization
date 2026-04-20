export type Tier = 'VP' | 'AVP' | 'Associate' | 'Analyst';

export const TIER_ORDER: Tier[] = ['VP', 'AVP', 'Associate', 'Analyst'];

export function getTier(designation: string): Tier {
  if (designation === 'VP') return 'VP';
  if (designation === 'AVP') return 'AVP';
  if (designation.startsWith('Associate')) return 'Associate';
  if (designation === 'Analyst') return 'Analyst';
  return 'Analyst';
}
