import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tokens } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { checkAndFinalizeCycle } from '@/lib/cycle';

export async function POST(req: NextRequest) {
  const { tokenId, status } = (await req.json()) as {
    tokenId: string;
    status: 'pending' | 'not_needed';
  };

  const [token] = await db.select().from(tokens).where(eq(tokens.id, tokenId)).limit(1);
  if (!token) {
    return NextResponse.json({ error: 'Token not found' }, { status: 404 });
  }

  await db.update(tokens).set({ status }).where(eq(tokens.id, tokenId));

  if (status === 'not_needed') {
    await checkAndFinalizeCycle(token.cycleId);
  }

  return NextResponse.json({ ok: true });
}
