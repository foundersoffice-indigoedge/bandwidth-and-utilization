export type ReportPerson = {
  name: string
  email: string
  role: string
  status: 'pending' | 'submitted' | 'exempt' | 'unknown'
  submittedAt?: string | null
}
export type SubmissionReport = {
  system: 'Project check-in' | 'Bandwidth'
  cycleStart: string
  cycleEnd: string
  cycleReference: string
  generatedAt: string
  previousCycle: boolean
  people: ReportPerson[]
  issue?: string
}

export function istDate(now: Date): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10)
}
export function shiftDate(date: string, days: number): string {
  const result = new Date(`${date}T12:00:00Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}
/** Rollout mornings close the previous cycle; subsequent mornings track the new one. */
export function reportCycle(currentCycle: string, now: Date) {
  const previousCycle = currentCycle === istDate(now)
  const cycleStart = previousCycle ? shiftDate(currentCycle, -7) : currentCycle
  return { cycleStart, cycleEnd: shiftDate(cycleStart, 6), previousCycle }
}
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))
}
function readableDate(date: string): string {
  return new Date(`${date}T12:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
}
function timestamp(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return readableDate(value) + ' (date only)'
  return new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) + ' IST'
}
export function renderSubmissionReport(report: SubmissionReport) {
  const people = [...report.people].sort((a,b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email))
  const pending = people.filter(person => person.status === 'pending')
  const submitted = people.filter(person => person.status === 'submitted')
  const exempt = people.filter(person => person.status === 'exempt')
  const unknown = people.filter(person => person.status === 'unknown')
  const kind = report.previousCycle ? 'Previous-cycle summary' : 'Daily submission status'
  const period = `${readableDate(report.cycleStart)} to ${readableDate(report.cycleEnd)}`
  const headline = report.issue ? 'Cycle data needs attention' : pending.length ? `${pending.length} awaiting submission` : unknown.length ? 'Submission status needs checking' : 'All required forms submitted'
  const secondary = people.filter(person => person.status !== 'pending')
  const subject = `${report.system}: ${headline.toLowerCase()} | ${report.previousCycle ? 'previous cycle' : 'cycle'} ${report.cycleStart}`
  const statusLabel = (person: ReportPerson) => person.status === 'submitted'
    ? `Submitted${person.submittedAt ? ` (${timestamp(person.submittedAt)})` : ''}`
    : person.status === 'pending' ? 'Awaiting submission' : person.status === 'exempt' ? 'Not required' : 'Status needs checking'
  const rowText = (person: ReportPerson) => `${person.name} | ${person.role || 'Role unavailable'} | ${person.email} | ${statusLabel(person)}`
  const summary = `${pending.length} pending / ${submitted.length} submitted / ${exempt.length} not required / ${unknown.length} need checking / ${people.length} total recipients`
  const note = report.previousCycle
    ? "This closes the previous cycle. Today's newly issued forms are excluded. Status reflects the records at the time shown below; late submissions received by then count as submitted."
    : 'This covers the current cycle. Awaiting submission means the form is still pending; it does not automatically mean the person missed a deadline.'
  const scope = report.system === 'Project check-in'
    ? 'Includes every recorded check-in recipient, including VPs and AVPs responsible for VP-led mandates. Confirmed and Updated both count as submitted.'
    : 'Includes the recorded bandwidth-form recipients. People marked not required are listed separately. Form submission is tracked independently of conflict resolution and director sign-off.'
  const table = (rows: ReportPerson[]) => `<table style="width:100%;table-layout:fixed;overflow-wrap:anywhere;border-collapse:collapse;font-size:13px"><thead><tr>${['Person / role','Email'].map(label => `<th style="padding:10px 8px;text-align:left;border-bottom:1px solid #c3c6da;color:#4d5067">${label}</th>`).join('')}</tr></thead><tbody>${rows.map(person => `<tr><td style="padding:12px 8px;vertical-align:top;border-bottom:1px solid #d6d8e5"><strong>${escapeHtml(person.name)}</strong><br><span style="color:#666a82">${escapeHtml(person.role || 'Role unavailable')}</span></td><td style="padding:12px 8px;vertical-align:top;border-bottom:1px solid #d6d8e5;overflow-wrap:anywhere">${escapeHtml(person.email)}</td></tr>`).join('')}</tbody></table>`
  const text = [report.system,kind,`Cycle: ${period}`,headline,report.issue || summary,`As of ${timestamp(report.generatedAt)}`,note,scope,'Awaiting submission:',...pending.map(rowText),pending.length ? '' : (report.issue ? 'Unavailable while cycle data needs attention.' : 'None.'),'Other recipients (submitted, not required, or status needs checking):',...secondary.map(rowText),`Cycle reference: ${report.cycleReference}`].join('\n')
  // Inline styling keeps the report readable in email clients that strip style blocks.
  const html = `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f4f5f7;color:#1b1d2a;font-family:Arial,sans-serif;line-height:1.5"><div style="max-width:800px;margin:auto;background:#ffffff;border:1px solid #d6d8e5;border-radius:13px;padding:28px"><p style="margin:0;color:#243b53;font-size:12px;letter-spacing:1px">${escapeHtml(report.system.toUpperCase())}</p><h1 style="font-size:25px;margin:10px 0">${escapeHtml(headline)}</h1><p>${escapeHtml(kind)}<br><strong>Cycle: ${escapeHtml(period)}</strong></p><p style="background:#f2f4f7;padding:14px;border-radius:8px">${escapeHtml(report.issue || summary)}</p><p style="font-size:13px;color:#4d5067">${escapeHtml(note)}</p><h2 style="font-size:18px;margin-top:28px">Awaiting submission</h2>${pending.length ? table(pending) : `<p>${report.issue ? 'Unavailable while cycle data needs attention.' : 'None.'}</p>`}<h2 style="font-size:16px;margin-top:32px;color:#4d5067">Other recipients (${secondary.length})</h2><p style="font-size:12px;color:#666a82">Submitted, not required, or status needs checking. Everyone still pending is listed above.</p>${secondary.length ? `<div style="font-size:12px;color:#4d5067">${secondary.map(person => `<p style="margin:8px 0"><strong>${escapeHtml(person.name)}</strong> (${escapeHtml(person.role || 'Role unavailable')})<br>${escapeHtml(statusLabel(person))}</p>`).join('')}</div>` : '<p>No other recipient records.</p>'}<p style="font-size:12px;color:#666a82;margin-top:26px">${escapeHtml(scope)}</p><p style="font-size:12px;color:#666a82">As of ${escapeHtml(timestamp(report.generatedAt))}<br>Cycle reference: ${escapeHtml(report.cycleReference)}</p></div></body></html>`
  return { subject, html, text }
}
