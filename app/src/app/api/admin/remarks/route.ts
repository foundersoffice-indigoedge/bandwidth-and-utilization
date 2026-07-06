import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { submissions, cycles, tokens } from '@/lib/db/schema';
import { and, eq, isNull, isNotNull, ne, or, lt, gte, inArray } from 'drizzle-orm';
import { isAuthorizedIntegrationRequest } from '@/lib/integration-auth';

export const dynamic = 'force-dynamic';
const CLAIM_TTL_MS = 15 * 60 * 1000;

type RemarkRow = {
  submissionId: string;
  siblingSubmissionIds: string[];
  remarksText: string;
  fellowRecordId: string;
  fellowName: string | null;
  cycleId: string;
  cycleStartDate: string;
  submitterProjects: { name: string; type: 'mandate' | 'dde' | 'pitch'; recordId: string }[];
};

export async function GET(req: Request) {
  if (!isAuthorizedIntegrationRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cutover = process.env.REMARKS_CUTOVER;
  if (!cutover) return NextResponse.json({ rows: [] });

  const rows = await db.transaction(async (tx) => {
    const staleBefore = new Date(Date.now() - CLAIM_TTL_MS);

    // Lock candidate rows so concurrent GETs take disjoint sets.
    const candidates = await tx
      .select({
        id: submissions.id,
        cycleId: submissions.cycleId,
        fellowRecordId: submissions.fellowRecordId,
        remarks: submissions.remarks,
        projectName: submissions.projectName,
        projectType: submissions.projectType,
        projectRecordId: submissions.projectRecordId,
        cycleStartDate: cycles.startDate,
      })
      .from(submissions)
      .innerJoin(cycles, eq(submissions.cycleId, cycles.id))
      .where(and(
        eq(submissions.isSelfReport, true),
        isNotNull(submissions.remarks),
        ne(submissions.remarks, ''),
        isNull(submissions.remarksProcessedAt),
        gte(cycles.startDate, cutover),
        or(isNull(submissions.remarksClaimedAt), lt(submissions.remarksClaimedAt, staleBefore)),
      ))
      .for('update', { skipLocked: true });

    if (candidates.length === 0) return [];

    await tx
      .update(submissions)
      .set({ remarksClaimedAt: new Date() })
      .where(inArray(submissions.id, candidates.map((c) => c.id)));

    // Group by (cycleId, fellowRecordId, remarks).
    const groups = new Map<string, typeof candidates>();
    for (const c of candidates) {
      const key = `${c.cycleId}::${c.fellowRecordId}::${c.remarks}`;
      const arr = groups.get(key) ?? [];
      arr.push(c);
      groups.set(key, arr);
    }

    const result: RemarkRow[] = [];
    for (const g of groups.values()) {
      const rep = g[0];
      const [tok] = await tx
        .select({ name: tokens.fellowName })
        .from(tokens)
        .where(and(eq(tokens.cycleId, rep.cycleId), eq(tokens.fellowRecordId, rep.fellowRecordId)))
        .limit(1);

      const projRows = await tx
        .select({
          name: submissions.projectName,
          type: submissions.projectType,
          recordId: submissions.projectRecordId,
        })
        .from(submissions)
        .where(and(eq(submissions.cycleId, rep.cycleId), eq(submissions.fellowRecordId, rep.fellowRecordId)));

      result.push({
        submissionId: rep.id,
        siblingSubmissionIds: g.map((r) => r.id).filter((id) => id !== rep.id),
        remarksText: rep.remarks as string,
        fellowRecordId: rep.fellowRecordId,
        fellowName: tok?.name ?? null,
        cycleId: rep.cycleId,
        cycleStartDate: String(rep.cycleStartDate),
        submitterProjects: projRows.map((p) => ({
          name: p.name,
          type: p.type as 'mandate' | 'dde' | 'pitch',
          recordId: p.recordId,
        })),
      });
    }

    return result;
  });

  return NextResponse.json({ rows });
}
