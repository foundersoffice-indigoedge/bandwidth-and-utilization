import { describe, it, expect } from 'vitest'
import { reportCycle, renderSubmissionReport, istDate, type SubmissionReport } from '../src/lib/submission-status-report'

const sample: SubmissionReport = {
 system: 'Project check-in', cycleStart: '2026-09-11', cycleEnd: '2026-09-17', cycleReference: 'test-cycle', generatedAt: '2026-09-16T03:45:00Z', previousCycle: false,
 people: [
  { name: 'VP <One>', email: 'vp@example.com', role: 'VP', status: 'pending' },
  { name: 'Director Two', email: 'director@example.com', role: 'Director', status: 'submitted', submittedAt: '2026-09-14T05:00:00Z' },
  { name: 'Exempt', email: 'exempt@example.com', role: 'Associate', status: 'exempt' },
 ],
}
describe('daily status report', () => {
 it('reports the previous project cycle on Friday', () => {
  expect(reportCycle('2026-09-18', new Date('2026-09-18T03:45:00Z'))).toEqual({ cycleStart: '2026-09-11', cycleEnd: '2026-09-17', previousCycle: true })
 })
 it('reports the previous bandwidth cycle on Monday, across a year boundary', () => {
  expect(reportCycle('2027-01-04', new Date('2027-01-04T03:45:00Z'))).toEqual({ cycleStart: '2026-12-28', cycleEnd: '2027-01-03', previousCycle: true })
 })
 it('reports current cycle on other days, including weekends', () => {
  expect(reportCycle('2026-09-11', new Date('2026-09-13T03:45:00Z')).previousCycle).toBe(false)
 })
 it('uses IST across the UTC date boundary', () => {
  expect(istDate(new Date('2026-09-17T19:00:00Z'))).toBe('2026-09-18')
 })
 it('includes VP recipients, all roles, counts, times and escaped text', () => {
  const report = renderSubmissionReport(sample)
  expect(report.subject).toContain('1 awaiting submission')
  expect(report.html).toContain('VP &lt;One&gt;')
  expect(report.html).not.toContain('VP <One>')
  expect(report.text).toContain('1 pending / 1 submitted / 1 not required / 0 need checking / 3 total recipients')
  expect(report.text).toContain('10:30 am IST')
  expect(report.text).toContain('vp@example.com')
 })
 it('preserves date-only timestamps without inventing a time', () => {
  const report = renderSubmissionReport({ ...sample, people: [{...sample.people[1], submittedAt: '2026-09-14'}] })
  expect(report.text).toContain('14 Sept 2026 (date only)')
  expect(report.text).not.toContain('5:30 am')
 })
 it('sends an explicit all-complete report', () => {
  expect(renderSubmissionReport({ ...sample, people: sample.people.filter(p => p.status !== 'pending') }).subject).toContain('all required forms submitted')
 })
 it('never calls missing or unknown data all complete', () => {
  expect(renderSubmissionReport({ ...sample, people: [], issue: 'No cycle found' }).subject).toContain('data needs attention')
  expect(renderSubmissionReport({ ...sample, people: [{...sample.people[0],status:'unknown'}] }).subject).toContain('needs checking')
 })
 it('labels the previous-cycle summary and its late-submission basis', () => {
  const report = renderSubmissionReport({ ...sample, previousCycle: true })
  expect(report.text).toContain('Previous-cycle summary')
  expect(report.text).toContain("Today's newly issued forms are excluded")
  expect(report.text).toContain('late submissions')
 })
})
