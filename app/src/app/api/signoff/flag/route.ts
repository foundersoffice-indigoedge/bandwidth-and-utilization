import { NextResponse } from 'next/server';
import { submitFlags } from '@/lib/signoff';
import { checkAndFinalizeCycle } from '@/lib/cycle';
import { db } from '@/lib/db';
import { directorSignoffs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

interface FlagBody {
  token?: string;
  flags?: Array<{
    submissionId?: string;
    proposedHoursPerDay?: number;
    comment?: string;
  }>;
}

export async function POST(req: Request) {
  let body: FlagBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.token || typeof body.token !== 'string') {
    return NextResponse.json({ error: 'token required' }, { status: 400 });
  }
  if (!Array.isArray(body.flags) || body.flags.length === 0) {
    return NextResponse.json({ error: 'flags must be a non-empty array' }, { status: 400 });
  }
  for (const f of body.flags) {
    if (!f.submissionId || typeof f.submissionId !== 'string') {
      return NextResponse.json({ error: 'each flag needs submissionId' }, { status: 400 });
    }
  }

  // Fetch cycleId for finalization check
  const [signoff] = await db
    .select({ cycleId: directorSignoffs.cycleId })
    .from(directorSignoffs)
    .where(eq(directorSignoffs.signoffToken, body.token))
    .limit(1);

  try {
    const result = await submitFlags({
      signoffToken: body.token,
      flags: body.flags.map(f => ({
        submissionId: f.submissionId as string,
        proposedHoursPerDay: f.proposedHoursPerDay,
        comment: f.comment,
      })),
    });

    // Note: cycle can't finalize yet — there are pending director_flag conflicts.
    // But run the check anyway in case other directors' state allows finalization
    // of unrelated cycles (defensive).
    if (signoff) {
      await checkAndFinalizeCycle(signoff.cycleId);
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
