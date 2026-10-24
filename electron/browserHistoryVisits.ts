import {
  browserHistoryDayKey,
  type BrowserHistorySource,
  type BrowserHistoryVisitRow,
} from "../src/lib/api/browserHistoryVisits";
import type { BrowserHistoryQuery } from "../src/lib/api/browserHistoryTypes";

export interface StoredHistoryVisit {
  visitedAt: number;
  isActorVisit: boolean;
}
export interface StoredHistoryEntry {
  id: string;
  url: string;
  title: string;
  visits: StoredHistoryVisit[];
}

/** One row per URL, local day and native visit source; all visits stay in the same store. */
export function projectHistoryVisits(
  entries: StoredHistoryEntry[],
  source: BrowserHistorySource,
): BrowserHistoryVisitRow[] {
  const rows = new Map<string, BrowserHistoryVisitRow>();
  for (const entry of entries)
    for (const visit of entry.visits) {
      if (source !== "all" && visit.isActorVisit !== (source === "agent"))
        continue;
      const key = `${entry.url}\0${browserHistoryDayKey(visit.visitedAt)}\0${visit.isActorVisit}`;
      const previous = rows.get(key);
      if (!previous || previous.visitTime < visit.visitedAt)
        rows.set(key, {
          id: entry.id,
          url: entry.url,
          title: entry.title,
          visitTime: visit.visitedAt,
          isActorVisit: visit.isActorVisit,
        });
    }
  return [...rows.values()].sort(
    (a, b) =>
      b.visitTime - a.visitTime ||
      a.id.localeCompare(b.id) ||
      Number(b.isActorVisit) - Number(a.isActorVisit),
  );
}

export function pageHistoryEntries<T>(
  entries: T[],
  query: Required<BrowserHistoryQuery>,
  revision: number,
  view: "pages" | "visits",
  source: BrowserHistorySource = "all",
) {
  let offset = 0;
  if (query.cursor !== null) {
    let cursor: unknown;
    try {
      cursor = JSON.parse(query.cursor);
    } catch {
      throw new Error("Invalid browser history cursor");
    }
    const page = cursor as Record<string, unknown> | null;
    if (
      !page ||
      typeof page !== "object" ||
      Array.isArray(page) ||
      Object.keys(page).some(
        (key) =>
          !["revision", "query", "offset", "view", "source"].includes(key),
      ) ||
      page.query !== query.query ||
      page.view !== view ||
      page.source !== source ||
      typeof page.offset !== "number" ||
      !Number.isSafeInteger(page.offset) ||
      page.offset < 0 ||
      page.offset > entries.length
    )
      throw new Error("Invalid browser history cursor");
    if (page.revision !== revision)
      throw new Error("Browser history cursor is stale");
    offset = page.offset;
  }
  return {
    entries: entries.slice(offset, offset + query.limit),
    total: entries.length,
    revision,
    nextCursor:
      offset + query.limit < entries.length
        ? JSON.stringify({
            revision,
            query: query.query,
            offset: offset + query.limit,
            view,
            source,
          })
        : null,
  };
}
