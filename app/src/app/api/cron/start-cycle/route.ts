import { NextRequest, NextResponse } from 'next/server';
import { isCycleMonday, startCycle, finalizeStaleCycles } from '@/lib/cycle';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = new Date();
  const force = req.nextUrl.searchParams.get('force') === 'true';

  if (!force && !isCycleMonday(today)) {
    return NextResponse.json({ message: 'Not a cycle Monday, skipping' });
  }

  const finalizedIds = await finalizeStaleCycles();

  const fellowsParam = req.nextUrl.searchParams.get('fellows');
  const testFellowIds = fellowsParam ? fellowsParam.split(',') : undefined;

  const cycleId = await startCycle(testFellowIds);
  return NextResponse.json({
    message: 'Cycle started',
    cycleId,
    finalizedStale: finalizedIds,
    testMode: !!testFellowIds,
  });
}
