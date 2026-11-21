// The menu of saved weekly reports, newest first, each with its headline numbers and the
// change from the week before.
import { delta, page, range, rangeShort } from './page';
import type { StoredReport } from './store';

export function renderReportsPage(saved: StoredReport[]): string {
  // saved is oldest first; show newest first but compare each with the week before it.
  const rows = saved
    .map((s, i) => ({ r: s.report, prev: i > 0 ? saved[i - 1].report : null }))
    .reverse()
    .map(({ r, prev }, i) => {
      const m = r.metrics;
      const pm = prev?.metrics;
      return `
      <a class="week card" href="/report?d=${r.reportDate}">
        <div class="week-head">
          <span class="when">${rangeShort(r.from, r.to)}${i === 0 ? '<span class="tag">Latest</span>' : ''}</span>
          <span class="rate"><b>${m.completionRate}%</b> done ${delta(m.completionRate, pm?.completionRate, 'up', ' pts')}</span>
        </div>
        <div class="meter"><i style="width:${m.completionRate}%"></i></div>
        <dl>
          <div><dt>Completed</dt><dd>${m.completed} ${delta(m.completed, pm?.completed, 'up')}</dd></div>
          <div><dt>Not completed</dt><dd>${m.notCompleted} ${delta(m.notCompleted, pm?.notCompleted, 'down')}</dd></div>
          <div><dt>Overdue</dt><dd>${m.overdue} ${delta(m.overdue, pm?.overdue, 'down')}</dd></div>
          <div><dt>Days slipped</dt><dd>${m.daysSlipped} ${delta(m.daysSlipped, pm?.daysSlipped, 'down')}</dd></div>
        </dl>
      </a>`;
    })
    .join('');

  const first = saved[0]?.report;
  const last = saved[saved.length - 1]?.report;
  const body = `
  <p class="eyebrow">All reports</p>
  <h1>${saved.length} saved week${saved.length === 1 ? '' : 's'}</h1>
  <p class="sub">${first && last ? `${range(first.from, last.to)} · newest first` : 'A report is saved every Saturday morning.'}</p>
  ${saved.length ? `<div class="list">${rows}</div>` : `<div class="empty"><b>No saved reports yet</b>The first one is saved on Saturday morning.</div>`}
  <footer><p>Changes are vs the week before. Green and ▲/▼ show whether the change is a good one.</p></footer>`;

  return page({ title: 'All weekly reports', active: 'reports', css: CSS, body });
}

const CSS = `
  .list { display: grid; gap: 10px; margin-top: 24px; }
  .week { display: block; padding: 14px 16px; text-decoration: none; color: var(--ink); transition: box-shadow .15s; }
  .week:hover { box-shadow: 0 0 0 1px var(--muted); }
  .week-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .when { font-weight: 650; font-size: 16px; }
  .tag { margin-left: 8px; font-size: 11px; font-weight: 600; color: var(--muted); background: var(--track);
         border-radius: 99px; padding: 1px 8px; vertical-align: 2px; }
  .rate { font-size: 13px; color: var(--muted); white-space: nowrap; }
  .rate b { color: var(--ink); font-size: 15px; }
  .meter { height: 6px; border-radius: 99px; background: var(--track); margin: 10px 0 12px; overflow: hidden; }
  .meter i { display: block; height: 100%; border-radius: 99px; background: var(--green); }
  dl { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 0; }
  dt { color: var(--muted); font-size: 12px; }
  dd { margin: 2px 0 0; font-weight: 600; font-size: 15px; }
  dd .delta { margin-left: 4px; font-size: 11.5px; }
  @media (max-width: 520px) { dl { grid-template-columns: repeat(2, minmax(0, 1fr)); row-gap: 10px; } }
`;
