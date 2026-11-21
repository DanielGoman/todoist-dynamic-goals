// The weekly report as a standalone web page (no external assets).
// Every task title is an isolated bidi run (dir="auto"), so Hebrew and English titles each read
// in their own direction while the table itself stays aligned.
import type { CompletedLateTask, Report, SlippedTask, WeekMetrics } from './report';
import { delta, esc, page, range, rangeShort, short } from './page';

/** True when the first letter is Hebrew/Arabic, so the row's secondary line should align right too. */
const isRtl = (text: string) => /^[^A-Za-z\u0590-\u08FF]*[\u0590-\u08FF]/.test(text);

/** One table row, whatever the section: the title, a secondary dates line, and the two numbers. */
type Row = { id: string; content: string; dates: string; daysLate: number; postponed: number; partial: boolean };

const arrow = '<span class="arrow">→</span>';

const slippedRow = (t: SlippedTask): Row => ({
  id: t.id,
  content: t.content,
  dates: t.overdue ? `due ${short(t.originalDue)}` : `${short(t.originalDue)} ${arrow} ${short(t.currentDue)}`,
  daysLate: t.daysLate,
  postponed: t.postponed,
  partial: t.partialHistory,
});

const completedRow = (t: CompletedLateTask): Row => ({
  id: t.id,
  content: t.content,
  dates: `due ${short(t.originalDue)} ${arrow} done ${short(t.completedOn)}`,
  daysLate: t.daysLate,
  postponed: t.postponed,
  partial: t.partialHistory,
});

