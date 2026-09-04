import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pendingProjects } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { isAuthorizedIntegrationRequest } from '@/lib/integration-auth';
import {
  PendingProjectReconciliationHold,
  reconcileCompletedPendingProject,
} from '@/lib/pending-project-reconciliation';

export const dynamic = 'force-dynamic';

type Resolution = 'completed' | 'rejected';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAuthorizedIntegrationRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { resolution?: Resolution } | null;
  if (!body?.resolution || (body.resolution !== 'completed' && body.resolution !== 'rejected')) {
    return NextResponse.json(
      { error: 'resolution must be "completed" or "rejected"' },
      { status: 400 }
    );
  }

  const [row] = await db.select().from(pendingProjects).where(eq(pendingProjects.id, id)).limit(1);
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (row.status === 'finished') {
    if (row.resolution === body.resolution) {
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

  if (row.status !== 'awaiting_setup') {
    return NextResponse.json(
      { error: `Cannot finish from status=${row.status}` },
      { status: 409 }
    );
  }

  if (body.resolution === 'rejected') {
    await db
      .update(pendingProjects)
      .set({ status: 'finished', resolution: body.resolution, resolvedAt: new Date() })
      .where(eq(pendingProjects.id, id));
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
