import { describe, it, expect, vi, beforeEach } from 'vitest';

const claimUpdate = vi.fn();
const processedUpdate = vi.fn();
let processedTargetRows: Array<{ cycleId: string; fellowRecordId: string; remarks: string | null }> = [];

vi.mock('@/lib/db', () => {
  const claimedRows = [
    { id: 's1', cycleId: 'c1', fellowRecordId: 'recF', remarks: 'X to be removed', projectName: 'X - DDE | Jun 2026', projectType: 'dde', projectRecordId: 'recX' },
    { id: 's2', cycleId: 'c1', fellowRecordId: 'recF', remarks: 'X to be removed', projectName: 'Y Pitch | Jun 2026', projectType: 'pitch', projectRecordId: 'recY' },
  ];

  const db = {
    select: (selection?: Record<string, unknown>) => {
      const keys = Object.keys(selection ?? {});

      if (keys.length === 1 && keys.includes('id')) {
        return {
          from: () => ({
            innerJoin: () => ({
              where: () => ({ __subquery: true }),
            }),
          }),
        };
      }

      if (keys.includes('startDate')) {
        return {
          from: () => ({
            where: async () => ([{ id: 'c1', startDate: '2026-07-13' }]),
          }),
        };
      }

      if (keys.includes('cycleId') && keys.includes('fellowRecordId') && keys.includes('remarks')) {
        return {
          from: () => ({
            where: () => ({
              limit: async () => processedTargetRows,
            }),
          }),
        };
      }

      if (keys.includes('type')) {
        return {
          from: () => ({
            where: async () => ([
              { name: 'X - DDE | Jun 2026', type: 'dde', recordId: 'recX' },
              { name: 'Y Pitch | Jun 2026', type: 'pitch', recordId: 'recY' },
            ]),
          }),
        };
      }

      return {
        from: () => ({
          where: () => ({
            limit: async () => ([{ name: 'Fellow F' }]),
          }),
        }),
      };
    },
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: (...a: unknown[]) => {
          if ('remarksClaimedAt' in values) {
            claimUpdate(...a);
            return {
              returning: async () => claimedRows,
            };
          }
          processedUpdate(...a);
          return Promise.resolve();
        },
      }),
    }),
  };

  return { db };
});

beforeEach(() => {
  process.env.BT_INTEGRATION_SECRET = 'sek';
  process.env.REMARKS_CUTOVER = '2026-07-06';
  claimUpdate.mockClear();
  processedUpdate.mockClear();
  processedTargetRows = [];
});

describe('GET /api/admin/remarks', () => {
  it('401s without secret', async () => {
    const { GET } = await import('@/app/api/admin/remarks/route');
    const res = await GET(new Request('http://x/api/admin/remarks'));
    expect(res.status).toBe(401);
  });

  it('dedups to one row per (cycle,fellow,text) with siblings and claims', async () => {
    const { GET } = await import('@/app/api/admin/remarks/route');
    const res = await GET(new Request('http://x/api/admin/remarks', { headers: { authorization: 'Bearer sek' } }));
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].submissionId).toBe('s1');
    expect(body.rows[0].siblingSubmissionIds).toEqual(['s2']);
    expect(claimUpdate).toHaveBeenCalled();
  });
});

describe('POST processed', () => {
  it('401s without secret', async () => {
    const { POST } = await import('@/app/api/admin/remarks/[submissionId]/processed/route');
    const res = await POST(new Request('http://x', { method: 'POST' }), { params: Promise.resolve({ submissionId: 's1' }) });
    expect(res.status).toBe(401);
  });

  it('is a no-op when the submission is gone', async () => {
    const { POST } = await import('@/app/api/admin/remarks/[submissionId]/processed/route');
    const res = await POST(
      new Request('http://x', { method: 'POST', headers: { authorization: 'Bearer sek' } }),
      { params: Promise.resolve({ submissionId: 's1' }) },
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(processedUpdate).not.toHaveBeenCalled();
  });
});
