import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { cycles, conflicts, submissions, conflictRemindersSent, directorSignoffs } from '@/lib/db/schema';
import { eq, and, desc, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { sendConflictReminderEmail, sendDirectorSignoffReminderEmail } from '@/lib/email';
import { checkAndFinalizeCycle, reconcileCycleConflictsWithLiveAirtable } from '@/lib/cycle';
import { isConflictReminderEligible } from '@/lib/conflict-reminder';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const REMINDERS_START_DATE = '2026-04-27';
const SIGNOFF_NUDGE_HOURS = 24;

async function claimConflictReminder(
  conflict: typeof conflicts.$inferSelect,
  claimedAt: Date,
): Promise<boolean> {
  const priorReminder = conflict.lastReminderSentAt;
  const claimed = await db
    .update(conflicts)
    .set({ lastReminderSentAt: claimedAt })
    .where(and(
      eq(conflicts.id, conflict.id),
      eq(conflicts.status, 'pending'),
      priorReminder ? eq(conflicts.lastReminderSentAt, priorReminder) : isNull(conflicts.lastReminderSentAt),
    ))
    .returning({ id: conflicts.id });
  return claimed.length === 1;
}

async function releaseConflictReminderClaim(
  conflict: typeof conflicts.$inferSelect,
  claimedAt: Date,
): Promise<void> {
  await db
    .update(conflicts)
    .set({ lastReminderSentAt: conflict.lastReminderSentAt })
    .where(and(
      eq(conflicts.id, conflict.id),
      eq(conflicts.status, 'pending'),
      eq(conflicts.lastReminderSentAt, claimedAt),
    ));
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [latestCycle] = await db
    .select()
    .from(cycles)
    .where(eq(cycles.status, 'collecting'))
    .orderBy(desc(cycles.createdAt))
    .limit(1);

  if (!latestCycle) {
    return NextResponse.json({ message: 'No active cycle' });
  }
  if (latestCycle.startDate < REMINDERS_START_DATE) {
    return NextResponse.json({ message: `Cycle ${latestCycle.startDate} predates reminder rollout` });
  }

  // Airtable context is fetched before any closure, reminder claim, or outbound email.
  let reconciliation: Awaited<ReturnType<typeof reconcileCycleConflictsWithLiveAirtable>>;
  try {
    reconciliation = await reconcileCycleConflictsWithLiveAirtable(latestCycle.id);
    if (reconciliation.resolvedConflictIds.length > 0) {
      await checkAndFinalizeCycle(latestCycle.id, reconciliation);
    }
  } catch (err) {
    console.error('Conflict reminder lifecycle preflight failed', err);
    return NextResponse.json({
      error: 'Airtable lifecycle preflight failed; no reminders or sign-off emails were sent',
      autoResolved: 0,
      ambiguousConflicts: 0,
    }, { status: 503 });
  }

  const pendingConflicts = await db
    .select()
    .from(conflicts)
    .where(and(
      eq(conflicts.cycleId, latestCycle.id),
      eq(conflicts.status, 'pending'),
      isNotNull(conflicts.emailMessageId),
    ));

  const now = new Date();
  const fellowMap = new Map(reconciliation.fellows.map(fellow => [fellow.recordId, fellow]));
  let sent = 0;
  let auditFailures = 0;

  for (const conflict of pendingConflicts) {
    if (!isConflictReminderEligible({
      now,
      emailSentAt: conflict.emailSentAt,
      lastReminderSentAt: conflict.lastReminderSentAt,
    })) continue;

    if (conflict.source === 'director_flag') {
      // Director flags retain their own lifecycle and are never auto-closed here.
      if (!conflict.resolverEmail || !conflict.resolutionToken || !conflict.emailMessageId) continue;

      const resolverFellow = conflict.resolverFellowId ? fellowMap.get(conflict.resolverFellowId) : undefined;
      const resolverName = resolverFellow?.name ?? conflict.resolverEmail;
      let projectName = conflict.projectRecordId;
      if (conflict.flaggedSubmissionId) {
        const [flaggedSubmission] = await db
          .select()
          .from(submissions)
          .where(eq(submissions.id, conflict.flaggedSubmissionId))
          .limit(1);
        if (flaggedSubmission) projectName = flaggedSubmission.projectName;
      }

      if (!await claimConflictReminder(conflict, now)) continue;
      let delivered = false;
      try {
        const messageId = await sendConflictReminderEmail(
          resolverName,
          conflict.resolverEmail,
          '',
          conflict.resolverEmail,
          projectName,
          conflict.proposedHoursPerDay ?? 0,
          conflict.flaggedOriginalHoursPerDay ?? 0,
          conflict.resolutionToken,
          conflict.emailMessageId,
        );
        delivered = true;
        try {
          await db.insert(conflictRemindersSent).values({
            conflictId: conflict.id,
            resendMessageId: messageId ?? null,
          });
        } catch (err) {
          auditFailures++;
          console.error(`Reminder audit insert failed after delivery for conflict ${conflict.id}:`, err);
        }
        sent++;
        await sleep(500);
      } catch (err) {
        if (!delivered) await releaseConflictReminderClaim(conflict, now);
        console.error(`Failed to send director_flag reminder for conflict ${conflict.id}:`, err);
      }
      continue;
    }

    // Submission-source conflicts must have passed the shared lifecycle check.
    if (!reconciliation.activeConflictIds.includes(conflict.id)) continue;
    if (!conflict.vpSubmissionId || !conflict.associateSubmissionId || !conflict.resolutionToken || !conflict.emailMessageId) continue;

    const [vpSubmission] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, conflict.vpSubmissionId))
      .limit(1);
    const [associateSubmission] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, conflict.associateSubmissionId))
      .limit(1);
    if (!vpSubmission || !associateSubmission) continue;

    const vpFellow = fellowMap.get(vpSubmission.fellowRecordId);
    const associateFellow = fellowMap.get(associateSubmission.fellowRecordId);
    if (!vpFellow || !associateFellow) continue;
    if (!await claimConflictReminder(conflict, now)) continue;

    let delivered = false;
    try {
      const messageId = await sendConflictReminderEmail(
        vpFellow.name,
        vpFellow.email,
        associateFellow.name,
        associateFellow.email,
        vpSubmission.projectName,
        conflict.vpHoursPerDay ?? 0,
        conflict.associateHoursPerDay ?? 0,
        conflict.resolutionToken,
        conflict.emailMessageId,
      );
      delivered = true;
      try {
        await db.insert(conflictRemindersSent).values({
          conflictId: conflict.id,
          resendMessageId: messageId ?? null,
        });
      } catch (err) {
        auditFailures++;
        console.error(`Reminder audit insert failed after delivery for conflict ${conflict.id}:`, err);
      }
      sent++;
      await sleep(500);
    } catch (err) {
      if (!delivered) await releaseConflictReminderClaim(conflict, now);
      console.error(`Failed to send reminder for conflict ${conflict.id}:`, err);
    }
  }

  // Existing Director sign-off cadence remains unchanged. It only runs after a
  // successful Airtable lifecycle preflight.
  const twentyFourHoursAgo = new Date(now.getTime() - SIGNOFF_NUDGE_HOURS * 60 * 60 * 1000);
  const openSignoffs = await db
    .select()
    .from(directorSignoffs)
    .where(and(
      eq(directorSignoffs.status, 'email_sent'),
      or(
        isNull(directorSignoffs.lastReminderSentAt),
        lt(directorSignoffs.lastReminderSentAt, twentyFourHoursAgo),
      ),
    ));

  let signoffsSent = 0;
  for (const signoff of openSignoffs) {
    try {
      const [signoffCycle] = await db
        .select()
        .from(cycles)
        .where(eq(cycles.id, signoff.cycleId))
        .limit(1);
      if (!signoffCycle) continue;
      await sendDirectorSignoffReminderEmail({
        directorName: signoff.directorName,
        directorEmail: signoff.directorEmail,
        cycleStartDate: signoffCycle.startDate,
        signoffToken: signoff.signoffToken,
        originalMessageId: signoff.emailMessageId,
      });
      await db
        .update(directorSignoffs)
        .set({ lastReminderSentAt: new Date(), updatedAt: new Date() })
        .where(eq(directorSignoffs.id, signoff.id));
      signoffsSent++;
      await sleep(500);
    } catch (err) {
      console.error(`Failed to send signoff reminder for ${signoff.directorName}:`, err);
    }
  }

  return NextResponse.json({
    message: `Sent ${sent} conflict reminder(s), ${signoffsSent} signoff reminder(s)`,
    totalConflicts: pendingConflicts.length,
    totalSignoffs: openSignoffs.length,
    autoResolved: reconciliation.resolvedConflictIds.length,
    ambiguousConflicts: reconciliation.ambiguousConflictIds.length,
    reminderAuditFailures: auditFailures,
  });
}
