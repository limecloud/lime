import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import {
  assertBrowserHistoryMutationResult,
  assertBrowserHistoryPage,
  parseBrowserHistoryClear,
  parseBrowserHistoryIds,
  parseBrowserHistoryQuery,
  type BrowserHistoryClear,
  type BrowserHistoryQuery,
} from "./browserHistoryTypes";
export type {
  BrowserHistoryEntry,
  BrowserHistoryPage,
} from "./browserHistoryTypes";

export async function listBrowserHistory(query: BrowserHistoryQuery = {}) {
  const result = await safeInvoke<unknown>(
    "browser_history_list",
    parseBrowserHistoryQuery(query),
  );
  assertBrowserHistoryPage(result);
  return result;
}
export async function removeBrowserHistory(ids: string[]) {
  const result = await safeInvoke<unknown>("browser_history_remove", {
    ids: parseBrowserHistoryIds(ids),
  });
  assertBrowserHistoryMutationResult(result);
  return result;
}
export async function clearBrowserHistory(options: BrowserHistoryClear = {}) {
  const result = await safeInvoke<unknown>(
    "browser_history_clear",
    { ...parseBrowserHistoryClear(options) },
  );
  assertBrowserHistoryMutationResult(result);
  return result;
}
export function listenBrowserHistoryChanged(
  handler: (revision: number) => void,
) {
  return safeListen<{ revision: number }>(
    "browser-history-changed",
    ({ payload }) => {
      if (
        !payload ||
        !Number.isSafeInteger(payload.revision) ||
        payload.revision < 0
      )
        throw new Error("Browser history revision is invalid");
      handler(payload.revision);
    },
  );
}
