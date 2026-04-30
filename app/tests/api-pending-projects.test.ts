import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSelect = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ orderBy: mockSelect }) }), where: () => ({ orderBy: mockSelect, limit: mockSelect }) }) }),
    update: () => ({ set: () => ({ where: mockUpdate }) }),
  },
}));

import { GET as getPending } from '../src/app/api/admin/pending-projects/route';
import { GET as getAwaiting } from '../src/app/api/admin/pending-projects/awaiting-setup/route';
import { POST as postAwaitingSetup } from '../src/app/api/admin/pending-projects/[id]/awaiting-setup/route';
import { POST as postFinish } from '../src/app/api/admin/pending-projects/[id]/finish/route';

const SECRET = 'test-secret-xyz';
beforeEach(() => {
  process.env.BT_INTEGRATION_SECRET = SECRET;
  mockSelect.mockReset();
  mockUpdate.mockReset();
});

const auth = { headers: { authorization: `Bearer ${SECRET}` } };

describe('GET /api/admin/pending-projects', () => {
  it('returns 401 without auth', async () => {
    const res = await getPending(new Request('http://x'));
    expect(res.status).toBe(401);
  });

  it('returns rows with auth', async () => {
    mockSelect.mockResolvedValueOnce([{ id: 'u1', type: 'dde', name: 'TestCo' }]);
    const res = await getPending(new Request('http://x', auth));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
  });
});

describe('POST awaiting-setup', () => {
  const params = Promise.resolve({ id: 'u1' });

  it('returns 401 without auth', async () => {
    const res = await postAwaitingSetup(new Request('http://x', { method: 'POST' }), { params });
    expect(res.status).toBe(401);
  });

  it('returns 400 without airtableRecordId', async () => {
    const res = await postAwaitingSetup(
      new Request('http://x', { method: 'POST', headers: auth.headers, body: JSON.stringify({}) }),
      { params }
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when row missing', async () => {
    mockSelect.mockResolvedValueOnce([]);
    const res = await postAwaitingSetup(
      new Request('http://x', { method: 'POST', headers: auth.headers, body: JSON.stringify({ airtableRecordId: 'recA' }) }),
      { params }
    );
    expect(res.status).toBe(404);
  });

  it('transitions pending -> awaiting_setup', async () => {
    mockSelect.mockResolvedValueOnce([{ id: 'u1', status: 'pending', airtableRecordId: null }]);
    const res = await postAwaitingSetup(
      new Request('http://x', { method: 'POST', headers: auth.headers, body: JSON.stringify({ airtableRecordId: 'recA' }) }),
      { params }
    );
    expect(res.status).toBe(200);
  });

  it('is idempotent for same airtableRecordId', async () => {
    mockSelect.mockResolvedValueOnce([{ id: 'u1', status: 'awaiting_setup', airtableRecordId: 'recA' }]);
    const res = await postAwaitingSetup(
      new Request('http://x', { method: 'POST', headers: auth.headers, body: JSON.stringify({ airtableRecordId: 'recA' }) }),
      { params }
    );
    expect(res.status).toBe(200);
  });

  it('returns 409 on different airtableRecordId', async () => {
    mockSelect.mockResolvedValueOnce([{ id: 'u1', status: 'awaiting_setup', airtableRecordId: 'recA' }]);
    const res = await postAwaitingSetup(
      new Request('http://x', { method: 'POST', headers: auth.headers, body: JSON.stringify({ airtableRecordId: 'recB' }) }),
      { params }
    );
    expect(res.status).toBe(409);
  });
});

describe('POST finish', () => {
  const params = Promise.resolve({ id: 'u1' });

  it('returns 400 on bad resolution', async () => {
    const res = await postFinish(
      new Request('http://x', { method: 'POST', headers: auth.headers, body: JSON.stringify({ resolution: 'wat' }) }),
      { params }
    );
    expect(res.status).toBe(400);
  });

  it('transitions awaiting_setup -> finished with completed', async () => {
    mockSelect.mockResolvedValueOnce([{ id: 'u1', status: 'awaiting_setup' }]);
    const res = await postFinish(
      new Request('http://x', { method: 'POST', headers: auth.headers, body: JSON.stringify({ resolution: 'completed' }) }),
      { params }
    );
    expect(res.status).toBe(200);
  });

  it('is idempotent for same resolution', async () => {
    mockSelect.mockResolvedValueOnce([{ id: 'u1', status: 'finished', resolution: 'completed' }]);
    const res = await postFinish(
      new Request('http://x', { method: 'POST', headers: auth.headers, body: JSON.stringify({ resolution: 'completed' }) }),
      { params }
    );
    expect(res.status).toBe(200);
  });

  it('returns 409 on conflicting resolution', async () => {
    mockSelect.mockResolvedValueOnce([{ id: 'u1', status: 'finished', resolution: 'completed' }]);
    const res = await postFinish(
      new Request('http://x', { method: 'POST', headers: auth.headers, body: JSON.stringify({ resolution: 'rejected' }) }),
      { params }
    );
    expect(res.status).toBe(409);
  });

  it('returns 409 from pending', async () => {
    mockSelect.mockResolvedValueOnce([{ id: 'u1', status: 'pending' }]);
    const res = await postFinish(
      new Request('http://x', { method: 'POST', headers: auth.headers, body: JSON.stringify({ resolution: 'completed' }) }),
      { params }
    );
    expect(res.status).toBe(409);
  });
});

describe('GET awaiting-setup', () => {
  it('returns 401 without auth', async () => {
    const res = await getAwaiting(new Request('http://x'));
    expect(res.status).toBe(401);
  });

  it('returns rows', async () => {
    mockSelect.mockResolvedValueOnce([{ id: 'u1', airtableRecordId: 'recA' }]);
    const res = await getAwaiting(new Request('http://x', auth));
    expect(res.status).toBe(200);
  });
});
