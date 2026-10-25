import type { Session } from "electron";
import type { BrowserHistoryHost } from "./browserHistoryHost";
import type { BrowserDownloadsHost } from "./browserDownloadsHost";
import {
  BROWSER_DATA_TIME_RANGES,
  browserDataRecord,
  browserDataSince,
  parseBrowserDataRequest,
  parseBrowserDataTimeRange,
  type BrowserDataClearResult,
  type BrowserDataSettings,
  type BrowserDataSummary,
} from "../src/lib/api/browserDataTypes";

export const BROWSER_DATA_COMMANDS = [
  "browser_data_settings",
  "browser_data_summary",
  "browser_data_clear",
] as const;
export type BrowserDataCommand = (typeof BROWSER_DATA_COMMANDS)[number];
export function isBrowserDataCommand(
  value: string,
): value is BrowserDataCommand {
  return BROWSER_DATA_COMMANDS.includes(value as BrowserDataCommand);
}
type DataSession = Pick<Session, "cookies" | "getCacheSize" | "clearData">;

/** Coordinates existing owners; never creates a second Profile, history or download store. */
export class BrowserDataHost {
  #clearing = false;
  constructor(
    private readonly owners: {
      history: Pick<BrowserHistoryHost, "summarizeData" | "invoke">;
      downloads: Pick<BrowserDownloadsHost, "summarizeData" | "clearData">;
      siteSettings: { count(): Promise<number>; clear(): Promise<unknown> };
      session: () => DataSession;
      now?: () => number;
    },
  ) {}

  async invoke(
    command: BrowserDataCommand,
    input: unknown = {},
  ): Promise<unknown> {
    if (command === "browser_data_settings") {
      browserDataRecord(input ?? {}, []);
      return this.settings();
    }
    if (command === "browser_data_summary") {
      const { timeRange } = browserDataRecord(input, ["timeRange"]);
      const since = browserDataSince(
        parseBrowserDataTimeRange(timeRange),
        (this.owners.now ?? Date.now)(),
      );
      const native = this.owners.session();
      const [history, siteData, cache, downloads, siteSettings] = await Promise.all([
        this.owners.history.summarizeData(since),
        optional(async () => ({
          siteCount: new Set(
            (await native.cookies.get({}))
              .map((cookie) => cookie.domain?.replace(/^\.+/u, ""))
              .filter(Boolean),
          ).size,
        })),
        optional(async () => {
          const sizeBytes = await native.getCacheSize();
          if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0)
            throw new Error("Invalid cache size");
          return { sizeBytes };
        }),
        optional(() => this.owners.downloads.summarizeData(since)),
        optional(async () => ({ siteCount: await this.owners.siteSettings.count() })),
      ]);
      return {
        history,
        siteData,
        cache,
        downloads,
        siteSettings,
      } satisfies BrowserDataSummary;
    }
    const request = parseBrowserDataRequest(input);
    if (this.#clearing)
      throw new Error("Browser data clearing is already in progress");
    this.#clearing = true;
    try {
      const settings = this.settings();
      const unsupported = request.dataTypes.filter(
        (type) =>
          !settings.dataRemovalPermitted[type] ||
          !settings.supportedTimeRanges[type].includes(request.timeRange),
      );
      if (unsupported.length)
        return {
          status: "unsupported",
          dataTypes: unsupported,
        } satisfies BrowserDataClearResult;
      // Resolve all native capability requirements before the first destructive operation.
      const native = request.dataTypes.some(
        (type) => type === "siteData" || type === "cache",
      )
        ? this.owners.session()
        : null;
      if (native && typeof native.clearData !== "function")
        throw new Error("Browser data clearing is unavailable");
      const since = browserDataSince(
        request.timeRange,
        (this.owners.now ?? Date.now)(),
      );
      const clearedDataTypes: typeof request.dataTypes = [];
      for (const [index, type] of request.dataTypes.entries()) {
        try {
          if (type === "history")
            await this.owners.history.invoke("browser_history_clear", {
              since,
            });
          else if (type === "downloads")
            await this.owners.downloads.clearData(since);
          else if (type === "siteSettings")
            await this.owners.siteSettings.clear();
          else if (type === "siteData") {
            // Stock Electron supports these masks only for all time. Never pass a timeRange it ignores.
            await native!.clearData({
              dataTypes: [
                "cookies",
                "backgroundFetch",
                "fileSystems",
                "indexedDB",
                "localStorage",
                "serviceWorkers",
              ],
            });
          } else if (type === "cache")
            await native!.clearData({ dataTypes: ["cache"] });
          else throw new Error("Browser data type is unavailable");
          clearedDataTypes.push(type);
        } catch {
          // Native stores may already have partial effects; this is never a rollback claim.
          return {
            status: "failed",
            clearedDataTypes,
            failedDataTypes: [type],
            pendingDataTypes: request.dataTypes.slice(index + 1),
          } satisfies BrowserDataClearResult;
        }
      }
      return {
        status: "completed",
        dataTypes: clearedDataTypes,
      } satisfies BrowserDataClearResult;
    } finally {
      this.#clearing = false;
    }
  }

  settings(): BrowserDataSettings {
    return {
      dataRemovalPermitted: {
        history: true,
        siteData: true,
        cache: true,
        downloads: true,
        formData: true,
        siteSettings: true,
      },
      supportedTimeRanges: {
        history: [...BROWSER_DATA_TIME_RANGES],
        downloads: [...BROWSER_DATA_TIME_RANGES],
        siteData: ["allTime"],
        cache: ["allTime"],
        formData: [],
        siteSettings: ["allTime"],
      },
    };
  }
}
async function optional<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}
