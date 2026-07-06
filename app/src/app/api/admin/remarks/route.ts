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

  const staleBefore = new Date(Date.now() - CLAIM_TTL_MS);
  const claimed = await db
    .update(submissions)
    .set({ remarksClaimedAt: new Date() })
    .where(inArray(
      submissions.id,
      db.select({ id: submissions.id })
        .from(submissions)
        .innerJoin(cycles, eq(submissions.cycleId, cycles.id))
        .where(and(
          eq(submissions.isSelfReport, true),
          isNotNull(submissions.remarks),
          ne(submissions.remarks, ''),
          isNull(submissions.remarksProcessedAt),
          gte(cycles.startDate, cutover),
          or(isNull(submissions.remarksClaimedAt), lt(submissions.remarksClaimedAt, staleBefore)),
        )),
    ))
    .returning({
      id: submissions.id,
      cycleId: submissions.cycleId,
      fellowRecordId: submissions.fellowRecordId,
      remarks: submissions.remarks,
      projectName: submissions.projectName,
      projectType: submissions.projectType,
      projectRecordId: submissions.projectRecordId,
    });

  if (claimed.length === 0) return NextResponse.json({ rows: [] });

  const cycleIds = [...new Set(claimed.map((c) => c.cycleId))];
  const cycleRows = await db
    .select({ id: cycles.id, startDate: cycles.startDate })
    .from(cycles)
    .where(inArray(cycles.id, cycleIds));
  const cycleStartById = new Map(cycleRows.map((c) => [c.id, c.startDate]));

  // Group by (cycleId, fellowRecordId, remarks).
  const groups = new Map<string, typeof claimed>();
  for (const c of claimed) {
    const key = `${c.cycleId}::${c.fellowRecordId}::${c.remarks}`;
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  }

  const rows: RemarkRow[] = [];
  for (const g of groups.values()) {
    const rep = g[0];
    const [tok] = await db
      .select({ name: tokens.fellowName })
      .from(tokens)
      .where(and(eq(tokens.cycleId, rep.cycleId), eq(tokens.fellowRecordId, rep.fellowRecordId)))
      .limit(1);

    const projRows = await db
      .select({
        name: submissions.projectName,
        type: submissions.projectType,
        recordId: submissions.projectRecordId,
      })
      .from(submissions)
      .where(and(eq(submissions.cycleId, rep.cycleId), eq(submissions.fellowRecordId, rep.fellowRecordId)));

    rows.push({
      submissionId: rep.id,
      siblingSubmissionIds: g.map((r) => r.id).filter((id) => id !== rep.id),
      remarksText: rep.remarks as string,
      fellowRecordId: rep.fellowRecordId,
      fellowName: tok?.name ?? null,
      cycleId: rep.cycleId,
      cycleStartDate: String(cycleStartById.get(rep.cycleId)),
      submitterProjects: projRows.map((p) => ({
        name: p.name,
        type: p.type as 'mandate' | 'dde' | 'pitch',
        recordId: p.recordId,
      })),
    });
  }

  return NextResponse.json({ rows });
}
