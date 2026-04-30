import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pendingProjects } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
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

  const [row] = await db.select().from(pendingProjects).where(eq(pendingProjects.id, id)).limit(1);
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Idempotent: already confirming is fine
  if (row.status === 'confirming') {
    return NextResponse.json({ ok: true });
  }

  // Only allowed from pending
  if (row.status !== 'pending') {
    return NextResponse.json(
      { error: `Cannot transition to confirming from status '${row.status}'` },
      { status: 409 }
    );
  }

  await db
    .update(pendingProjects)
    .set({ status: 'confirming' })
    .where(eq(pendingProjects.id, id));

  return NextResponse.json({ ok: true });
}
