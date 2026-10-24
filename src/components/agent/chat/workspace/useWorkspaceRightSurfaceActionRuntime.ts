import {
  useCallback,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { LayoutMode } from "@/lib/workspace/workbenchContract";
import type { ReviewThreadSidePanelTarget } from "./ReviewThreadSidePanelTab";
import type { WorkspaceArticleWorkspace } from "./workspaceArticleWorkspaceModel";
import {
  closeWorkspacePluginSurfaceDescriptor,
  mergeWorkspacePluginSurfaceDescriptors,
  resolveWorkspacePluginSurfaceActiveContainerId,
  type WorkspacePluginSurfaceDescriptor,
} from "./workspacePluginSurfaceModel";
import type { WorkspaceRightSurfaceKind } from "./right-surface";
import type { WorkspaceRightSurfaceBrowserIntent } from "./workspaceRightSurfaceBrowserIntent";

type ConsumePendingRequestsForSurface = (
  surface: WorkspaceRightSurfaceKind,
) => Promise<unknown>;

type DismissPendingRequestsForSurface = (
  surface: WorkspaceRightSurfaceKind,
  reason?: string,
) => Promise<unknown>;

type RefreshRightSurfacePendingRequests = () => Promise<unknown>;
type SetBoolean = (value: boolean) => void;

interface UseWorkspaceRightSurfaceActionRuntimeParams {
  activeBrowserRightSurfaceIntent: WorkspaceRightSurfaceBrowserIntent | null;
  activePluginSurfaceContainerId: string | null;
  activePluginSurfaces: WorkspacePluginSurfaceDescriptor[];
  articleEditorRightSurface: WorkspaceArticleWorkspace | null;
  articleEditorRightSurfaceAvailable: boolean;
  availableSurfaces: ReadonlySet<WorkspaceRightSurfaceKind>;
  browserRightSurfaceAvailable: boolean;
  closeRightSurface: (kind: WorkspaceRightSurfaceKind) => void;
  canReplaceSidePanelTab: (tabId: string) => boolean;
  openSidePanelTab: (
    kind: WorkspaceRightSurfaceKind,
    replaceTabId?: string,
  ) => void;
  consumePendingRequestsForSurface: ConsumePendingRequestsForSurface;
  dismissPendingRequestsForSurface: DismissPendingRequestsForSurface;
  expertInfoPanelCollapsed: boolean;
  filesRightSurfaceAvailable: boolean;
  filesRightSurfaceTarget: ReviewThreadSidePanelTarget | null;
  handleToggleCanvas: () => void;
  manualRightSurface: WorkspaceRightSurfaceKind | null;
  pendingBrowserRightSurfaceIntent: WorkspaceRightSurfaceBrowserIntent | null;
  pendingPluginSurfaces: WorkspacePluginSurfaceDescriptor[];
  pluginSurfaceRightSurface: WorkspacePluginSurfaceDescriptor | null;
  pluginSurfaceRightSurfaceAvailable: boolean;
  pluginSurfaceRightSurfaces: WorkspacePluginSurfaceDescriptor[];
  refreshRightSurfacePendingRequests: RefreshRightSurfacePendingRequests;
  rightSurfaceActiveSurface: WorkspaceRightSurfaceKind | null;
  rightSurfaceHarnessEnabled: boolean;
  sceneLayoutMode: LayoutMode;
  setActiveArticleWorkspace: Dispatch<
    SetStateAction<WorkspaceArticleWorkspace | null>
  >;
  setActiveBrowserRightSurfaceIntent: Dispatch<
    SetStateAction<WorkspaceRightSurfaceBrowserIntent | null>
  >;
  setActiveFilesRightSurfaceTarget: Dispatch<
    SetStateAction<ReviewThreadSidePanelTarget | null>
  >;
  setActivePluginSurfaceContainerId: Dispatch<SetStateAction<string | null>>;
  setActivePluginSurfaces: Dispatch<
    SetStateAction<WorkspacePluginSurfaceDescriptor[]>
  >;
  setDismissedPluginSurfaceContainerIds: Dispatch<SetStateAction<string[]>>;
  setExpertInfoPanelCollapsed: SetBoolean;
  setHarnessPanelVisible: SetBoolean;
  setLayoutMode: Dispatch<SetStateAction<LayoutMode>>;
  setManualRightSurface: Dispatch<
    SetStateAction<WorkspaceRightSurfaceKind | null>
  >;
  setRightSurfaceBrowserTitle: Dispatch<SetStateAction<string | null>>;
}

interface WorkspaceRightSurfaceActionRuntime {
  handleCloseRightSurfaceTab: (kind: WorkspaceRightSurfaceKind) => void;
  handleClosePluginSurface: (surface: WorkspacePluginSurfaceDescriptor) => void;
  handleRightSurfaceBrowserNavigate: (
    url: string,
    title?: string | null,
  ) => void;
  handleSelectPluginSurface: (
    surface: WorkspacePluginSurfaceDescriptor,
  ) => void;
  handleSelectRightSurfaceTab: (
    kind: WorkspaceRightSurfaceKind,
    replaceTabId?: string,
  ) => void;
  handleToggleExpertInfoPanel: () => void;
  handleToggleCanvasFromRightSurface: () => void;
  handleToggleRightSurfaceBrowser: () => void;
  handleToggleRightSurfaceFiles: () => void;
  handleToggleRightSurfaceHarness: () => void;
  handleToggleRightSurfaceShell: () => void;
}

export function useWorkspaceRightSurfaceActionRuntime({
  activeBrowserRightSurfaceIntent,
  activePluginSurfaceContainerId,
  activePluginSurfaces,
  articleEditorRightSurface,
  articleEditorRightSurfaceAvailable,
  availableSurfaces,
  browserRightSurfaceAvailable,
  closeRightSurface,
  openSidePanelTab,
  canReplaceSidePanelTab,
  consumePendingRequestsForSurface,
  dismissPendingRequestsForSurface,
  expertInfoPanelCollapsed,
  filesRightSurfaceAvailable,
  filesRightSurfaceTarget,
  handleToggleCanvas,
  manualRightSurface,
  pendingBrowserRightSurfaceIntent,
  pendingPluginSurfaces,
  pluginSurfaceRightSurface,
  pluginSurfaceRightSurfaceAvailable,
  pluginSurfaceRightSurfaces,
  refreshRightSurfacePendingRequests,
  rightSurfaceActiveSurface,
  rightSurfaceHarnessEnabled,
  sceneLayoutMode,
  setActiveArticleWorkspace,
  setActiveBrowserRightSurfaceIntent,
  setActiveFilesRightSurfaceTarget,
  setActivePluginSurfaceContainerId,
  setActivePluginSurfaces,
  setDismissedPluginSurfaceContainerIds,
  setExpertInfoPanelCollapsed,
  setHarnessPanelVisible,
  setLayoutMode,
  setManualRightSurface,
  setRightSurfaceBrowserTitle,
}: UseWorkspaceRightSurfaceActionRuntimeParams): WorkspaceRightSurfaceActionRuntime {
  const closeCompetingRightSurfaces = useCallback(() => {
    setHarnessPanelVisible(false);
    setExpertInfoPanelCollapsed(true);
  }, [setExpertInfoPanelCollapsed, setHarnessPanelVisible]);

  useEffect(() => {
    if (pendingPluginSurfaces.length === 0) {
      return;
    }
    const hasNewPluginSurface = pendingPluginSurfaces.some(
      (incoming) =>
        !activePluginSurfaces.some(
          (current) => current.containerId === incoming.containerId,
        ),
    );
    if (!hasNewPluginSurface) {
      return;
    }

    setActivePluginSurfaces((current) =>
      mergeWorkspacePluginSurfaceDescriptors(current, pendingPluginSurfaces),
    );
    setActivePluginSurfaceContainerId((current) =>
      resolveWorkspacePluginSurfaceActiveContainerId({
        activeContainerId: current,
        preferredContainerId:
          pendingPluginSurfaces[pendingPluginSurfaces.length - 1]?.containerId,
        surfaces: mergeWorkspacePluginSurfaceDescriptors(
          activePluginSurfaces,
          pendingPluginSurfaces,
        ),
      }),
    );
    setHarnessPanelVisible(false);
    setExpertInfoPanelCollapsed(true);
    setManualRightSurface(
      (current) =>
        current ?? (sceneLayoutMode === "chat" ? "appSurface" : current),
    );
    void refreshRightSurfacePendingRequests();
    void consumePendingRequestsForSurface("appSurface");
  }, [
    activePluginSurfaces,
    consumePendingRequestsForSurface,
    pendingPluginSurfaces,
    refreshRightSurfacePendingRequests,
    sceneLayoutMode,
    setActivePluginSurfaceContainerId,
    setActivePluginSurfaces,
    setExpertInfoPanelCollapsed,
    setHarnessPanelVisible,
    setManualRightSurface,
  ]);

  useEffect(() => {
    if (
      !pendingBrowserRightSurfaceIntent ||
      pendingBrowserRightSurfaceIntent.priority !== "foreground"
    ) {
      return;
    }
    if (
      activeBrowserRightSurfaceIntent?.sourceRequestId ===
      pendingBrowserRightSurfaceIntent.sourceRequestId
    ) {
      return;
    }

    closeCompetingRightSurfaces();
    setActiveBrowserRightSurfaceIntent(pendingBrowserRightSurfaceIntent);
    setRightSurfaceBrowserTitle(
      pendingBrowserRightSurfaceIntent.title?.trim() || null,
    );
    setManualRightSurface("browser");
  }, [
    activeBrowserRightSurfaceIntent?.sourceRequestId,
    closeCompetingRightSurfaces,
    pendingBrowserRightSurfaceIntent,
    setActiveBrowserRightSurfaceIntent,
    setManualRightSurface,
    setRightSurfaceBrowserTitle,
  ]);

  const handleToggleRightSurfaceFiles = useCallback(() => {
    if (!filesRightSurfaceAvailable) {
      return;
    }
    const shouldOpenFiles = manualRightSurface !== "files";
    closeCompetingRightSurfaces();
    setActiveFilesRightSurfaceTarget(
      shouldOpenFiles ? filesRightSurfaceTarget : null,
    );
    if (shouldOpenFiles) {
      setManualRightSurface("files");
    } else {
      closeRightSurface("files");
    }
    if (shouldOpenFiles) {
      void refreshRightSurfacePendingRequests();
      void consumePendingRequestsForSurface("files");
    } else {
      void dismissPendingRequestsForSurface("files", "user_closed_surface");
    }
  }, [
    closeRightSurface,
    closeCompetingRightSurfaces,
    consumePendingRequestsForSurface,
    dismissPendingRequestsForSurface,
    filesRightSurfaceAvailable,
    filesRightSurfaceTarget,
    manualRightSurface,
    refreshRightSurfacePendingRequests,
    setActiveFilesRightSurfaceTarget,
    setManualRightSurface,
  ]);

  const handleToggleRightSurfaceShell = useCallback(() => {
    if (!availableSurfaces.has("shell")) {
      return;
    }
    const shouldOpenShell = manualRightSurface !== "shell";
    closeCompetingRightSurfaces();
    if (shouldOpenShell) {
      setManualRightSurface("shell");
    } else {
      closeRightSurface("shell");
    }
    if (shouldOpenShell) {
      void refreshRightSurfacePendingRequests();
      void consumePendingRequestsForSurface("shell");
    } else {
      void dismissPendingRequestsForSurface("shell", "user_closed_surface");
    }
  }, [
    availableSurfaces,
    closeRightSurface,
    closeCompetingRightSurfaces,
    consumePendingRequestsForSurface,
    dismissPendingRequestsForSurface,
    manualRightSurface,
    refreshRightSurfacePendingRequests,
    setManualRightSurface,
  ]);

  const handleToggleRightSurfaceBrowser = useCallback(() => {
    if (!browserRightSurfaceAvailable) {
      return;
    }
    const shouldOpenBrowser = manualRightSurface !== "browser";
    closeCompetingRightSurfaces();
    if (shouldOpenBrowser) {
      setManualRightSurface("browser");
    } else {
      closeRightSurface("browser");
    }
    if (shouldOpenBrowser) {
      if (pendingBrowserRightSurfaceIntent) {
        setActiveBrowserRightSurfaceIntent(pendingBrowserRightSurfaceIntent);
        setRightSurfaceBrowserTitle(
          pendingBrowserRightSurfaceIntent.title?.trim() || null,
        );
      }
      void refreshRightSurfacePendingRequests();
    } else {
      void dismissPendingRequestsForSurface("browser", "user_closed_surface");
    }
  }, [
    closeRightSurface,
    browserRightSurfaceAvailable,
    closeCompetingRightSurfaces,
    dismissPendingRequestsForSurface,
    manualRightSurface,
    pendingBrowserRightSurfaceIntent,
    refreshRightSurfacePendingRequests,
    setActiveBrowserRightSurfaceIntent,
    setManualRightSurface,
    setRightSurfaceBrowserTitle,
  ]);

  const handleRightSurfaceBrowserNavigate = useCallback(
    (_url: string, title?: string | null) => {
      setRightSurfaceBrowserTitle(title?.trim() || null);
    },
    [setRightSurfaceBrowserTitle],
  );

  const handleToggleRightSurfaceHarness = useCallback(() => {
    if (!rightSurfaceHarnessEnabled) {
      return;
    }
    const shouldOpenHarness = manualRightSurface !== "harness";
    closeCompetingRightSurfaces();
    if (shouldOpenHarness) {
      setManualRightSurface("harness");
    } else {
      closeRightSurface("harness");
    }
    if (shouldOpenHarness) {
      void refreshRightSurfacePendingRequests();
      void consumePendingRequestsForSurface("harness");
    } else {
      void dismissPendingRequestsForSurface("harness", "user_closed_surface");
    }
  }, [
    closeRightSurface,
    closeCompetingRightSurfaces,
    consumePendingRequestsForSurface,
    dismissPendingRequestsForSurface,
    manualRightSurface,
    refreshRightSurfacePendingRequests,
    rightSurfaceHarnessEnabled,
    setManualRightSurface,
  ]);

  const handleToggleExpertInfoPanel = useCallback(() => {
    if (!availableSurfaces.has("expertInfo")) {
      return;
    }
    setHarnessPanelVisible(false);
    const shouldOpenExpertInfo = rightSurfaceActiveSurface
      ? rightSurfaceActiveSurface !== "expertInfo"
      : expertInfoPanelCollapsed || sceneLayoutMode !== "chat";
    if (shouldOpenExpertInfo) {
      setLayoutMode("chat");
      setManualRightSurface("expertInfo");
      void refreshRightSurfacePendingRequests();
      void consumePendingRequestsForSurface("expertInfo");
    } else {
      closeRightSurface("expertInfo");
      void dismissPendingRequestsForSurface(
        "expertInfo",
        "user_closed_surface",
      );
    }
    setExpertInfoPanelCollapsed(!shouldOpenExpertInfo);
  }, [
    availableSurfaces,
    closeRightSurface,
    consumePendingRequestsForSurface,
    dismissPendingRequestsForSurface,
    expertInfoPanelCollapsed,
    refreshRightSurfacePendingRequests,
    rightSurfaceActiveSurface,
    sceneLayoutMode,
    setExpertInfoPanelCollapsed,
    setHarnessPanelVisible,
    setLayoutMode,
    setManualRightSurface,
  ]);

  useEffect(() => {
    if (!filesRightSurfaceAvailable) {
      setActiveFilesRightSurfaceTarget(null);
    }
    if (!pluginSurfaceRightSurfaceAvailable) {
      setActivePluginSurfaces((current) => (current.length ? [] : current));
      setActivePluginSurfaceContainerId(null);
    }
    if (!articleEditorRightSurfaceAvailable) {
      setActiveArticleWorkspace(null);
    }
  }, [
    articleEditorRightSurfaceAvailable,
    filesRightSurfaceAvailable,
    pluginSurfaceRightSurfaceAvailable,
    setActiveArticleWorkspace,
    setActiveFilesRightSurfaceTarget,
    setActivePluginSurfaceContainerId,
    setActivePluginSurfaces,
  ]);

  const handleToggleCanvasFromRightSurface = useCallback(() => {
    if (manualRightSurface && sceneLayoutMode !== "chat") {
      void dismissPendingRequestsForSurface(
        manualRightSurface,
        "user_switched_surface",
      );
      setManualRightSurface(null);
      return;
    }

    setHarnessPanelVisible(false);
    if (manualRightSurface) {
      void dismissPendingRequestsForSurface(
        manualRightSurface,
        "user_switched_surface",
      );
    }
    setManualRightSurface(null);
    handleToggleCanvas();
  }, [
    dismissPendingRequestsForSurface,
    handleToggleCanvas,
    manualRightSurface,
    sceneLayoutMode,
    setHarnessPanelVisible,
    setManualRightSurface,
  ]);

  const handleSelectRightSurfaceTab = useCallback(
    (kind: WorkspaceRightSurfaceKind, replaceTabId?: string) => {
      if (
        !availableSurfaces.has(kind) ||
        (!replaceTabId &&
          kind === rightSurfaceActiveSurface &&
          kind !== "shell") ||
        (replaceTabId && !canReplaceSidePanelTab(replaceTabId))
      ) {
        return;
      }

      setHarnessPanelVisible(false);
      setExpertInfoPanelCollapsed(kind !== "expertInfo");
      if (kind === "files") {
        setActiveFilesRightSurfaceTarget(filesRightSurfaceTarget);
      }
      if (kind === "appSurface" && pluginSurfaceRightSurface) {
        setActivePluginSurfaces((current) =>
          mergeWorkspacePluginSurfaceDescriptors(current, [
            pluginSurfaceRightSurface,
          ]),
        );
        setActivePluginSurfaceContainerId(
          pluginSurfaceRightSurface.containerId,
        );
      }
      if (kind === "articleWorkspace" && articleEditorRightSurface) {
        setActiveArticleWorkspace(articleEditorRightSurface);
      }
      if (kind === "browser" && pendingBrowserRightSurfaceIntent) {
        setActiveBrowserRightSurfaceIntent(pendingBrowserRightSurfaceIntent);
        setRightSurfaceBrowserTitle(
          pendingBrowserRightSurfaceIntent.title?.trim() || null,
        );
      }
      openSidePanelTab(kind, replaceTabId);
      void refreshRightSurfacePendingRequests();
      if (kind !== "browser") void consumePendingRequestsForSurface(kind);
    },
    [
      articleEditorRightSurface,
      availableSurfaces,
      consumePendingRequestsForSurface,
      filesRightSurfaceTarget,
      pendingBrowserRightSurfaceIntent,
      pluginSurfaceRightSurface,
      refreshRightSurfacePendingRequests,
      rightSurfaceActiveSurface,
      setActiveArticleWorkspace,
      setActiveBrowserRightSurfaceIntent,
      setActiveFilesRightSurfaceTarget,
      setActivePluginSurfaceContainerId,
      setActivePluginSurfaces,
      setExpertInfoPanelCollapsed,
      setHarnessPanelVisible,
      openSidePanelTab,
      canReplaceSidePanelTab,
      setRightSurfaceBrowserTitle,
    ],
  );

  const handleSelectPluginSurface = useCallback(
    (surface: WorkspacePluginSurfaceDescriptor) => {
      setHarnessPanelVisible(false);
      setExpertInfoPanelCollapsed(true);
      setActivePluginSurfaceContainerId(surface.containerId);
      setManualRightSurface("appSurface");
    },
    [
      setActivePluginSurfaceContainerId,
      setExpertInfoPanelCollapsed,
      setHarnessPanelVisible,
      setManualRightSurface,
    ],
  );

  const handleClosePluginSurface = useCallback(
    (surface: WorkspacePluginSurfaceDescriptor) => {
      const result = closeWorkspacePluginSurfaceDescriptor({
        activeContainerId: activePluginSurfaceContainerId,
        containerId: surface.containerId,
        surfaces: pluginSurfaceRightSurfaces,
      });
      setActivePluginSurfaces(result.surfaces);
      setDismissedPluginSurfaceContainerIds((current) =>
        current.includes(surface.containerId)
          ? current
          : [...current, surface.containerId],
      );
      setActivePluginSurfaceContainerId(result.activeContainerId);
      if (result.surfaces.length === 0) {
        closeRightSurface("appSurface");
        void dismissPendingRequestsForSurface(
          "appSurface",
          "user_closed_surface",
        );
      }
    },
    [
      activePluginSurfaceContainerId,
      closeRightSurface,
      dismissPendingRequestsForSurface,
      pluginSurfaceRightSurfaces,
      setActivePluginSurfaceContainerId,
      setActivePluginSurfaces,
      setDismissedPluginSurfaceContainerIds,
    ],
  );

  const handleCloseRightSurfaceTab = useCallback(
    (kind: WorkspaceRightSurfaceKind) => {
      closeRightSurface(kind);
      if (kind === "harness") setHarnessPanelVisible(false);
      if (kind === "expertInfo") setExpertInfoPanelCollapsed(true);
      if (kind === "files") setActiveFilesRightSurfaceTarget(null);
      if (kind === "articleWorkspace") setActiveArticleWorkspace(null);
      if (kind === "workbench") setLayoutMode("chat");
      if (kind === "appSurface") {
        setDismissedPluginSurfaceContainerIds((current) => [
          ...new Set([
            ...current,
            ...pluginSurfaceRightSurfaces.map((surface) => surface.containerId),
          ]),
        ]);
        setActivePluginSurfaces([]);
        setActivePluginSurfaceContainerId(null);
      }
      void dismissPendingRequestsForSurface(kind, "user_closed_surface");
    },
    [
      closeRightSurface,
      dismissPendingRequestsForSurface,
      pluginSurfaceRightSurfaces,
      setActiveArticleWorkspace,
      setActiveFilesRightSurfaceTarget,
      setActivePluginSurfaceContainerId,
      setActivePluginSurfaces,
      setDismissedPluginSurfaceContainerIds,
      setExpertInfoPanelCollapsed,
      setHarnessPanelVisible,
      setLayoutMode,
    ],
  );

  return {
    handleCloseRightSurfaceTab,
    handleClosePluginSurface,
    handleRightSurfaceBrowserNavigate,
    handleSelectPluginSurface,
    handleSelectRightSurfaceTab,
    handleToggleCanvasFromRightSurface,
    handleToggleExpertInfoPanel,
    handleToggleRightSurfaceBrowser,
    handleToggleRightSurfaceFiles,
    handleToggleRightSurfaceHarness,
    handleToggleRightSurfaceShell,
  };
}
