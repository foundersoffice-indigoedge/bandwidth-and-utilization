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
