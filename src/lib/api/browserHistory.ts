import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import { assertBrowserHistoryMutationResult } from "./browserHistoryTypes";
import {
  assertBrowserHistoryVisitsPage,
  parseBrowserHistoryVisitsQuery,
  parseBrowserHistoryVisitTargets,
  type BrowserHistoryVisitsQuery,
  type BrowserHistoryVisitTarget,
} from "./browserHistoryVisits";
export type {
  BrowserHistoryEntry,
  BrowserHistoryPage,
} from "./browserHistoryTypes";

export async function listBrowserHistoryVisits(
  query: BrowserHistoryVisitsQuery = {},
) {
  const result = await safeInvoke<unknown>("browser_history_list", {
    ...parseBrowserHistoryVisitsQuery(query),
    view: "visits",
  });
  assertBrowserHistoryVisitsPage(result);
  return result;
}
export async function removeBrowserHistoryVisits(
  entries: BrowserHistoryVisitTarget[],
) {
  const result = await safeInvoke<unknown>("browser_history_remove", {
    entries: parseBrowserHistoryVisitTargets(entries),
  });
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
