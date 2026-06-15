import { getTemplateMap } from 'ie-agent-rules';

// Project type labels are governed (utilization-mis.template.type-labels).
const TYPE_LABELS = getTemplateMap('utilization-mis.template.type-labels');

export async function postToSlack(text: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    console.error(`Slack webhook failed: ${res.status}`);
  }
}

export async function postPendingList(
  names: string[],
  dateRange: string
): Promise<void> {
  if (names.length === 0) return;

  const bullets = names.map(n => `• ${n}`).join('\n');
  await postToSlack(
    `The following people have not submitted their bandwidth update for ${dateRange}:\n${bullets}`
  );
}

export async function postRemark(
  fellowName: string,
  remark: string
): Promise<void> {
  await postToSlack(`${fellowName} flagged: ${remark}`);
}

export interface FlagSlackEntry {
  projectName: string;
  projectType: 'mandate' | 'dde' | 'pitch';
  fellowName: string;
  fellowDesignation: string;
  reportedHoursPerDay: number;
  proposedHoursPerDay: number | null;
  directorComment: string | null;
  resolverName: string;
}

export async function postDirectorFlagToSlack(params: {
  directorName: string;
  cycleDateRange: string;
  flags: FlagSlackEntry[];
}): Promise<void> {
  const { directorName, cycleDateRange, flags } = params;
  if (flags.length === 0) return;

  const lines = flags.map(f => {
    const typeLabel = TYPE_LABELS[f.projectType];
    const proposed = f.proposedHoursPerDay !== null
      ? `${f.proposedHoursPerDay.toFixed(2)} hrs/day`
      : 'no proposed value';
    let block =
      `• *${f.projectName}* (${typeLabel}) — ${f.fellowName} (${f.fellowDesignation})\n` +
      `    Reported: ${f.reportedHoursPerDay.toFixed(2)} hrs/day\n` +
      `    Proposed: ${proposed}`;
    if (f.directorComment) block += `\n    Comment: "${f.directorComment}"`;
    block += `\n    Resolution email sent to: ${f.resolverName}`;
    return block;
  }).join('\n\n');

  const text =
    `:triangular_flag_on_post: *Director sign-off flag* — ${directorName} — Cycle ${cycleDateRange}\n\n` +
    `${directorName} flagged ${flags.length} bandwidth claim${flags.length !== 1 ? 's' : ''}:\n\n` +
    `${lines}\n\n` +
    `_Sign-off: ${directorName} — flagged (resolution pending)_`;

  await postToSlack(text);
}

export async function postNewProject(
  projectName: string,
  projectType: 'mandate' | 'dde' | 'pitch',
  directorName: string,
  teammateNames: string[],
  submitterName: string,
  cycleStartDate: string,
  submitterHoursPerWeek: number,
  submitterUtilizationPct: number,
  teammateBandwidth: Array<{ name: string; hoursPerWeek: number }>
): Promise<void> {
  const typeLabel = TYPE_LABELS[projectType];
  const teammateList = teammateNames.length > 0 ? teammateNames.join(', ') : '—';
  const pctInt = Math.round(submitterUtilizationPct * 100);

  let text = `:new: *New ${typeLabel}*\n` +
    `*Name:* ${projectName}\n` +
    `*Director:* ${directorName}\n` +
    `*Team:* ${teammateList}\n` +
    `*Added by:* ${submitterName}\n` +
    `*Cycle:* Week of ${cycleStartDate}\n` +
    `Bandwidth given by ${submitterName}: ${submitterHoursPerWeek.toFixed(1)} hrs/week (${pctInt}% of capacity)`;

  for (const tb of teammateBandwidth) {
    text += `\nBandwidth noted for ${tb.name}: ${tb.hoursPerWeek.toFixed(1)} hrs/week`;
  }

  await postToSlack(text);
}
