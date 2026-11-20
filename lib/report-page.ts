// The weekly report as a standalone web page (no external assets).
// Every task title is an isolated bidi run (dir="auto"), so Hebrew and English titles each read
// in their own direction while the table itself stays aligned.
import type { Report, SlippedTask } from './report';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmt = (ymd: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...opts }).format(new Date(`${ymd}T00:00:00Z`));
/** True when the first letter is Hebrew/Arabic, so the row's secondary line should align right too. */
const isRtl = (text: string) => /^[^A-Za-z֐-ࣿ]*[֐-ࣿ]/.test(text);

const short = (ymd: string) => fmt(ymd, { day: 'numeric', month: 'short' });

function range(from: string, to: string): string {
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  const start = sameMonth ? fmt(from, { day: 'numeric' }) : short(from);
  return `${start} – ${fmt(to, { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

function rows(tasks: SlippedTask[], maxLate: number): string {
  return tasks
    .map((t) => {
      const plus = t.partialHistory ? '+' : '';
      const pct = Math.max(4, Math.round((t.daysLate / maxLate) * 100));
      const dates = t.overdue
        ? `due ${short(t.originalDue)}`
        : `${short(t.originalDue)} <span class="arrow">→</span> ${short(t.currentDue)}`;
      return `
      <tr>
        <td class="task${isRtl(t.content) ? ' rtl' : ''}">
          <a dir="auto" href="https://app.todoist.com/app/task/${esc(t.id)}">${esc(t.content)}</a>
          <div class="dates">${dates}</div>
        </td>
        <td class="num late">
          <span class="value">${t.daysLate}${plus}<small>d</small></span>
          <span class="bar"><i style="width:${pct}%"></i></span>
        </td>
        <td class="num moves">${t.postponed ? `${t.postponed}${plus}` : '<span class="none">–</span>'}</td>
      </tr>`;
    })
    .join('');
}

function section(title: string, hint: string, tone: string, tasks: SlippedTask[], maxLate: number): string {
  if (!tasks.length) return '';
  return `
  <section class="${tone}">
    <header class="section-head">
      <h2><span class="dot ${tone}"></span>${title}<span class="count">${tasks.length}</span></h2>
      <p>${hint}</p>
    </header>
    <table>
      <thead><tr><th>Task</th><th class="num">Late</th><th class="num">Moved</th></tr></thead>
      <tbody>${rows(tasks, maxLate)}</tbody>
    </table>
  </section>`;
}

export function renderReportPage(r: Report, generatedAt: Date): string {
  const overdue = r.tasks.filter((t) => t.overdue);
  const postponed = r.tasks.filter((t) => !t.overdue);
  const maxLate = Math.max(1, ...r.tasks.map((t) => t.daysLate));
  const planned = r.completed + r.openFromWeek;
  const rate = planned ? Math.round((r.completed / planned) * 100) : 100;
  const generated = new Intl.DateTimeFormat('en-GB', {
    timeZone: r.timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(generatedAt);
  const partial = r.tasks.some((t) => t.partialHistory);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Weekly report · ${range(r.from, r.to)}</title>
<style>
  :root {
    --bg: #f6f5f2; --card: #ffffff; --ink: #1c1c1e; --muted: #75757c; --faint: #a6a6ad;
    --line: #e8e6e1; --track: #efede8;
    --red: #d1453b; --amber: #c97a1c; --green: #2f8f5b;
    color-scheme: light dark;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #121214; --card: #1b1b1e; --ink: #f2f2f4; --muted: #9a9aa2; --faint: #66666e;
      --line: #2a2a2f; --track: #26262b;
      --red: #ef6a5f; --amber: #e3a04a; --green: #4cbb7f;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans Hebrew", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  main { max-width: 720px; margin: 0 auto; padding: 40px 20px 56px; }
  .eyebrow { margin: 0; color: var(--muted); font-size: 12px; letter-spacing: .12em; text-transform: uppercase; font-weight: 600; }
  h1 { margin: 6px 0 4px; font-size: 30px; line-height: 1.15; letter-spacing: -.02em; font-weight: 700; }
  .sub { margin: 0; color: var(--faint); font-size: 13px; }

  .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 28px 0 12px; }
  .stat { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px 12px; }
  .stat b { display: block; font-size: 30px; line-height: 1.1; font-weight: 650; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
  .stat span { display: block; margin-top: 4px; color: var(--muted); font-size: 12.5px; line-height: 1.3; }
  .stat.ok b { color: var(--green); }
  .stat.warn b { color: var(--amber); }
  .stat.bad b { color: var(--red); }

  .rate { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; }
  .rate-top { display: flex; justify-content: space-between; align-items: baseline; font-size: 13px; color: var(--muted); }
  .rate-top b { color: var(--ink); font-size: 15px; font-variant-numeric: tabular-nums; }
  .track { height: 8px; border-radius: 99px; background: var(--track); margin-top: 10px; overflow: hidden; }
  .track i { display: block; height: 100%; border-radius: 99px; background: var(--green); }

  section { margin-top: 36px; }
  .section-head h2 { display: flex; align-items: center; gap: 10px; margin: 0; font-size: 17px; font-weight: 650; }
  .section-head p { margin: 2px 0 12px 18px; color: var(--muted); font-size: 13px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .dot.red { background: var(--red); } .dot.amber { background: var(--amber); }
  .count { margin-left: auto; color: var(--muted); font-weight: 500; font-size: 13px;
           background: var(--track); border-radius: 99px; padding: 1px 10px; font-variant-numeric: tabular-nums; }

  table { width: 100%; border-collapse: separate; border-spacing: 0; background: var(--card);
          border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  th { text-align: left; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--faint);
       font-weight: 600; padding: 10px 16px; border-bottom: 1px solid var(--line); }
  td { padding: 12px 16px; border-bottom: 1px solid var(--line); vertical-align: top; }
  tr:last-child td { border-bottom: 0; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .task { overflow-wrap: anywhere; }
  .task a { display: block; color: var(--ink); text-decoration: none; font-weight: 500; text-align: start; unicode-bidi: isolate; }
  .task a:hover { text-decoration: underline; text-underline-offset: 3px; }
  .dates { margin-top: 2px; color: var(--muted); font-size: 12.5px; font-variant-numeric: tabular-nums; }
  .task.rtl .dates { text-align: right; }
  .arrow { color: var(--faint); }
  .late { width: 96px; }
  .late .value { font-weight: 600; }
  .late small { color: var(--muted); font-weight: 500; margin-left: 1px; }
  .bar { display: block; height: 4px; margin: 7px 0 0 auto; width: 64px; border-radius: 99px; background: var(--track); overflow: hidden; }
  .bar i { display: block; height: 100%; margin-left: auto; border-radius: 99px; background: var(--red); opacity: .8; }
  section.amber .bar i { background: var(--amber); }
  .moves { width: 64px; color: var(--ink); }
  .none { color: var(--faint); }

  .empty { margin-top: 36px; text-align: center; padding: 40px 16px; background: var(--card);
           border: 1px solid var(--line); border-radius: 14px; color: var(--muted); }
  .empty b { display: block; color: var(--ink); font-size: 17px; margin-bottom: 2px; }

  footer { margin-top: 32px; color: var(--faint); font-size: 12.5px; line-height: 1.6; }
  footer p { margin: 0 0 4px; }

  @media (max-width: 520px) {
    main { padding-top: 28px; }
    h1 { font-size: 25px; }
    .stats { gap: 8px; }
    .stat { padding: 12px 12px 10px; }
    .stat b { font-size: 25px; }
    .stat span { font-size: 11.5px; }
    td, th { padding-left: 12px; padding-right: 12px; }
    .late { width: 78px; } .bar { width: 52px; } .moves { width: 54px; }
  }
</style>
</head>
<body>
<main>
  <p class="eyebrow">Weekly report</p>
  <h1>${range(r.from, r.to)}</h1>
  <p class="sub">Generated ${generated}</p>

  <div class="stats">
    <div class="stat ok"><b>${r.completed}</b><span>Completed</span></div>
    <div class="stat warn"><b>${r.openFromWeek}</b><span>Open from this week</span></div>
    <div class="stat bad"><b>${r.overdue}</b><span>Overdue now</span></div>
  </div>
  <div class="rate">
    <div class="rate-top"><span>Done out of this week's plan</span><b>${rate}%</b></div>
    <div class="track"><i style="width:${rate}%"></i></div>
  </div>

  ${
    r.tasks.length
      ? section('Overdue', 'Still open and past due, sorted by days past the original due date.', 'red', overdue, maxLate) +
        section('Postponed', 'Moved past the end of the week. Original due date → current due date.', 'amber', postponed, maxLate)
      : `<div class="empty"><b>Nothing slipped</b>Every task planned for this week got done. 🎉</div>`
  }

  <footer>
    <p><b>Late</b>: days past the due date the task was created with. <b>Moved</b>: times the due date was pushed later.</p>
    <p>${r.openTotal} open task${r.openTotal === 1 ? '' : 's'} in total are past their original due date, including ones older than this week.</p>
    ${partial ? `<p>+ The task is older than Todoist's activity history (from ${short(r.historyFrom || r.from)}), so the real number may be higher.</p>` : ''}
  </footer>
</main>
</body>
</html>`;
}
