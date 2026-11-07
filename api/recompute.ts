// Manual trigger for testing: /api/recompute?key=SETUP_KEY  (add &reset=1 to start both the day and week goals fresh)
import { recompute } from '../lib/todoist';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const key = process.env.SETUP_KEY;
  if (!key || url.searchParams.get('key') !== key) {
    return new Response('Unauthorized', { status: 401 });
  }
  try {
    return Response.json(await recompute(url.searchParams.get('reset') === '1' ? { resetDay: true, resetWeek: true } : {}));
  } catch (err) {
    return new Response(String(err), { status: 500 });
  }
}
