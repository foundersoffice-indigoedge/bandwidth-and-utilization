// Workflow templates & display labels, re-inlined from the rules store.
// These are presentation config, not governed business rules.

export function renderTemplate(
  template: string,
  vars: Record<string, string | number> = {},
): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{{${k}}}`).join(String(v));
  }
  const leftover = out.match(/\{\{[a-zA-Z0-9_]+\}\}/);
  if (leftover) {
    throw new Error(`renderTemplate: unresolved placeholder ${leftover[0]}`);
  }
  return out;
}

export const TYPE_LABELS: Record<string, string> = {
  mandate: 'Mandate',
  dde: 'DDE',
  pitch: 'Pitch',
};

export const TYPE_LABELS_PLURAL: Record<string, string> = {
  mandate: 'Mandates',
  dde: 'DDEs',
  pitch: 'Pitches',
};

export const EMAIL_SUBJECTS: Record<string, string> = {
  collection: 'Bandwidth Update — {{dateRange}}',
  reminder: 'Reminder: Bandwidth Update Pending',
  conflict: 'Bandwidth Conflict — {{projectName}}',
  'conflict-resolution': 'Re: Bandwidth Conflict — {{projectName}}',
  'conflict-reminder': 'Reminder: Bandwidth Conflict — {{projectName}}',
  signoff: 'Bandwidth Sign-off — {{dateRange}} — {{projectCount}} {{projectNoun}}',
  'signoff-reminder': 'Re: Bandwidth Sign-off — {{dateRange}}',
  flag: 'Bandwidth Sign-off Flag — {{projectName}} — {{fellowName}}',
  'flag-confirmation': 'Re: Bandwidth Sign-off Flag — {{projectName}} — {{fellowName}}',
  completion: 'Bandwidth Cycle {{dateRange}} — Complete',
};

export const RESOLVER_LABELS: Record<string, string> = {
  associate_number: "{{associateName}}'s number",
  vp_number: "{{vpName}}'s number",
  custom: 'a custom number',
};

export const FLAG_ACTION_LABELS: Record<string, string> = {
  keep_original: 'kept the original value',
  use_proposed: "used the director's proposed value",
  custom: 'set a custom value',
};

export const IY_MONTHS: string[] = [
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
];
