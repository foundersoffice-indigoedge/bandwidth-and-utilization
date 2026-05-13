import { describe, it, expect, vi } from 'vitest';

// Mock db at top level to avoid real connection
vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  },
}));

vi.mock('../src/lib/signoff', () => ({
  confirmSignoff: vi.fn().mockResolvedValue({ confirmed: false }),
  submitFlags: vi.fn(),
  transitionToFlaggedResolved: vi.fn(),
}));

vi.mock('../src/lib/cycle', () => ({
  checkAndFinalizeCycle: vi.fn().mockResolvedValue(undefined),
}));

// These tests are smoke tests for endpoint shape; integration is verified in dev manually
// against a preview deployment with seeded data (mirrors the api-pending-projects.test.ts style).

describe('POST /api/signoff/confirm', () => {
  it('rejects missing token with 400', async () => {
    const { POST } = await import('../src/app/api/signoff/confirm/route');
    const req = new Request('http://localhost/api/signoff/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects unknown token with 409', async () => {
    const { POST } = await import('../src/app/api/signoff/confirm/route');
    const req = new Request('http://localhost/api/signoff/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'bad-token' }),
    });
    const res = await POST(req);
    expect([404, 409]).toContain(res.status);
  });
});
