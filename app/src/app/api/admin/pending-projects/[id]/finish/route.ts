import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pendingProjects } from '@/lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { isAuthorizedIntegrationRequest } from '@/lib/integration-auth';
import {
  PendingProjectReconciliationHold,
  reconcileCompletedPendingProject,
} from '@/lib/pending-project-reconciliation';

export const dynamic = 'force-dynamic';

type Resolution = 'completed' | 'rejected';
type ExpectedStatus = 'confirming';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAuthorizedIntegrationRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as {
    resolution?: Resolution;
    expectedStatus?: ExpectedStatus;
  } | null;
  if (!body?.resolution || (body.resolution !== 'completed' && body.resolution !== 'rejected')) {
    return NextResponse.json(
      { error: 'resolution must be "completed" or "rejected"' },
      { status: 400 }
    );
  }
  if (body.expectedStatus !== undefined && body.expectedStatus !== 'confirming') {
    return NextResponse.json(
      { error: 'expectedStatus must be "confirming" when provided' },
      { status: 400 }
    );
  }
  if (body.expectedStatus && body.resolution !== 'rejected') {
    return NextResponse.json(
      { error: 'expectedStatus is supported only for rejected finishes' },
      { status: 400 }
    );
  }

  const [row] = await db.select().from(pendingProjects).where(eq(pendingProjects.id, id)).limit(1);
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (row.status === 'finished') {
    if (row.resolution === body.resolution) {
      if (body.expectedStatus && row.airtableRecordId) {
        return NextResponse.json(
          { error: 'Finished project has an Airtable record and cannot be withdrawn' },
          { status: 409 }
        );
      }
      return NextResponse.json({
        ok: true,
        reconciliation: { promotedSubmissions: 0, collapsedDuplicates: 0, updatedConflicts: 0, repairedSnapshots: 0 },
      });
    }
    return NextResponse.json(
      { error: `Already finished with resolution=${row.resolution}` },
      { status: 409 }
    );
  }

  if (body.expectedStatus && (row.status !== body.expectedStatus || row.airtableRecordId)) {
    return NextResponse.json(
      { error: `Pending project no longer matches expected status=${body.expectedStatus}` },
      { status: 409 }
    );
  }

  const canRejectConfirming = row.status === 'confirming' && body.resolution === 'rejected';
  if (row.status !== 'awaiting_setup' && !canRejectConfirming) {
    return NextResponse.json(
      { error: `Cannot finish from status=${row.status}` },
      { status: 409 }
    );
  }

  if (body.resolution === 'rejected') {
    const statusGuard = body.expectedStatus
      ? and(eq(pendingProjects.status, body.expectedStatus), isNull(pendingProjects.airtableRecordId))
      : eq(pendingProjects.status, row.status);
    const [updated] = await db
      .update(pendingProjects)
      .set({ status: 'finished', resolution: body.resolution, resolvedAt: new Date() })
      .where(and(eq(pendingProjects.id, id), statusGuard))
      .returning({ id: pendingProjects.id });
    if (!updated) {
      return NextResponse.json(
        { error: 'Pending project changed while it was being finished' },
        { status: 409 }
      );
    }
    return NextResponse.json({
      ok: true,
      reconciliation: { promotedSubmissions: 0, collapsedDuplicates: 0, updatedConflicts: 0, repairedSnapshots: 0 },
    });
  }

  try {
    const reconciliation = await reconcileCompletedPendingProject(row);
    return NextResponse.json({ ok: true, reconciliation });
  } catch (error) {
    if (error instanceof PendingProjectReconciliationHold) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
