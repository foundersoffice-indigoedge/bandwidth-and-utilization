import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pendingProjects } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { isAuthorizedIntegrationRequest } from '@/lib/integration-auth';

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAuthorizedIntegrationRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  // Atomic claim: only succeeds if row was 'pending'. Two concurrent callers
  // can't both win — the second's UPDATE matches zero rows. This is what
  // makes the endpoint safe for ie-checkin's cron to use as a worker lock.
  const claimed = await db
    .update(pendingProjects)
    .set({ status: 'confirming' })
    .where(and(eq(pendingProjects.id, id), eq(pendingProjects.status, 'pending')))
    .returning({ id: pendingProjects.id });

  if (claimed.length === 1) {
    return NextResponse.json({ ok: true });
  }

  // UPDATE matched 0 rows. Inspect to give a meaningful error.
  const [row] = await db.select().from(pendingProjects).where(eq(pendingProjects.id, id)).limit(1);
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (row.status === 'confirming') {
    return NextResponse.json(
      { error: 'Already claimed by another worker' },
      { status: 409 }
    );
  }
  return NextResponse.json(
    { error: `Cannot transition to confirming from status '${row.status}'` },
    { status: 409 }
  );
}
