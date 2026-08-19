import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { mockSelect, mockUpdate, sendReport } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
  sendReport: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: { select: mockSelect, update: mockUpdate } }));
vi.mock('@/lib/email', () => ({ sendSubmissionComplianceReport: sendReport }));

import { GET } from '@/app/api/cron/submission-compliance/route';

describe('/api/cron/submission-compliance', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.CRON_SECRET = 'cron-test';
    process.env.SUBMISSION_COMPLIANCE_ENABLED_FROM = '2026-08-24';
    mockSelect.mockReset();
    mockUpdate.mockReset();
    sendReport.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.CRON_SECRET;
    delete process.env.SUBMISSION_COMPLIANCE_ENABLED_FROM;
  });

  it('rejects callers without the cron secret before touching the database', async () => {
    const response = await GET(new NextRequest('https://util.test/api/cron/submission-compliance'));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('accepts the cron secret but refuses to process before Monday 1:00 p.m. IST', async () => {
    vi.setSystemTime(new Date('2026-08-24T07:29:59.999Z'));
    const response = await GET(new NextRequest('https://util.test/api/cron/submission-compliance', {
      headers: { authorization: 'Bearer cron-test' },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ message: 'Submission deadline has not passed yet' });
  });

  it('leaves a pre-cutover Monday untouched', async () => {
    vi.setSystemTime(new Date('2026-08-17T07:30:00.000Z'));
    const response = await GET(new NextRequest('https://util.test/api/cron/submission-compliance', {
      headers: { authorization: 'Bearer cron-test' },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: 'Cycle 2026-08-17 predates SUBMISSION_COMPLIANCE_ENABLED_FROM',
    });
  });

  it('does not send when a concurrent cron invocation already claimed the report', async () => {
    vi.setSystemTime(new Date('2026-09-07T07:30:00.000Z'));
    mockSelect
      .mockReturnValueOnce({
        from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => ([{ id: 'c3', createdAt: new Date() }]) }) }) }),
      })
      .mockReturnValueOnce({ from: () => ({ where: async () => ([]) }) })
      .mockReturnValueOnce({
        from: () => ({ where: async () => ([
          { cycleId: 'c1', cycleStartDate: '2026-08-24', fellowRecordId: 'recA', fellowName: 'Asha', fellowDesignation: 'Associate 2', outcome: 'missed', submittedAt: null },
          { cycleId: 'c2', cycleStartDate: '2026-08-31', fellowRecordId: 'recA', fellowName: 'Asha', fellowDesignation: 'Associate 2', outcome: 'missed', submittedAt: null },
          { cycleId: 'c3', cycleStartDate: '2026-09-07', fellowRecordId: 'recA', fellowName: 'Asha', fellowDesignation: 'Associate 2', outcome: 'missed', submittedAt: null },
        ]) }),
      });
    mockUpdate.mockReturnValue({
      set: () => ({ where: () => ({ returning: async () => ([]) }) }),
    });

    const response = await GET(new NextRequest('https://util.test/api/cron/submission-compliance', {
      headers: { authorization: 'Bearer cron-test' },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ message: 'Compliance report already claimed or sent', flaggedPeople: 1 });
    expect(sendReport).not.toHaveBeenCalled();
  });

  it('releases its claim when the email provider fails so the retry checkpoint can run', async () => {
    vi.setSystemTime(new Date('2026-09-07T07:30:00.000Z'));
    mockSelect
      .mockReturnValueOnce({
        from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => ([{ id: 'c3', createdAt: new Date() }]) }) }) }),
      })
      .mockReturnValueOnce({ from: () => ({ where: async () => ([]) }) })
      .mockReturnValueOnce({
        from: () => ({ where: async () => ([
          { cycleId: 'c1', cycleStartDate: '2026-08-24', fellowRecordId: 'recA', fellowName: 'Asha', fellowDesignation: 'Associate 2', outcome: 'missed', submittedAt: null },
          { cycleId: 'c2', cycleStartDate: '2026-08-31', fellowRecordId: 'recA', fellowName: 'Asha', fellowDesignation: 'Associate 2', outcome: 'missed', submittedAt: null },
          { cycleId: 'c3', cycleStartDate: '2026-09-07', fellowRecordId: 'recA', fellowName: 'Asha', fellowDesignation: 'Associate 2', outcome: 'missed', submittedAt: null },
        ]) }),
      });
    mockUpdate
      .mockReturnValueOnce({ set: () => ({ where: () => ({ returning: async () => ([{ id: 'c3' }]) }) }) })
      .mockReturnValueOnce({ set: () => ({ where: async () => undefined }) });
    sendReport.mockRejectedValueOnce(new Error('Resend unavailable'));

    const response = await GET(new NextRequest('https://util.test/api/cron/submission-compliance', {
      headers: { authorization: 'Bearer cron-test' },
    }));

    expect(response.status).toBe(500);
    expect(sendReport).toHaveBeenCalledOnce();
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });
});
