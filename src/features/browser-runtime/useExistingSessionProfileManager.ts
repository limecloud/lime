import { startTransition, useCallback, useMemo, useState } from "react";
import type {
  BrowserProfileRecord,
  ChromeBridgePageInfo,
  ChromeBridgeStatusSnapshot,
} from "@/lib/webview-api";
import {
  type ExistingSessionTabRecord,
  getExistingSessionTabLabel,
} from "./existingSessionBridge";
import {
  attachExistingSessionProfile,
  buildMissingExistingSessionObserverError,
  getExistingSessionBridgeStatus,
  listExistingSessionTabs,
  loadExistingSessionBridgeContext,
  switchExistingSessionTab,
} from "./existingSessionBridgeClient";
import {
  syncExistingSessionPageInfoRecord,
  updateExistingSessionPageInfoRecord,
} from "./existingSessionPageInfo";

type RuntimeMessage = {
  type: "success" | "error";
  text: string;
};

type UseExistingSessionProfileManagerOptions = {
  profiles: BrowserProfileRecord[];
  existingSessionEnvironmentNotice?: string | null;
  onMessage?: (message: RuntimeMessage) => void;
  onProfileLaunched?: (profileKey: string) => void;
};

type UseExistingSessionProfileManagerResult = {
  attachProfiles: BrowserProfileRecord[];
  bridgeStatus: ChromeBridgeStatusSnapshot | null;
  bridgeObserverMap: Map<
    string,
    ChromeBridgeStatusSnapshot["observers"][number]
  >;
  bridgeConnectionCount: number;
  connectedAttachCount: number;
  pageInfoByProfileKey: Record<string, ChromeBridgePageInfo>;
  tabsByProfileKey: Record<string, ExistingSessionTabRecord[]>;
  tabPanelsOpen: Record<string, boolean>;
  loadingTabsByProfileKey: Record<string, boolean>;
  switchingTabKey: string | null;
  syncBridgeStatus: (nextBridgeStatus: ChromeBridgeStatusSnapshot | null) => void;
  refreshBridgeStatusSnapshot: () => Promise<ChromeBridgeStatusSnapshot | null>;
  loadExistingSessionTabs: (
    profile: BrowserProfileRecord,
    options?: { quiet?: boolean; open?: boolean },
  ) => Promise<ExistingSessionTabRecord[]>;
  handleAttachExistingSession: (profile: BrowserProfileRecord) => Promise<void>;
  handleToggleExistingSessionTabs: (profile: BrowserProfileRecord) => Promise<void>;
  handleSwitchExistingSessionTab: (
    profile: BrowserProfileRecord,
    tab: ExistingSessionTabRecord,
  ) => Promise<void>;
};

