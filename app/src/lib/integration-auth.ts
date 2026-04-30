export function isAuthorizedIntegrationRequest(req: Request): boolean {
  const secret = process.env.BT_INTEGRATION_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization');
  if (!header) return false;
  return header === `Bearer ${secret}`;
}
