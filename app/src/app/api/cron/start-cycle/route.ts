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

  // One-off pause requested 2026-07-05: skip rollout on these UTC dates.
  // Auto-resumes the following cycle Monday. `force=true` still overrides.
  const SKIP_CYCLE_DATES = ['2026-07-06'];
  const todayUtc = today.toISOString().split('T')[0];
  if (!force && SKIP_CYCLE_DATES.includes(todayUtc)) {
    return NextResponse.json({ message: `Cycle rollout paused for ${todayUtc}, skipping` });
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
