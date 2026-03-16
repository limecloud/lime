import type {
  ChromeBridgeObserverSnapshot,
  ChromeBridgePageInfo,
  ChromeBridgeStatusSnapshot,
} from "@/lib/webview-api";
import { shouldReplaceExistingSessionPageInfo } from "./existingSessionBridge";

export function mergeExistingSessionPageInfo(
  current: ChromeBridgePageInfo | null,
  next: ChromeBridgePageInfo | null,
): ChromeBridgePageInfo | null {
  if (!next) {
    return current;
  }
  return shouldReplaceExistingSessionPageInfo(current, next) ? next : current;
}

export function updateExistingSessionPageInfoRecord(
  previous: Record<string, ChromeBridgePageInfo>,
  profileKey: string,
  nextPageInfo: ChromeBridgePageInfo | null,
): Record<string, ChromeBridgePageInfo> {
  const currentPageInfo = previous[profileKey] ?? null;
  const mergedPageInfo = mergeExistingSessionPageInfo(
    currentPageInfo,
    nextPageInfo,
  );

  if (!mergedPageInfo || mergedPageInfo === currentPageInfo) {
    return previous;
  }

  return {
    ...previous,
    [profileKey]: mergedPageInfo,
  };
}

export function syncExistingSessionPageInfoRecord(
  previous: Record<string, ChromeBridgePageInfo>,
  bridgeStatus: ChromeBridgeStatusSnapshot | null,
): Record<string, ChromeBridgePageInfo> {
  if (!bridgeStatus) {
    return previous;
  }

  let nextPageInfoByProfileKey = previous;
  for (const observer of bridgeStatus.observers) {
    nextPageInfoByProfileKey = updateExistingSessionPageInfoRecord(
      nextPageInfoByProfileKey,
      observer.profile_key,
      observer.last_page_info ?? null,
    );
  }
  return nextPageInfoByProfileKey;
}

export function mergeExistingSessionObserverPageInfo(
  current: ChromeBridgePageInfo | null,
  observer: Pick<ChromeBridgeObserverSnapshot, "last_page_info"> | null,
): ChromeBridgePageInfo | null {
  if (!observer) {
    return null;
  }
  return mergeExistingSessionPageInfo(current, observer.last_page_info ?? null);
}
