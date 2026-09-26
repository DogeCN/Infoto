// Cloudflare Turnstile token verification. A missing secret fails closed: the request
// is rejected rather than waved through.

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const VERIFY_TIMEOUT_MS = 5_000;

export async function verifyTurnstile(
  token: string,
  secret: string | undefined,
  remoteIp?: string,
): Promise<boolean> {
  if (!secret) return false;
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch (e) {
    console.error('[turnstile] verification failed', e);
    return false;
  }
}
