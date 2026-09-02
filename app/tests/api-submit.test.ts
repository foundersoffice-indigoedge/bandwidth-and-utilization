import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  updateWhere: vi.fn(),
  fetchAllProjects: vi.fn(),
  fetchEligibleFellows: vi.fn(),
  upsertSubmission: vi.fn(),
  createSubmissionConflict: vi.fn(),
  sendConflictEmail: vi.fn(),
  postRemark: vi.fn(),
  checkAndFinalizeCycle: vi.fn(),
  createSignoffIfReady: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    select: mocks.select,
    update: () => ({
      set: () => ({ where: mocks.updateWhere }),
    }),
  },
}));
vi.mock('@/lib/airtable/projects', () => ({ fetchAllProjects: mocks.fetchAllProjects }));
vi.mock('@/lib/airtable/fellows', () => ({
  fetchEligibleFellows: mocks.fetchEligibleFellows,
  isVpOrAvp: (designation: string) => designation === 'VP' || designation === 'AVP',
}));
vi.mock('@/lib/submission-persistence', () => ({
  upsertSubmission: mocks.upsertSubmission,
  createSubmissionConflict: mocks.createSubmissionConflict,
}));
vi.mock('@/lib/email', () => ({ sendConflictEmail: mocks.sendConflictEmail }));
vi.mock('@/lib/slack', () => ({ postRemark: mocks.postRemark }));
vi.mock('@/lib/cycle', () => ({ checkAndFinalizeCycle: mocks.checkAndFinalizeCycle }));
vi.mock('@/lib/signoff', () => ({ createSignoffIfReady: mocks.createSignoffIfReady }));

import { POST } from '../src/app/api/submit/route';

const token = {
  id: 'token-1', cycleId: 'cycle-1', fellowRecordId: 'recKanishka', fellowName: 'Kanishka Gupta',
  fellowEmail: 'kanishka@example.com', fellowDesignation: 'Associate 2', status: 'pending',
};
const pendingProject = {
  id: 'pending-rubick', cycleId: 'cycle-1', type: 'dde', name: 'Rubick AI',
  teammateRecordIds: ['recKanishka'], createdByFellowId: 'recNihar', createdByFellowName: 'Nihar Dighe',
};
const savedSubmission = {
  id: 'submission-rubick', cycleId: 'cycle-1', fellowRecordId: 'recKanishka',
  projectRecordId: 'pending_pending-rubick', projectName: 'Rubick AI', projectType: 'dde',
  hoursValue: 2, hoursUnit: 'per_day', hoursPerDay: 2, hoursPerWeek: 12,
  isSelfReport: true, targetFellowId: null, remarks: null,
};

function selection(value: unknown) {
  return { from: () => ({ where: () => ({ limit: async () => value }) }) };
}

function pendingSelection(value: unknown) {
  return { from: () => ({ where: async () => value }) };
}

function request(entries: unknown) {
  return new NextRequest('https://util.test/api/submit', {
    method: 'POST',
    body: JSON.stringify({ token: 'token-value', entries, remarks: '' }),
  });
}

beforeEach(() => {
  mocks.select.mockReset();
  mocks.updateWhere.mockReset();
  mocks.fetchAllProjects.mockReset();
  mocks.fetchEligibleFellows.mockReset();
  mocks.upsertSubmission.mockReset();
  mocks.createSubmissionConflict.mockReset();
  mocks.sendConflictEmail.mockReset();
  mocks.postRemark.mockReset();
  mocks.checkAndFinalizeCycle.mockReset();
  mocks.createSignoffIfReady.mockReset();

  mocks.select
    .mockReturnValueOnce(selection([token]))
    .mockReturnValueOnce(pendingSelection([pendingProject]));
  mocks.fetchAllProjects.mockResolvedValue([]);
  mocks.fetchEligibleFellows.mockResolvedValue([
    { recordId: 'recKanishka', name: 'Kanishka Gupta', email: 'kanishka@example.com', designation: 'Associate 2' },
    { recordId: 'recNihar', name: 'Nihar Dighe', email: 'nihar@example.com', designation: 'AVP' },
  ]);
  mocks.updateWhere.mockResolvedValue(undefined);
  mocks.checkAndFinalizeCycle.mockResolvedValue(undefined);
});

describe('POST /api/submit pending teammate safety', () => {
  it('inserts a missing pending-project teammate self-report and then consumes the token', async () => {
    mocks.upsertSubmission.mockResolvedValue(savedSubmission);
    mocks.select.mockReturnValueOnce(pendingSelection([])); // no senior projection to reconcile

    const response = await POST(request([{
      projectRecordId: 'pending_pending-rubick', targetFellowId: null, hoursValue: 2, hoursUnit: 'per_day',
    }]));

    expect(response.status).toBe(200);
    expect(mocks.upsertSubmission).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      cycleId: 'cycle-1', fellowRecordId: 'recKanishka', projectRecordId: 'pending_pending-rubick',
      hoursPerWeek: 12, isSelfReport: true,
    }));
    expect(mocks.updateWhere).toHaveBeenCalledOnce();
  });

  it('rejects an invalid entry before persistence and leaves the token pending', async () => {
    const response = await POST(request([{
      projectRecordId: 'pending_pending-rubick', targetFellowId: 'recNihar', hoursValue: 2, hoursUnit: 'per_day',
    }]));

    expect(response.status).toBe(400);
    expect(mocks.upsertSubmission).not.toHaveBeenCalled();
    expect(mocks.updateWhere).not.toHaveBeenCalled();
  });

  it('leaves the token pending when persistence fails, so the fellow can retry', async () => {
    mocks.upsertSubmission.mockRejectedValue(new Error('Neon unavailable'));

    const response = await POST(request([{
      projectRecordId: 'pending_pending-rubick', targetFellowId: null, hoursValue: 2, hoursUnit: 'per_day',
    }]));

    expect(response.status).toBe(500);
    expect(mocks.updateWhere).not.toHaveBeenCalled();
  });
});
