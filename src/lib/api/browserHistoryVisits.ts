import {
  BROWSER_HISTORY_MAX_VISITS,
  assertBrowserHistoryTimestamp,
  normalizeBrowserHistoryTitle,
  normalizeBrowserHistoryUrl,
  parseBrowserHistoryQuery,
  type BrowserHistoryQuery,
} from "./browserHistoryTypes";

export type BrowserHistorySource = "all" | "agent" | "other";
export interface BrowserHistoryVisitTarget {
  url: string;
  visitTime: number;
}
export interface BrowserHistoryVisitRow extends BrowserHistoryVisitTarget {
  id: string;
  title: string;
  isActorVisit: boolean;
}
export interface BrowserHistoryVisitsQuery extends BrowserHistoryQuery {
  source?: BrowserHistorySource;
}
export interface BrowserHistoryVisitsPage {
  entries: BrowserHistoryVisitRow[];
  nextCursor: string | null;
  total: number;
  revision: number;
}

export function browserHistoryDayKey(time: number): string {
  return new Date(time).toDateString();
}
export function browserHistoryVisitKey(entry: BrowserHistoryVisitRow): string {
  return `${entry.url}\0${entry.visitTime}\0${entry.isActorVisit}`;
}
export function parseBrowserHistoryVisitsQuery(
  value: unknown = {},
): Required<BrowserHistoryVisitsQuery> {
  const { source = "all", ...query } = object(value);
  if (source !== "all" && source !== "agent" && source !== "other")
    throw new Error("Invalid browser history source");
  return { ...parseBrowserHistoryQuery(query), source };
}
export function parseBrowserHistoryVisitTargets(
  value: unknown,
): BrowserHistoryVisitTarget[] {
  if (!Array.isArray(value) || value.length > BROWSER_HISTORY_MAX_VISITS)
    throw new Error("Invalid browser history visit targets");
  const targets = new Map<string, BrowserHistoryVisitTarget>();
  for (const candidate of value) {
    const entry = object(candidate);
    if (
      Object.keys(entry).some((key) => key !== "url" && key !== "visitTime") ||
      typeof entry.url !== "string" ||
      normalizeBrowserHistoryUrl(entry.url) !== entry.url
    )
      throw new Error("Invalid browser history visit target");
    assertBrowserHistoryTimestamp(entry.visitTime);
    targets.set(`${entry.url}\0${browserHistoryDayKey(entry.visitTime)}`, {
      url: entry.url,
      visitTime: entry.visitTime,
    });
  }
  return [...targets.values()];
}
export function assertBrowserHistoryVisitsPage(
  value: unknown,
): asserts value is BrowserHistoryVisitsPage {
  const page = object(value);
  if (
    Object.keys(page).some(
      (key) => !["entries", "nextCursor", "total", "revision"].includes(key),
    ) ||
    !Array.isArray(page.entries) ||
    page.entries.length > 200 ||
    !integer(page.total) ||
    page.total < page.entries.length ||
    page.total > BROWSER_HISTORY_MAX_VISITS ||
    !integer(page.revision) ||
    (page.nextCursor !== null &&
      (typeof page.nextCursor !== "string" || page.nextCursor.length > 4096))
  )
    throw new Error("Invalid browser history visit page");
  const keys = new Set<string>();
  for (const candidate of page.entries) {
    const entry = object(candidate);
    if (
      Object.keys(entry).some(
        (key) =>
          !["id", "url", "title", "visitTime", "isActorVisit"].includes(key),
      ) ||
      typeof entry.id !== "string" ||
      !entry.id ||
      entry.id.length > 128 ||
      typeof entry.url !== "string" ||
      normalizeBrowserHistoryUrl(entry.url) !== entry.url ||
      typeof entry.title !== "string" ||
      normalizeBrowserHistoryTitle(entry.title) !== entry.title ||
      typeof entry.isActorVisit !== "boolean"
    )
      throw new Error("Invalid browser history visit row");
    assertBrowserHistoryTimestamp(entry.visitTime);
    const key = `${entry.url}\0${browserHistoryDayKey(entry.visitTime)}\0${entry.isActorVisit}`;
    if (keys.has(key)) throw new Error("Duplicate browser history visit row");
    keys.add(key);
  }
}
function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid browser history visit input");
  return value as Record<string, unknown>;
}
