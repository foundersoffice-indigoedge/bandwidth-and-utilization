import { writeFileSync } from 'node:fs'
import { buildSubmissionStatus } from '../src/lib/submission-status-data'
import { renderSubmissionReport } from '../src/lib/submission-status-report'

async function main() {
  const now = process.argv[2] ? new Date(process.argv[2]) : new Date()
  const output = process.argv[3] || '/tmp/submission-status-preview.html'
  const report = await buildSubmissionStatus(now)
  writeFileSync(output, renderSubmissionReport(report).html)
  console.log(JSON.stringify({ ...report, people: report.people.map(({name,role,status,submittedAt}) => ({name,role,status,submittedAt})) }, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
