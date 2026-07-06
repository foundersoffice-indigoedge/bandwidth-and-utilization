import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { submissions } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { isAuthorizedIntegrationRequest } from '@/lib/integration-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ submissionId: string }> }) {
  if (!isAuthorizedIntegrationRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { submissionId } = await params;
  const [target] = await db
    .select({
      cycleId: submissions.cycleId,
      fellowRecordId: submissions.fellowRecordId,
      remarks: submissions.remarks,
    })
    .from(submissions)
    .where(eq(submissions.id, submissionId))
    .limit(1);

  if (!target) return NextResponse.json({ ok: true });

  await db
    .update(submissions)
    .set({ remarksProcessedAt: new Date() })
    .where(and(
      eq(submissions.cycleId, target.cycleId),
      eq(submissions.fellowRecordId, target.fellowRecordId),
      eq(submissions.remarks, target.remarks as string),
    ));

  return NextResponse.json({ ok: true });
}