function rows(list: Row[], maxLate: number): string {
  return list
    .map((t) => {
      const plus = t.partial ? '+' : '';
      const pct = t.daysLate ? Math.max(4, Math.round((t.daysLate / maxLate) * 100)) : 0;
      return `
      <tr>
        <td class="task${isRtl(t.content) ? ' rtl' : ''}">
          <a dir="auto" href="https://app.todoist.com/app/task/${esc(t.id)}">${esc(t.content)}</a>
          <div class="dates">${t.dates}</div>
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

function section(title: string, hint: string, tone: string, list: Row[], maxLate: number): string {
  if (!list.length) return '';
  return `
  <section class="${tone}">
    <header class="section-head">
      <h2><span class="dot ${tone}"></span>${title}<span class="count">${list.length}</span></h2>
      <p>${hint}</p>
    </header>
    <table>
      <thead><tr><th>Task</th><th class="num">Late</th><th class="num">Moved</th></tr></thead>
      <tbody>${rows(list, maxLate)}</tbody>
    </table>
  </section>`;
}

export type ReportPageOptions = {
  /** The saved report of the week before, for the change numbers. */
  prev?: Report | null;
  /** Neighbouring saved weeks, for the ← / → links. */
  older?: Report | null;
  newer?: Report | null;
  /** When the report was saved; null when built live just now. */
  savedAt?: string | null;
};

type Tile = { key: keyof WeekMetrics; label: string; good: 'up' | 'down' | 'neutral'; tone?: string };

const TILES: Tile[] = [
  { key: 'completed', label: 'Completed', good: 'up', tone: 'ok' },
  { key: 'notCompleted', label: 'Not completed from this week', good: 'down', tone: 'warn' },
  { key: 'overdue', label: 'Overdue at week end', good: 'down', tone: 'bad' },
  { key: 'postponements', label: 'Postponements', good: 'down' },
  { key: 'daysSlipped', label: 'Days slipped', good: 'down' },
  { key: 'added', label: 'Tasks added', good: 'neutral' },
];

export function renderReportPage(r: Report, generatedAt: Date, opts: ReportPageOptions = {}): string {
  const m = r.metrics;
  const pm = opts.prev?.metrics;
  const overdue = r.tasks.filter((t) => t.overdue);
  const postponed = r.tasks.filter((t) => !t.overdue);
  const maxLate = Math.max(1, ...r.tasks.map((t) => t.daysLate), ...r.completedLate.map((t) => t.daysLate));
  const when = new Intl.DateTimeFormat('en-GB', {
    timeZone: r.timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(opts.savedAt ? new Date(opts.savedAt) : generatedAt);
  const partial = r.tasks.some((t) => t.partialHistory) || r.completedLate.some((t) => t.partialHistory);
  const weekLink = (w: Report | null | undefined, dir: 'older' | 'newer') =>
    w
      ? `<a class="week-link ${dir}" href="/report?d=${w.reportDate}">${dir === 'older' ? '← ' : ''}${rangeShort(w.from, w.to)}${dir === 'newer' ? ' →' : ''}</a>`
      : '<span></span>';

  const tiles = TILES.map((t) => {
    const value = m[t.key];
    return `<div class="stat ${t.tone || ''}"><b>${value}</b><span>${t.label}</span>${delta(value, pm?.[t.key], t.good)}</div>`;
  }).join('');

  const status = opts.savedAt ? `Saved ${when}` : `Live as of ${when} · not saved yet`;

  const body = `
  <p class="eyebrow">Weekly report</p>
  <h1>${range(r.from, r.to)}</h1>
  <p class="sub">${status}${pm ? ' · changes are vs the week before' : ''}</p>
  ${opts.older || opts.newer ? `<div class="weeks">${weekLink(opts.older, 'older')}${weekLink(opts.newer, 'newer')}</div>` : ''}

  <div class="stats">${tiles}</div>
  <div class="rate card">
    <div class="rate-top"><span>Done out of this week's plan (${m.completed} of ${m.planned})</span><span><b>${m.completionRate}%</b> ${delta(m.completionRate, pm?.completionRate, 'up', ' pts')}</span></div>
    <div class="track"><i style="width:${m.completionRate}%"></i></div>
  </div>

  ${
    r.tasks.length
      ? section('Overdue', 'Still open and past due, sorted by days past the original due date.', 'red', overdue.map(slippedRow), maxLate) +
        section('Postponed', 'Moved past the end of the week. Original due date → current due date.', 'amber', postponed.map(slippedRow), maxLate)
      : `<div class="empty"><b>Nothing slipped</b>Every task planned for this week got done. 🎉</div>`
  }
  ${section('Completed after postponing', 'Done this week, but only after the due date was pushed at least once.', 'green', r.completedLate.map(completedRow), maxLate)}

  <footer>
    <p><b>Late</b>: days past the due date the task was created with (for completed tasks, until the day it was done). <b>Moved</b>: times the due date was pushed later.</p>
    <p><b>Days slipped</b> and <b>Postponements</b> count tasks originally due this week: still open, or completed after postponing.</p>
    <p>${r.openTotal} open task${r.openTotal === 1 ? '' : 's'} in total are past their original due date, including ones older than this week.</p>
    ${partial ? `<p>+ The task is older than Todoist's activity history (from ${short(r.historyFrom || r.from)}), so the real number may be higher.</p>` : ''}
  </footer>`;

  return page({ title: `Weekly report · ${range(r.from, r.to)}`, active: 'report', css: REPORT_CSS, body });
}

const REPORT_CSS = `
  .weeks { display: flex; justify-content: space-between; margin-top: 14px; }
  .week-link { font-size: 13px; color: var(--muted); text-decoration: none; padding: 4px 10px; border-radius: 99px; background: var(--track); }
  .week-link:hover { color: var(--ink); }

  .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 24px 0 12px; }
  .stat { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px 12px; }
  .stat b { display: block; font-size: 30px; line-height: 1.1; font-weight: 650; letter-spacing: -.02em; }
  .stat span { display: block; margin-top: 4px; color: var(--muted); font-size: 12.5px; line-height: 1.3; }
  .stat .delta { margin-top: 6px; }
  .stat.ok b { color: var(--green); }
  .stat.warn b { color: var(--amber); }
  .stat.bad b { color: var(--red); }

  .rate { padding: 14px 16px; }
  .rate-top { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-size: 13px; color: var(--muted); }
  .rate-top b { color: var(--ink); font-size: 15px; }
  .track { height: 8px; border-radius: 99px; background: var(--track); margin-top: 10px; overflow: hidden; }
  .track i { display: block; height: 100%; border-radius: 99px; background: var(--green); }

  section { margin-top: 36px; }
  .section-head h2 { display: flex; align-items: center; gap: 10px; margin: 0; font-size: 17px; font-weight: 650; }
  .section-head p { margin: 2px 0 12px 18px; color: var(--muted); font-size: 13px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .dot.red { background: var(--red); } .dot.amber { background: var(--amber); } .dot.green { background: var(--green); }
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
  section.green .bar i { background: var(--green); }
  .moves { width: 64px; color: var(--ink); }
  .none { color: var(--faint); }

  @media (max-width: 520px) {
    .stats { gap: 8px; }
    .stat { padding: 12px 12px 10px; }
    .stat b { font-size: 25px; }
    .stat span { font-size: 11.5px; }
    td, th { padding-left: 12px; padding-right: 12px; }
    .late { width: 78px; } .bar { width: 52px; } .moves { width: 54px; }
  }
`;
