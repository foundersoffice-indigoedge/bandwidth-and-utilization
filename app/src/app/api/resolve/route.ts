import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { conflicts, submissions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { scoreHours, WORKING_DAYS_PER_WEEK } from '@/lib/scoring';
import { sendConflictResolutionEmail } from '@/lib/email';
import { checkAndFinalizeCycle } from '@/lib/cycle';
import { fetchEligibleFellows } from '@/lib/airtable/fellows';
import type { ConflictResolution, ProjectType } from '@/types';

export async function POST(req: NextRequest) {
  const { resolutionToken, action, customHours } = (await req.json()) as {
    resolutionToken: string;
    action: ConflictResolution;
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

  let resolvedHours: number;
  if (action === 'associate_number') {
    resolvedHours = conflict.associateHoursPerDay;
  } else if (action === 'vp_number') {
    resolvedHours = conflict.vpHoursPerDay;
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
  const [vpSub] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.id, conflict.vpSubmissionId))
    .limit(1);

  const resolvedHoursPerWeek = resolvedHours * WORKING_DAYS_PER_WEEK;

  if (vpSub) {
    const { score, meu } = scoreHours(resolvedHours, vpSub.projectType as ProjectType);
    await db
      .update(submissions)
      .set({ hoursPerDay: resolvedHours, hoursPerWeek: resolvedHoursPerWeek, autoScore: score, autoMeu: meu })
      .where(eq(submissions.id, conflict.vpSubmissionId));
  }

  // Also update the associate's self-report with resolved hours
  const [assocSub] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.id, conflict.associateSubmissionId))
    .limit(1);

  if (assocSub) {
    const { score, meu } = scoreHours(resolvedHours, assocSub.projectType as ProjectType);
    await db
      .update(submissions)
      .set({ hoursPerDay: resolvedHours, hoursPerWeek: resolvedHoursPerWeek, autoScore: score, autoMeu: meu })
      .where(eq(submissions.id, conflict.associateSubmissionId));
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
        action,
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
