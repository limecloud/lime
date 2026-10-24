export const BROWSER_HISTORY_MAX_ENTRIES = 10_000;
export const BROWSER_HISTORY_MAX_VISITS = 50_000;
export const BROWSER_HISTORY_MAX_FILE_BYTES = 64 * 1024 * 1024;
export const BROWSER_HISTORY_MAX_URL_LENGTH = 4096;
export const BROWSER_HISTORY_MAX_TITLE_LENGTH = 1024;

export interface BrowserHistoryEntry {
  id: string;
  url: string;
  title: string;
  /** Number of visits retained within the history storage budget. */
  visitCount: number;
  firstVisitedAt: number;
  lastVisitedAt: number;
}

export interface BrowserHistoryVisit {
  url: string;
  title?: string;
  visitedAt?: number;
  /** Set only by the native Browser owner when a committed visit is Agent controlled. */
  isActorVisit?: boolean;
}

export interface BrowserHistoryQuery {
  query?: string;
  cursor?: string | null;
  limit?: number;
}

export interface BrowserHistoryPage {
  entries: BrowserHistoryEntry[];
  nextCursor: string | null;
  total: number;
  revision: number;
}

export interface BrowserHistoryMutationResult {
  removedEntries: number;
  removedVisits: number;
  revision: number;
}

export interface BrowserHistoryClear {
  /** Inclusive lower bound; older visits to the same URL remain in history. */
  since?: number;
}

export function normalizeBrowserHistoryUrl(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > BROWSER_HISTORY_MAX_URL_LENGTH ||
    /\p{Cc}/u.test(value)
  )
    return null;
  try {
    const url = new URL(value.trim());
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      !url.hostname ||
      url.href.length > BROWSER_HISTORY_MAX_URL_LENGTH
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export function normalizeBrowserHistoryTitle(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string")
    throw new Error("Invalid browser history title");
  return value
    .replace(/[\p{Cc}\s]+/gu, " ")
    .trim()
    .slice(0, BROWSER_HISTORY_MAX_TITLE_LENGTH);
}

export function assertBrowserHistoryTimestamp(
  value: unknown,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 8_640_000_000_000_000
  )
    throw new Error("Invalid browser history timestamp");
}

export function parseBrowserHistoryQuery(
  value: unknown = {},
): Required<BrowserHistoryQuery> {
  const source = historyObject(value);
  if (
    Object.keys(source).some(
      (key) => !["query", "cursor", "limit"].includes(key),
    )
  )
    throw new Error("Unknown browser history query field");
  const query = source.query === undefined ? "" : source.query;
  const cursor = source.cursor === undefined ? null : source.cursor;
  const limit = source.limit === undefined ? 50 : source.limit;
  if (
    typeof query !== "string" ||
    query.length > 256 ||
    (cursor !== null && (typeof cursor !== "string" || cursor.length > 4096)) ||
    typeof limit !== "number" ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200
  )
    throw new Error("Invalid browser history query");
  return {
    query: query.normalize("NFKC").toLocaleLowerCase().trim(),
    cursor,
    limit,
  };
}

export function parseBrowserHistoryClear(
  value: unknown = {},
): BrowserHistoryClear {
  const source = historyObject(value);
  if (Object.keys(source).some((key) => key !== "since"))
    throw new Error("Unknown browser history clear field");
  if (source.since !== undefined) assertBrowserHistoryTimestamp(source.since);
  return source.since === undefined ? {} : { since: source.since as number };
}

export function assertBrowserHistoryPage(
  value: unknown,
): asserts value is BrowserHistoryPage {
  const page = historyObject(value);
  if (
    !Array.isArray(page.entries) ||
    page.entries.length > 200 ||
    typeof page.total !== "number" ||
    !Number.isSafeInteger(page.total) ||
    page.total < page.entries.length ||
    page.total > BROWSER_HISTORY_MAX_ENTRIES ||
    typeof page.revision !== "number" ||
    !Number.isSafeInteger(page.revision) ||
    page.revision < 0 ||
    (page.nextCursor !== null &&
      (typeof page.nextCursor !== "string" || page.nextCursor.length > 4096))
  )
    throw new Error("Invalid browser history page");
  const ids = new Set<string>();
  const urls = new Set<string>();
  for (const candidate of page.entries) {
    const entry = historyObject(candidate);
    if (
      typeof entry.id !== "string" ||
      !entry.id ||
      entry.id.length > 128 ||
      typeof entry.url !== "string" ||
      normalizeBrowserHistoryUrl(entry.url) !== entry.url ||
      typeof entry.title !== "string" ||
      normalizeBrowserHistoryTitle(entry.title) !== entry.title ||
      typeof entry.visitCount !== "number" ||
      !Number.isSafeInteger(entry.visitCount) ||
      entry.visitCount < 1 ||
      entry.visitCount > BROWSER_HISTORY_MAX_VISITS
    )
      throw new Error("Invalid browser history entry");
    if (ids.has(entry.id) || urls.has(entry.url))
      throw new Error("Duplicate browser history entry");
    ids.add(entry.id);
    urls.add(entry.url);
    assertBrowserHistoryTimestamp(entry.firstVisitedAt);
    assertBrowserHistoryTimestamp(entry.lastVisitedAt);
    if (entry.lastVisitedAt < entry.firstVisitedAt)
      throw new Error("Invalid browser history visit range");
  }
}

export function assertBrowserHistoryMutationResult(
  value: unknown,
): asserts value is BrowserHistoryMutationResult {
  const result = historyObject(value);
  for (const key of ["removedEntries", "removedVisits", "revision"] as const) {
    if (
      typeof result[key] !== "number" ||
      !Number.isSafeInteger(result[key]) ||
      result[key] < 0
    )
      throw new Error("Invalid browser history mutation result");
  }
  if (
    (result.removedEntries as number) > BROWSER_HISTORY_MAX_ENTRIES ||
    (result.removedVisits as number) > BROWSER_HISTORY_MAX_VISITS ||
    (result.removedEntries as number) > (result.removedVisits as number)
  )
    throw new Error("Invalid browser history mutation counts");
}

function historyObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid browser history input");
  return value as Record<string, unknown>;
}
