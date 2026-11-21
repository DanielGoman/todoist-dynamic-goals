// Trends across all saved weekly reports: one small line chart per measure (single series,
// or two where the comparison is the point), each with its latest value and the change from
// the week before, a hover/keyboard readout, and a table with every number underneath.
//
// Colors: categorical slots 1–3 of the dataviz reference palette (blue, orange, aqua),
// validated all-pairs for CVD in light and dark. Aqua is under 3:1 on the light surface, so
// every value is also in the table and the two-series charts have a legend and end labels.
import { delta, esc, page, range, rangeShort } from './page';
import type { WeekMetrics } from './report';
import type { StoredReport } from './store';

type Series = { key: keyof WeekMetrics; name: string; slot: 1 | 2 | 3 };
type Chart = { id: string; title: string; hint: string; series: Series[]; good: 'up' | 'down' | 'neutral'; unit?: string; max?: number };

const CHARTS: Chart[] = [
  {
    id: 'planned',
    title: 'Planned vs completed',
    hint: 'Planned = completed + still open from the week.',
    series: [
      { key: 'completed', name: 'Completed', slot: 1 },
      { key: 'planned', name: 'Planned', slot: 2 },
    ],
    good: 'up',
  },
  { id: 'rate', title: 'Completion rate', hint: "Share of the week's plan that got done.", series: [{ key: 'completionRate', name: 'Completion rate', slot: 1 }], good: 'up', unit: '%', max: 100 },
  { id: 'slipped', title: 'Days slipped', hint: 'Days past the original due date, for tasks due that week.', series: [{ key: 'daysSlipped', name: 'Days slipped', slot: 1 }], good: 'down' },
  { id: 'moves', title: 'Postponements', hint: 'Times a due date was pushed later.', series: [{ key: 'postponements', name: 'Postponements', slot: 1 }], good: 'down' },
  { id: 'overdue', title: 'Overdue at week end', hint: 'Open tasks past their due date when the report was saved.', series: [{ key: 'overdue', name: 'Overdue', slot: 1 }], good: 'down' },
  { id: 'late', title: 'Completed after postponing', hint: 'Done, but only after moving the due date.', series: [{ key: 'completedLate', name: 'Completed after postponing', slot: 1 }], good: 'down' },
  {
    id: 'inflow',
    title: 'Added vs completed',
    hint: 'More added than completed means the list is growing.',
    series: [
      { key: 'completed', name: 'Completed', slot: 1 },
      { key: 'added', name: 'Added', slot: 3 },
    ],
    good: 'neutral',
  },
];

const TABLE_COLS: { key: keyof WeekMetrics; label: string }[] = [
  { key: 'planned', label: 'Planned' },
  { key: 'completed', label: 'Done' },
  { key: 'completionRate', label: 'Rate %' },
  { key: 'notCompleted', label: 'Not done' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'postponements', label: 'Moves' },
  { key: 'daysSlipped', label: 'Days slipped' },
  { key: 'completedLate', label: 'Done late' },
  { key: 'added', label: 'Added' },
];

