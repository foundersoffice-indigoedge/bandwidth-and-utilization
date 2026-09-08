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
  const body = (await req.json().catch(() => null)) as {
    airtableRecordId?: string;
    airtableProjectName?: string;
    processingClaimId?: string;
  } | null;
  if (!body?.airtableRecordId) {
    return NextResponse.json({ error: 'airtableRecordId is required' }, { status: 400 });
  }

  const [row] = await db.select().from(pendingProjects).where(eq(pendingProjects.id, id)).limit(1);
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (row.status === 'awaiting_setup') {
    if (row.airtableRecordId === body.airtableRecordId) {
      if (body.airtableProjectName && row.airtableProjectName && row.airtableProjectName !== body.airtableProjectName) {
        return NextResponse.json(
          { error: 'Already awaiting_setup with a different airtableProjectName' },
          { status: 409 },
        );
      }
      if (body.airtableProjectName && !row.airtableProjectName) {
        await db
          .update(pendingProjects)
          .set({ airtableProjectName: body.airtableProjectName })
          .where(eq(pendingProjects.id, id));
      }
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
  if (row.processingClaimId && body.processingClaimId !== row.processingClaimId) {
    return NextResponse.json({ error: 'This processing claim no longer owns the row' }, { status: 409 });
  }

  const transitioned = await db
    .update(pendingProjects)
    .set({
      status: 'awaiting_setup',
      airtableRecordId: body.airtableRecordId,
      airtableProjectName: body.airtableProjectName ?? row.name,
      processingStep: 'airtable_project_recorded',
      processingProgress: [
        ...(row.processingProgress ?? []),
        { step: 'airtable_project_recorded', completedAt: new Date().toISOString(), detail: body.airtableRecordId },
      ],
      processingError: null,
      processingUpdatedAt: new Date(),
    })
    .where(and(
      eq(pendingProjects.id, id),
      eq(pendingProjects.status, 'confirming'),
      ...(row.processingClaimId ? [eq(pendingProjects.processingClaimId, row.processingClaimId)] : []),
    ))
    .returning({ id: pendingProjects.id });

  if (transitioned.length !== 1) {
    return NextResponse.json({ error: 'The row changed while its Airtable project was being recorded' }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
