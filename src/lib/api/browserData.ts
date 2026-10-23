import { safeInvoke } from "@/lib/dev-bridge";
import {
  assertBrowserDataSettings,
  assertBrowserDataSummary,
  assertBrowserDataClearResult,
  parseBrowserDataRequest,
  parseBrowserDataTimeRange,
  type BrowserDataRequest,
  type BrowserDataTimeRange,
} from "./browserDataTypes";

export async function getBrowsingDataSettings() {
  const result = await safeInvoke<unknown>("browser_data_settings", {});
  assertBrowserDataSettings(result);
  return result;
}
export async function getBrowsingDataSummary(timeRange: BrowserDataTimeRange) {
  const result = await safeInvoke<unknown>("browser_data_summary", {
    timeRange: parseBrowserDataTimeRange(timeRange),
  });
  assertBrowserDataSummary(result);
  return result;
}
export async function clearBrowsingData(request: BrowserDataRequest) {
  const parsed = parseBrowserDataRequest(request);
  const result = await safeInvoke<unknown>("browser_data_clear", { ...parsed });
  assertBrowserDataClearResult(result);
  const reported =
    result.status === "failed"
      ? [
          ...result.clearedDataTypes,
          ...result.failedDataTypes,
          ...result.pendingDataTypes,
        ]
      : result.dataTypes;
  if (
    reported.some((type) => !parsed.dataTypes.includes(type)) ||
    (result.status !== "unsupported" &&
      reported.length !== parsed.dataTypes.length)
  )
    throw new Error("Browser data result does not match the request");
  return result;
}
