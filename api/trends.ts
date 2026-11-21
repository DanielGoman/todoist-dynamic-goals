// The trends across all saved reports. Served at /trends (see vercel.json rewrites).
import { authorize, htmlResponse, unauthorized } from '../lib/auth';
import { renderTrendsPage } from '../lib/trends-page';
import { loadAllReports } from '../lib/store';
import { getUser, localDate } from '../lib/todoist';

export async function GET(request: Request): Promise<Response> {
  const { timezone } = await getUser();
  const auth = await authorize(request, localDate(timezone));
  if (!auth.ok) return unauthorized();
  try {
    return htmlResponse(renderTrendsPage(await loadAllReports()), auth.setCookie);
  } catch (err) {
    console.error('trends page failed', err);
    return new Response('Could not load the trends.', { status: 500 });
  }
}
