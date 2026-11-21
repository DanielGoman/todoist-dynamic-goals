// Weekly report: what got done, and which tasks slipped (overdue or postponed) and by how much.
import {
  addDays,
  api,
  dueToLocal,
  countedCompletions,
  fetchCompletions,
  fetchOpenTasks,
  fetchUncompletions,
  getUser,
  localDate,
  localMidnightUtc,
} from './todoist';

// ---------- activity log ----------

type Activity = {
  taskId: string;
  type: 'added' | 'updated' | 'completed';
  at: number;
  initiator: string;
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
        initiator: String(e.initiator_id ?? e.initiatorId ?? ''),
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
  /** The day the report was built for (the day after `to`). */
  reportDate: string;
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
  /** Completed during the week after being postponed at least once. */
  completedLate: CompletedLateTask[];
  historyFrom: string | null;
  /** Week-level numbers for comparisons and trends (fixed when the report is saved). */
  metrics: WeekMetrics;
};

export type WeekMetrics = {
  /** Tasks planned for the week: completed + still open from the week. */
  planned: number;
  completed: number;
  /** Completed out of planned, 0-100. */
  completionRate: number;
  notCompleted: number;
  overdue: number;
  postponedOut: number;
  completedLate: number;
  /** Times a due date was pushed later, across this week's slipped and late-completed tasks. */
  postponements: number;
  /**
   * Days slipped: for tasks originally due this week, days past the original due date
   * (until completion, or until the report day if still open).
   */
  daysSlipped: number;
  /** Tasks you created during the week. */
  added: number;
};

