import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { mockSelect, mockUpdate, mockInsert, sendConflictReminder, reconcileCycle } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
  mockInsert: vi.fn(),
  sendConflictReminder: vi.fn(),
  reconcileCycle: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: { select: mockSelect, update: mockUpdate, insert: mockInsert } }));
vi.mock('@/lib/email', () => ({
  sendConflictReminderEmail: sendConflictReminder,
  sendDirectorSignoffReminderEmail: vi.fn(),
}));
vi.mock('@/lib/cycle', () => ({
  checkAndFinalizeCycle: vi.fn(),
  reconcileCycleConflictsWithLiveAirtable: reconcileCycle,
}));

import { GET } from '@/app/api/cron/conflict-reminders/route';

const cycle = { id: 'cycle-1', startDate: '2026-08-24', createdAt: new Date('2026-08-24T00:00:00.000Z') };
const conflict = {
  id: 'conflict-1', cycleId: 'cycle-1', status: 'pending', source: 'submission',
  emailMessageId: 'original-message', emailSentAt: new Date('2026-08-25T04:00:00.000Z'),
  lastReminderSentAt: null, vpSubmissionId: 'vp-sub', associateSubmissionId: 'associate-sub',
  resolutionToken: 'resolution-token', vpHoursPerDay: 0, associateHoursPerDay: 6,
};

const latestCycleSelect = () => ({
  from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [cycle] }) }) }),
});
const rowsSelect = (rows: unknown[]) => ({ from: () => ({ where: async () => rows }) });
const oneRowSelect = (row: unknown) => ({
  from: () => ({ where: () => ({ limit: async () => row ? [row] : [] }) }),
});
const claimedUpdate = (rows: unknown[]) => ({
  set: () => ({ where: () => ({ returning: async () => rows }) }),
});
const noReturnUpdate = () => ({ set: () => ({ where: async () => undefined }) });

describe('/api/cron/conflict-reminders', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'cron-test';
    vi.setSystemTime(new Date('2026-08-27T05:00:00.000Z'));
    mockSelect.mockReset();
    mockUpdate.mockReset();
    mockInsert.mockReset();
    sendConflictReminder.mockReset();
    reconcileCycle.mockReset();
    reconcileCycle.mockResolvedValue({
      resolvedConflictIds: [], activeConflictIds: ['conflict-1'], ambiguousConflictIds: [],
      fellows: [
        { recordId: 'vp', name: 'Vijay', email: 'vijay@example.com', designation: 'VP' },
        { recordId: 'associate', name: 'Asha', email: 'asha@example.com', designation: 'Associate 2' },
      ],
      allProjects: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.CRON_SECRET;
  });

  it('fails closed when Airtable lifecycle preflight fails', async () => {
    mockSelect.mockReturnValueOnce(latestCycleSelect());
    reconcileCycle.mockRejectedValueOnce(new Error('Airtable unavailable'));

    const response = await GET(new NextRequest('https://util.test/api/cron/conflict-reminders', {
      headers: { authorization: 'Bearer cron-test' },
    }));

    expect(response.status).toBe(503);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(sendConflictReminder).not.toHaveBeenCalled();
  });

  it('does not remind a conflict younger than 24 hours', async () => {
    const younger = { ...conflict, emailSentAt: new Date('2026-08-26T05:00:01.000Z') };
    mockSelect
      .mockReturnValueOnce(latestCycleSelect())
      .mockReturnValueOnce(rowsSelect([younger]))
      .mockReturnValueOnce(rowsSelect([]));

    const response = await GET(new NextRequest('https://util.test/api/cron/conflict-reminders', {
      headers: { authorization: 'Bearer cron-test' },
    }));

    expect(response.status).toBe(200);
    expect(sendConflictReminder).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('lets only the atomic winner send when another cron already claimed the reminder', async () => {
    mockSelect
      .mockReturnValueOnce(latestCycleSelect())
      .mockReturnValueOnce(rowsSelect([conflict]))
      .mockReturnValueOnce(oneRowSelect({ fellowRecordId: 'vp', projectName: 'LoadShare DDE' }))
      .mockReturnValueOnce(oneRowSelect({ fellowRecordId: 'associate', projectName: 'LoadShare DDE' }))
      .mockReturnValueOnce(rowsSelect([]));
    mockUpdate.mockReturnValueOnce(claimedUpdate([]));

    await GET(new NextRequest('https://util.test/api/cron/conflict-reminders', {
      headers: { authorization: 'Bearer cron-test' },
    }));

    expect(sendConflictReminder).not.toHaveBeenCalled();
  });

  it('releases the claim when the provider fails before delivery', async () => {
    mockSelect
      .mockReturnValueOnce(latestCycleSelect())
      .mockReturnValueOnce(rowsSelect([conflict]))
      .mockReturnValueOnce(oneRowSelect({ fellowRecordId: 'vp', projectName: 'LoadShare DDE' }))
      .mockReturnValueOnce(oneRowSelect({ fellowRecordId: 'associate', projectName: 'LoadShare DDE' }))
      .mockReturnValueOnce(rowsSelect([]));
    mockUpdate
      .mockReturnValueOnce(claimedUpdate([{ id: 'conflict-1' }]))
      .mockReturnValueOnce(noReturnUpdate());
    sendConflictReminder.mockRejectedValueOnce(new Error('Resend unavailable'));

    await GET(new NextRequest('https://util.test/api/cron/conflict-reminders', {
      headers: { authorization: 'Bearer cron-test' },
    }));

    expect(sendConflictReminder).toHaveBeenCalledOnce();
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  it('does not release a successful send when reminder history recording fails', async () => {
    mockSelect
      .mockReturnValueOnce(latestCycleSelect())
      .mockReturnValueOnce(rowsSelect([conflict]))
      .mockReturnValueOnce(oneRowSelect({ fellowRecordId: 'vp', projectName: 'LoadShare DDE' }))
      .mockReturnValueOnce(oneRowSelect({ fellowRecordId: 'associate', projectName: 'LoadShare DDE' }))
      .mockReturnValueOnce(rowsSelect([]));
    mockUpdate.mockReturnValueOnce(claimedUpdate([{ id: 'conflict-1' }]));
    mockInsert.mockReturnValueOnce({ values: async () => { throw new Error('audit unavailable'); } });
    sendConflictReminder.mockResolvedValueOnce('reminder-message');

    await GET(new NextRequest('https://util.test/api/cron/conflict-reminders', {
      headers: { authorization: 'Bearer cron-test' },
    }));

    expect(sendConflictReminder).toHaveBeenCalledOnce();
    expect(mockUpdate).toHaveBeenCalledOnce();
  });
});
