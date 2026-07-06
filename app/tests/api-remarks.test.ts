import { describe, it, expect, vi, beforeEach } from 'vitest';

const claimUpdate = vi.fn();
const processedUpdate = vi.fn();
let processedTargetRows: Array<{ cycleId: string; fellowRecordId: string; remarks: string | null }> = [];

vi.mock('@/lib/db', () => {
  const candidateRows = [
    { id: 's1', cycleId: 'c1', fellowRecordId: 'recF', remarks: 'X to be removed', projectName: 'X - DDE | Jun 2026', projectType: 'dde', projectRecordId: 'recX', cycleStartDate: '2026-07-13' },
    { id: 's2', cycleId: 'c1', fellowRecordId: 'recF', remarks: 'X to be removed', projectName: 'Y Pitch | Jun 2026', projectType: 'pitch', projectRecordId: 'recY', cycleStartDate: '2026-07-13' },
  ];

  const tx = {
    select: (selection?: Record<string, unknown>) => {
      if (selection && 'id' in selection) {
        return {
          from: () => ({
            innerJoin: () => ({
              where: () => ({
                for: async () => candidateRows,
              }),
            }),
          }),
        };
      }

      if (selection && 'type' in selection) {
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
      set: () => ({
        where: (...a: unknown[]) => {
          claimUpdate(...a);
          return Promise.resolve();
        },
      }),
    }),
  };

  const db = {
    transaction: (cb: (t: typeof tx) => unknown) => cb(tx),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => processedTargetRows,
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: (...a: unknown[]) => {
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
