// The weekly report page. Served at /report (see vercel.json rewrites).
//   /report                         latest saved report (or a live one if none is saved yet)
//   /report?d=YYYY-MM-DD            the report saved on that day; built live if it was never saved
//   + &s=<sig> (signed Telegram link) or &key=SETUP_KEY the first time; after that a session cookie.
import { authorize, htmlResponse, unauthorized } from '../lib/auth';
import { buildReport, type Report } from '../lib/report';
import { renderReportPage } from '../lib/report-page';
import { listReportDates, loadReport } from '../lib/store';
import { getUser, localDate } from '../lib/todoist';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { timezone } = await getUser();
  const today = localDate(timezone);
  const d = url.searchParams.get('d') || undefined;
  if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return new Response('Bad date', { status: 400 });

  const auth = await authorize(request, today);
  if (!auth.ok) return unauthorized();

  try {
    const dates = await listReportDates();
    const date = d || dates[dates.length - 1] || today;
    const stored = dates.includes(date) ? await loadReport(date) : null;
    const report = stored?.report ?? (await buildReport(date));

    // Neighbours among the saved weeks (a live report sits after every earlier saved one).
    const olderDate = [...dates].reverse().find((x) => x < date);
    const newerDate = dates.find((x) => x > date);
    const [older, newer] = await Promise.all([
      olderDate ? loadReport(olderDate) : null,
      newerDate ? loadReport(newerDate) : null,
    ]);
    // Changes are vs the previous saved report, unless it is more than a couple of weeks back.
    const prev: Report | null = older && older.report.to >= addDay(report.from, -14) ? older.report : null;

    const html = renderReportPage(report, new Date(), {
      prev,
      older: older?.report ?? null,
      newer: newer?.report ?? null,
      savedAt: stored?.savedAt ?? null,
    });
    return htmlResponse(html, auth.setCookie);
  } catch (err) {
    console.error('report page failed', err);
    return new Response('Could not build the report.', { status: 500 });
  }
}

const addDay = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
