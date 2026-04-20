import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tokens } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getActiveCycle } from '@/lib/cycle';
import { sendReminderEmail } from '@/lib/email';
import { postPendingList } from '@/lib/slack';
import { getCycleEndDate } from '@/lib/schedule';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

  if (dayOfWeek === 0 || dayOfWeek === 6 || dayOfWeek === 1) {
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
      { recordId: t.fellowRecordId, name: t.fellowName, email: t.fellowEmail, designation: t.fellowDesignation, capacityMeu: 0 },
      t.token,
      cycle.startDate
    );
    await sleep(500);
  }

  if (dayOfWeek >= 3) {
    const startDate = new Date(cycle.startDate);
    const endDate = getCycleEndDate(startDate);
    const dateRange = `${startDate.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })} – ${endDate.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}`;

    await postPendingList(
      pendingTokens.map(t => t.fellowName),
      dateRange
    );
  }

  return NextResponse.json({
    message: `Reminders sent to ${pendingTokens.length} fellows`,
    slackPosted: dayOfWeek >= 3,
  });
}
