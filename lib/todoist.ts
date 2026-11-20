// Shared Todoist logic: read this day's/week's numbers and set the daily + weekly goals.
// Uses your personal API token (never expires) for all reads/writes.

const API = 'https://api.todoist.com/api/v1';

function token(): string {
  const t = process.env.TODOIST_API_TOKEN;
  if (!t) throw new Error('TODOIST_API_TOKEN is not set');
  return t;
}

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token()}`, ...(init.headers || {}) },
  });
  if (!res.ok) {
    throw new Error(`Todoist ${init.method || 'GET'} ${path} -> ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

function sync(body: Record<string, string>): Promise<any> {
  return api('/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
}

// ---------- date helpers (all dates are YYYY-MM-DD in the user's timezone) ----------

export function localDate(tz: string, d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday: 1 = Monday ... 7 = Sunday */
function isoDow(ymd: string): number {
  const d = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** First day of the week containing `today`, for Todoist's start_day (1 = Mon ... 7 = Sun). */
export function weekStartOf(today: string, startDay: number): string {
  return addDays(today, -((isoDow(today) - startDay + 7) % 7));
}

/** A Todoist due date ("2026-11-07", "2026-11-07T10:00:00" or "...Z") as a local calendar date. */
export function dueToLocal(due: string, tz: string): string {
  return /[zZ]$|[+-]\d\d:\d\d$/.test(due) ? localDate(tz, new Date(due)) : due.slice(0, 10);
}

// ---------- Todoist reads ----------

export type User = {
  id: string;
  timezone: string;
  dailyGoal: number;
  weeklyGoal: number;
  startDay: number;
};

export async function getUser(): Promise<User> {
  const data = await sync({ sync_token: '*', resource_types: JSON.stringify(['user']) });
  const u = data.user || {};
  return {
    id: String(u.id ?? ''),
    timezone: u.tz_info?.timezone || process.env.TIMEZONE || 'Asia/Jerusalem',
    dailyGoal: Number(u.daily_goal ?? 0),
    weeklyGoal: Number(u.weekly_goal ?? 0),
    startDay: Number(u.start_day ?? 1) || 1,
  };
}

/** UTC instant of local midnight at the start of `ymd` in `tz`. */
export function localMidnightUtc(ymd: string, tz: string): Date {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const target = Date.parse(`${ymd}T00:00:00Z`);
  let guess = target;
  // Two passes settle the offset, including across DST changes.
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
    const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    guess += target - asIfUtc;
  }
  return new Date(guess);
}

/**
 * Completed counts for today and for the current week (the same numbers Todoist's own counter shows).
 * See countedCompletions for the rules.
 */
export async function getCompleted(
  user: User,
  today: string,
  weekStart: string,
  open: Map<string, OpenTask>,
): Promise<{ today: number; week: number; skippedStale: number }> {
  const tz = user.timezone;
  const since = localMidnightUtc(weekStart, tz);
  const until = localMidnightUtc(addDays(today, 1), tz);
  const todayStart = localMidnightUtc(today, tz).getTime();

  const events = await fetchCompletions(since, until, user.id, tz);
  const { counted, skipped } = countedCompletions(events, open);
  return {
    today: counted.filter((c) => Date.parse(c.completedAt) >= todayStart).length,
    week: counted.length,
    skippedStale: skipped,
  };
}

export type Completion = {
  taskId: string;
  completedAt: string;
  content: string;
  addedAt: string | null;
  recurring: boolean;
  /** Local date of the occurrence that was completed (recurring tasks), if Todoist reports it. */
  occurrence: string | null;
};

/**
 * Every completion event between two instants, from the activity log.
 *
 * The "completed tasks" endpoints leave out recurring tasks (they never become completed,
 * they just move to the next date), so they undercount. The activity log has every
 * completion, including each recurring occurrence. Only `userId`'s own completions count.
 */
export async function fetchCompletions(since: Date, until: Date, userId: string, tz: string): Promise<Completion[]> {
  const out: Completion[] = [];
  const sinceMs = since.getTime();
  const untilMs = until.getTime();
  let cursor: string | null = null;
  // Newest first; stop once we're past `since`. Safety cap of 50 pages x 100.
  for (let page = 0; page < 50; page++) {
    const params = new URLSearchParams({ object_type: 'item', event_type: 'completed', limit: '100' });
    if (userId) params.set('initiator_id', userId);
    if (cursor) params.set('cursor', cursor);
    const res = await api(`/activities?${params}`);
    const list: any[] = res.results || res.events || [];
    let reachedStart = false;
    for (const e of list) {
      const at = String(e.event_date ?? e.eventDate);
      const ms = Date.parse(at);
      if (ms < sinceMs) {
        reachedStart = true;
        continue;
      }
      if (ms >= untilMs) continue;
      const initiator = String(e.initiator_id ?? e.initiatorId ?? '');
      if (userId && initiator && initiator !== userId) continue;
      const x = e.extra_data || e.extraData || {};
      const occ = x.completed_due_date ?? x.completedDueDate;
      out.push({
        taskId: String(e.object_id ?? e.objectId),
        completedAt: at,
        content: String(x.content ?? ''),
        addedAt: x.date_added ?? x.dateAdded ?? null,
        recurring: !!(x.is_recurring ?? x.isRecurring),
        occurrence: occ ? dueToLocal(String(occ), tz) : null,
      });
    }
    cursor = res.next_cursor || res.nextCursor || null;
    if (reachedStart || !cursor) break;
  }
  return out;
}

/**
 * Turns raw completion events into the completions that really count, matching Todoist:
 * - Complete, undo, complete again: counts once (latest completion wins).
 * - A non-recurring task that's open again was undone: not counted.
 * - A recurring task counts once per occurrence. Undoing it moves it back to that same
 *   date (logged as an edit, not an "uncomplete"), so if it's due on that date again, it's undone.
 */
export function countedCompletions(
  events: Completion[],
  open: Map<string, { due: string | null; recurring: boolean }>,
): { counted: Completion[]; skipped: number } {
  const latest = new Map<string, Completion>();
  for (const c of events) {
    const isRecurring = c.recurring || !!open.get(c.taskId)?.recurring;
    const key = isRecurring ? `${c.taskId}|${c.occurrence ?? c.completedAt}` : c.taskId;
    const prev = latest.get(key);
    if (!prev || Date.parse(c.completedAt) > Date.parse(prev.completedAt)) latest.set(key, { ...c, recurring: isRecurring });
  }
  const counted: Completion[] = [];
  let skipped = 0;
  for (const c of latest.values()) {
    const task = open.get(c.taskId);
    const undone = c.recurring ? !!task && !!c.occurrence && task.due === c.occurrence : !!task;
    if (undone) skipped++;
    else counted.push(c);
  }
  skipped += events.length - latest.size;
  return { counted, skipped };
}

/** Every open task, raw from the API. */
export async function fetchOpenTasks(): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ limit: '200' });
    if (cursor) params.set('cursor', cursor);
    const page = await api(`/tasks?${params}`);
    for (const t of page.results || []) {
      if (!t.checked && !t.is_deleted) out.push(t);
    }
    cursor = page.next_cursor || null;
  } while (cursor);
  return out;
}

