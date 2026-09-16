import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ select: vi.fn(), orderBy: vi.fn(), where: vi.fn() }))
vi.mock('../src/lib/db', () => ({ db: {select: mocks.select} }))
import { buildSubmissionStatus, bandwidthStatus } from '../src/lib/submission-status-data'
beforeEach(() => {
 vi.clearAllMocks()
 mocks.select.mockReturnValue({from: () => ({where: mocks.where})})
 mocks.where.mockReturnValueOnce({orderBy: mocks.orderBy})
})
describe('bandwidth recipient selection', () => {
 it('reads the previous Monday cycle even when finalized', async () => {
  mocks.orderBy.mockResolvedValue([{id:'cycle-1',status:'complete'}])
  mocks.where.mockResolvedValueOnce([{fellowRecordId:'f1',fellowName:'Pending',fellowEmail:'a@example.com',fellowDesignation:'VP',status:'pending'},{fellowRecordId:'f2',fellowName:'Exempt',fellowEmail:'b@example.com',fellowDesignation:'AVP',status:'not_needed'}])
  const report = await buildSubmissionStatus(new Date('2026-09-21T03:45:00Z'))
  expect(report.cycleStart).toBe('2026-09-14')
  expect(report.previousCycle).toBe(true)
  expect(report.cycleReference).toContain('complete')
  expect(report.people.map(p => p.status)).toEqual(['pending','exempt'])
 })
 it('flags missing production cycles', async () => {
  mocks.orderBy.mockResolvedValue([])
  expect((await buildSubmissionStatus(new Date())).issue).toContain('No production bandwidth cycle')
 })
 it('flags ambiguous duplicate production cycles', async () => {
  mocks.orderBy.mockResolvedValue([{id:'one'},{id:'two'}])
  const report = await buildSubmissionStatus(new Date())
  expect(report.issue).toContain('Multiple production cycles')
  expect(report.people).toEqual([])
 })
 it('treats unfamiliar statuses as unverified and exemptions separately', () => {
  expect(bandwidthStatus('not_needed')).toBe('exempt')
  expect(bandwidthStatus('submitted')).toBe('submitted')
  expect(bandwidthStatus('other')).toBe('unknown')
 })
})
