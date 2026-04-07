import { NextRequest, NextResponse } from 'next/server';
import { isCycleMonday, startCycle, getActiveCycle } from '@/lib/cycle';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = new Date();

  if (!isCycleMonday(today)) {
    return NextResponse.json({ message: 'Not a cycle Monday, skipping' });
  }

  const active = await getActiveCycle();
  if (active) {
    return NextResponse.json({ message: 'Cycle already active, skipping' });
  }

  const cycleId = await startCycle();
  return NextResponse.json({ message: 'Cycle started', cycleId });
}