/**
 * Effective local due date of every open task.
 * - A task with its own due date uses it.
 * - An undated subtask inherits the due date of its nearest dated ancestor
 *   (so subtasks of a task due today count as planned for today).
 * - Undated top-level tasks, and subtasks with no dated ancestor, are ignored.
 */
export type OpenTask = { parentId: string | null; due: string | null; recurring: boolean };

export async function getOpenDueDates(
  tz: string,
): Promise<{ dates: string[]; inherited: number; tasks: Map<string, OpenTask> }> {
  const tasks = new Map<string, OpenTask>();
  for (const t of await fetchOpenTasks()) {
    tasks.set(String(t.id), {
      parentId: t.parent_id ? String(t.parent_id) : null,
      due: t.due?.date ? dueToLocal(String(t.due.date), tz) : null,
      recurring: !!t.due?.is_recurring,
    });
  }

  const dates: string[] = [];
  let inherited = 0;
  for (const task of tasks.values()) {
    if (task.due) {
      dates.push(task.due);
      continue;
    }
    // Walk up the parent chain (bounded, in case of bad data).
    let parent = task.parentId ? tasks.get(task.parentId) : undefined;
    for (let depth = 0; parent && depth < 10; depth++) {
      if (parent.due) {
        dates.push(parent.due);
        inherited++;
        break;
      }
      parent = parent.parentId ? tasks.get(parent.parentId) : undefined;
    }
  }
  return { dates, inherited, tasks };
}

