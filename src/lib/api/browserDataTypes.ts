export const BROWSER_DATA_TYPES = [
  "history",
  "siteData",
  "cache",
  "downloads",
  "formData",
  "siteSettings",
] as const;
export type BrowserDataType = (typeof BROWSER_DATA_TYPES)[number];
export const BROWSER_DATA_TIME_RANGES = [
  "lastHour",
  "lastDay",
  "lastWeek",
  "lastMonth",
  "allTime",
] as const;
export type BrowserDataTimeRange = (typeof BROWSER_DATA_TIME_RANGES)[number];
export interface BrowserDataSettings {
  dataRemovalPermitted: Record<BrowserDataType, boolean>;
  supportedTimeRanges: Record<BrowserDataType, BrowserDataTimeRange[]>;
}
export interface BrowserDataRequest {
  dataTypes: BrowserDataType[];
  timeRange: BrowserDataTimeRange;
}
export interface BrowserDataSummary {
  history: { firstSite: string | null; siteCount: number };
  siteData: { siteCount: number } | null;
  cache: { sizeBytes: number } | null;
  downloads: { count: number } | null;
  siteSettings: { siteCount: number } | null;
}
export type BrowserDataClearResult =
  | { status: "completed"; dataTypes: BrowserDataType[] }
  | { status: "unsupported"; dataTypes: BrowserDataType[] }
  | {
      status: "failed";
      clearedDataTypes: BrowserDataType[];
      failedDataTypes: BrowserDataType[];
      pendingDataTypes: BrowserDataType[];
    };

export function browserDataRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error("Invalid Browser data payload");
  return value as Record<string, unknown>;
}
export function parseBrowserDataTimeRange(
  value: unknown,
): BrowserDataTimeRange {
  if (!BROWSER_DATA_TIME_RANGES.includes(value as BrowserDataTimeRange))
    throw new Error("Invalid Browser data time range");
  return value as BrowserDataTimeRange;
}
export function browserDataSince(
  range: BrowserDataTimeRange,
  now: number,
): number {
  parseBrowserDataTimeRange(range);
  if (!Number.isSafeInteger(now) || now < 0)
    throw new Error("Invalid Browser data clock");
  const hours = {
    lastHour: 1,
    lastDay: 24,
    lastWeek: 168,
    lastMonth: 672,
    allTime: 0,
  }[range];
  return hours ? Math.max(0, now - hours * 3_600_000) : 0;
}
function parseTypes(value: unknown, allowEmpty = false): BrowserDataType[] {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && !value.length) ||
    value.length > BROWSER_DATA_TYPES.length ||
    new Set(value).size !== value.length ||
    value.some((type) => !BROWSER_DATA_TYPES.includes(type))
  )
    throw new Error("Invalid Browser data types");
  return BROWSER_DATA_TYPES.filter((type) => value.includes(type));
}
export function parseBrowserDataRequest(value: unknown): BrowserDataRequest {
  const record = browserDataRecord(value, ["dataTypes", "timeRange"]);
  return {
    dataTypes: parseTypes(record.dataTypes),
    timeRange: parseBrowserDataTimeRange(record.timeRange),
  };
}
export function assertBrowserDataSettings(
  value: unknown,
): asserts value is BrowserDataSettings {
  const record = browserDataRecord(value, [
    "dataRemovalPermitted",
    "supportedTimeRanges",
  ]);
  const policy = browserDataRecord(
    record.dataRemovalPermitted,
    BROWSER_DATA_TYPES,
  );
  const supported = browserDataRecord(
    record.supportedTimeRanges,
    BROWSER_DATA_TYPES,
  );
  for (const type of BROWSER_DATA_TYPES) {
    const ranges = supported[type];
    if (
      typeof policy[type] !== "boolean" ||
      !Array.isArray(ranges) ||
      ranges.length > BROWSER_DATA_TIME_RANGES.length ||
      new Set(ranges).size !== ranges.length
    )
      throw new Error("Invalid Browser data settings");
    ranges.forEach(parseBrowserDataTimeRange);
  }
}
export function assertBrowserDataSummary(
  value: unknown,
): asserts value is BrowserDataSummary {
  const record = browserDataRecord(value, [
    "history",
    "siteData",
    "cache",
    "downloads",
    "siteSettings",
  ]);
  const history = browserDataRecord(record.history, ["firstSite", "siteCount"]);
  const count = (number: unknown) =>
    typeof number === "number" && Number.isSafeInteger(number) && number >= 0;
  if (
    !count(history.siteCount) ||
    (history.siteCount === 0
      ? history.firstSite !== null
      : typeof history.firstSite !== "string" ||
        !history.firstSite ||
        history.firstSite.length > 2048)
  )
    throw new Error("Invalid Browser history summary");
  for (const [type, field] of [
    ["siteData", "siteCount"],
    ["cache", "sizeBytes"],
    ["downloads", "count"],
    ["siteSettings", "siteCount"],
  ] as const) {
    if (record[type] === null) continue;
    if (!count(browserDataRecord(record[type], [field])[field]))
      throw new Error("Invalid Browser data summary");
  }
}
export function assertBrowserDataClearResult(
  value: unknown,
): asserts value is BrowserDataClearResult {
  const record = browserDataRecord(value, [
    "status",
    "dataTypes",
    "clearedDataTypes",
    "failedDataTypes",
    "pendingDataTypes",
  ]);
  if (record.status === "completed" || record.status === "unsupported") {
    browserDataRecord(record, ["status", "dataTypes"]);
    parseTypes(record.dataTypes);
  } else if (record.status === "failed") {
    browserDataRecord(record, [
      "status",
      "clearedDataTypes",
      "failedDataTypes",
      "pendingDataTypes",
    ]);
    const cleared = parseTypes(record.clearedDataTypes, true);
    const failed = parseTypes(record.failedDataTypes);
    const pending = parseTypes(record.pendingDataTypes, true);
    parseTypes([...cleared, ...failed, ...pending]);
  } else throw new Error("Invalid Browser data result");
}
