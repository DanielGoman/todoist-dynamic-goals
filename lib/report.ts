// Weekly report: what got done, and which tasks slipped (overdue or postponed) and by how much.
import {
  addDays,
  api,
  dueToLocal,
  fetchCompletedItems,
  fetchOpenTasks,
  getUser,
  localDate,
  localMidnightUtc,
} from './todoist';

// ---------- activity log ----------

type Activity = {
  taskId: string;
  type: 'added' | 'updated' | 'completed';
  at: number;
  /** Local due date after the event (null = no due date). undefined = the event didn't touch the due date. */
  due?: string | null;
  /** Local due date before the event. Only set on updates that changed the due date. */
  lastDue?: string | null;
};

async function fetchActivities(eventType: Activity['type'], tz: string): Promise<Activity[]> {
  const out: Activity[] = [];
  let cursor: string | null = null;
  // Safety cap: 50 pages x 100 events is far more than a week's history.
  for (let page = 0; page < 50; page++) {
    const params = new URLSearchParams({ object_type: 'item', event_type: eventType, limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const res = await api(`/activities?${params}`);
    for (const e of res.results || res.events || []) {
      const x = e.extra_data || e.extraData || {};
      const dueRaw = x.due_date ?? x.dueDate;
      const lastRaw = x.last_due_date ?? x.lastDueDate;
      const hasLast = 'last_due_date' in x || 'lastDueDate' in x;
      out.push({
        taskId: String(e.object_id ?? e.objectId),
        type: eventType,
        at: Date.parse(e.event_date ?? e.eventDate),
        due: dueRaw ? dueToLocal(String(dueRaw), tz) : dueRaw === null || hasLast ? null : undefined,
        lastDue: hasLast ? (lastRaw ? dueToLocal(String(lastRaw), tz) : null) : undefined,
      });
    }
    cursor = res.next_cursor || res.nextCursor || null;
    if (!cursor) break;
  }
  return out;
}

// ---------- the report ----------

export type SlippedTask = {
  id: string;
  content: string;
  /** Due date the task had when it was created (or the earliest one the history still shows). */
  originalDue: string;
  currentDue: string;
  postponed: number;
  daysLate: number;
  overdue: boolean;
  /** The activity log doesn't reach back to this task's creation, so the numbers are a minimum. */
  partialHistory: boolean;
};

export type Report = {
  timezone: string;
  /** First and last day covered (the 7 days before the report day). */
  from: string;
  to: string;
  completed: number;
  /** Still open, originally due within the week. */
  openFromWeek: number;
  /** Still open, originally due within the week or earlier. */
  openTotal: number;
  overdue: number;
  postponedOut: number;
  tasks: SlippedTask[];
  historyFrom: string | null;
};

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * Builds the report for the 7 days before `reportDay` (default: today, local).
 *
 * A task is listed when it's still open and its original due date is before the report day:
 * that covers tasks overdue now and tasks you postponed past the end of the week.
 * "Original" is the due date at creation. For recurring tasks it's the current occurrence's
 * date before any postponing; completing an occurrence starts the count fresh.
 */
export async function buildReport(reportDay?: string): Promise<Report> {
  const user = await getUser();
  const tz = user.timezone;
  const today = reportDay || localDate(tz);
  const from = addDays(today, -7);
  const to = addDays(today, -1);

  const [open, completedItems, added, updated, completedEvents] = await Promise.all([
    fetchOpenTasks(),
    fetchCompletedItems(localMidnightUtc(from, tz), localMidnightUtc(today, tz)),
    fetchActivities('added', tz),
    fetchActivities('updated', tz),
    fetchActivities('completed', tz),
  ]);

  const all = [...added, ...updated, ...completedEvents];
  const oldestEvent = all.length ? Math.min(...all.map((e) => e.at)) : null;
  const byTask = new Map<string, Activity[]>();
  for (const e of all) {
    if (!byTask.has(e.taskId)) byTask.set(e.taskId, []);
    byTask.get(e.taskId)!.push(e);
  }

  const openIds = new Set(open.map((t) => String(t.id)));
  // Same rule as the goal: a non-recurring task that's open again isn't really completed.
  const recurringIds = new Set(open.filter((t) => t.due?.is_recurring).map((t) => String(t.id)));
  const completed = completedItems.filter((c) => !openIds.has(c.taskId) || recurringIds.has(c.taskId)).length;

  const tasks: SlippedTask[] = [];
  for (const t of open) {
    if (!t.due?.date) continue;
    const id = String(t.id);
    const recurring = !!t.due.is_recurring;
    const currentDue = dueToLocal(String(t.due.date), tz);
    const events = (byTask.get(id) || []).sort((a, b) => a.at - b.at);
    const completions = events.filter((e) => e.type === 'completed').map((e) => e.at);

    let baseline: string | null = null;
    let postponed = 0;
    for (const e of events) {
      if (e.type === 'added') {
        if (e.due) baseline = e.due;
      } else if (e.type === 'completed') {
        // A recurring task jumps to its next occurrence: start that occurrence fresh.
        if (recurring) {
          baseline = null;
          postponed = 0;
        }
      } else if (e.lastDue !== undefined) {
        // Completing a recurring task also logs a due-date change; that's not a postponement.
        if (recurring && completions.some((c) => Math.abs(c - e.at) < 120_000)) continue;
        if (baseline === null && e.lastDue) baseline = e.lastDue;
        if (e.due && e.lastDue && e.due > e.lastDue) postponed++;
      }
    }
    baseline ??= currentDue;
    if (baseline >= today) continue;

    const createdAt = Date.parse(t.added_at ?? t.created_at ?? '');
    const hasAdded = events.some((e) => e.type === 'added');
    tasks.push({
      id,
      content: String(t.content),
      originalDue: baseline,
      currentDue,
      postponed,
      daysLate: daysBetween(baseline, today),
      overdue: currentDue < today,
      partialHistory: !hasAdded && !(oldestEvent !== null && createdAt >= oldestEvent),
    });
  }
  tasks.sort((a, b) => b.daysLate - a.daysLate || b.postponed - a.postponed);

  return {
    timezone: tz,
    from,
    to,
    completed,
    openFromWeek: tasks.filter((t) => t.originalDue >= from).length,
    openTotal: tasks.length,
    overdue: tasks.filter((t) => t.overdue).length,
    postponedOut: tasks.filter((t) => !t.overdue).length,
    tasks,
    historyFrom: oldestEvent ? localDate(tz, new Date(oldestEvent)) : null,
  };
}

// ---------- Telegram summary ----------
// English only: task titles (often Hebrew) live on the web page, where each one gets its own
// text direction. Mixing directions inside a Telegram message is what scrambled the layout.

const dm = (ymd: string) => `${+ymd.slice(8, 10)}.${+ymd.slice(5, 7)}`;

export function formatSummary(r: Report): string {
  const planned = r.completed + r.openFromWeek;
  const rate = planned ? Math.round((r.completed / planned) * 100) : 100;
  const lines = [
    `📊 <b>Weekly report · ${dm(r.from)}–${dm(r.to)}</b>`,
    '',
    `✅ Completed  <b>${r.completed}</b>  (${rate}% of this week's plan)`,
    `⏳ Open from this week  <b>${r.openFromWeek}</b>`,
    `🔴 Overdue now  <b>${r.overdue}</b>`,
    `➡️ Postponed past the week  <b>${r.postponedOut}</b>`,
  ];
  if (!r.tasks.length) lines.push('', 'Nothing slipped. 🎉');
  return lines.join('\n');
}
