// Manual report: /api/report?key=SETUP_KEY            -> preview (JSON + the message text)
//                /api/report?key=SETUP_KEY&send=1     -> also send it to Telegram
//                &date=YYYY-MM-DD                      -> build it as if run on that day (covers the 7 days before)
import { buildReport, formatReport } from '../lib/report';
import { sendTelegram } from '../lib/telegram';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const key = process.env.SETUP_KEY;
  if (!key || url.searchParams.get('key') !== key) {
    return new Response('Unauthorized', { status: 401 });
  }
  const date = url.searchParams.get('date') || undefined;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response('date must be YYYY-MM-DD', { status: 400 });
  try {
    const report = await buildReport(date);
    const message = formatReport(report);
    const send = url.searchParams.get('send') === '1';
    if (send) await sendTelegram(message);
    return Response.json({ sent: send, message, report });
  } catch (err) {
    return new Response(String(err), { status: 500 });
  }
}
