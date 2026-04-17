import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tokens, submissions, conflicts } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { normalizeToHoursPerDay, normalizeToHoursPerWeek, scoreHours } from '@/lib/scoring';
import { isConflict } from '@/lib/conflicts';
import { sendConflictEmail } from '@/lib/email';
import { postRemark } from '@/lib/slack';
import { fetchEligibleFellows, isVpOrAvp } from '@/lib/airtable/fellows';
import { fetchAllProjects } from '@/lib/airtable/projects';
import { checkAndFinalizeCycle } from '@/lib/cycle';

interface EntryPayload {
  projectRecordId: string;
  targetFellowId: string | null;
  hoursValue: number;
  hoursUnit: 'per_day' | 'per_week';
}

export async function POST(req: NextRequest) {
  const { token: tokenValue, entries, remarks } = (await req.json()) as {
    token: string;
    entries: EntryPayload[];
    remarks: string;
  };

  // Validate token
  const [tokenRecord] = await db
    .select()
    .from(tokens)
    .where(eq(tokens.token, tokenValue))
    .limit(1);

  if (!tokenRecord || tokenRecord.status !== 'pending') {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 400 });
  }

  // Fetch project data for names/types
  const allProjects = await fetchAllProjects();
  const projectMap = new Map(allProjects.map(p => [p.projectRecordId, p]));

  // Process and save each entry
  const savedSubmissions: Array<typeof submissions.$inferInsert & { id: string }> = [];
  const remarksText = remarks?.trim() || null;

  for (const entry of entries) {
    const project = projectMap.get(entry.projectRecordId);
    if (!project) continue;

    const hoursPerDay = normalizeToHoursPerDay(entry.hoursValue, entry.hoursUnit);
    const hoursPerWeek = normalizeToHoursPerWeek(entry.hoursValue, entry.hoursUnit);
    const { score, meu } = scoreHours(hoursPerDay, project.projectType);
    const isSelfReport = entry.targetFellowId === null;

    const [saved] = await db
      .insert(submissions)
      .values({
        cycleId: tokenRecord.cycleId,
        fellowRecordId: tokenRecord.fellowRecordId,
        projectRecordId: entry.projectRecordId,
        projectName: project.projectName,
        projectType: project.projectType,
        hoursValue: entry.hoursValue,
        hoursUnit: entry.hoursUnit,
        hoursPerDay,
        hoursPerWeek,
        autoScore: score,
        autoMeu: meu,
        isSelfReport,
        targetFellowId: entry.targetFellowId,
        remarks: isSelfReport ? remarksText : null,
      })
      .returning();

    savedSubmissions.push(saved);
  }

  // Cross-reference: check VP projections against associate self-reports
  const isVp = isVpOrAvp(tokenRecord.fellowDesignation);
  const fellows = await fetchEligibleFellows();
  const fellowMap = new Map(fellows.map(f => [f.recordId, f]));

  for (const sub of savedSubmissions) {
    if (isVp && !sub.isSelfReport && sub.targetFellowId) {
      // VP just submitted a projection for an associate.
      // Check if the associate has already self-reported for this project.
      const [assocSub] = await db
        .select()
        .from(submissions)
        .where(
          and(
            eq(submissions.cycleId, tokenRecord.cycleId),
            eq(submissions.projectRecordId, sub.projectRecordId!),
            eq(submissions.fellowRecordId, sub.targetFellowId),
            eq(submissions.isSelfReport, true)
          )
        )
        .limit(1);

      if (assocSub && isConflict(sub.hoursPerDay!, assocSub.hoursPerDay)) {
        const resToken = crypto.randomUUID();
        await db.insert(conflicts).values({
          cycleId: tokenRecord.cycleId,
          projectRecordId: sub.projectRecordId!,
          vpSubmissionId: sub.id,
          associateSubmissionId: assocSub.id,
          vpHoursPerDay: sub.hoursPerDay!,
          associateHoursPerDay: assocSub.hoursPerDay,
          difference: Math.abs(sub.hoursPerDay! - assocSub.hoursPerDay),
          resolutionToken: resToken,
        });

        const assocFellow = fellowMap.get(sub.targetFellowId);
        if (assocFellow) {
          const emailId = await sendConflictEmail(
            tokenRecord.fellowName,
            tokenRecord.fellowEmail,
            assocFellow.name,
            assocFellow.email,
            sub.projectName!,
            sub.hoursPerDay!,
            assocSub.hoursPerDay,
            resToken
          );
          if (emailId) {
            await db.update(conflicts).set({ emailMessageId: emailId }).where(eq(conflicts.resolutionToken, resToken));
          }
        }
      }
    }

    if (!isVp && sub.isSelfReport) {
      // Associate just self-reported. Check if any VP has projected for them on this project.
      const vpProjections = await db
        .select()
        .from(submissions)
        .where(
          and(
            eq(submissions.cycleId, tokenRecord.cycleId),
            eq(submissions.projectRecordId, sub.projectRecordId!),
            eq(submissions.targetFellowId, tokenRecord.fellowRecordId),
            eq(submissions.isSelfReport, false)
          )
        );

      for (const vpSub of vpProjections) {
        if (isConflict(vpSub.hoursPerDay, sub.hoursPerDay!)) {
          const vpFellow = fellowMap.get(vpSub.fellowRecordId);
          if (vpFellow) {
            const resToken = crypto.randomUUID();
            await db.insert(conflicts).values({
              cycleId: tokenRecord.cycleId,
              projectRecordId: sub.projectRecordId!,
              vpSubmissionId: vpSub.id,
              associateSubmissionId: sub.id,
              vpHoursPerDay: vpSub.hoursPerDay,
              associateHoursPerDay: sub.hoursPerDay!,
              difference: Math.abs(vpSub.hoursPerDay - sub.hoursPerDay!),
              resolutionToken: resToken,
            });

            const emailId = await sendConflictEmail(
              vpFellow.name,
              vpFellow.email,
              tokenRecord.fellowName,
              tokenRecord.fellowEmail,
              sub.projectName!,
              vpSub.hoursPerDay,
              sub.hoursPerDay!,
              resToken
            );
            if (emailId) {
              await db.update(conflicts).set({ emailMessageId: emailId }).where(eq(conflicts.resolutionToken, resToken));
            }
          }
        }
      }
    }
  }

  // Burn token
  await db
    .update(tokens)
    .set({ status: 'submitted' as const, submittedAt: new Date() })
    .where(eq(tokens.id, tokenRecord.id));

  // Post remarks to Slack
  if (remarksText) {
    await postRemark(tokenRecord.fellowName, remarksText);
  }

  // Check if cycle is now complete
  await checkAndFinalizeCycle(tokenRecord.cycleId);

  return NextResponse.json({ ok: true });
}
