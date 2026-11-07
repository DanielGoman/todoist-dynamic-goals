// Daily reset (Vercel Cron, ~00:05 Israel time): start the day fresh, and the week too on its first day.
import { recompute } from '../../lib/todoist';

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  try {
    const result = await recompute({ resetDay: true, resetWeek: 'auto' });
    console.log('reset', JSON.stringify(result));
    return Response.json(result);
  } catch (err) {
    console.error('reset failed', err);
    return new Response('Reset failed', { status: 500 });
  }
}
