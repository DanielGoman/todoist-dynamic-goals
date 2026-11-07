// OAuth redirect target. Completing the exchange activates webhooks for your account.
// The access token itself isn't stored: the app uses your personal API token instead.
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieState = /(?:^|;\s*)oauth_state=([^;]+)/.exec(request.headers.get('cookie') || '')?.[1];

  if (url.searchParams.get('error')) {
    return html(`Authorization was declined: ${escapeHtml(url.searchParams.get('error') || '')}`, 400);
  }
  if (!code || !state || state !== cookieState) {
    return html('Invalid or expired state. Start again from /api/oauth/start.', 400);
  }

  const res = await fetch('https://api.todoist.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.TODOIST_CLIENT_ID || '',
      client_secret: process.env.TODOIST_CLIENT_SECRET || '',
      code,
    }).toString(),
  });
  if (!res.ok) {
    return html(`Token exchange failed (${res.status}): ${escapeHtml(await res.text())}`, 502);
  }

  return html('Done. Webhooks are now active for your account. You can close this tab.', 200, {
    'Set-Cookie': 'oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/oauth; Max-Age=0',
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function html(message: string, status: number, headers: Record<string, string> = {}): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Todoist dynamic goal</title><p style="font-family:sans-serif">${message}</p>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers } },
  );
}
