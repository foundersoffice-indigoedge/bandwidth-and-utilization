import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { pendingProjects } from '@/lib/db/schema';
import { isAuthorizedIntegrationRequest } from '@/lib/integration-auth';
import {
  PendingProjectReconciliationHold,
  reconcileCompletedPendingProject,
} from '@/lib/pending-project-reconciliation';

export const dynamic = 'force-dynamic';

/** Reconcile retained pending_ references for an already-linked intake. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isAuthorizedIntegrationRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const [row] = await db.select().from(pendingProjects).where(eq(pendingProjects.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

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
