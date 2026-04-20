import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { adHocProjects } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

interface LinkPayload {
  adHocId: string;
  airtableRecordId: string;
}

export async function POST(req: NextRequest) {
  const { adHocId, airtableRecordId } = (await req.json()) as LinkPayload;

  if (!adHocId || !airtableRecordId) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 });
  }

  await db
    .update(adHocProjects)
    .set({
      status: 'linked' as const,
      linkedAirtableRecordId: airtableRecordId,
      linkedAt: new Date(),
    })
    .where(eq(adHocProjects.id, adHocId));

  return NextResponse.json({ ok: true });
}
