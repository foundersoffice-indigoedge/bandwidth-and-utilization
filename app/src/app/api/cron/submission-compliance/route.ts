import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, gte, isNull, lt, or } from 'drizzle-orm';
import { db } from '@/lib/db';
import { cycles, submissionDeadlineChecks, tokens } from '@/lib/db/schema';
import {
  deadlineAt,
  deadlineOutcome,
  evaluateTransition,
  istDate,
} from '@/lib/submission-compliance';
import { currentCycleStartDate } from '@/lib/peer-email-schedule';
import { sendSubmissionComplianceReport, type SubmissionComplianceReportPerson } from '@/lib/email';

const CLAIM_STALE_AFTER_MS = 10 * 60 * 1000;

function checkpointStatus(check: typeof submissionDeadlineChecks.$inferSelect): string {
  if (check.outcome === 'on_time') return 'Submitted on time';
  if (!check.submittedAt) return 'Pending at deadline';
  return `Submitted late at ${check.submittedAt.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true,
  })}`;
}

/**
 * Monday 13:00 IST deadline checkpoint. It writes only forward from
 * SUBMISSION_COMPLIANCE_ENABLED_FROM, and records every required form once so
 * later submissions cannot rewrite whether it met the deadline.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const enabledFrom = process.env.SUBMISSION_COMPLIANCE_ENABLED_FROM;
  if (!enabledFrom) {
    return NextResponse.json({ message: 'Submission compliance disabled (SUBMISSION_COMPLIANCE_ENABLED_FROM unset)' });
  }

  const now = new Date();
  const cycleStartDate = currentCycleStartDate(now);
  const deadline = deadlineAt(cycleStartDate);

  if (istDate(now) !== cycleStartDate) {
    return NextResponse.json({ message: 'Submission compliance runs on Monday only' });
  }
  if (cycleStartDate < enabledFrom) {
    return NextResponse.json({ message: `Cycle ${cycleStartDate} predates SUBMISSION_COMPLIANCE_ENABLED_FROM` });
  }
  if (now.getTime() < deadline.getTime()) {
    return NextResponse.json({ message: 'Submission deadline has not passed yet' });
  }

  // Date targeting avoids stale or test cycles. The production run can only own
  // this IST Monday's real cycle.
  const [cycle] = await db
    .select()
    .from(cycles)
    .where(and(
      eq(cycles.startDate, cycleStartDate),
      eq(cycles.isTest, false),
    ))
    .orderBy(desc(cycles.createdAt))
    .limit(1);

  if (!cycle) {
    return NextResponse.json({ message: `No production cycle for week of ${cycleStartDate}` });
  }

  const cycleTokens = await db
    .select()
    .from(tokens)
    .where(eq(tokens.cycleId, cycle.id));

  let checksRecorded = 0;
  for (const token of cycleTokens) {
    const outcome = deadlineOutcome({
      status: token.status,
      submittedAt: token.submittedAt,
      notNeededAt: token.notNeededAt,
      statusUpdatedAt: token.statusUpdatedAt,
      deadline,
    });
    if (!outcome) continue;

    const inserted = await db
      .insert(submissionDeadlineChecks)
      .values({
        tokenId: token.id,
        cycleId: cycle.id,
        cycleStartDate,
        fellowRecordId: token.fellowRecordId,
        fellowName: token.fellowName,
        fellowDesignation: token.fellowDesignation,
        outcome,
        deadlineAt: deadline,
        submittedAt: token.submittedAt,
      })
      .onConflictDoNothing({ target: submissionDeadlineChecks.tokenId })
      .returning({ id: submissionDeadlineChecks.id });
    checksRecorded += inserted.length;
  }

  const allChecks = await db
    .select()
    .from(submissionDeadlineChecks)
    .where(gte(submissionDeadlineChecks.cycleStartDate, enabledFrom));

  const checksByFellow = new Map<string, typeof allChecks>();
  for (const check of allChecks) {
    const fellowChecks = checksByFellow.get(check.fellowRecordId) || [];
    fellowChecks.push(check);
    checksByFellow.set(check.fellowRecordId, fellowChecks);
  }

  const currentCheckByFellow = new Map(
    allChecks
      .filter(check => check.cycleId === cycle.id)
      .map(check => [check.fellowRecordId, check]),
  );

  const people: SubmissionComplianceReportPerson[] = [];
  for (const [fellowRecordId, fellowChecks] of checksByFellow) {
    const transition = evaluateTransition(
      fellowChecks.map(check => ({ cycleStartDate: check.cycleStartDate, outcome: check.outcome })),
      cycleStartDate,
    );
    const currentCheck = currentCheckByFellow.get(fellowRecordId);
    if (!transition.changed || !currentCheck || transition.classification === 'none') continue;

    people.push({
      name: currentCheck.fellowName,
      designation: currentCheck.fellowDesignation,
      classification: transition.classification,
      totalMisses: transition.totalMisses,
      category1Streaks: transition.category1Streaks,
      category2Episodes: transition.category2Episodes,
      currentCheckpointStatus: checkpointStatus(currentCheck),
    });
  }

  // Stable payload order matters because retries use the same Resend idempotency
  // key and must therefore send byte-for-byte equivalent content.
  people.sort((a, b) => a.name.localeCompare(b.name) || a.designation.localeCompare(b.designation));

  if (people.length === 0) {
    return NextResponse.json({
      message: 'Deadline checks recorded; no new compliance classifications',
      checksRecorded,
    });
  }

  // Atomic claim. The 13:15 IST retry can reclaim a hung 13:00 invocation, while
  // Resend's deterministic idempotency key prevents a duplicate email on retry.
  const staleBefore = new Date(now.getTime() - CLAIM_STALE_AFTER_MS);
  const claimed = await db
    .update(cycles)
    .set({ complianceReportClaimedAt: now })
    .where(and(
      eq(cycles.id, cycle.id),
      isNull(cycles.complianceReportSentAt),
      or(
        isNull(cycles.complianceReportClaimedAt),
        lt(cycles.complianceReportClaimedAt, staleBefore),
      ),
    ))
    .returning({ id: cycles.id });

  if (claimed.length === 0) {
    return NextResponse.json({
      message: 'Compliance report already claimed or sent',
      checksRecorded,
      flaggedPeople: people.length,
    });
  }

  try {
    const messageId = await sendSubmissionComplianceReport({
      cycleId: cycle.id,
      cycleStartDate,
      people,
    });

    await db
      .update(cycles)
      .set({
        complianceReportSentAt: new Date(),
        complianceReportMessageId: messageId ?? null,
      })
      .where(eq(cycles.id, cycle.id));

    return NextResponse.json({
      message: 'Submission compliance report sent',
      checksRecorded,
      flaggedPeople: people.length,
    });
  } catch (error) {
    // Release only an unsent claim. The 13:15 checkpoint can retry after a
    // transient provider failure, and the same idempotency key protects send.
    await db
      .update(cycles)
      .set({ complianceReportClaimedAt: null })
      .where(and(eq(cycles.id, cycle.id), isNull(cycles.complianceReportSentAt)));

    console.error('submission compliance report failed', error);
    return NextResponse.json({ error: 'Submission compliance report failed' }, { status: 500 });
  }
}
