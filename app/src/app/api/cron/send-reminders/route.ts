import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tokens } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getActiveCycle } from '@/lib/cycle';
import { sendReminderEmail } from '@/lib/email';
import { postPendingList } from '@/lib/slack';
import { getCycleEndDate } from '@/lib/schedule';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Cadence is workflow config (re-inlined from rules store): which weekdays skip reminders.
// The Slack pending-list posts on every reminder run (daily 09:00 IST, Tue–Fri) so
// #team-allocation sees who hasn't filled each morning, not just from Wednesday on.
const REMINDER_SKIP_DAYS = [0, 6, 1];

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cycle = await getActiveCycle();
  if (!cycle) {
    return NextResponse.json({ message: 'No active cycle' });
  }

  const dayOfWeek = new Date().getDay();

  if (REMINDER_SKIP_DAYS.includes(dayOfWeek)) {
    return NextResponse.json({ message: 'No reminders today' });
  }

  const pendingTokens = await db
    .select()
    .from(tokens)
    .where(and(eq(tokens.cycleId, cycle.id), eq(tokens.status, 'pending')));

  if (pendingTokens.length === 0) {
    return NextResponse.json({ message: 'All submitted' });
  }

  for (const t of pendingTokens) {
    await sendReminderEmail(
      { recordId: t.fellowRecordId, name: t.fellowName, email: t.fellowEmail, designation: t.fellowDesignation },
      t.token,
      cycle.startDate
    );
    await sleep(500);
  }

  // Post the pending list to #team-allocation on every reminder run.
  const startDate = new Date(cycle.startDate);
  const endDate = getCycleEndDate(startDate);
  const dateRange = `${startDate.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })} – ${endDate.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  await postPendingList(
    pendingTokens.map(t => t.fellowName),
    dateRange
  );

  return NextResponse.json({
    message: `Reminders sent to ${pendingTokens.length} fellows`,
    slackPosted: true,
  });
}
