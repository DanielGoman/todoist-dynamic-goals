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

## Notes

- The Hobby plan allows one cron per day; its exact fire time can drift within the hour, which is fine here.
- If `completed` always shows 0 while you have completed tasks today, the productivity-stats response shape differs from what `lib/todoist.ts → getCompletedToday` expects — check the raw output of `GET https://api.todoist.com/api/v1/tasks/completed/stats` and adjust the field names.
- Changing goals affects streaks: a "goal met" day now means "finished everything planned".
- To stop: remove the webhook in the App Management Console (or delete the Vercel project) and set your goal back manually.
