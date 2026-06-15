import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { cycles, conflicts, submissions, conflictRemindersSent, directorSignoffs } from '@/lib/db/schema';
import { eq, and, desc, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { sendConflictReminderEmail, sendDirectorSignoffReminderEmail } from '@/lib/email';
import { fetchEligibleFellows } from '@/lib/airtable/fellows';
import { getString, getNumber } from 'ie-agent-rules';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// Weekly anchor (shared with schedule.ts) and the sign-off nudge interval are
// governed cadence rules. The IST same-day logic stays in code.
const REMINDERS_START_DATE = getString('utilization-mis.cadence.weekly-anchor');
const SIGNOFF_NUDGE_HOURS = getNumber('utilization-mis.cadence.signoff-nudge-hours');

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

    if (conflict.source === 'director_flag') {
      // director_flag conflicts: resolver is stored on the row directly (no VP-lookup needed)
      if (!conflict.resolverEmail) continue;

      const resolverFellow = conflict.resolverFellowId ? fellowMap.get(conflict.resolverFellowId) : undefined;
      const resolverName = resolverFellow?.name ?? conflict.resolverEmail;

      // Fetch the flagged submission for project name
      let projectName = conflict.projectRecordId;
      if (conflict.flaggedSubmissionId) {
        const [flaggedSub] = await db
          .select()
          .from(submissions)
          .where(eq(submissions.id, conflict.flaggedSubmissionId))
          .limit(1);
        if (flaggedSub) projectName = flaggedSub.projectName;
      }

      try {
        const msgId = await sendConflictReminderEmail(
          resolverName,
          conflict.resolverEmail,
          '',
          conflict.resolverEmail,
          projectName,
          conflict.proposedHoursPerDay ?? 0,
          conflict.flaggedOriginalHoursPerDay ?? 0,
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
        console.error(`Failed to send director_flag reminder for conflict ${conflict.id}:`, err);
      }
    } else {
      // submission-source conflicts: look up VP and associate fellows
      if (!conflict.vpSubmissionId || !conflict.associateSubmissionId) continue;
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
          conflict.vpHoursPerDay!,
          conflict.associateHoursPerDay!,
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
  }

  // Signoff reminders — daily nudge for open signoffs (status='email_sent', no reminder yet or >24h ago)
  const twentyFourHoursAgo = new Date(Date.now() - SIGNOFF_NUDGE_HOURS * 60 * 60 * 1000);
  const openSignoffs = await db
    .select()
    .from(directorSignoffs)
    .where(
      and(
        eq(directorSignoffs.status, 'email_sent'),
        or(
          isNull(directorSignoffs.lastReminderSentAt),
          lt(directorSignoffs.lastReminderSentAt, twentyFourHoursAgo),
        ),
      ),
    );

  let signoffsSent = 0;
  for (const s of openSignoffs) {
    try {
      const [cycle] = await db.select().from(cycles).where(eq(cycles.id, s.cycleId)).limit(1);
      if (!cycle) continue;
      await sendDirectorSignoffReminderEmail({
        directorName: s.directorName,
        directorEmail: s.directorEmail,
        cycleStartDate: cycle.startDate,
        signoffToken: s.signoffToken,
        originalMessageId: s.emailMessageId,
      });
      await db
        .update(directorSignoffs)
        .set({ lastReminderSentAt: new Date(), updatedAt: new Date() })
        .where(eq(directorSignoffs.id, s.id));
      signoffsSent++;
      await sleep(500);
    } catch (err) {
      console.error(`Signoff reminder failed for ${s.id}:`, err);
    }
  }

  return NextResponse.json({
    message: `Sent ${sent} conflict reminder(s), ${signoffsSent} signoff reminder(s)`,
    totalConflicts: pendingConflicts.length,
    totalSignoffs: openSignoffs.length,
  });
}