export function useExistingSessionProfileManager(
  options: UseExistingSessionProfileManagerOptions,
): UseExistingSessionProfileManagerResult {
  const {
    profiles,
    existingSessionEnvironmentNotice,
    onMessage,
    onProfileLaunched,
  } = options;
  const [bridgeStatus, setBridgeStatus] =
    useState<ChromeBridgeStatusSnapshot | null>(null);
  const [tabsByProfileKey, setTabsByProfileKey] = useState<
    Record<string, ExistingSessionTabRecord[]>
  >({});
  const [tabPanelsOpen, setTabPanelsOpen] = useState<Record<string, boolean>>(
    {},
  );
  const [loadingTabsByProfileKey, setLoadingTabsByProfileKey] = useState<
    Record<string, boolean>
  >({});
  const [switchingTabKey, setSwitchingTabKey] = useState<string | null>(null);
  const [pageInfoByProfileKey, setPageInfoByProfileKey] = useState<
    Record<string, ChromeBridgePageInfo>
  >({});

  const attachProfiles = useMemo(
    () =>
      profiles.filter(
        (profile) =>
          profile.archived_at === null &&
          (profile.transport_kind ?? "managed_cdp") === "existing_session",
      ),
    [profiles],
  );
  const bridgeObserverMap = useMemo(
    () =>
      new Map(
        (bridgeStatus?.observers ?? []).map((observer) => [
          observer.profile_key,
          observer,
        ]),
      ),
    [bridgeStatus],
  );
  const connectedAttachCount = useMemo(
    () =>
      attachProfiles.filter((profile) =>
        bridgeObserverMap.has(profile.profile_key),
      ).length,
    [attachProfiles, bridgeObserverMap],
  );
  const bridgeConnectionCount = bridgeStatus?.observer_count ?? 0;

  const updatePageInfo = useCallback(
    (profileKey: string, nextPageInfo: ChromeBridgePageInfo | null) => {
      setPageInfoByProfileKey((previous) =>
        updateExistingSessionPageInfoRecord(
          previous,
          profileKey,
          nextPageInfo,
        ),
      );
    },
    [],
  );

  const syncBridgeStatus = useCallback(
    (nextBridgeStatus: ChromeBridgeStatusSnapshot | null) => {
      setBridgeStatus(nextBridgeStatus);
      setPageInfoByProfileKey((previous) =>
        syncExistingSessionPageInfoRecord(previous, nextBridgeStatus),
      );
    },
    [],
  );

  const refreshBridgeStatusSnapshot = useCallback(async () => {
    const nextBridgeStatus = await getExistingSessionBridgeStatus();
    syncBridgeStatus(nextBridgeStatus);
    return nextBridgeStatus;
  }, [syncBridgeStatus]);

  const loadExistingSessionTabs = useCallback(
    async (
      profile: BrowserProfileRecord,
      loadOptions?: {
        quiet?: boolean;
        open?: boolean;
      },
    ) => {
      const profileKey = profile.profile_key;
      setLoadingTabsByProfileKey((previous) => ({
        ...previous,
        [profileKey]: true,
      }));

      try {
        const tabs = await listExistingSessionTabs(profileKey);
        startTransition(() => {
          setTabsByProfileKey((previous) => ({
            ...previous,
            [profileKey]: tabs,
          }));
          if (loadOptions?.open !== false) {
            setTabPanelsOpen((previous) => ({
              ...previous,
              [profileKey]: true,
            }));
          }
        });
        return tabs;
      } catch (error) {
        if (!loadOptions?.quiet) {
          onMessage?.({
            type: "error",
            text: `读取标签页失败: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        }
        throw error;
      } finally {
        setLoadingTabsByProfileKey((previous) => ({
          ...previous,
          [profileKey]: false,
        }));
      }
    },
    [onMessage],
  );

  const handleAttachExistingSession = useCallback(
    async (profile: BrowserProfileRecord) => {
      const { bridgeStatus: nextBridgeStatus, observer } =
        await loadExistingSessionBridgeContext(profile.profile_key);
      syncBridgeStatus(nextBridgeStatus);

      if (!observer) {
        throw buildMissingExistingSessionObserverError(profile.profile_key);
      }

      updatePageInfo(
        profile.profile_key,
        await attachExistingSessionProfile(profile),
      );

      onProfileLaunched?.(profile.profile_key);
      onMessage?.({
        type: "success",
        text: profile.launch_url
          ? `已附着当前 Chrome：${profile.name}，并导航到 ${profile.launch_url}${existingSessionEnvironmentNotice ? `。${existingSessionEnvironmentNotice}` : ""}`
          : `已附着当前 Chrome：${profile.name}${existingSessionEnvironmentNotice ? `。${existingSessionEnvironmentNotice}` : ""}`,
      });
    },
    [
      existingSessionEnvironmentNotice,
      onMessage,
      onProfileLaunched,
      syncBridgeStatus,
      updatePageInfo,
    ],
  );

  const handleToggleExistingSessionTabs = useCallback(
    async (profile: BrowserProfileRecord) => {
      const profileKey = profile.profile_key;
      if (tabPanelsOpen[profileKey]) {
        setTabPanelsOpen((previous) => ({
          ...previous,
          [profileKey]: false,
        }));
        return;
      }

      try {
        await loadExistingSessionTabs(profile, {
          open: true,
        });
      } catch (_) {
        return;
      }
    },
    [loadExistingSessionTabs, tabPanelsOpen],
  );

  const handleSwitchExistingSessionTab = useCallback(
    async (profile: BrowserProfileRecord, tab: ExistingSessionTabRecord) => {
      const tabKey = `${profile.profile_key}:${tab.id}`;
      setSwitchingTabKey(tabKey);

      try {
        updatePageInfo(
          profile.profile_key,
          await switchExistingSessionTab(profile.profile_key, tab.id),
        );

        await Promise.all([
          loadExistingSessionTabs(profile, {
            quiet: true,
            open: true,
          }).catch(() => []),
          refreshBridgeStatusSnapshot(),
        ]);

        onMessage?.({
          type: "success",
          text: `已切换到标签页：${getExistingSessionTabLabel(tab)}`,
        });
      } catch (error) {
        onMessage?.({
          type: "error",
          text: `切换标签页失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      } finally {
        setSwitchingTabKey(null);
      }
    },
    [
      loadExistingSessionTabs,
      onMessage,
      refreshBridgeStatusSnapshot,
      updatePageInfo,
    ],
  );

  return {
    attachProfiles,
    bridgeStatus,
    bridgeObserverMap,
    bridgeConnectionCount,
    connectedAttachCount,
    pageInfoByProfileKey,
    tabsByProfileKey,
    tabPanelsOpen,
    loadingTabsByProfileKey,
    switchingTabKey,
    syncBridgeStatus,
    refreshBridgeStatusSnapshot,
    loadExistingSessionTabs,
    handleAttachExistingSession,
    handleToggleExistingSessionTabs,
    handleSwitchExistingSessionTab,
  };
}
