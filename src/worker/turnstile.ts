// Cloudflare Turnstile verification.
// Missing secret: allow and warn (local-only in production terms — deploys inject the secret).

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile(
	token: string,
	secret: string | undefined,
	remoteIp?: string,
): Promise<boolean> {
	if (!secret) {
		console.warn('[turnstile] secret 未配置，放行');
		return true;
	}
	if (!token) return false;
	try {
		const body = new URLSearchParams({ secret, response: token });
		if (remoteIp) body.set('remoteip', remoteIp);
		const res = await fetch(VERIFY_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body,
		});
		if (!res.ok) return false;
		const json = (await res.json()) as { success?: boolean };
		return json.success === true;
	} catch {
		return false;
	}
}
