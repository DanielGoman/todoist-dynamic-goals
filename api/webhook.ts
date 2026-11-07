// Todoist webhook receiver: on any task change, recompute and update the daily goal.
import { recompute } from '../lib/todoist';

const RELEVANT = new Set([
  'item:added',
  'item:updated',
  'item:deleted',
  'item:completed',
  'item:uncompleted',
]);

async function hmacBase64(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return Buffer.from(sig).toString('base64');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.TODOIST_CLIENT_SECRET;
  if (!secret) return new Response('TODOIST_CLIENT_SECRET not set', { status: 500 });

  // Verify Todoist's signature over the raw body.
  const raw = await request.text();
  const received = request.headers.get('x-todoist-hmac-sha256') || '';
  if (!safeEqual(received, await hmacBase64(secret, raw))) {
    return new Response('Bad signature', { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }

  if (!RELEVANT.has(event.event_name)) {
    return Response.json({ ignored: event.event_name });
  }
  const onlyUser = process.env.TODOIST_USER_ID;
  if (onlyUser && String(event.user_id) !== onlyUser) {
    return Response.json({ ignored: 'other user' });
  }

  try {
    const result = await recompute();
    console.log(event.event_name, JSON.stringify(result));
    return Response.json(result);
  } catch (err) {
    console.error('recompute failed', err);
    // Non-2xx makes Todoist retry the delivery.
    return new Response('Recompute failed', { status: 500 });
  }
}
