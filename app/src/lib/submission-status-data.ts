import { and, desc, eq } from 'drizzle-orm'
import { db } from './db'
import { cycles, tokens } from './db/schema'
import { currentCycleStartDate } from './peer-email-schedule'
import { reportCycle, type ReportPerson, type SubmissionReport } from './submission-status-report'

export function bandwidthStatus(status: unknown): ReportPerson['status'] {
  if (status === 'pending') return 'pending'
  if (status === 'submitted') return 'submitted'
  if (status === 'not_needed') return 'exempt'
  return 'unknown'
}

export async function buildSubmissionStatus(now: Date): Promise<SubmissionReport> {
  const period = reportCycle(currentCycleStartDate(now), now)
  const matchingCycles = await db.select().from(cycles)
    .where(and(eq(cycles.startDate, period.cycleStart), eq(cycles.isTest, false)))
    .orderBy(desc(cycles.createdAt))
  const base = { system: 'Bandwidth' as const, ...period, generatedAt: now.toISOString() }
  if (matchingCycles.length !== 1) {
    return { ...base, cycleReference: matchingCycles.map(cycle => cycle.id).join(', ') || period.cycleStart,
      people: [], issue: matchingCycles.length === 0
        ? "No production bandwidth cycle was found for this week. Completion can't be confirmed."
        : 'Multiple production cycles exist for this week. The recipient list needs checking before completion can be reported.' }
  }
  const cycle = matchingCycles[0]
  // Read completed cycles too: finalization can leave unanswered forms behind.
  const records = await db.select().from(tokens).where(eq(tokens.cycleId, cycle.id))
  const people: ReportPerson[] = records.map(record => ({
    name: record.fellowName, email: record.fellowEmail, role: record.fellowDesignation,
    status: bandwidthStatus(record.status), submittedAt: record.submittedAt?.toISOString(),
  }))
  const duplicates = new Set(records.map(record => record.fellowRecordId)).size !== records.length
  return { ...base, cycleReference: `${cycle.id} (${cycle.status})`, people,
    issue: records.length === 0 ? "This cycle has no recipient records. Completion can't be confirmed."
      : duplicates ? 'Duplicate recipient records were found. Counts below refer to records and need checking.' : undefined }
}
