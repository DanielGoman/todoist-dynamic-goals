# Todoist dynamic daily goal

Keeps Todoist's **daily goal** equal to the number of tasks you planned for today, so the native goal widget becomes a real "today's progress" bar.

```
daily goal = completed today + still open (today | overdue)
```

- **Webhook** (`/api/webhook`) — every task add/update/complete/uncomplete/delete recomputes the goal within seconds.
- **Daily reset** (`/api/cron/reset`) — Vercel Cron at 22:05 UTC (00:05 Israel winter / 01:05 summer) starts each day fresh, since no event fires at midnight.
- **Ratchet mode** (default) — during the day the goal only goes up, so postponing tasks can't fake 100%. Set `GOAL_MODE=live` if you want it exact both ways.

## Setup (~10 min)

1. **Create a Todoist app** — https://app.todoist.com/app/settings/integrations/app-management → *Create a new app*. Note the **Client ID** and **Client secret**.

2. **Get your personal API token** — Todoist → Settings → Integrations → Developer.

3. **Deploy to Vercel**
   - Push this folder to a GitHub repo and import it at https://vercel.com/new (framework preset: *Other*), or run `npx vercel` inside the folder.
   - Project → Settings → Environment Variables, add everything from `.env.example` (`TODOIST_API_TOKEN`, `TODOIST_CLIENT_ID`, `TODOIST_CLIENT_SECRET`, `SETUP_KEY`, `CRON_SECRET`). Generate the two secrets with `openssl rand -hex 32`.
   - Redeploy so the variables take effect. Note your URL, e.g. `https://todoist-dynamic-goal.vercel.app`.

4. **Configure the Todoist app** (App Management Console → your app):
   - **OAuth redirect URL:** `https://<your-app>.vercel.app/api/oauth/callback`
   - **Webhooks → Callback URL:** `https://<your-app>.vercel.app/api/webhook`
   - **Events:** `item:added`, `item:updated`, `item:deleted`, `item:completed`, `item:uncompleted`
   - Save / activate the webhook.

5. **Authorize your own app** (activates webhooks for your account — required even though you created the app):
   open `https://<your-app>.vercel.app/api/oauth/start?key=<SETUP_KEY>` and approve.

6. **Test**
   - `https://<your-app>.vercel.app/api/recompute?key=<SETUP_KEY>` → JSON with `completed`, `remaining`, `goal`. Check the numbers match what you see in Todoist.
   - Complete a task → Vercel → Logs should show an `item:completed` line, and the widget updates.

## Weekly report (Telegram + web page)

Every Saturday morning (cron at 04:00 UTC, so about 6:00 Israel time in winter and 7:00 in summer), a short Telegram summary arrives for the 7 days before,
with an **Open full report** button. The page shows completed and open counts, then every slipped
task (overdue, or postponed past the week) with how many days it is past its original due date
and how many times it was moved. Hebrew and English titles each keep their own text direction.

1. In Telegram, message **@BotFather** → `/newbot` → copy the bot token.
2. Send any message to your new bot, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `result[0].message.chat.id`.
3. Add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` to the Vercel project's environment variables, then redeploy.
4. View the page any time: `/report?key=<SETUP_KEY>` (add `&d=YYYY-MM-DD` for the week before that day).
5. Send a test: `/api/report?key=<SETUP_KEY>&send=1`.

The button link is signed with `CRON_SECRET` and works for 30 days, so `SETUP_KEY` never goes
through Telegram. The page is built live when opened, so open tasks show their current state.

Postponement history comes from Todoist's activity log, which only reaches back about a week on
your plan. Numbers for tasks created before that are marked `+` (they may be higher).

## Notes

- The Hobby plan allows one cron per day; its exact fire time can drift within the hour, which is fine here.
- If `completed` always shows 0 while you have completed tasks today, the completed-tasks response shape differs from what `lib/todoist.ts → getCompleted` expects — check the raw output of `GET https://api.todoist.com/api/v1/tasks/completed/by_completion_date?since=…&until=…` and adjust the field names (`items`, `task_id`/`id`, `completed_at`).
- Changing goals affects streaks: a "goal met" day now means "finished everything planned".
- To stop: remove the webhook in the App Management Console (or delete the Vercel project) and set your goal back manually.

<!-- Deploy pipeline check: 2026-11-07 -->
