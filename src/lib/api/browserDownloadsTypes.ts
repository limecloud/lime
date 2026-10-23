export const MAX_DOWNLOAD_RECORDS = 10000;
export const BROWSER_DOWNLOAD_STATES = [
  "started",
  "progressing",
  "paused",
  "completed",
  "cancelled",
  "interrupted",
] as const;
export type BrowserDownloadState = (typeof BROWSER_DOWNLOAD_STATES)[number];
export const BROWSER_DOWNLOAD_ACTIONS = [
  "pause",
  "resume",
  "cancel",
  "open",
  "reveal",
  "remove",
] as const;
export type BrowserDownloadAction = (typeof BROWSER_DOWNLOAD_ACTIONS)[number];
export interface BrowserDownloadEntry {
  id: string;
  url: string;
  filename: string;
  mimeType: string | null;
  state: BrowserDownloadState;
  receivedBytes: number;
  totalBytes: number | null;
  startedAt: number;
  updatedAt: number;
  canPause: boolean;
  canResume: boolean;
  canCancel: boolean;
  fileExists: boolean;
}
export interface BrowserDownloadsQuery {
  query?: string;
  offset?: number;
  limit?: number;
}
export interface BrowserDownloadsPage {
  entries: BrowserDownloadEntry[];
  total: number;
  nextOffset: number | null;
  revision: number;
  historyRevision: number;
}
export type BrowserDownloadsChange =
  | { kind: "invalidated" }
  | {
      kind: "updated";
      revision: number;
      historyRevision: number;
      entries: BrowserDownloadEntry[];
      removedIds: string[];
    };

export function downloadRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Browser download payload");
  return value as Record<string, unknown>;
}
export function assertDownloadKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error("Unexpected Browser download field");
}
export function parseBrowserDownloadsQuery(
  value: unknown = {},
): Required<BrowserDownloadsQuery> {
  const record = downloadRecord(value);
  assertDownloadKeys(record, ["query", "offset", "limit"]);
  const { query = "", offset = 0, limit = 100 } = record;
  if (
    typeof query !== "string" ||
    query.length > 2048 ||
    !nonNegative(offset) ||
    !nonNegative(limit) ||
    limit < 1 ||
    limit > 1000
  )
    throw new Error("Invalid Browser download query");
  return {
    query: query.normalize("NFKC").trim().toLocaleLowerCase(),
    offset,
    limit,
  };
}
export function parseBrowserDownloadAction(value: unknown): {
  id: string;
  action: BrowserDownloadAction;
} {
  const record = downloadRecord(value);
  assertDownloadKeys(record, ["id", "action"]);
  if (
    typeof record.id !== "string" ||
    !record.id ||
    record.id.length > 128 ||
    !BROWSER_DOWNLOAD_ACTIONS.includes(record.action as BrowserDownloadAction)
  )
    throw new Error("Invalid Browser download action");
  return { id: record.id, action: record.action as BrowserDownloadAction };
}
export function assertBrowserDownloadEntry(
  value: unknown,
): asserts value is BrowserDownloadEntry {
  const entry = downloadRecord(value);
  assertDownloadKeys(entry, [
    "id",
    "url",
    "filename",
    "mimeType",
    "state",
    "receivedBytes",
    "totalBytes",
    "startedAt",
    "updatedAt",
    "canPause",
    "canResume",
    "canCancel",
    "fileExists",
  ]);
  if (
    typeof entry.id !== "string" ||
    !entry.id ||
    entry.id.length > 128 ||
    typeof entry.url !== "string" ||
    entry.url.length > 65536 ||
    typeof entry.filename !== "string" ||
    entry.filename.length > 4096 ||
    (entry.mimeType !== null &&
      (typeof entry.mimeType !== "string" || entry.mimeType.length > 1024)) ||
    !BROWSER_DOWNLOAD_STATES.includes(entry.state as BrowserDownloadState) ||
    !nonNegative(entry.receivedBytes) ||
    (entry.totalBytes !== null && !nonNegative(entry.totalBytes)) ||
    !nonNegative(entry.startedAt) ||
    !nonNegative(entry.updatedAt) ||
    entry.updatedAt < entry.startedAt ||
    ["canPause", "canResume", "canCancel", "fileExists"].some(
      (key) => typeof entry[key] !== "boolean",
    )
  )
    throw new Error("Invalid Browser download entry");
}
export function assertBrowserDownloadsPage(
  value: unknown,
): asserts value is BrowserDownloadsPage {
  const page = downloadRecord(value);
  assertDownloadKeys(page, [
    "entries",
    "total",
    "nextOffset",
    "revision",
    "historyRevision",
  ]);
  if (
    !Array.isArray(page.entries) ||
    page.entries.length > 1000 ||
    !nonNegative(page.total) ||
    page.total < page.entries.length ||
    !nonNegative(page.revision) ||
    !nonNegative(page.historyRevision) ||
    page.historyRevision > page.revision ||
    (page.nextOffset !== null &&
      (!nonNegative(page.nextOffset) || page.nextOffset >= page.total))
  )
    throw new Error("Invalid Browser download page");
  const ids = new Set<string>();
  for (const entry of page.entries) {
    assertBrowserDownloadEntry(entry);
    if (ids.has(entry.id)) throw new Error("Duplicate Browser download id");
    ids.add(entry.id);
  }
}
export function assertBrowserDownloadsChange(
  value: unknown,
): asserts value is BrowserDownloadsChange {
  const change = downloadRecord(value);
  if (change.kind === "invalidated") {
    assertDownloadKeys(change, ["kind"]);
    return;
  }
  assertDownloadKeys(change, [
    "kind",
    "revision",
    "historyRevision",
    "entries",
    "removedIds",
  ]);
  if (
    change.kind !== "updated" ||
    !nonNegative(change.revision) ||
    !nonNegative(change.historyRevision) ||
    change.historyRevision > change.revision ||
    !Array.isArray(change.entries) ||
    !Array.isArray(change.removedIds) ||
    change.entries.length > MAX_DOWNLOAD_RECORDS ||
    change.removedIds.length > MAX_DOWNLOAD_RECORDS
  )
    throw new Error("Invalid Browser download change");
  const ids = new Set<string>();
  for (const entry of change.entries) {
    assertBrowserDownloadEntry(entry);
    if (ids.has(entry.id)) throw new Error("Duplicate Browser download id");
    ids.add(entry.id);
  }
  for (const id of change.removedIds) {
    if (typeof id !== "string" || !id || id.length > 128 || ids.has(id))
      throw new Error("Invalid removed Browser download id");
    ids.add(id);
  }
}
export function nonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
