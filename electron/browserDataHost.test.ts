// @vitest-environment node
import type { Session } from "electron";
import { describe, expect, it, vi } from "vitest";
import { BrowserDataHost } from "./browserDataHost";
import {
  BROWSER_DATA_TYPES,
  BROWSER_DATA_TIME_RANGES,
  assertBrowserDataClearResult,
  assertBrowserDataSettings,
  assertBrowserDataSummary,
  browserDataSince,
} from "../src/lib/api/browserDataTypes";

const now = 100 * 86_400_000;
function fixture() {
  const history = {
    summarizeData: vi.fn(async () => ({
      firstSite: "example.com",
      siteCount: 1,
    })),
    invoke: vi.fn(async (): Promise<unknown> => ({})),
  };
  const downloads = {
    summarizeData: vi.fn(async () => ({ count: 3 })),
    clearData: vi.fn(async () => undefined),
  };
  const siteSettings = {
    count: vi.fn(async () => 2),
    clear: vi.fn(async () => undefined),
  };
  const native = {
    cookies: {
      get: vi.fn(async () => [
        { domain: ".example.com" },
        { domain: "example.com" },
        { domain: "sub.example.com" },
      ]),
    },
    getCacheSize: vi.fn(async () => 1234),
    clearData: vi.fn(async () => undefined),
  };
  const session = vi.fn(() => native as unknown as Session);
  return {
    history,
    downloads,
    siteSettings,
    native,
    session,
    host: new BrowserDataHost({
      history,
      downloads,
      siteSettings,
      session,
      now: () => now,
    }),
  };
}

