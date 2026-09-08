import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pendingProjects } from '@/lib/db/schema';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { isAuthorizedIntegrationRequest } from '@/lib/integration-auth';
import { randomUUID } from 'node:crypto';

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAuthorizedIntegrationRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const claimId = randomUUID();

  const leaseCutoff = new Date(Date.now() - 600_000);

  // A new row or an abandoned claim can be acquired atomically. The previous
  // claim ID is replaced only after its 10-minute processing window expires.
  // Two callers still can't win because the first update refreshes the lease.
  const claimed = await db
    .update(pendingProjects)
    .set({
      status: 'confirming',
      processingClaimId: claimId,
      processingClaimedAt: new Date(),
      processingStep: 'matching',
      processingError: null,
      processingUpdatedAt: new Date(),
    })
    .where(and(
      eq(pendingProjects.id, id),
      or(
        eq(pendingProjects.status, 'pending'),
        and(
          eq(pendingProjects.status, 'confirming'),
          or(
            isNull(pendingProjects.processingClaimedAt),
            lt(pendingProjects.processingClaimedAt, leaseCutoff),
          ),
        ),
      ),
    ))
    .returning({ id: pendingProjects.id });

  if (claimed.length === 1) {
    return NextResponse.json({ ok: true, claimId, leaseSeconds: 600 });
  }

  // UPDATE matched 0 rows. Inspect to give a meaningful error.
  const [row] = await db.select().from(pendingProjects).where(eq(pendingProjects.id, id)).limit(1);
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (row.status === 'confirming') {
    const leaseExpired = !row.processingClaimedAt || Date.now() - row.processingClaimedAt.getTime() > 600_000;
    return NextResponse.json(
      { error: 'Already claimed by another worker', leaseExpired, claimId: row.processingClaimId },
      { status: 409 }
    );
  }
  return NextResponse.json(
    { error: `Cannot transition to confirming from status '${row.status}'` },
    { status: 409 }
  );
}
