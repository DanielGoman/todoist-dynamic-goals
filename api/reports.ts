// The list of saved weekly reports. Served at /reports (see vercel.json rewrites).
import { authorize, htmlResponse, unauthorized } from '../lib/auth';
import { renderReportsPage } from '../lib/reports-page';
import { loadAllReports } from '../lib/store';
import { getUser, localDate } from '../lib/todoist';

export async function GET(request: Request): Promise<Response> {
  const { timezone } = await getUser();
  const auth = await authorize(request, localDate(timezone));
  if (!auth.ok) return unauthorized();
  try {
    return htmlResponse(renderReportsPage(await loadAllReports()), auth.setCookie);
  } catch (err) {
    console.error('reports page failed', err);
    return new Response('Could not load the reports.', { status: 500 });
  }
}