export type CompletedLateTask = {
  id: string;
  content: string;
  originalDue: string;
  completedOn: string;
  postponed: number;
  /** Days between the original due date and the day it was completed (0 if on time). */
  daysLate: number;
  partialHistory: boolean;
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

  const [open, completionEvents, undoEvents, added, updated, completedEvents] = await Promise.all([
    fetchOpenTasks(),
    fetchCompletions(localMidnightUtc(from, tz), localMidnightUtc(today, tz), user.id, tz),
    fetchUncompletions(localMidnightUtc(from, tz), localMidnightUtc(today, tz), user.id, tz),
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

  // Same counting rules as the daily/weekly goal (recurring occurrences count, undone ones don't).
  const openState = new Map(
    open.map((t) => [
      String(t.id),
      {
        due: t.due?.date ? dueToLocal(String(t.due.date), tz) : null,
        recurring: !!t.due?.is_recurring,
        parentId: t.parent_id ? String(t.parent_id) : null,
      },
    ]),
  );
  const { counted } = countedCompletions(completionEvents, openState, undoEvents);
  const completed = counted.length;

  const eventsOf = (id: string) => (byTask.get(id) || []).sort((a, b) => a.at - b.at);
  const isPartial = (events: Activity[], createdAtRaw: unknown) => {
    const createdAt = Date.parse(String(createdAtRaw ?? ''));
    return !events.some((e) => e.type === 'added') && !(oldestEvent !== null && createdAt >= oldestEvent);
  };

  const tasks: SlippedTask[] = [];
  for (const t of open) {
    if (!t.due?.date) continue;
    const id = String(t.id);
    const currentDue = dueToLocal(String(t.due.date), tz);
    const events = eventsOf(id);
    const h = traceHistory(events, !!t.due.is_recurring);
    const baseline = h.baseline ?? currentDue;
    if (baseline >= today) continue;

    tasks.push({
      id,
      content: String(t.content),
      originalDue: baseline,
      currentDue,
      postponed: h.postponed,
      daysLate: daysBetween(baseline, today),
      overdue: currentDue < today,
      partialHistory: isPartial(events, t.added_at ?? t.created_at),
    });
  }
  tasks.sort((a, b) => b.daysLate - a.daysLate || b.postponed - a.postponed);

  // Tasks completed this week that had been postponed at least once along the way.
  const completedLate: CompletedLateTask[] = [];
  for (const c of counted) {
    const events = eventsOf(c.taskId);
    const h = traceHistory(events, c.recurring, Date.parse(c.completedAt));
    if (!h.postponed || !h.baseline) continue;
    const completedOn = localDate(tz, new Date(c.completedAt));
    completedLate.push({
      id: c.taskId,
      content: c.content,
      originalDue: h.baseline,
      completedOn,
      postponed: h.postponed,
      daysLate: Math.max(0, daysBetween(h.baseline, completedOn)),
      partialHistory: isPartial(events, c.addedAt),
    });
  }
  completedLate.sort((a, b) => b.postponed - a.postponed || b.daysLate - a.daysLate);

  const fromWeek = tasks.filter((t) => t.originalDue >= from);
  const lateThisWeek = completedLate.filter((t) => t.originalDue >= from);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const planned = completed + fromWeek.length;
  const weekStartMs = localMidnightUtc(from, tz).getTime();
  const weekEndMs = localMidnightUtc(today, tz).getTime();
  const metrics: WeekMetrics = {
    planned,
    completed,
    completionRate: planned ? Math.round((completed / planned) * 100) : 100,
    notCompleted: fromWeek.length,
    overdue: tasks.filter((t) => t.overdue).length,
    postponedOut: tasks.filter((t) => !t.overdue).length,
    completedLate: completedLate.length,
    postponements: sum(fromWeek.map((t) => t.postponed)) + sum(lateThisWeek.map((t) => t.postponed)),
    daysSlipped: sum(fromWeek.map((t) => t.daysLate)) + sum(lateThisWeek.map((t) => t.daysLate)),
    added: added.filter((e) => e.at >= weekStartMs && e.at < weekEndMs && (!user.id || !e.initiator || e.initiator === user.id)).length,
  };

  return {
    timezone: tz,
    reportDate: today,
    metrics,
    from,
    to,
    completed,
    openFromWeek: tasks.filter((t) => t.originalDue >= from).length,
    openTotal: tasks.length,
    overdue: tasks.filter((t) => t.overdue).length,
    postponedOut: tasks.filter((t) => !t.overdue).length,
    tasks,
    completedLate,
    historyFrom: oldestEvent ? localDate(tz, new Date(oldestEvent)) : null,
  };
}

/**
 * Walks a task's activity history (sorted by time) and returns its original due date and how
 * many times the due date was pushed later.
 * - The original due date is the one given at creation, or the earliest one the history shows.
 * - Moving a task to an earlier date doesn't count as a postponement.
 * - Recurring tasks: completing an occurrence starts the next one fresh, and the automatic
 *   date jump that comes with a completion isn't a postponement.
 * - `until` (a completion time) stops the walk at that completion, for completed tasks.
 */
function traceHistory(
  events: Activity[],
  recurring: boolean,
  until?: number,
): { baseline: string | null; postponed: number } {
  const NEAR = 120_000;
  const completions = events.filter((e) => e.type === 'completed').map((e) => e.at);
  let baseline: string | null = null;
  let postponed = 0;
  for (const e of events) {
    if (until !== undefined && e.at > until + NEAR) break;
    if (e.type === 'added') {
      if (e.due) baseline = e.due;
    } else if (e.type === 'completed') {
      if (until !== undefined && Math.abs(e.at - until) < NEAR) break; // the completion we're measuring
      if (recurring) {
        baseline = null;
        postponed = 0;
      }
    } else if (e.lastDue !== undefined) {
      if (recurring && completions.some((c) => Math.abs(c - e.at) < NEAR)) continue;
      if (baseline === null && e.lastDue) baseline = e.lastDue;
      if (e.due && e.lastDue && e.due > e.lastDue) postponed++;
    }
  }
  return { baseline, postponed };
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
    `🔁 Completed after postponing  <b>${r.completedLate.length}</b>`,
  ];
  if (!r.tasks.length) lines.push('', 'Nothing slipped. 🎉');
  return lines.join('\n');
}
