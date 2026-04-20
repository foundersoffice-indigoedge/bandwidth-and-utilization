async function postToSlack(text: string): Promise<void> {
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

export async function postNewAdHocProject(
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
  const typeLabel = projectType === 'mandate' ? 'Mandate' : projectType === 'dde' ? 'DDE' : 'Pitch';
  const teammateList = teammateNames.length > 0 ? teammateNames.join(', ') : '—';
  const pctInt = Math.round(submitterUtilizationPct * 100);

  let text = `:new: New ad-hoc project added to bandwidth tracker\n` +
    `*Name:* ${projectName}\n` +
    `*Type:* ${typeLabel}\n` +
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