describe("Browser data current-owner coordinator", () => {
  it("uses 28 days and inclusive since boundaries, with all time anchored at zero", () => {
    expect(
      BROWSER_DATA_TIME_RANGES.map((range) => browserDataSince(range, now)),
    ).toEqual([
      now - 3_600_000,
      now - 86_400_000,
      now - 7 * 86_400_000,
      now - 28 * 86_400_000,
      0,
    ]);
    expect(browserDataSince("lastMonth", 10)).toBe(0);
    expect(() => browserDataSince("lastHour", NaN)).toThrow();
  });
  it("reports the actual stock masks and preserves all six types and five range choices", async () => {
    const f = fixture();
    const settings = await f.host.invoke("browser_data_settings", {});
    assertBrowserDataSettings(settings);
    expect(Object.keys(settings.dataRemovalPermitted).sort()).toEqual(
      [...BROWSER_DATA_TYPES].sort(),
    );
    expect(settings.supportedTimeRanges.history).toEqual(
      BROWSER_DATA_TIME_RANGES,
    );
    expect(settings.supportedTimeRanges.siteData).toEqual(["allTime"]);
    expect(settings.supportedTimeRanges.formData).toEqual([]);
    expect(settings.supportedTimeRanges.siteSettings).toEqual(["allTime"]);
    expect(f.session).not.toHaveBeenCalled();
  });
  it.each(BROWSER_DATA_TIME_RANGES)(
    "checks the complete combination before any deletion for %s",
    async (timeRange) => {
      const f = fixture();
      const result = await f.host.invoke("browser_data_clear", {
        timeRange,
        dataTypes: [...BROWSER_DATA_TYPES],
      });
      assertBrowserDataClearResult(result);
      expect(result).toMatchObject({ status: "unsupported" });
      expect(f.history.invoke).not.toHaveBeenCalled();
      expect(f.downloads.clearData).not.toHaveBeenCalled();
      expect(f.native.clearData).not.toHaveBeenCalled();
      expect(f.session).not.toHaveBeenCalled();
    },
  );
  it("passes only recognized native masks, never an ignored timeRange, for all time", async () => {
    const f = fixture();
    expect(
      await f.host.invoke("browser_data_clear", {
        timeRange: "allTime",
        dataTypes: ["downloads", "cache", "siteData", "history"],
      }),
    ).toEqual({
      status: "completed",
      dataTypes: ["history", "siteData", "cache", "downloads"],
    });
    expect(f.history.invoke).toHaveBeenCalledExactlyOnceWith(
      "browser_history_clear",
      { since: 0 },
    );
    expect(f.downloads.clearData).toHaveBeenCalledExactlyOnceWith(0);
    expect(f.native.clearData.mock.calls).toEqual([
      [
        {
          dataTypes: [
            "cookies",
            "backgroundFetch",
            "fileSystems",
            "indexedDB",
            "localStorage",
            "serviceWorkers",
          ],
        },
      ],
      [{ dataTypes: ["cache"] }],
    ]);
  });
  it("summarizes ranged owner facts but current cookie domains and cache bytes", async () => {
    const f = fixture();
    const result = await f.host.invoke("browser_data_summary", {
      timeRange: "lastMonth",
    });
    assertBrowserDataSummary(result);
    expect(result).toEqual({
      history: { firstSite: "example.com", siteCount: 1 },
      siteData: { siteCount: 2 },
      cache: { sizeBytes: 1234 },
      downloads: { count: 3 },
      siteSettings: { siteCount: 2 },
    });
    expect(f.history.summarizeData).toHaveBeenCalledExactlyOnceWith(
      now - 28 * 86_400_000,
    );
    expect(f.downloads.summarizeData).toHaveBeenCalledExactlyOnceWith(
      now - 28 * 86_400_000,
    );
    expect(f.native.cookies.get).toHaveBeenCalledExactlyOnceWith({});
  });
  it("returns null for optional preview failures and rejects a failed history query", async () => {
    const f = fixture();
    f.native.cookies.get.mockRejectedValue(new Error("unavailable"));
    f.native.getCacheSize.mockResolvedValue(-1);
    f.downloads.summarizeData.mockRejectedValue(new Error("unavailable"));
    expect(
      await f.host.invoke("browser_data_summary", { timeRange: "lastHour" }),
    ).toEqual({
      history: { firstSite: "example.com", siteCount: 1 },
      siteData: null,
      cache: null,
      downloads: null,
      siteSettings: { siteCount: 2 },
    });
    f.history.summarizeData.mockRejectedValue(new Error("history unavailable"));
    await expect(
      f.host.invoke("browser_data_summary", { timeRange: "lastHour" }),
    ).rejects.toThrow("history unavailable");
  });
  it("reports partial effects without attempting later owners, then releases the lock", async () => {
    const f = fixture();
    f.native.clearData.mockRejectedValueOnce(new Error("partially cleared"));
    const result = await f.host.invoke("browser_data_clear", {
      timeRange: "allTime",
      dataTypes: ["history", "siteData", "downloads"],
    });
    assertBrowserDataClearResult(result);
    expect(result).toEqual({
      status: "failed",
      clearedDataTypes: ["history"],
      failedDataTypes: ["siteData"],
      pendingDataTypes: ["downloads"],
    });
    expect(f.downloads.clearData).not.toHaveBeenCalled();
    expect(
      await f.host.invoke("browser_data_clear", {
        timeRange: "lastDay",
        dataTypes: ["history", "downloads"],
      }),
    ).toMatchObject({ status: "completed" });
    expect(f.downloads.clearData).toHaveBeenCalledWith(now - 86_400_000);
  });
  it("takes the operation lock synchronously across concurrent callers", async () => {
    const f = fixture();
    let finish!: (value: unknown) => void;
    f.history.invoke.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const request = { dataTypes: ["history"], timeRange: "lastHour" };
    const first = f.host.invoke("browser_data_clear", request);
    await expect(f.host.invoke("browser_data_clear", request)).rejects.toThrow(
      "already in progress",
    );
    expect(f.history.invoke).toHaveBeenCalledOnce();
    finish({});
    await expect(first).resolves.toMatchObject({ status: "completed" });
  });
  it.each([
    { dataTypes: [], timeRange: "allTime" },
    { dataTypes: ["history", "history"], timeRange: "allTime" },
    { dataTypes: ["cookies"], timeRange: "allTime" },
    { dataTypes: ["history"], timeRange: "30days" },
    { dataTypes: ["history"], timeRange: "allTime", partition: "default" },
  ])("rejects malformed requests without effects: %j", async (request) => {
    const f = fixture();
    await expect(
      f.host.invoke("browser_data_clear", request),
    ).rejects.toThrow();
    expect(f.history.invoke).not.toHaveBeenCalled();
    expect(f.session).not.toHaveBeenCalled();
  });
});
