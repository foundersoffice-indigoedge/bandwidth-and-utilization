import { neon } from '@neondatabase/serverless'
import { Resend } from 'resend'
import { istDate, renderSubmissionReport, type SubmissionReport } from './submission-status-report'

type Payload = { from: string; to: string; subject: string; html: string; text: string }
/** Persist the first snapshot so provider retries have identical bodies and one key. */
export async function deliverDailyReport(system: string, now: Date, from: string, build: () => Promise<SubmissionReport>) {
  from = from.trim()
  if (!from) throw new Error('Report sender is missing')
  const sql = neon(process.env.DATABASE_URL!)
  const key = `${system}/${istDate(now)}`
  let rows = await sql`SELECT payload, sent_at FROM daily_submission_reports WHERE report_key = ${key}`
  if (!rows.length) {
    const report = await build()
    const payload: Payload = { from, to: 'ajder@indigoedge.com', ...renderSubmissionReport(report) }
    await sql`INSERT INTO daily_submission_reports (report_key, payload) VALUES (${key}, ${JSON.stringify(payload)}::jsonb) ON CONFLICT (report_key) DO NOTHING`
    rows = await sql`SELECT payload, sent_at FROM daily_submission_reports WHERE report_key = ${key}`
  }
  if (rows[0].sent_at) return { status: 'already_sent', reportKey: key }
  const payload = rows[0].payload as Payload
  const { data, error } = await new Resend(process.env.RESEND_API_KEY?.trim()).emails.send(payload, { idempotencyKey: key })
  if (error || !data?.id) throw new Error(`Report delivery failed: ${error?.message || 'No message ID'}`)
  await sql`UPDATE daily_submission_reports SET sent_at = now(), message_id = ${data.id} WHERE report_key = ${key} AND sent_at IS NULL`
  return { status: 'sent', reportKey: key, messageId: data.id }
}
