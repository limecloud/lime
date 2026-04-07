import type {
  BrowserActionResult,
  BrowserProfileRecord,
  ChromeBridgeObserverSnapshot,
  ChromeBridgePageInfo,
  ChromeBridgeStatusSnapshot,
} from "@/lib/webview-api";
import { browserRuntimeApi } from "./api";
import {
  parseExistingSessionPageInfo,
  parseExistingSessionTabs,
  type ExistingSessionTabRecord,
} from "./existingSessionBridge";

type ExistingSessionActionName =
  | "list_tabs"
  | "read_page"
  | "switch_tab"
  | "navigate";

export type ExistingSessionBridgeContext = {
  bridgeStatus: ChromeBridgeStatusSnapshot | null;
  observer: ChromeBridgeObserverSnapshot | null;
};

export type ExistingSessionAttachContext = ExistingSessionBridgeContext & {
  profile: BrowserProfileRecord | null;
};

function createExistingSessionActionError(
  fallbackMessage: string,
  result: BrowserActionResult,
) {
  return new Error(result.error || fallbackMessage);
}

async function executeExistingSessionAction(params: {
  profileKey: string;
  action: ExistingSessionActionName;
  args?: Record<string, unknown>;
  errorMessage: string;
}) {
  const result = await browserRuntimeApi.browserExecuteAction({
    profile_key: params.profileKey,
    backend: "lime_extension_bridge",
    action: params.action,
    args: params.args,
    timeout_ms: 30_000,
  });

  if (!result.success) {
    throw createExistingSessionActionError(params.errorMessage, result);
  }

  return result;
}

export function findExistingSessionObserver(
  bridgeStatus: ChromeBridgeStatusSnapshot | null,
  profileKey: string,
) {
  if (!bridgeStatus) {
    return null;
  }
  return (
    bridgeStatus.observers.find(
      (observer) => observer.profile_key === profileKey,
    ) ?? null
  );
}

export function buildMissingExistingSessionObserverError(profileKey: string) {
  return new Error(
    `没有检测到 profile_key=${profileKey} 的当前 Chrome 连接。请先在当前 Chrome 安装并连接 Lime Browser Bridge 扩展。`,
  );
}

export async function getExistingSessionBridgeStatus() {
  return await browserRuntimeApi.getChromeBridgeStatus().catch(() => null);
}

export async function loadExistingSessionBridgeContext(
  profileKey: string,
): Promise<ExistingSessionBridgeContext> {
  const bridgeStatus = await getExistingSessionBridgeStatus();
  return {
    bridgeStatus,
    observer: findExistingSessionObserver(bridgeStatus, profileKey),
  };
}

export function findExistingSessionProfile(
  profiles: BrowserProfileRecord[],
  profileKey: string,
) {
  return profiles.find((profile) => profile.profile_key === profileKey) ?? null;
}

export async function loadExistingSessionAttachContext(
  profileKey: string,
): Promise<ExistingSessionAttachContext> {
  const [profiles, bridgeContext] = await Promise.all([
    browserRuntimeApi
      .listBrowserProfiles({
        include_archived: false,
      })
      .catch(() => []),
    loadExistingSessionBridgeContext(profileKey),
  ]);

  return {
    profile: findExistingSessionProfile(profiles, profileKey),
    ...bridgeContext,
  };
}

export async function listExistingSessionTabs(
  profileKey: string,
): Promise<ExistingSessionTabRecord[]> {
  const result = await executeExistingSessionAction({
    profileKey,
    action: "list_tabs",
    errorMessage: "读取当前窗口标签页失败",
  });
  return parseExistingSessionTabs(result.data);
}

export async function readExistingSessionPage(
  profileKey: string,
): Promise<ChromeBridgePageInfo | null> {
  const result = await executeExistingSessionAction({
    profileKey,
    action: "read_page",
    errorMessage: "读取当前页面失败",
  });
  return parseExistingSessionPageInfo(result.data);
}

export async function switchExistingSessionTab(
  profileKey: string,
  tabId: string,
): Promise<ChromeBridgePageInfo | null> {
  const result = await executeExistingSessionAction({
    profileKey,
    action: "switch_tab",
    args: {
      target: tabId,
      wait_for_page_info: true,
    },
    errorMessage: "切换标签页失败",
  });
  return parseExistingSessionPageInfo(result.data);
}

export async function attachExistingSessionProfile(
  profile: Pick<BrowserProfileRecord, "profile_key" | "launch_url">,
): Promise<ChromeBridgePageInfo | null> {
  const result = await executeExistingSessionAction({
    profileKey: profile.profile_key,
    action: profile.launch_url ? "navigate" : "read_page",
    args: profile.launch_url
      ? {
          url: profile.launch_url,
          wait_for_page_info: true,
        }
      : undefined,
    errorMessage: "附着当前 Chrome 失败",
  });
  return parseExistingSessionPageInfo(result.data);
}
