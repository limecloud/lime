import {
  browserHistoryDayKey,
  browserHistoryVisitKey,
  parseBrowserHistoryVisitTargets,
  type BrowserHistoryVisitRow,
} from "@/lib/api/browserHistoryVisits";

export function groupBrowserHistory(entries: BrowserHistoryVisitRow[]) {
  const groups = new Map<
    string,
    { key: string; visitTime: number; entries: BrowserHistoryVisitRow[] }
  >();
  for (const entry of entries) {
    const key = browserHistoryDayKey(entry.visitTime);
    const group = groups.get(key);
    if (group) group.entries.push(entry);
    else groups.set(key, { key, visitTime: entry.visitTime, entries: [entry] });
  }
  return [...groups.values()];
}

export function selectedBrowserHistory(
  entries: BrowserHistoryVisitRow[],
  selected: ReadonlySet<string>,
) {
  return parseBrowserHistoryVisitTargets(
    entries
      .filter((entry) => selected.has(browserHistoryVisitKey(entry)))
      .map(({ url, visitTime }) => ({ url, visitTime })),
  );
}
