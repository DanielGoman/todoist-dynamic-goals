// The weekly report page. Served at /report (see vercel.json rewrites).
//   /report?d=YYYY-MM-DD&s=<sig>          signed link from the Telegram message (valid 30 days)
//   /report?key=SETUP_KEY[&d=YYYY-MM-DD]  manual view (d defaults to today)
// The page is built live, so open tasks reflect their state when you view it.
import { buildReport } from '../lib/report';
import { renderReportPage } from '../lib/report-page';
import { verifyReportLink } from '../lib/sign';
import { getUser, localDate } from '../lib/todoist';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { timezone } = await getUser();
  const today = localDate(timezone);
  const d = url.searchParams.get('d') || undefined;
  if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return new Response('Bad date', { status: 400 });

  const key = process.env.SETUP_KEY;
  const byKey = !!key && url.searchParams.get('key') === key;
  const bySig = !!d && (await verifyReportLink(d, url.searchParams.get('s') || '', today));
  if (!byKey && !bySig) {
    return new Response('This report link is invalid or has expired.', { status: 401 });
  }

  try {
    const report = await buildReport(d);
    return new Response(renderReportPage(report, new Date()), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex',
      },
    });
  } catch (err) {
    console.error('report page failed', err);
    return new Response('Could not build the report.', { status: 500 });
  }
}