export async function setGoals(goals: { daily_goal?: number; weekly_goal?: number }): Promise<void> {
  if (goals.daily_goal === undefined && goals.weekly_goal === undefined) return;
  const uuid = crypto.randomUUID();
  const data = await sync({
    commands: JSON.stringify([{ type: 'update_goals', uuid, args: goals }]),
  });
  const status = data.sync_status?.[uuid];
  if (status !== 'ok') throw new Error(`update_goals failed: ${JSON.stringify(status)}`);
}

// ---------- the calculation ----------

export type RecomputeOptions = {
  /** Start the day fresh (ignore today's earlier, higher goal). */
  resetDay?: boolean;
  /** Start the week fresh: true, false, or 'auto' = only if today is the first day of the week. */
  resetWeek?: boolean | 'auto';
};

export type RecomputeResult = {
  timezone: string;
  today: string;
  weekStart: string;
  includeOverdue: boolean;
  inheritedSubtasks: number;
  skippedStaleCompletions: number;
  mode: 'ratchet' | 'live';
  daily: { completed: number; remaining: number; planned: number; previousGoal: number; goal: number; reset: boolean };
  weekly: { completed: number; remaining: number; planned: number; previousGoal: number; goal: number; reset: boolean };
  changed: boolean;
};

/**
 * daily goal  = completed today      + open tasks due today
 * weekly goal = completed this week  + open tasks due from today to the end of the week
 * Undated subtasks count on their parent's (nearest dated ancestor's) due date.
 * Overdue tasks are left out unless INCLUDE_OVERDUE=true.
 * ratchet mode (default): goals only go up during their day/week, so postponing
 *   can't fake 100%; the resets start each day/week fresh.
 * live mode (GOAL_MODE=live): goals always equal the current counts.
 */
export async function recompute(opts: RecomputeOptions = {}): Promise<RecomputeResult> {
  const user = await getUser();
  const tz = user.timezone;
  const today = localDate(tz);
  const weekStart = weekStartOf(today, user.startDay);
  const nextWeekStart = addDays(weekStart, 7);
  const includeOverdue = process.env.INCLUDE_OVERDUE === 'true';
  const mode: 'ratchet' | 'live' = process.env.GOAL_MODE === 'live' ? 'live' : 'ratchet';

  // Open tasks first: the completed count needs them to drop stale (just-undone) completions.
  const open = await getOpenDueDates(tz);
  const completed = await getCompleted(user, today, weekStart, open.tasks);
  const dueDates = open.dates;

  const overdue = dueDates.filter((d) => d < today).length;
  const dueToday = dueDates.filter((d) => d === today).length;
  const dueRestOfWeek = dueDates.filter((d) => d >= today && d < nextWeekStart).length;

  const dailyRemaining = dueToday + (includeOverdue ? overdue : 0);
  const weeklyRemaining = dueRestOfWeek + (includeOverdue ? overdue : 0);
  const dailyPlanned = Math.max(1, completed.today + dailyRemaining);
  const weeklyPlanned = Math.max(1, completed.week + weeklyRemaining);

  const resetDay = !!opts.resetDay;
  const resetWeek = opts.resetWeek === 'auto' ? today === weekStart : !!opts.resetWeek;

  const dailyGoal = resetDay || mode === 'live' ? dailyPlanned : Math.max(user.dailyGoal, dailyPlanned);
  const weeklyGoal = resetWeek || mode === 'live' ? weeklyPlanned : Math.max(user.weeklyGoal, weeklyPlanned);

  const update: { daily_goal?: number; weekly_goal?: number } = {};
  if (dailyGoal !== user.dailyGoal) update.daily_goal = dailyGoal;
  if (weeklyGoal !== user.weeklyGoal) update.weekly_goal = weeklyGoal;
  await setGoals(update);

  return {
    timezone: tz,
    today,
    weekStart,
    includeOverdue,
    inheritedSubtasks: open.inherited,
    skippedStaleCompletions: completed.skippedStale,
    mode,
    daily: {
      completed: completed.today,
      remaining: dailyRemaining,
      planned: dailyPlanned,
      previousGoal: user.dailyGoal,
      goal: dailyGoal,
      reset: resetDay,
    },
    weekly: {
      completed: completed.week,
      remaining: weeklyRemaining,
      planned: weeklyPlanned,
      previousGoal: user.weeklyGoal,
      goal: weeklyGoal,
      reset: resetWeek,
    },
    changed: Object.keys(update).length > 0,
  };
}
