// Saved weekly reports in Vercel Blob (private store): one JSON file per week,
// reports/<reportDate>.json. Pages read them server-side; nothing is publicly reachable.
import { get, list, put } from '@vercel/blob';
import type { Report } from './report';

const PREFIX = 'reports/';

export type StoredReport = {
  version: 1;
  savedAt: string;
  report: Report;
};

const pathFor = (date: string) => `${PREFIX}${date}.json`;

export async function saveReport(report: Report): Promise<void> {
  const body: StoredReport = { version: 1, savedAt: new Date().toISOString(), report };
  await put(pathFor(report.reportDate), JSON.stringify(body), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true, // re-saving a week replaces it
  });
}

/** Dates of all saved reports, oldest first. */
export async function listReportDates(): Promise<string[]> {
  const dates: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
    for (const b of page.blobs) {
      const m = /^reports\/(\d{4}-\d{2}-\d{2})\.json$/.exec(b.pathname);
      if (m) dates.push(m[1]);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return dates.sort();
}

export async function loadReport(date: string): Promise<StoredReport | null> {
  const res = await get(pathFor(date), { access: 'private', useCache: false });
  if (!res || res.statusCode !== 200) return null;
  return JSON.parse(await new Response(res.stream).text()) as StoredReport;
}

/** Every saved report, oldest first. */
export async function loadAllReports(): Promise<StoredReport[]> {
  const dates = await listReportDates();
  const all = await Promise.all(dates.map(loadReport));
  return all.filter((r): r is StoredReport => !!r);
}
