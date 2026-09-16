import { describe, it, expect, vi, beforeEach } from 'vitest'
const mocks = vi.hoisted(() => ({ build: vi.fn(), deliver: vi.fn() }))
vi.mock('@/lib/submission-status-data', () => ({ buildSubmissionStatus: mocks.build }))
vi.mock('@/lib/daily-report-delivery', () => ({ deliverDailyReport: mocks.deliver }))
import { GET } from '../src/app/api/cron/submission-status/route'
beforeEach(() => { vi.clearAllMocks(); process.env.CRON_SECRET = 'test-secret' })
describe('report endpoint', () => {
 it('rejects missing authorization before reading data', async () => {
  expect((await GET(new Request('https://example.com/api/cron/submission-status'))).status).toBe(401)
  expect(mocks.build).not.toHaveBeenCalled()
  expect(mocks.deliver).not.toHaveBeenCalled()
 })
 it('fails closed when CRON_SECRET is unset', async () => {
  delete process.env.CRON_SECRET
  expect((await GET(new Request('https://example.com/api/cron/submission-status', {headers:{authorization:'Bearer undefined'}}))).status).toBe(401)
 })
 it('provides an authenticated read-only preview', async () => {
  mocks.build.mockResolvedValue({system:'Bandwidth',cycleStart:'2026-09-14',cycleEnd:'2026-09-20',cycleReference:'test',generatedAt:'2026-09-16T03:45:00Z',previousCycle:false,people:[],issue:'Missing cycle'})
  const response = await GET(new Request('https://example.com/api/cron/submission-status?preview=true',{headers:{authorization:'Bearer test-secret'}}))
  expect(response.status).toBe(200)
  expect((await response.json()).subject).toContain('data needs attention')
  expect(mocks.deliver).not.toHaveBeenCalled()
 })
 it('returns a retryable error for data or delivery failures', async () => {
  mocks.deliver.mockRejectedValueOnce(new Error('temporary failure'))
  expect((await GET(new Request('https://example.com/api/cron/submission-status',{headers:{authorization:'Bearer test-secret'}}))).status).toBe(500)
 })
})