export function renderTrendsPage(saved: StoredReport[]): string {
  const weeks = saved.map((s) => ({ date: s.report.reportDate, label: rangeShort(s.report.from, s.report.to), m: s.report.metrics }));
  const last = weeks[weeks.length - 1];
  const prev = weeks[weeks.length - 2];

  const cards = CHARTS.map((c) => {
    const lead = c.series[0];
    const head = last
      ? `<span class="now"><b>${last.m[lead.key]}${c.unit || ''}</b> ${delta(last.m[lead.key], prev?.m[lead.key], c.good, c.unit === '%' ? ' pts' : '')}</span>`
      : '';
    const legend =
      c.series.length > 1
        ? `<div class="legend">${c.series.map((s) => `<span><i class="key s${s.slot}"></i>${esc(s.name)}</span>`).join('')}</div>`
        : '';
    return `
    <section class="chart card" data-chart="${c.id}">
      <header><h2>${esc(c.title)}</h2>${head}</header>
      <p class="hint">${esc(c.hint)}</p>
      ${legend}
      <div class="plot" tabindex="0" role="img" aria-label="${esc(c.title)} by week. Values are in the table below."></div>
    </section>`;
  }).join('');

  const table = `
  <section class="table-wrap card">
    <table>
      <thead><tr><th>Week</th>${TABLE_COLS.map((c) => `<th class="num">${c.label}</th>`).join('')}</tr></thead>
      <tbody>${[...weeks]
        .reverse()
        .map((w) => `<tr><td><a href="/report?d=${w.date}">${w.label}</a></td>${TABLE_COLS.map((c) => `<td class="num">${w.m[c.key]}</td>`).join('')}</tr>`)
        .join('')}</tbody>
    </table>
  </section>`;

  const data = {
    weeks: weeks.map((w) => ({ label: w.label, m: w.m })),
    charts: CHARTS.map((c) => ({ id: c.id, unit: c.unit || '', max: c.max ?? null, series: c.series })),
  };
  // JSON inside <script>: escape "<" so a task title can never close the tag.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');

  const first = saved[0]?.report;
  const body = `
  <p class="eyebrow">Trends</p>
  <h1>${weeks.length ? `${weeks.length} week${weeks.length === 1 ? '' : 's'}` : 'No data yet'}</h1>
  <p class="sub">${first && saved.length ? `${range(first.from, saved[saved.length - 1].report.to)} · latest value and change vs the week before` : 'Trends start after the first saved report.'}</p>
  ${weeks.length === 1 ? `<div class="note card">Only one week so far: the lines start with next Saturday's report.</div>` : ''}
  ${weeks.length ? `<div class="grid">${cards}</div><h2 class="table-title">Every week</h2>${table}` : ''}
  <div class="tip" role="status" aria-live="polite" hidden></div>`;

  return page({ title: 'Weekly trends', active: 'trends', css: CSS, body, script: weeks.length ? `const DATA = ${json};\n${SCRIPT}` : '' });
}

const CSS = `
  :root { --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --grid: #e1e0d9; --axis: #898781; --surface: #ffffff; }
  @media (prefers-color-scheme: dark) { :root { --s1: #3987e5; --s2: #d95926; --s3: #199e70; --grid: #2c2c2a; --surface: #1b1b1e; } }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 24px; }
  .chart { padding: 14px 16px 10px; min-width: 0; }
  .chart:first-child { grid-column: 1 / -1; }
  .chart header { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
  .chart h2 { margin: 0; font-size: 14.5px; font-weight: 650; }
  .now b { font-size: 18px; font-weight: 650; }
  .now .delta { margin-left: 4px; }
  .hint { margin: 2px 0 6px; color: var(--muted); font-size: 12px; }
  .legend { display: flex; gap: 14px; font-size: 12px; color: var(--muted); margin-bottom: 2px; }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .key { display: inline-block; width: 14px; height: 2px; border-radius: 2px; }
  .key.s1 { background: var(--s1); } .key.s2 { background: var(--s2); } .key.s3 { background: var(--s3); }
  .plot { position: relative; height: 170px; outline: none; border-radius: 8px; }
  .plot:focus-visible { box-shadow: 0 0 0 2px var(--s1); }
  .plot svg { display: block; overflow: visible; }
  .plot text { font: 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; fill: var(--axis); font-variant-numeric: tabular-nums; }
  .plot text.end { fill: var(--muted); font-weight: 600; }
  .note { margin-top: 18px; padding: 12px 16px; color: var(--muted); font-size: 13px; }
  .tip { position: fixed; z-index: 10; pointer-events: none; background: var(--card); border: 1px solid var(--line);
         border-radius: 10px; padding: 8px 10px; font-size: 12px; box-shadow: 0 6px 20px rgba(0,0,0,.12); min-width: 120px; }
  .tip .t { color: var(--muted); margin-bottom: 4px; }
  .tip .r { display: flex; align-items: center; gap: 8px; }
  .tip .r b { font-size: 13px; font-variant-numeric: tabular-nums; }
  .tip .r span { color: var(--muted); }
  .table-title { font-size: 15px; margin: 32px 0 10px; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); font-weight: 600;
       padding: 10px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  td { padding: 9px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  tr:last-child td { border-bottom: 0; }
  td a { text-decoration: none; font-weight: 600; }
  td a:hover { text-decoration: underline; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  @media (max-width: 620px) { .grid { grid-template-columns: minmax(0, 1fr); } }
`;

// Client-side drawing: charts are drawn at the container's real width (so text stays 11px on
// phones) and redrawn on resize. Labels go in via textContent, never innerHTML.
const SCRIPT = String.raw`
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const tip = document.querySelector('.tip');
  const el = (name, attrs, parent) => {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const niceMax = (v) => {
    if (v <= 4) return 4;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 4, 6, 8, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  };

  function draw(box, chart) {
    box.textContent = '';
    const W = box.clientWidth, H = box.clientHeight;
    const M = { l: 30, r: chart.series.length > 1 ? 34 : 30, t: 10, b: 22 };
    const iw = W - M.l - M.r, ih = H - M.t - M.b;
    const n = DATA.weeks.length;
    const vals = chart.series.map((s) => DATA.weeks.map((w) => w.m[s.key]));
    const top = chart.max ?? niceMax(Math.max(1, ...vals.flat()));
    const x = (i) => M.l + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
    const y = (v) => M.t + ih - (v / top) * ih;
    const svg = el('svg', { width: W, height: H }, box);

    // Recessive hairline grid + clean ticks (0, half, top).
    for (const t of [0, top / 2, top]) {
      el('line', { x1: M.l, x2: W - M.r, y1: y(t), y2: y(t), stroke: 'var(--grid)', 'stroke-width': 1 }, svg);
      const lab = el('text', { x: M.l - 6, y: y(t) + 4, 'text-anchor': 'end' }, svg);
      lab.textContent = (Number.isInteger(t) ? t : t.toFixed(1)) + (chart.unit === '%' ? '%' : '');
    }
    // X labels: as many as fit without colliding, always the last one.
    const step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / 100))));
    DATA.weeks.forEach((w, i) => {
      if ((n - 1 - i) % step !== 0) return;
      const t = el('text', { x: x(i), y: H - 4, 'text-anchor': n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' }, svg);
      t.textContent = w.label;
    });

    // Lines (2px, round joins), a 10% wash under a lone series, end dots with a surface ring.
    chart.series.forEach((s, si) => {
      const color = 'var(--s' + s.slot + ')';
      const pts = vals[si].map((v, i) => [x(i), y(v)]);
      if (n > 1) {
        if (chart.series.length === 1) {
          const area = 'M' + pts.map((p) => p.join(',')).join('L') + 'L' + x(n - 1) + ',' + y(0) + 'L' + x(0) + ',' + y(0) + 'Z';
          el('path', { d: area, fill: color, 'fill-opacity': 0.1, stroke: 'none' }, svg);
        }
        el('path', { d: 'M' + pts.map((p) => p.join(',')).join('L'), fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
      }
      const [ex, ey] = pts[n - 1];
      el('circle', { cx: ex, cy: ey, r: 4, fill: color, stroke: 'var(--surface)', 'stroke-width': 2 }, svg);
    });
    // End labels (value at the end of each line), skipped when two would collide.
    const ends = vals.map((v) => y(v[n - 1]));
    const collide = ends.length > 1 && Math.abs(ends[0] - ends[1]) < 13;
    if (!collide) vals.forEach((v, si) => {
      const t = el('text', { class: 'end', x: x(n - 1) + 8, y: ends[si] + 4 }, svg);
      t.textContent = v[n - 1] + (chart.unit || '');
    });

    // Crosshair: snaps to the nearest week; same readout on hover and on arrow keys.
    const cross = el('line', { y1: M.t, y2: M.t + ih, stroke: 'var(--axis)', 'stroke-width': 1, visibility: 'hidden' }, svg);
    const hot = chart.series.map((s) => el('circle', { r: 4, fill: 'var(--s' + s.slot + ')', stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }, svg));
    let cur = -1;
    const show = (i) => {
      cur = i;
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      hot.forEach((h, si) => { h.setAttribute('cx', x(i)); h.setAttribute('cy', y(vals[si][i])); h.setAttribute('visibility', 'visible'); });
      tip.textContent = '';
      const t = document.createElement('div'); t.className = 't'; t.textContent = DATA.weeks[i].label; tip.appendChild(t);
      chart.series.forEach((s, si) => {
        const r = document.createElement('div'); r.className = 'r';
        const k = document.createElement('i'); k.className = 'key s' + s.slot;
        const b = document.createElement('b'); b.textContent = vals[si][i] + (chart.unit || '');
        const sp = document.createElement('span'); sp.textContent = s.name;
        r.append(k, b, sp); tip.appendChild(r);
      });
      tip.hidden = false;
      const rect = box.getBoundingClientRect();
      const left = Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, rect.left + x(i) + 12));
      tip.style.left = left + 'px';
      tip.style.top = Math.max(8, rect.top + M.t - 4) + 'px';
    };
    const hide = () => { cur = -1; cross.setAttribute('visibility', 'hidden'); hot.forEach((h) => h.setAttribute('visibility', 'hidden')); tip.hidden = true; };
    const nearest = (px) => Math.max(0, Math.min(n - 1, n === 1 ? 0 : Math.round(((px - M.l) / iw) * (n - 1))));
    box.onpointermove = (e) => show(nearest(e.clientX - box.getBoundingClientRect().left));
    box.onpointerleave = hide;
    box.onblur = hide;
    box.onkeydown = (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        show(cur < 0 ? n - 1 : Math.max(0, Math.min(n - 1, cur + (e.key === 'ArrowRight' ? 1 : -1))));
      } else if (e.key === 'Escape') hide();
    };
    box.onfocus = () => show(n - 1);
  }

  const drawAll = () => DATA.charts.forEach((c) => {
    const box = document.querySelector('[data-chart="' + c.id + '"] .plot');
    if (box) draw(box, c);
  });
  drawAll();
  let raf = 0;
  window.addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(drawAll); });
  window.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });
})();
`;
