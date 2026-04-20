import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tokens, submissions, adHocProjects, conflicts, cycles } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { normalizeToHoursPerDay, normalizeToHoursPerWeek, scoreHours } from '@/lib/scoring';
import { isConflict } from '@/lib/conflicts';
import { sendConflictEmail } from '@/lib/email';
import { postNewAdHocProject } from '@/lib/slack';
import { fetchEligibleFellows, isVpOrAvp } from '@/lib/airtable/fellows';

type ProjectType = 'mandate' | 'dde' | 'pitch';

interface AddProjectPayload {
  token: string;
  existingAdHocId?: string;
  type: ProjectType;
  name: string;
  directorRecordId: string;
  directorName: string;
  teammateRecordIds: string[];
  selfBandwidth: { value: number; unit: 'per_day' | 'per_week' };
  teammateBandwidth?: Array<{ recordId: string; value: number; unit: 'per_day' | 'per_week' }>;
}

export async function POST(req: NextRequest) {
  const payload = (await req.json()) as AddProjectPayload;

  const [tokenRecord] = await db
    .select()
    .from(tokens)
    .where(eq(tokens.token, payload.token))
    .limit(1);
  if (!tokenRecord || tokenRecord.status !== 'pending') {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 400 });
  }

  if (!payload.name?.trim() || !payload.type || !payload.directorRecordId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  let adHocId: string;
  if (payload.existingAdHocId) {
    adHocId = payload.existingAdHocId;
  } else {
    const [created] = await db
      .insert(adHocProjects)
      .values({
        cycleId: tokenRecord.cycleId,
        type: payload.type,
        name: payload.name.trim(),
        directorRecordId: payload.directorRecordId,
        directorName: payload.directorName,
        teammateRecordIds: payload.teammateRecordIds,
        createdByFellowId: tokenRecord.fellowRecordId,
        createdByFellowName: tokenRecord.fellowName,
      })
      .returning();
    adHocId = created.id;
  }

  const projectRecordId = `adhoc_${adHocId}`;

  const selfHpd = normalizeToHoursPerDay(payload.selfBandwidth.value, payload.selfBandwidth.unit);
  const selfHpw = normalizeToHoursPerWeek(payload.selfBandwidth.value, payload.selfBandwidth.unit);
  const { score: selfScore, meu: selfMeu } = scoreHours(selfHpd, payload.type);

  const [selfSub] = await db
    .insert(submissions)
    .values({
      cycleId: tokenRecord.cycleId,
      fellowRecordId: tokenRecord.fellowRecordId,
      projectRecordId,
      projectName: payload.name.trim(),
      projectType: payload.type,
      hoursValue: payload.selfBandwidth.value,
      hoursUnit: payload.selfBandwidth.unit,
      hoursPerDay: selfHpd,
      hoursPerWeek: selfHpw,
      autoScore: selfScore,
      autoMeu: selfMeu,
      isSelfReport: true,
    })
    .returning();

  const isVp = isVpOrAvp(tokenRecord.fellowDesignation);
  const fellows = await fetchEligibleFellows();
  const fellowMap = new Map(fellows.map(f => [f.recordId, f]));

  const teammateBandwidthForSlack: Array<{ name: string; hoursPerWeek: number }> = [];
  if (isVp && payload.teammateBandwidth && payload.teammateBandwidth.length > 0) {
    for (const tb of payload.teammateBandwidth) {
      const tbHpd = normalizeToHoursPerDay(tb.value, tb.unit);
      const tbHpw = normalizeToHoursPerWeek(tb.value, tb.unit);
      const { score: tbScore, meu: tbMeu } = scoreHours(tbHpd, payload.type);

      const [projSub] = await db
        .insert(submissions)
        .values({
          cycleId: tokenRecord.cycleId,
          fellowRecordId: tokenRecord.fellowRecordId,
          projectRecordId,
          projectName: payload.name.trim(),
          projectType: payload.type,
          hoursValue: tb.value,
          hoursUnit: tb.unit,
          hoursPerDay: tbHpd,
          hoursPerWeek: tbHpw,
          autoScore: tbScore,
          autoMeu: tbMeu,
          isSelfReport: false,
          targetFellowId: tb.recordId,
        })
        .returning();

      const teammate = fellowMap.get(tb.recordId);
      if (teammate) {
        teammateBandwidthForSlack.push({ name: teammate.name, hoursPerWeek: tbHpw });

        const [existingSelf] = await db
          .select()
          .from(submissions)
          .where(
            and(
              eq(submissions.cycleId, tokenRecord.cycleId),
              eq(submissions.projectRecordId, projectRecordId),
              eq(submissions.fellowRecordId, tb.recordId),
              eq(submissions.isSelfReport, true),
            ),
          )
          .limit(1);

        if (existingSelf && isConflict(tbHpd, existingSelf.hoursPerDay)) {
          const resToken = crypto.randomUUID();
          const [conflictRow] = await db
            .insert(conflicts)
            .values({
              cycleId: tokenRecord.cycleId,
              projectRecordId,
              vpSubmissionId: projSub.id,
              associateSubmissionId: existingSelf.id,
              vpHoursPerDay: tbHpd,
              associateHoursPerDay: existingSelf.hoursPerDay,
              difference: Math.abs(tbHpd - existingSelf.hoursPerDay),
              resolutionToken: resToken,
              isAdHoc: true,
            })
            .returning();

          const emailId = await sendConflictEmail(
            tokenRecord.fellowName, tokenRecord.fellowEmail,
            teammate.name, teammate.email,
            payload.name.trim(), tbHpd, existingSelf.hoursPerDay, resToken,
          );
          if (emailId) {
            await db.update(conflicts).set({ emailMessageId: emailId }).where(eq(conflicts.id, conflictRow.id));
          }
        }
      }
    }
  }

  if (!isVp && payload.existingAdHocId) {
    const vpProjections = await db
      .select()
      .from(submissions)
      .where(
        and(
          eq(submissions.cycleId, tokenRecord.cycleId),
          eq(submissions.projectRecordId, projectRecordId),
          eq(submissions.targetFellowId, tokenRecord.fellowRecordId),
          eq(submissions.isSelfReport, false),
        ),
      );
    for (const vpSub of vpProjections) {
      if (isConflict(vpSub.hoursPerDay, selfHpd)) {
        const vpFellow = fellowMap.get(vpSub.fellowRecordId);
        if (!vpFellow) continue;
        const resToken = crypto.randomUUID();
        const [conflictRow] = await db
          .insert(conflicts)
          .values({
            cycleId: tokenRecord.cycleId,
            projectRecordId,
            vpSubmissionId: vpSub.id,
            associateSubmissionId: selfSub.id,
            vpHoursPerDay: vpSub.hoursPerDay,
            associateHoursPerDay: selfHpd,
            difference: Math.abs(vpSub.hoursPerDay - selfHpd),
            resolutionToken: resToken,
            isAdHoc: true,
          })
          .returning();

        const emailId = await sendConflictEmail(
          vpFellow.name, vpFellow.email,
          tokenRecord.fellowName, tokenRecord.fellowEmail,
          payload.name.trim(), vpSub.hoursPerDay, selfHpd, resToken,
        );
        if (emailId) {
          await db.update(conflicts).set({ emailMessageId: emailId }).where(eq(conflicts.id, conflictRow.id));
        }
      }
    }
  }

  if (!payload.existingAdHocId) {
    const teammateNames = payload.teammateRecordIds
      .map(id => fellowMap.get(id)?.name)
      .filter((n): n is string => !!n);
    const [cycleRow] = await db.select().from(cycles).where(eq(cycles.id, tokenRecord.cycleId)).limit(1);

    await postNewAdHocProject(
      payload.name.trim(),
      payload.type,
      payload.directorName,
      teammateNames,
      tokenRecord.fellowName,
      cycleRow?.startDate ?? '',
      selfHpw,
      selfHpw / 84,
      teammateBandwidthForSlack,
    );
  }

  return NextResponse.json({ ok: true, adHocId });
}
