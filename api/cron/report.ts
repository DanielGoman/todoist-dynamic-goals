// Weekly report (Vercel Cron, Saturday 04:00 UTC: about 6am Israel time in winter, 7am in summer).
// Saves the report (Vercel Blob), then sends a short Telegram summary with a button to the full report page.
import { buildReport, formatSummary } from '../../lib/report';
import { reportUrl } from '../../lib/sign';
import { saveReport } from '../../lib/store';
import { getUser, localDate } from '../../lib/todoist';
import { sendTelegram } from '../../lib/telegram';

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  try {
    const { timezone } = await getUser();
    const today = localDate(timezone);
    const report = await buildReport(today);
    try {
      await saveReport(report);
    } catch (err) {
      console.error('saving the report failed (sending anyway)', err); // the summary still goes out
    }
    await sendTelegram(formatSummary(report), { text: 'Open full report →', url: await reportUrl(today) });
    console.log('report sent', JSON.stringify({ ...report, tasks: report.tasks.length }));
    return Response.json({ sent: true, tasks: report.tasks.length });
  } catch (err) {
    console.error('report failed', err);
    return new Response('Report failed', { status: 500 });
  }
}
