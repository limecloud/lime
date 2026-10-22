import {
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { LayoutMode } from "@/lib/workspace/workbenchContract";
import type { AgentThreadItem, AgentThreadTurn } from "@/lib/api/agentProtocol";
import { useThreadOutputs } from "./right-surface/useThreadOutputs";
import type { ReviewThreadSidePanelTarget } from "./ReviewThreadSidePanelTab";
import type { WorkspaceArticleWorkspace } from "./workspaceArticleWorkspaceModel";
import { useWorkspaceRightSurfaceActionRuntime } from "./useWorkspaceRightSurfaceActionRuntime";
import type { WorkspaceRightSurfacePendingActions } from "./useWorkspaceRightSurfaceArtifactOpenRuntime";
import { useWorkspaceRightSurfaceDerivedRuntime } from "./useWorkspaceRightSurfaceDerivedRuntime";
import type { WorkspaceRightSurfaceLocalStateRuntime } from "./useWorkspaceRightSurfaceLocalStateRuntime";
import { useWorkspaceRightSurfacePendingBridgeRuntime } from "./useWorkspaceRightSurfacePendingBridgeRuntime";
import { useWorkspaceRightSurfaceProjectionRuntime } from "./useWorkspaceRightSurfaceProjectionRuntime";
import { closeBrowserTab } from "@/lib/api/browserTab";
import { useWorkspaceBrowserTabProjection } from "./useWorkspaceBrowserTabProjection";
import {
  createBrowserWorkspaceLinkTab,
  type BrowserWorkspaceOwner,
} from "@/lib/api/browserWorkspace";
import {
  buildWorkspacePluginSurfacesFromThreadItems,
  resolveWorkspacePluginSurfaceSessionEpoch,
  resolveWorkspacePluginSurfaceThreadId,
  type WorkspacePluginSurfaceSessionEpoch,
} from "./workspacePluginSurfaceModel";

interface UseWorkspaceRightSurfaceCoordinatorRuntimeParams {
  articleEditorRightSurface: WorkspaceArticleWorkspace | null;
  articleEditorRightSurfaceAvailable: boolean;
  bindRightSurfacePendingActions: (
    actions: WorkspaceRightSurfacePendingActions,
  ) => void;
  canvasWorkbenchRootPath: string | null;
  clawTraceEnabled: boolean;
  expertInfoPanelCollapsed: boolean;
  expertInfoPanelVisible: boolean;
  handleToggleCanvas: () => void;
  harnessPendingCount: number;
  hasExpertInfoPanel: boolean;
  localState: WorkspaceRightSurfaceLocalStateRuntime;
  preferredServiceSkillResultFileTarget: ReviewThreadSidePanelTarget | null;
  runtimeWorkspaceId: string | null;
  sceneIsPreparingSend: boolean;
  sceneIsSending: boolean;
  sceneLayoutMode: LayoutMode;
  sceneSessionId?: string | null;
  sceneThreadId?: string | null;
  sessionId?: string | null;
  shellRightSurfaceAvailable: boolean;
  showHarnessToggle: boolean;
  suppressHomeNavbarUtilityActions: boolean;
  taskCenterHomeHotpathActive: boolean;
  threadItems: readonly AgentThreadItem[];
  threadTurns?: readonly AgentThreadTurn[];
  setExpertInfoPanelCollapsed: (value: boolean) => void;
  setHarnessPanelVisible: (value: boolean) => void;
  setLayoutMode: Dispatch<SetStateAction<LayoutMode>>;
}

export function useWorkspaceRightSurfaceCoordinatorRuntime({
  articleEditorRightSurface,
  articleEditorRightSurfaceAvailable,
  bindRightSurfacePendingActions,
  canvasWorkbenchRootPath,
  clawTraceEnabled,
  expertInfoPanelCollapsed,
  expertInfoPanelVisible,
  handleToggleCanvas,
  harnessPendingCount,
  hasExpertInfoPanel,
  localState,
  preferredServiceSkillResultFileTarget,
  runtimeWorkspaceId,
  sceneIsPreparingSend,
  sceneIsSending,
  sceneLayoutMode,
  sceneSessionId,
  sceneThreadId,
  sessionId,
  shellRightSurfaceAvailable,
  showHarnessToggle,
  suppressHomeNavbarUtilityActions,
  taskCenterHomeHotpathActive,
  threadItems,
  threadTurns = [],
  setExpertInfoPanelCollapsed,
  setHarnessPanelVisible,
  setLayoutMode,
}: UseWorkspaceRightSurfaceCoordinatorRuntimeParams) {
  const effectiveSessionId = sessionId || sceneSessionId || null;
  const effectiveSceneThreadId = resolveWorkspacePluginSurfaceThreadId(
    sceneThreadId,
    threadItems,
  );
  useWorkspaceBrowserTabProjection({
    enabled: localState.sidePanelTabs.tabs.some(
      (tab) => tab.kind === "browser",
    ),
    runtimeSessionId: effectiveSessionId,
    threadId: effectiveSceneThreadId,
    onProjection: localState.synchronizeBrowserTabs,
  });
  const outputs = useThreadOutputs(
    {
      threadId: effectiveSceneThreadId,
      turns: threadTurns,
      items: threadItems,
      cwd: canvasWorkbenchRootPath,
    },
    localState.sidePanelTabs.open &&
      localState.sidePanelTabs.tabs.some(
        (tab) =>
          tab.tabId === localState.sidePanelTabs.activeTabId &&
          tab.kind === "workspace-new-tab",
      ),
  );
  const pluginSurfaceSessionEpochRef =
    useRef<WorkspacePluginSurfaceSessionEpoch | null>(null);
  const pluginSurfaceSessionEpoch = resolveWorkspacePluginSurfaceSessionEpoch({
    currentSessionId: effectiveSessionId,
    currentThreadId: effectiveSceneThreadId,
    previousEpoch: pluginSurfaceSessionEpochRef.current,
  });
  useEffect(() => {
    if (pluginSurfaceSessionEpoch.ready) {
      pluginSurfaceSessionEpochRef.current = pluginSurfaceSessionEpoch.epoch;
    }
  }, [pluginSurfaceSessionEpoch.epoch, pluginSurfaceSessionEpoch.ready]);
  const canonicalPluginSurfaces = useMemo(
    () =>
      pluginSurfaceSessionEpoch.ready
        ? buildWorkspacePluginSurfacesFromThreadItems(
            threadItems,
            localState.dismissedPluginSurfaceContainerIds,
            pluginSurfaceSessionEpoch.epoch?.threadId,
          )
        : [],
    [
      localState.dismissedPluginSurfaceContainerIds,
      pluginSurfaceSessionEpoch.epoch?.threadId,
      pluginSurfaceSessionEpoch.ready,
      threadItems,
    ],
  );
  const pendingRuntime = useWorkspaceRightSurfacePendingBridgeRuntime({
    bindRightSurfacePendingActions,
    canvasWorkbenchRootPath,
    manualRightSurface: localState.manualRightSurface,
    runtimeWorkspaceId,
    sceneIsPreparingSend,
    sceneIsSending,
    sceneLayoutMode,
    sceneSessionId,
    sessionId,
    taskCenterHomeHotpathActive,
  });
  const derivedRuntime = useWorkspaceRightSurfaceDerivedRuntime({
    activeBrowserRightSurfaceIntent: localState.activeBrowserRightSurfaceIntent,
    activeFilesRightSurfaceTarget: localState.activeFilesRightSurfaceTarget,
    activePluginSurfaceContainerId: localState.activePluginSurfaceContainerId,
    activePluginSurfaces: localState.activePluginSurfaces,
    pendingBrowserRightSurfaceIntent: pendingRuntime.pendingBrowserIntent,
    pendingFileTarget: pendingRuntime.pendingFileTarget,
    pendingPluginSurfaces: canonicalPluginSurfaces,
    preferredServiceSkillResultFileTarget,
    projectRootPath: canvasWorkbenchRootPath,
    threadItems,
  });
  const rightSurfaceHarnessEnabled =
    !suppressHomeNavbarUtilityActions && showHarnessToggle;
  const rightSurfaceTraceAvailable = !suppressHomeNavbarUtilityActions;
  const rightSurfaceTraceEnabled =
    rightSurfaceTraceAvailable && clawTraceEnabled;
  const { availableSurfaces, rightSurfaceLaunchers, rightSurfaceState } =
    useWorkspaceRightSurfaceProjectionRuntime({
      backgroundTerminalAvailable: Boolean(
        effectiveSceneThreadId &&
        (threadItems.some(
          (item) =>
            item.type === "command_execution" &&
            item.thread_id === effectiveSceneThreadId &&
            item.process_id,
        ) ||
          localState.sidePanelTabs.tabs.some(
            (tab) => tab.kind === "background-terminal",
          )),
      ),
      appServerPendingIntents: pendingRuntime.pendingIntents,
      appSurfaceAvailable: derivedRuntime.pluginSurfaceRightSurfaceAvailable,
      articleWorkspaceAvailable: articleEditorRightSurfaceAvailable,
      expertInfoVisible: expertInfoPanelVisible,
      filesAvailable: derivedRuntime.filesRightSurfaceAvailable,
      harnessPendingCount,
      hasExpertInfoPanel,
      manualRightSurface: localState.manualRightSurface,
      openedRightSurfaces: localState.openedRightSurfaces,
      preferredServiceSkillResultFileTargetRelativePath:
        preferredServiceSkillResultFileTarget?.relativePath,
      sceneLayoutMode,
      shellAvailable: shellRightSurfaceAvailable,
      showHarnessToggle,
      suppressHomeNavbarUtilityActions,
      traceAvailable: rightSurfaceTraceAvailable,
    });
  const { pruneRightSurfaces, rememberRightSurface } = localState;
  useEffect(() => {
    pruneRightSurfaces(availableSurfaces);
  }, [
    availableSurfaces,
    localState.manualRightSurface,
    localState.openedRightSurfaces,
    pruneRightSurfaces,
  ]);
  useEffect(() => {
    if (rightSurfaceState.activeSurface) {
      rememberRightSurface(rightSurfaceState.activeSurface);
    }
  }, [rememberRightSurface, rightSurfaceState.activeSurface]);
  const actionRuntime = useWorkspaceRightSurfaceActionRuntime({
    activeBrowserRightSurfaceIntent: localState.activeBrowserRightSurfaceIntent,
    activePluginSurfaceContainerId: localState.activePluginSurfaceContainerId,
    activePluginSurfaces: localState.activePluginSurfaces,
    articleEditorRightSurface,
    articleEditorRightSurfaceAvailable,
    availableSurfaces,
    browserRightSurfaceAvailable: derivedRuntime.browserRightSurfaceAvailable,
    closeRightSurface: localState.closeRightSurface,
    openSidePanelTab: localState.openSidePanelTab,
    canReplaceSidePanelTab: localState.canReplaceSidePanelTab,
    consumePendingRequestsForSurface:
      pendingRuntime.consumePendingRequestsForSurface,
    dismissPendingRequestsForSurface:
      pendingRuntime.dismissPendingRequestsForSurface,
    expertInfoPanelCollapsed,
    filesRightSurfaceAvailable: derivedRuntime.filesRightSurfaceAvailable,
    filesRightSurfaceTarget: derivedRuntime.filesRightSurfaceTarget,
    handleToggleCanvas,
    manualRightSurface: localState.manualRightSurface,
    pendingBrowserRightSurfaceIntent: pendingRuntime.pendingBrowserIntent,
    pendingPluginSurfaces: canonicalPluginSurfaces,
    pluginSurfaceRightSurface: derivedRuntime.pluginSurfaceRightSurface,
    pluginSurfaceRightSurfaceAvailable:
      derivedRuntime.pluginSurfaceRightSurfaceAvailable,
    pluginSurfaceRightSurfaces: derivedRuntime.pluginSurfaceRightSurfaces,
    refreshRightSurfacePendingRequests: pendingRuntime.refreshPendingRequests,
    rightSurfaceActiveSurface: rightSurfaceState.activeSurface,
    rightSurfaceHarnessEnabled,
    rightSurfaceTraceAvailable,
    sceneLayoutMode,
    setActiveArticleWorkspace: localState.setActiveArticleWorkspace,
    setActiveBrowserRightSurfaceIntent:
      localState.setActiveBrowserRightSurfaceIntent,
    setActiveFilesRightSurfaceTarget:
      localState.setActiveFilesRightSurfaceTarget,
    setActivePluginSurfaceContainerId:
      localState.setActivePluginSurfaceContainerId,
    setActivePluginSurfaces: localState.setActivePluginSurfaces,
    setDismissedPluginSurfaceContainerIds:
      localState.setDismissedPluginSurfaceContainerIds,
    setExpertInfoPanelCollapsed,
    setHarnessPanelVisible,
    setLayoutMode,
    setManualRightSurface: localState.setManualRightSurface,
    setRightSurfaceBrowserTitle: localState.setRightSurfaceBrowserTitle,
  });

  return {
    ...derivedRuntime,
    ...actionRuntime,
    outputs,
    openBrowserInBackground: localState.openBrowserInBackground,
    handleBrowserLaunchApplied: (requestId: string) => {
      if (
        localState.activeBrowserRightSurfaceIntent?.sourceRequestId !==
          requestId ||
        localState.activeBrowserRightSurfaceIntent.launchApplied
      )
        return;
      localState.setActiveBrowserRightSurfaceIntent((current) =>
        current?.sourceRequestId === requestId && !current.launchApplied
          ? { ...current, launchApplied: true }
          : current,
      );
      void pendingRuntime.consumePendingRequestsForSurface("browser", [
        requestId,
      ]);
    },
    sidePanelTabs: localState.sidePanelTabs,
    handleOpenBrowserAddress: async (
      sourceTabId: string,
      url: string,
      ensureOwner?: () => Promise<BrowserWorkspaceOwner | null>,
    ) => {
      const source = localState.captureBrowserAddressSource(sourceTabId);
      let resolvedOwner: BrowserWorkspaceOwner | null = null;
      const isCurrent = () => source.isCurrent(resolvedOwner);
      if (!isCurrent()) return;
      const owner =
        effectiveSessionId && effectiveSceneThreadId
          ? {
              runtimeSessionId: effectiveSessionId,
              threadId: effectiveSceneThreadId,
            }
          : await ensureOwner?.();
      resolvedOwner = owner ?? null;
      if (!isCurrent()) return;
      if (!owner)
        throw new Error("Browser workspace requires a canonical conversation");
      const identity = await createBrowserWorkspaceLinkTab({
        owner,
        url,
        background: false,
        isCurrent,
      });
      if (!identity || !isCurrent()) return;
      source.replace(owner, identity.tabId);
      setHarnessPanelVisible(false);
      setExpertInfoPanelCollapsed(true);
    },
    getFileDraft: localState.getFileDraft,
    setFileDraft: localState.setFileDraft,
    openWorkspaceFile: localState.openWorkspaceFile,
    pinSidePanelTab: localState.pinSidePanelTab,
    backgroundTerminalItems: threadItems,
    openBackgroundTerminal: (target: AgentThreadItem) => {
      if (
        target.type !== "command_execution" ||
        target.thread_id !== effectiveSceneThreadId
      )
        return;
      const item = threadItems.find(
        (item) =>
          item.id === target.id &&
          item.turn_id === target.turn_id &&
          item.thread_id === target.thread_id,
      );
      if (item?.type !== "command_execution") return;
      setHarnessPanelVisible(false);
      setExpertInfoPanelCollapsed(true);
      localState.openBackgroundTerminal(item);
    },
    handleNewSidePanelTab: () => {
      setHarnessPanelVisible(false);
      setExpertInfoPanelCollapsed(true);
      localState.openSidePanelTab("workspace-new-tab");
    },
    handleSelectSidePanelTab: (tabId: string) => {
      const tab = localState.sidePanelTabs.tabs.find(
        (item) => item.tabId === tabId,
      );
      if (!tab) return;
      if (
        tab.kind !== "workspace-new-tab" &&
        tab.kind !== "files" &&
        tab.kind !== "background-terminal" &&
        tab.kind !== "shell" &&
        tab.kind !== "browser"
      )
        actionRuntime.handleSelectRightSurfaceTab(tab.kind);
      else {
        setHarnessPanelVisible(false);
        setExpertInfoPanelCollapsed(true);
      }
      localState.selectSidePanelTab(tabId);
    },
    handleCloseSidePanelTab: (tabId: string) => {
      const tab = localState.sidePanelTabs.tabs.find(
        (item) => item.tabId === tabId,
      );
      if (!tab) return;
      if (tab.browser) {
        void closeBrowserTab(tab.browser.tabId).catch((reason: unknown) =>
          console.error("Browser tab close failed", reason),
        );
        return;
      }
      if (tab.kind === "background-terminal") {
        localState.closeSidePanelTab(tabId);
        return;
      }
      const sameKind = localState.sidePanelTabs.tabs.filter(
        (item) => item.kind === tab.kind,
      );
      if (sameKind.length === 1)
        actionRuntime.handleCloseRightSurfaceTab(tab.kind);
      else localState.closeSidePanelTab(tabId);
    },
    handleSelectChatFromNewTab: (tabId: string) => {
      if (!localState.canReplaceSidePanelTab(tabId)) return;
      localState.closeSidePanelTab(tabId);
      localState.setManualRightSurface(null);
      setHarnessPanelVisible(false);
      setExpertInfoPanelCollapsed(true);
      setLayoutMode("chat");
      document
        .querySelector<HTMLElement>(
          '[data-composer-editor-host] [role="textbox"][contenteditable="true"]',
        )
        ?.focus();
    },
    handleToggleSidePanel: (
      onlyAction?: import("./right-surface/rightSurfaceTypes").WorkspaceRightSurfaceKind,
    ) => {
      setHarnessPanelVisible(false);
      setExpertInfoPanelCollapsed(true);
      if (rightSurfaceState.activeSurface) {
        localState.setManualRightSurface(null);
        setLayoutMode("chat");
      } else if (!localState.sidePanelTabs.tabs.length && onlyAction) {
        actionRuntime.handleSelectRightSurfaceTab(onlyAction);
      } else localState.showSidePanel();
    },
    activePluginSurfaceContainerId: localState.activePluginSurfaceContainerId,
    rightSurfaceBrowserTitle: localState.rightSurfaceBrowserTitle,
    rightSurfaceHarnessEnabled,
    rightSurfaceLaunchers,
    rightSurfaceState,
    rightSurfaceTraceAvailable,
    rightSurfaceTraceEnabled,
  };
}

export type WorkspaceRightSurfaceCoordinatorRuntime = ReturnType<
  typeof useWorkspaceRightSurfaceCoordinatorRuntime
>;
