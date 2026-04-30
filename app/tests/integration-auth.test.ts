import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isAuthorizedIntegrationRequest } from '../src/lib/integration-auth';

describe('isAuthorizedIntegrationRequest', () => {
  const ORIGINAL_SECRET = process.env.BT_INTEGRATION_SECRET;

  beforeEach(() => {
    process.env.BT_INTEGRATION_SECRET = 'test-secret-123';
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.BT_INTEGRATION_SECRET;
    else process.env.BT_INTEGRATION_SECRET = ORIGINAL_SECRET;
  });

  it('accepts a request with the correct bearer token', () => {
    const req = new Request('http://x', { headers: { authorization: 'Bearer test-secret-123' } });
    expect(isAuthorizedIntegrationRequest(req)).toBe(true);
  });

  it('rejects a request with the wrong token', () => {
    const req = new Request('http://x', { headers: { authorization: 'Bearer wrong' } });
    expect(isAuthorizedIntegrationRequest(req)).toBe(false);
  });

  it('rejects a request with no Authorization header', () => {
    const req = new Request('http://x');
    expect(isAuthorizedIntegrationRequest(req)).toBe(false);
  });

  it('rejects a request when BT_INTEGRATION_SECRET is unset', () => {
    delete process.env.BT_INTEGRATION_SECRET;
    const req = new Request('http://x', { headers: { authorization: 'Bearer test-secret-123' } });
    expect(isAuthorizedIntegrationRequest(req)).toBe(false);
  });

  it('rejects a request with malformed scheme', () => {
    const req = new Request('http://x', { headers: { authorization: 'test-secret-123' } });
    expect(isAuthorizedIntegrationRequest(req)).toBe(false);
  });
});
