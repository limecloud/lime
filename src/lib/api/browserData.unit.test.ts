import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearBrowsingData,
  getBrowsingDataSettings,
  getBrowsingDataSummary,
} from "./browserData";
import {
  assertBrowserDataSettings,
  assertBrowserDataSummary,
  parseBrowserDataRequest,
} from "./browserDataTypes";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dev-bridge", () => ({ safeInvoke: invoke }));
beforeEach(() => invoke.mockReset());

describe("Browser data typed gateway", () => {
  it("normalizes the selection and invokes the real Host contract", async () => {
    invoke.mockResolvedValue({
      status: "completed",
      dataTypes: ["history", "downloads"],
    });
    expect(
      await clearBrowsingData({
        dataTypes: ["downloads", "history"],
        timeRange: "lastWeek",
      }),
    ).toEqual({ status: "completed", dataTypes: ["history", "downloads"] });
    expect(invoke).toHaveBeenCalledExactlyOnceWith("browser_data_clear", {
      dataTypes: ["history", "downloads"],
      timeRange: "lastWeek",
    });
  });
  it("rejects malformed policy, preview and deletion acknowledgements", async () => {
    for (const value of [
      null,
      {},
      { status: "completed", dataTypes: [] },
      { status: "completed", dataTypes: ["cache"] },
      { status: "completed", dataTypes: ["history"], ok: true },
      {
        status: "failed",
        clearedDataTypes: ["history"],
        failedDataTypes: ["history"],
        pendingDataTypes: [],
      },
    ]) {
      invoke.mockResolvedValue(value);
      await expect(
        clearBrowsingData({ dataTypes: ["history"], timeRange: "lastHour" }),
      ).rejects.toThrow();
    }
    invoke.mockResolvedValue({
      dataRemovalPermitted: {},
      supportedTimeRanges: {},
    });
    await expect(getBrowsingDataSettings()).rejects.toThrow();
    expect(invoke).toHaveBeenLastCalledWith("browser_data_settings", {});
    invoke.mockResolvedValue({
      history: { firstSite: null, siteCount: 2 },
      siteData: null,
      cache: null,
      downloads: null,
    });
    await expect(getBrowsingDataSummary("lastHour")).rejects.toThrow();
    expect(invoke).toHaveBeenLastCalledWith("browser_data_summary", {
      timeRange: "lastHour",
    });
  });
  it("preserves explicit unsupported and partial outcomes for the UI", async () => {
    const partial = {
      status: "failed",
      clearedDataTypes: ["history"],
      failedDataTypes: ["cache"],
      pendingDataTypes: ["downloads"],
    };
    invoke
      .mockResolvedValueOnce({ status: "unsupported", dataTypes: ["cache"] })
      .mockResolvedValueOnce(partial);
    const request = {
      dataTypes: ["history", "cache", "downloads"] as (
        | "history"
        | "cache"
        | "downloads"
      )[],
      timeRange: "lastHour" as const,
    };
    expect(await clearBrowsingData(request)).toEqual({
      status: "unsupported",
      dataTypes: ["cache"],
    });
    expect(await clearBrowsingData(request)).toEqual(partial);
  });
  it("rejects unknown profile, range, enum and duplicate fields before IPC", () => {
    for (const input of [
      { dataTypes: ["history"], timeRange: "allTime", partition: "default" },
      { dataTypes: ["history", "history"], timeRange: "allTime" },
      { dataTypes: ["passwords"], timeRange: "allTime" },
      { dataTypes: ["history"], timeRange: "last30Days" },
    ])
      expect(() => parseBrowserDataRequest(input)).toThrow();
    expect(invoke).not.toHaveBeenCalled();
    expect(() => assertBrowserDataSettings({})).toThrow();
    expect(() =>
      assertBrowserDataSummary({
        history: { siteCount: 0, firstSite: null },
        siteData: { siteCount: -1 },
        cache: null,
        downloads: null,
      }),
    ).toThrow();
  });
});
