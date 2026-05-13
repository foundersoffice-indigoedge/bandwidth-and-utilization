import { NextResponse } from 'next/server';
import { confirmSignoff } from '@/lib/signoff';
import { checkAndFinalizeCycle } from '@/lib/cycle';
import { db } from '@/lib/db';
import { directorSignoffs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function POST(req: Request) {
  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.token || typeof body.token !== 'string') {
    return NextResponse.json({ error: 'token required' }, { status: 400 });
  }

  // Fetch the signoff to get cycleId for finalization check
  const [signoff] = await db
    .select({ cycleId: directorSignoffs.cycleId })
    .from(directorSignoffs)
    .where(eq(directorSignoffs.signoffToken, body.token))
    .limit(1);

  const { confirmed } = await confirmSignoff(body.token);
  if (!confirmed) {
    return NextResponse.json({ error: 'Signoff not found or already responded' }, { status: 409 });
  }

  // Trigger cycle finalization check
  if (signoff) {
    await checkAndFinalizeCycle(signoff.cycleId);
  }

  return NextResponse.json({ ok: true });
}
