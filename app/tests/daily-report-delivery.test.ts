import { describe, it, expect, vi, beforeEach } from 'vitest'
const mocks = vi.hoisted(() => ({ sql: vi.fn(), send: vi.fn() }))
vi.mock('@neondatabase/serverless', () => ({ neon: () => mocks.sql }))
vi.mock('resend', () => ({ Resend: class { emails = { send: mocks.send } } }))
import { deliverDailyReport } from '../src/lib/daily-report-delivery'
const now = new Date('2026-09-16T03:45:00Z')
const payload = { from: 'reports@example.com', to: 'ajder@indigoedge.com', subject: 'Saved', html: '<p>Saved</p>', text: 'Saved' }
beforeEach(() => vi.clearAllMocks())
describe('daily delivery', () => {
 it('does not resend a delivered report', async () => {
  mocks.sql.mockResolvedValueOnce([{ payload, sent_at: now }])
  const build = vi.fn()
  expect((await deliverDailyReport('bandwidth', now, payload.from, build)).status).toBe('already_sent')
  expect(build).not.toHaveBeenCalled()
  expect(mocks.send).not.toHaveBeenCalled()
 })
 it('retries an immutable snapshot with the same provider key', async () => {
  mocks.sql.mockResolvedValueOnce([{ payload, sent_at: null }]).mockResolvedValueOnce([])
  mocks.send.mockResolvedValueOnce({ data: { id: 'message-1' }, error: null })
  const build = vi.fn()
  await deliverDailyReport('bandwidth', now, payload.from, build)
  expect(build).not.toHaveBeenCalled()
  expect(mocks.send).toHaveBeenCalledWith(payload, { idempotencyKey: 'bandwidth/2026-09-16' })
 })
 it('does not record delivery when the provider rejects the message', async () => {
  mocks.sql.mockResolvedValueOnce([{ payload, sent_at: null }])
  mocks.send.mockResolvedValueOnce({ error: { message: 'temporary failure' } })
  await expect(deliverDailyReport('bandwidth', now, payload.from, vi.fn())).rejects.toThrow('temporary failure')
  expect(mocks.sql).toHaveBeenCalledTimes(1)
 })
 it('stores a new snapshot addressed only to Ajder, without CC', async () => {
  mocks.sql.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{payload,sent_at:null}]).mockResolvedValueOnce([])
  mocks.send.mockResolvedValueOnce({data:{id:'message-1'}})
  const build = vi.fn().mockResolvedValue({system:'Bandwidth',cycleStart:'2026-09-14',cycleEnd:'2026-09-20',cycleReference:'cycle',generatedAt:now.toISOString(),previousCycle:false,people:[],issue:'No cycle'})
  await deliverDailyReport('bandwidth', now, payload.from, build)
  const saved = JSON.parse(mocks.sql.mock.calls[1][2])
  expect(saved.to).toBe('ajder@indigoedge.com')
  expect(saved.cc).toBeUndefined()
  expect(build).toHaveBeenCalledTimes(1)
 })
})
