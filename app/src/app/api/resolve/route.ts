import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { conflicts, submissions, directorSignoffs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { scoreHours, WORKING_DAYS_PER_WEEK } from '@/lib/scoring';
import { sendConflictResolutionEmail, sendDirectorFlagResolutionConfirmationEmail } from '@/lib/email';
import { checkAndFinalizeCycle } from '@/lib/cycle';
import { fetchEligibleFellows } from '@/lib/airtable/fellows';
import { transitionToFlaggedResolved } from '@/lib/signoff';
import { dedupeRecipients } from '@/lib/director-flag';
import type { ConflictResolution, ProjectType } from '@/types';

export async function POST(req: NextRequest) {
  const { resolutionToken, action, customHours } = (await req.json()) as {
    resolutionToken: string;
    action: ConflictResolution | 'keep_original' | 'use_proposed';
    customHours?: number;
  };

  const [conflict] = await db
    .select()
    .from(conflicts)
    .where(eq(conflicts.resolutionToken, resolutionToken))
    .limit(1);

  if (!conflict || conflict.status === 'resolved') {
    return NextResponse.json({ error: 'Invalid or already resolved' }, { status: 400 });
  }

  // ---------------------------------------------------------------------------
  // Branch: director_flag — one-sided writeback
  // ---------------------------------------------------------------------------
  if (conflict.source === 'director_flag') {
    if (!conflict.flaggedSubmissionId) {
      return NextResponse.json({ error: 'malformed director_flag conflict' }, { status: 500 });
    }

    let finalHoursPerDay: number;

    if (action === 'keep_original') {
      // Read submission fresh — do NOT trust the snapshotted flaggedOriginalHoursPerDay
      const [currentSub] = await db
        .select()
        .from(submissions)
        .where(eq(submissions.id, conflict.flaggedSubmissionId))
        .limit(1);
      if (!currentSub) {
        return NextResponse.json({ error: 'submission missing' }, { status: 500 });
      }
      finalHoursPerDay = currentSub.hoursPerDay;
      // No UPDATE to submission — endorsing current value
    } else if (action === 'use_proposed') {
      if (conflict.proposedHoursPerDay === null || conflict.proposedHoursPerDay === undefined) {
        return NextResponse.json({ error: 'no proposed value on this conflict' }, { status: 400 });
      }
      finalHoursPerDay = conflict.proposedHoursPerDay;
    } else if (action === 'custom') {
      if (typeof customHours !== 'number' || isNaN(customHours)) {
        return NextResponse.json({ error: 'customHours required for custom action' }, { status: 400 });
      }
      finalHoursPerDay = customHours;
    } else {
      return NextResponse.json({ error: 'invalid action for director_flag conflict' }, { status: 400 });
    }

    const hoursPerWeek = finalHoursPerDay * WORKING_DAYS_PER_WEEK;

    // Update the flagged submission (only for use_proposed / custom)
    if (action !== 'keep_original') {
      const [sub] = await db
        .select()
        .from(submissions)
        .where(eq(submissions.id, conflict.flaggedSubmissionId))
        .limit(1);
      if (sub) {
        const { score } = scoreHours(finalHoursPerDay, sub.projectType as ProjectType);
        await db
          .update(submissions)
          .set({ hoursPerDay: finalHoursPerDay, hoursPerWeek, autoScore: score })
          .where(eq(submissions.id, conflict.flaggedSubmissionId));
      }
    }

    // Resolve the conflict row
    await db
      .update(conflicts)
      .set({
        status: 'resolved' as const,
        resolvedHoursPerDay: finalHoursPerDay,
        resolvedBy: action,
      })
      .where(eq(conflicts.id, conflict.id));

    // Send threaded confirmation email
    try {
      const fellows = await fetchEligibleFellows();
      const fellowMap = new Map(fellows.map(f => [f.recordId, f]));

      // Fetch the flagged submission for project name + fellow info
      const [flaggedSub] = await db
        .select()
        .from(submissions)
        .where(eq(submissions.id, conflict.flaggedSubmissionId))
        .limit(1);

      const flaggedFellow = flaggedSub ? fellowMap.get(flaggedSub.fellowRecordId) : null;
      const projectName = flaggedSub?.projectName ?? 'Unknown project';
      const fellowName = flaggedFellow?.name ?? 'Unknown fellow';

      // Build CC list: resolver's email is TO. CC = directorEmail + Pai (CC_EMAIL) + Ajder (ADMIN_EMAIL) + flaggedFellow.email (if different from resolver)
      const resolverEmail = conflict.resolverEmail ?? process.env.ADMIN_EMAIL!;

      // Look up director email via signoffId
      let directorEmail: string | null = null;
      if (conflict.signoffId) {
        const [signoffRow] = await db
          .select({ directorEmail: directorSignoffs.directorEmail })
          .from(directorSignoffs)
          .where(eq(directorSignoffs.id, conflict.signoffId))
          .limit(1);
        directorEmail = signoffRow?.directorEmail ?? null;
      }

      const ccRaw: string[] = [
        directorEmail,
        process.env.CC_EMAIL,
        process.env.ADMIN_EMAIL,
        flaggedFellow?.email ?? null,
      ].filter((v): v is string => typeof v === 'string' && v.length > 0);

      const { cc: dedupedCc } = dedupeRecipients({ to: resolverEmail, cc: ccRaw });

      await sendDirectorFlagResolutionConfirmationEmail({
        resolverEmail,
        ccEmails: dedupedCc,
        fellowName,
        projectName,
        finalHoursPerDay,
        action,
        originalMessageId: conflict.emailMessageId ?? null,
      });
    } catch {
      // Don't block resolution if email fails
    }

    // Transition signoff to flagged_resolved if all children are resolved
    if (conflict.signoffId) {
      await transitionToFlaggedResolved(conflict.signoffId);
    }

    // Check if cycle is now complete
    await checkAndFinalizeCycle(conflict.cycleId);

    return NextResponse.json({ ok: true });
  }

  // ---------------------------------------------------------------------------
  // Existing path: submission-source conflict — two-sided writeback
  // ---------------------------------------------------------------------------

  let resolvedHours: number;
  if (action === 'associate_number') {
    resolvedHours = conflict.associateHoursPerDay!;
  } else if (action === 'vp_number') {
    resolvedHours = conflict.vpHoursPerDay!;
  } else {
    resolvedHours = customHours!;
  }

  // Update conflict record
  await db
    .update(conflicts)
    .set({
      status: 'resolved' as const,
      resolvedHoursPerDay: resolvedHours,
      resolvedBy: action,
    })
    .where(eq(conflicts.id, conflict.id));

  // Update the VP's projection submission with the resolved hours and re-score
  const vpSubmissionId = conflict.vpSubmissionId!;
  const associateSubmissionId = conflict.associateSubmissionId!;
  const [vpSub] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.id, vpSubmissionId))
    .limit(1);

  const resolvedHoursPerWeek = resolvedHours * WORKING_DAYS_PER_WEEK;

  if (vpSub) {
    const { score } = scoreHours(resolvedHours, vpSub.projectType as ProjectType);
    await db
      .update(submissions)
      .set({ hoursPerDay: resolvedHours, hoursPerWeek: resolvedHoursPerWeek, autoScore: score })
      .where(eq(submissions.id, vpSubmissionId));
  }

  // Also update the associate's self-report with resolved hours
  const [assocSub] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.id, associateSubmissionId))
    .limit(1);

  if (assocSub) {
    const { score } = scoreHours(resolvedHours, assocSub.projectType as ProjectType);
    await db
      .update(submissions)
      .set({ hoursPerDay: resolvedHours, hoursPerWeek: resolvedHoursPerWeek, autoScore: score })
      .where(eq(submissions.id, associateSubmissionId));
  }

  // Send resolution confirmation email (threads with original conflict email)
  try {
    const fellows = await fetchEligibleFellows();
    const fellowMap = new Map(fellows.map(f => [f.recordId, f]));
    const vpFellow = vpSub ? fellowMap.get(vpSub.fellowRecordId) : null;
    const assocFellow = assocSub ? fellowMap.get(assocSub.fellowRecordId) : null;

    if (vpFellow && assocFellow && vpSub) {
      await sendConflictResolutionEmail(
        vpFellow.name,
        vpFellow.email,
        assocFellow.name,
        assocFellow.email,
        vpSub.projectName,
        resolvedHours,
        action as ConflictResolution,
        conflict.emailMessageId,
      );
    }
  } catch {
    // Don't block resolution if the email fails
  }

  // Check if cycle is now complete
  await checkAndFinalizeCycle(conflict.cycleId);

  return NextResponse.json({ ok: true });
}
