import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import {
  assertBrowserDownloadsPage,
  assertBrowserDownloadsChange,
  parseBrowserDownloadAction,
  parseBrowserDownloadsQuery,
  type BrowserDownloadAction,
  type BrowserDownloadsQuery,
  type BrowserDownloadsChange,
} from "./browserDownloadsTypes";
export type {
  BrowserDownloadEntry,
  BrowserDownloadsPage,
  BrowserDownloadsChange,
} from "./browserDownloadsTypes";

export async function listBrowserDownloads(query: BrowserDownloadsQuery = {}) {
  const result = await safeInvoke<unknown>(
    "browser_downloads_list",
    parseBrowserDownloadsQuery(query),
  );
  assertBrowserDownloadsPage(result);
  return result;
}
export async function manageBrowserDownload(
  id: string,
  action: BrowserDownloadAction,
): Promise<void> {
  const result = await safeInvoke<unknown>(
    "browser_downloads_action",
    parseBrowserDownloadAction({ id, action }),
  );
  assertSuccess(result);
}
export async function clearBrowserDownloads(): Promise<void> {
  const result = await safeInvoke<unknown>("browser_downloads_clear", {});
  assertSuccess(result);
}
function assertSuccess(value: unknown): void {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    (value as { ok?: unknown }).ok !== true
  )
    throw new Error("Browser download operation did not succeed");
}
export function listenBrowserDownloadsChanged(
  handler: (change: BrowserDownloadsChange) => void,
) {
  return safeListen<unknown>("browser-downloads-changed", ({ payload }) => {
    try {
      assertBrowserDownloadsChange(payload);
    } catch {
      handler({ kind: "invalidated" });
      return;
    }
    handler(payload);
  });
}
