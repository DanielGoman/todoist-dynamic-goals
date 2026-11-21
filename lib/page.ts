// Shared frame for the report pages: colors, type, navigation, and small formatting helpers.

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmt = (ymd: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...opts }).format(new Date(`${ymd}T00:00:00Z`));

/** "16 Nov" */
export const short = (ymd: string) => fmt(ymd, { day: 'numeric', month: 'short' });

/** "14 – 20 November 2026" (or "28 Nov – 4 December 2026" across months) */
export function range(from: string, to: string): string {
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  const start = sameMonth ? fmt(from, { day: 'numeric' }) : short(from);
  return `${start} – ${fmt(to, { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

/** "14–20 Nov" (compact, for lists and chart axes) */
export function rangeShort(from: string, to: string): string {
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return sameMonth ? `${fmt(from, { day: 'numeric' })}–${short(to)}` : `${short(from)} – ${short(to)}`;
}

/**
 * Change vs the previous week as a small chip: arrow + amount, colored by whether the
 * direction is good. The arrow carries the direction too, so color is never the only cue.
 */
export function delta(
  cur: number,
  prev: number | null | undefined,
  goodWhen: 'up' | 'down' | 'neutral',
  unit = '',
): string {
  if (prev === null || prev === undefined) return '';
  const d = cur - prev;
  if (d === 0) return `<span class="delta flat" title="Same as the week before">= same</span>`;
  const up = d > 0;
  const tone = goodWhen === 'neutral' ? 'flat' : (up === (goodWhen === 'up')) ? 'good' : 'bad';
  return `<span class="delta ${tone}" title="Change vs the week before">${up ? '▲' : '▼'} ${Math.abs(d)}${unit}</span>`;
}

export type NavKey = 'report' | 'reports' | 'trends';

export function page(opts: { title: string; active: NavKey; css?: string; body: string; script?: string }): string {
  const link = (key: NavKey, href: string, label: string) =>
    `<a href="${href}"${opts.active === key ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(opts.title)}</title>
<style>${BASE_CSS}${opts.css || ''}</style>
</head>
<body>
<nav class="top">
  <span class="brand">Todoist weekly</span>
  ${link('report', '/report', 'Latest')}
  ${link('reports', '/reports', 'All reports')}
  ${link('trends', '/trends', 'Trends')}
</nav>
<main>
${opts.body}
</main>
${opts.script ? `<script>${opts.script}</script>` : ''}
</body>
</html>`;
}

const BASE_CSS = `
  :root {
    --bg: #f6f5f2; --card: #ffffff; --ink: #1c1c1e; --muted: #75757c; --faint: #a6a6ad;
    --line: #e8e6e1; --track: #efede8;
    --red: #d1453b; --amber: #c97a1c; --green: #2f8f5b;
    --good: #006300; --bad: #d03b3b;
    color-scheme: light dark;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #121214; --card: #1b1b1e; --ink: #f2f2f4; --muted: #9a9aa2; --faint: #66666e;
      --line: #2a2a2f; --track: #26262b;
      --red: #ef6a5f; --amber: #e3a04a; --green: #4cbb7f;
      --good: #0ca30c; --bad: #e66767;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans Hebrew", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  a { color: inherit; }
  nav.top { max-width: 720px; margin: 0 auto; padding: 16px 20px 0; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  nav.top .brand { font-weight: 650; font-size: 13px; margin-right: auto; color: var(--muted); }
  nav.top a { text-decoration: none; font-size: 13px; color: var(--muted); padding: 5px 11px; border-radius: 99px; }
  nav.top a:hover { background: var(--track); color: var(--ink); }
  nav.top a[aria-current="page"] { background: var(--card); color: var(--ink); font-weight: 600; box-shadow: 0 0 0 1px var(--line); }
  main { max-width: 720px; margin: 0 auto; padding: 28px 20px 56px; }
  .eyebrow { margin: 0; color: var(--muted); font-size: 12px; letter-spacing: .12em; text-transform: uppercase; font-weight: 600; }
  h1 { margin: 6px 0 4px; font-size: 30px; line-height: 1.15; letter-spacing: -.02em; font-weight: 700; }
  .sub { margin: 0; color: var(--faint); font-size: 13px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; }
  .delta { display: inline-block; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .delta.good { color: var(--good); } .delta.bad { color: var(--bad); } .delta.flat { color: var(--muted); font-weight: 500; }
  .empty { margin-top: 36px; text-align: center; padding: 40px 16px; background: var(--card);
           border: 1px solid var(--line); border-radius: 14px; color: var(--muted); }
  .empty b { display: block; color: var(--ink); font-size: 17px; margin-bottom: 2px; }
  footer { margin-top: 32px; color: var(--faint); font-size: 12.5px; line-height: 1.6; }
  footer p { margin: 0 0 4px; }
  @media (max-width: 520px) {
    main { padding-top: 20px; }
    h1 { font-size: 25px; }
  }
`;
