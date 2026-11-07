// Shared Todoist logic: read this day's/week's numbers and set the daily + weekly goals.
// Uses your personal API token (never expires) for all reads/writes.

const API = 'https://api.todoist.com/api/v1';

function token(): string {
  const t = process.env.TODOIST_API_TOKEN;
  if (!t) throw new Error('TODOIST_API_TOKEN is not set');
  return t;
}

async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
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
function dueToLocal(due: string, tz: string): string {
  return /[zZ]$|[+-]\d\d:\d\d$/.test(due) ? localDate(tz, new Date(due)) : due.slice(0, 10);
}

// ---------- Todoist reads ----------

export type User = {
  timezone: string;
  dailyGoal: number;
  weeklyGoal: number;
  startDay: number;
};

export async function getUser(): Promise<User> {
  const data = await sync({ sync_token: '*', resource_types: JSON.stringify(['user']) });
  const u = data.user || {};
  return {
    timezone: u.tz_info?.timezone || process.env.TIMEZONE || 'Asia/Jerusalem',
    dailyGoal: Number(u.daily_goal ?? 0),
    weeklyGoal: Number(u.weekly_goal ?? 0),
    startDay: Number(u.start_day ?? 1) || 1,
  };
}

/** Completed counts for today and for the current week (same numbers Todoist's widget uses). */
export async function getCompleted(
  today: string,
  weekStart: string,
): Promise<{ today: number; week: number }> {
  const stats = await api('/tasks/completed/stats');
  const days: any[] = stats.days_items || [];
  const todayCount = Number(days.find((d) => d.date === today)?.total_completed ?? 0);

  // Prefer Todoist's own weekly bucket when it lines up with our week; otherwise sum the days.
  const weekBucket = (stats.week_items || []).find((w: any) => w.from === weekStart);
  const weekCount = weekBucket
    ? Number(weekBucket.total_completed ?? 0)
    : days
        .filter((d) => d.date >= weekStart && d.date <= today)
        .reduce((sum, d) => sum + Number(d.total_completed ?? 0), 0);

  return { today: todayCount, week: weekCount };
}

/**
 * Effective local due date of every open task.
 * - A task with its own due date uses it.
 * - An undated subtask inherits the due date of its nearest dated ancestor
 *   (so subtasks of a task due today count as planned for today).
 * - Undated top-level tasks, and subtasks with no dated ancestor, are ignored.
 */
export async function getOpenDueDates(tz: string): Promise<{ dates: string[]; inherited: number }> {
  const tasks = new Map<string, { parentId: string | null; due: string | null }>();
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ limit: '200' });
    if (cursor) params.set('cursor', cursor);
    const page = await api(`/tasks?${params}`);
    for (const t of page.results || []) {
      if (t.checked || t.is_deleted) continue;
      tasks.set(String(t.id), {
        parentId: t.parent_id ? String(t.parent_id) : null,
        due: t.due?.date ? dueToLocal(String(t.due.date), tz) : null,
      });
    }
    cursor = page.next_cursor || null;
  } while (cursor);

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
  return { dates, inherited };
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

  const [completed, open] = await Promise.all([getCompleted(today, weekStart), getOpenDueDates(tz)]);
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
