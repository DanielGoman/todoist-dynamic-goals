// Weekly report (Vercel Cron, Saturday). Two cron entries cover 6am in both winter (UTC+2) and
// summer (UTC+3) time; whichever run lands in the 6 o'clock hour locally sends, the other skips.
// Sends a short Telegram summary with a button to the full report page.
import { buildReport, formatSummary } from '../../lib/report';
import { reportUrl } from '../../lib/sign';
import { getUser, localDate } from '../../lib/todoist';
import { sendTelegram } from '../../lib/telegram';

const SEND_HOUR = 6;

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  try {
    const { timezone } = await getUser();
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(new Date()),
    );
    if (hour !== SEND_HOUR) return Response.json({ skipped: `local hour is ${hour}` });

    const today = localDate(timezone);
    const report = await buildReport(today);
    await sendTelegram(formatSummary(report), { text: 'Open full report →', url: await reportUrl(today) });
    console.log('report sent', JSON.stringify({ ...report, tasks: report.tasks.length }));
    return Response.json({ sent: true, tasks: report.tasks.length });
  } catch (err) {
    console.error('report failed', err);
    return new Response('Report failed', { status: 500 });
  }
}
