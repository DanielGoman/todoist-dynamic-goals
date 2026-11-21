// Who may see the report pages: anyone holding a valid signed report link (from Telegram),
// the SETUP_KEY, or a session cookie that one of those set. The cookie lets you move between
// the report, the list of reports and the trends page without new links. It lasts 30 days.
import { hmac, verifyReportLink } from './sign';

const COOKIE = 'tdg_session';
const SESSION_DAYS = 30;

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function validSession(value: string | null): Promise<boolean> {
  if (!value) return false;
  const [exp, sig] = value.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmac(`session:${exp}`));
}

async function newSessionCookie(): Promise<string> {
  const exp = Date.now() + SESSION_DAYS * 86_400_000;
  const value = `${exp}.${await hmac(`session:${exp}`)}`;
  return `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86_400}`;
}

/**
 * Checks access. `setCookie` is returned when the visitor came in with a link or the key,
 * so the response can start (or renew) their session.
 */
export async function authorize(
  request: Request,
  today: string,
): Promise<{ ok: boolean; setCookie?: string }> {
  const url = new URL(request.url);
  const key = process.env.SETUP_KEY;
  const d = url.searchParams.get('d');
  const viaKey = !!key && url.searchParams.get('key') === key;
  const viaLink = !!d && (await verifyReportLink(d, url.searchParams.get('s') || '', today));
  if (viaKey || viaLink) return { ok: true, setCookie: await newSessionCookie() };
  if (await validSession(readCookie(request, COOKIE))) return { ok: true };
  return { ok: false };
}

export function htmlResponse(html: string, setCookie?: string, status = 200): Response {
  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex',
    'Referrer-Policy': 'no-referrer',
  });
  if (setCookie) headers.append('Set-Cookie', setCookie);
  return new Response(html, { status, headers });
}

export const unauthorized = () =>
  new Response('This link is invalid or has expired. Open the latest report from Telegram.', { status: 401 });
