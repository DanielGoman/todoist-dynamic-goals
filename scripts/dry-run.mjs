// Read-only check of the goal math. Never writes to Todoist.
// Usage (PowerShell):  $env:TODOIST_API_TOKEN="..."; node scripts/dry-run.mjs
//        (bash):       TODOIST_API_TOKEN=... node scripts/dry-run.mjs
import { getUser, getOpenDueDates, getCompleted, localDate, weekStartOf } from '../lib/todoist.ts';

const user = await getUser();
const tz = user.timezone;
const today = localDate(tz);
const weekStart = weekStartOf(today, user.startDay);

const open = await getOpenDueDates(tz);
const completed = await getCompleted(user, today, weekStart, open.tasks);
const dueToday = open.dates.filter((d) => d === today).length;

// The old source, for comparison (this is what lagged after an undo).
const stats = await fetch('https://api.todoist.com/api/v1/tasks/completed/stats', {
  headers: { Authorization: `Bearer ${process.env.TODOIST_API_TOKEN}` },
}).then((r) => r.json());
const statsToday = Number((stats.days_items || []).find((d) => d.date === today)?.total_completed ?? 0);

console.log({
  time: new Date().toLocaleTimeString('en-GB', { timeZone: tz }),
  today,
  currentDailyGoal: user.dailyGoal,
  completedToday_new: completed.today,
  completedToday_oldStats: statsToday,
  skippedStale: completed.skippedStale,
  openDueToday: dueToday,
  planned_new: Math.max(1, completed.today + dueToday),
  planned_old: Math.max(1, statsToday + dueToday),
});
