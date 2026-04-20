import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { cycles, conflicts, submissions, conflictRemindersSent } from '@/lib/db/schema';
import { eq, and, desc, isNotNull } from 'drizzle-orm';
import { sendConflictReminderEmail } from '@/lib/email';
import { fetchEligibleFellows } from '@/lib/airtable/fellows';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const REMINDERS_START_DATE = '2026-04-27';

function isSameIstDay(a: Date | null, b: Date): boolean {
  if (!a) return false;
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const ad = new Date(a.getTime() + istOffsetMs).toISOString().split('T')[0];
  const bd = new Date(b.getTime() + istOffsetMs).toISOString().split('T')[0];
  return ad === bd;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [latestCycle] = await db
    .select()
    .from(cycles)
    .orderBy(desc(cycles.createdAt))
    .limit(1);

  if (!latestCycle) {
    return NextResponse.json({ message: 'No cycles' });
  }

  if (latestCycle.startDate < REMINDERS_START_DATE) {
    return NextResponse.json({ message: 'Latest cycle predates reminder start date' });
  }

  if (latestCycle.status === 'complete') {
    return NextResponse.json({ message: 'Latest cycle complete; no reminders' });
  }

  const pendingConflicts = await db
    .select()
    .from(conflicts)
    .where(
      and(
        eq(conflicts.cycleId, latestCycle.id),
        eq(conflicts.status, 'pending'),
        isNotNull(conflicts.emailMessageId),
      ),
    );

  const now = new Date();
  const fellows = await fetchEligibleFellows();
  const fellowMap = new Map(fellows.map(f => [f.recordId, f]));

  let sent = 0;
  for (const conflict of pendingConflicts) {
    if (isSameIstDay(conflict.lastReminderSentAt, now)) continue;

    const [vpSub] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, conflict.vpSubmissionId))
      .limit(1);
    const [assocSub] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, conflict.associateSubmissionId))
      .limit(1);
    if (!vpSub || !assocSub) continue;

    const vpFellow = fellowMap.get(vpSub.fellowRecordId);
    const assocFellow = fellowMap.get(assocSub.fellowRecordId);
    if (!vpFellow || !assocFellow) continue;

    try {
      const msgId = await sendConflictReminderEmail(
        vpFellow.name,
        vpFellow.email,
        assocFellow.name,
        assocFellow.email,
        vpSub.projectName,
        conflict.vpHoursPerDay,
        conflict.associateHoursPerDay,
        conflict.resolutionToken!,
        conflict.emailMessageId!,
      );

      await db.insert(conflictRemindersSent).values({
        conflictId: conflict.id,
        resendMessageId: msgId ?? null,
      });
      await db
        .update(conflicts)
        .set({ lastReminderSentAt: now })
        .where(eq(conflicts.id, conflict.id));

      sent++;
      await sleep(500);
    } catch (err) {
      console.error(`Failed to send reminder for conflict ${conflict.id}:`, err);
    }
  }

  return NextResponse.json({ message: `Sent ${sent} conflict reminder(s)`, total: pendingConflicts.length });
}
