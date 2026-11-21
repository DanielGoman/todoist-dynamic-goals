// Manual report: /api/report?key=SETUP_KEY            -> preview (JSON: summary text, page link, data)
//                /api/report?key=SETUP_KEY&send=1     -> also send it to Telegram
//                /api/report?key=SETUP_KEY&save=1     -> also save it (shows up in /reports and /trends)
//                &date=YYYY-MM-DD                      -> build it as if run on that day (covers the 7 days before)
// To see the page itself: /report?key=SETUP_KEY (or the signed link this returns).
import { buildReport, formatSummary } from '../lib/report';
import { reportUrl } from '../lib/sign';
import { saveReport } from '../lib/store';
import { getUser, localDate } from '../lib/todoist';
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
    const day = date || localDate((await getUser()).timezone);
    const report = await buildReport(day);
    const message = formatSummary(report);
    const link = await reportUrl(day);
    const send = url.searchParams.get('send') === '1';
    const save = url.searchParams.get('save') === '1';
    if (save) await saveReport(report);
    if (send) await sendTelegram(message, { text: 'Open full report →', url: link });
    return Response.json({ sent: send, saved: save, link, message, report });
  } catch (err) {
    return new Response(String(err), { status: 500 });
  }
}
