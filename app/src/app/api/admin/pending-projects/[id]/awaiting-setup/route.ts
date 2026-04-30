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
  const body = (await req.json().catch(() => null)) as { airtableRecordId?: string } | null;
  if (!body?.airtableRecordId) {
    return NextResponse.json({ error: 'airtableRecordId is required' }, { status: 400 });
  }

  const [row] = await db.select().from(pendingProjects).where(eq(pendingProjects.id, id)).limit(1);
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (row.status === 'awaiting_setup') {
    if (row.airtableRecordId === body.airtableRecordId) {
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json(
      { error: 'Already awaiting_setup with a different airtableRecordId' },
      { status: 409 }
    );
  }

  if (row.status === 'finished') {
    return NextResponse.json({ error: 'Already finished' }, { status: 409 });
  }

  await db
    .update(pendingProjects)
    .set({ status: 'awaiting_setup', airtableRecordId: body.airtableRecordId })
    .where(eq(pendingProjects.id, id));

  return NextResponse.json({ ok: true });
}
