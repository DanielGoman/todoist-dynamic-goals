// One-time: authorize your own Todoist app so its webhooks start firing for your account.
// Visit /api/oauth/start?key=SETUP_KEY
export function GET(request: Request): Response {
  const url = new URL(request.url);
  const key = process.env.SETUP_KEY;
  if (!key || url.searchParams.get('key') !== key) {
    return new Response('Unauthorized', { status: 401 });
  }
  const clientId = process.env.TODOIST_CLIENT_ID;
  if (!clientId) return new Response('TODOIST_CLIENT_ID not set', { status: 500 });

  const state = crypto.randomUUID();
  const auth = new URL('https://app.todoist.com/oauth/authorize');
  auth.searchParams.set('client_id', clientId);
  auth.searchParams.set('scope', 'data:read');
  auth.searchParams.set('state', state);
  auth.searchParams.set('response_type', 'code');

  return new Response(null, {
    status: 302,
    headers: {
      Location: auth.toString(),
      'Set-Cookie': `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/api/oauth; Max-Age=600`,
    },
  });
}
