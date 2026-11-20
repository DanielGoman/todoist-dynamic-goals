// Signed report links: /report?d=YYYY-MM-DD&s=<sig>. The signature proves the link came from us,
// so the Telegram message never has to carry SETUP_KEY. Links stop working after LINK_DAYS.
const LINK_DAYS = 30;

async function hmac(message: string): Promise<string> {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error('CRON_SECRET is not set');
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Buffer.from(sig).toString('base64url').slice(0, 32);
}

export function signReportDate(date: string): Promise<string> {
  return hmac(`weekly-report:${date}`);
}

export async function verifyReportLink(date: string, sig: string, today: string): Promise<boolean> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !sig) return false;
  const ageDays = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000;
  if (ageDays < 0 || ageDays > LINK_DAYS) return false;
  const expected = await hmac(`weekly-report:${date}`);
  if (expected.length !== sig.length) return false;
  let r = 0;
  for (let i = 0; i < sig.length; i++) r |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return r === 0;
}

/** Public base URL of the production deployment. */
export function baseUrl(): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!host) throw new Error('Set PUBLIC_URL (VERCEL_PROJECT_PRODUCTION_URL is missing)');
  return `https://${host}`;
}

export async function reportUrl(date: string): Promise<string> {
  return `${baseUrl()}/report?d=${date}&s=${await signReportDate(date)}`;
}
