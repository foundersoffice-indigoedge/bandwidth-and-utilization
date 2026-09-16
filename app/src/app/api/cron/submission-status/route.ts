import { NextResponse } from 'next/server'
import { buildSubmissionStatus } from '@/lib/submission-status-data'
import { renderSubmissionReport } from '@/lib/submission-status-report'
import { deliverDailyReport } from '@/lib/daily-report-delivery'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const now = new Date()
    if (new URL(request.url).searchParams.get('preview') === 'true') {
      const report = await buildSubmissionStatus(now)
      return NextResponse.json({ report, ...renderSubmissionReport(report) })
    }
    return NextResponse.json(await deliverDailyReport('bandwidth', now, process.env.EMAIL_FROM || 'bandwidth@indigoedge.com', () => buildSubmissionStatus(now)))
  } catch (error) {
    console.error('[submission-status] report failed', error)
    return NextResponse.json({ error: 'Submission status report failed' }, { status: 500 })
  }
}
