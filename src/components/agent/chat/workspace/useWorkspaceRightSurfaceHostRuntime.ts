import {
  createElement,
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { FileDiff, Files, Globe, SquareTerminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAppNavigationRequest } from "@/contexts/AppNavigationContext";
import { SettingsTabs } from "@/types/settings";
import {
  readProjectGitStatus,
  type ProjectGitStatus,
} from "@/lib/api/projectGit";
import { LocalConversationActions } from "./LocalConversationActions";
import { ThreadSidePanelLauncher } from "./right-surface/ThreadSidePanelLauncher";
import { FileTabLifecycleProvider } from "./text-file-editor/FileTabLifecycle";
import { FileTabDraftContext } from "./text-file-editor/fileTabDraftContext";
import { useFileTabCloseGuard } from "./text-file-editor/useFileTabCloseGuard";
import type { ThreadSidePanelAction } from "./right-surface/threadSidePanelActions";
import type { WorkspaceRightSurfaceKind } from "./right-surface";
import type { LayoutMode } from "@/lib/workspace/workbenchContract";
import type { WorkspaceHandleSend } from "./useWorkspaceSendActions";
import {
  renderWorkspaceRightSurfaceHostRuntime,
  type RenderWorkspaceRightSurfaceHostRuntimeParams,
} from "./WorkspaceRightSurfaceHostRuntime";
import type { WorkspaceRightSurfaceCoordinatorRuntime } from "./useWorkspaceRightSurfaceCoordinatorRuntime";
import { submitWorkspaceArticleEditorActionIntent } from "./workspaceArticleEditorActionDispatch";
import type { WorkspaceArticleWorkspaceActionIntent } from "./workspaceArticleWorkspaceModel";
import { useWorkspaceLinkOpening } from "./useWorkspaceLinkOpening";
import type { OpenLink } from "../components/LinkOpeningContext";
import { WorkspaceBrowserNavigationContext } from "./right-surface/browser/workspaceBrowserNavigationContext";

type RightSurfaceHostRuntimeProjection = Pick<
  WorkspaceRightSurfaceCoordinatorRuntime,
  | "activePluginSurfaceContainerId"
  | "browserRightSurfaceAvailable"
  | "browserRightSurfaceIntent"
  | "handleBrowserLaunchApplied"
  | "handleOpenBrowserAddress"
  | "setNewTabAddressDraft"
  | "openBrowserInBackground"
  | "filesRightSurfaceAvailable"
  | "filesRightSurfaceTarget"
  | "handleClosePluginSurface"
  | "handleCloseSidePanelTab"
  | "handleNewSidePanelTab"
  | "handleSelectSidePanelTab"
  | "handleSelectChatFromNewTab"
  | "handleToggleSidePanel"
  | "sidePanelTabs"
  | "getFileDraft"
  | "setFileDraft"
  | "openWorkspaceFile"
  | "outputs"
  | "handleRunAction"
  | "pinSidePanelTab"
  | "backgroundTerminalItems"
  | "rightSurfaceLaunchers"
  | "handleRightSurfaceBrowserNavigate"
  | "handleSelectPluginSurface"
  | "handleSelectRightSurfaceTab"
  | "pluginSurfaceRightSurface"
  | "pluginSurfaceRightSurfaces"
  | "rightSurfaceBrowserTitle"
  | "rightSurfaceHarnessEnabled"
  | "rightSurfaceState"
>;

interface UseWorkspaceRightSurfaceHostRuntimeParams extends Omit<
  RenderWorkspaceRightSurfaceHostRuntimeParams,
  | "idPrefix"
  | "sidePanelTabs"
  | "sidePanelActions"
  | "outputs"
  | "onOpenWebsite"
  | "onNewSidePanelTab"
  | "onSelectSidePanelTab"
  | "onCloseSidePanelTab"
  | "onSelectSidePanelAction"
  | "onSelectChatFromNewTab"
  | "onOpenWorkspaceFile"
  | "onPinSidePanelTab"
  | "backgroundTerminalItems"
  | "activePluginSurfaceContainerId"
  | "browserRightSurfaceAvailable"
  | "browserRightSurfaceInitialUrl"
  | "browserRightSurfaceLaunchRequestId"
  | "onBrowserLaunchApplied"
  | "browserRightSurfaceIntentTitle"
  | "browserRightSurfaceHistoricalProjection"
  | "filesRightSurfaceAvailable"
  | "filesRightSurfaceTarget"
  | "pluginSurfaceRightSurface"
  | "pluginSurfaceRightSurfaces"
  | "rightSurfaceBrowserTitle"
  | "rightSurfaceHarnessEnabled"
  | "rightSurfaceState"
  | "onArticleActionIntent"
  | "onArticleSelectedObjectChange"
  | "onClosePluginSurface"
  | "onOpenArticlePreviewArtifact"
  | "onRightSurfaceBrowserNavigate"
  | "onSelectPluginSurface"
> {
  runtimeWorkspaceId?: string | null;
  handleSendRef: MutableRefObject<WorkspaceHandleSend>;
  onOpenArticlePreviewArtifact: RenderWorkspaceRightSurfaceHostRuntimeParams["onOpenArticlePreviewArtifact"];
  restoreInput: (prompt: string) => void;
  rightSurfaceRuntime: RightSurfaceHostRuntimeProjection;
  setLayoutMode: (mode: LayoutMode) => void;
}

export function useWorkspaceRightSurfaceHostRuntime({
  runtimeWorkspaceId,
  handleSendRef,
  onOpenArticlePreviewArtifact,
  restoreInput,
  rightSurfaceRuntime,
  setLayoutMode,
  ...hostRuntimeParams
}: UseWorkspaceRightSurfaceHostRuntimeParams): ReturnType<
  typeof renderWorkspaceRightSurfaceHostRuntime
> & { launcher: ReactNode; openLink: OpenLink } {
  const idPrefix = useId();
  const fileTabDrafts = useMemo(
    () => ({
      getFileDraft: rightSurfaceRuntime.getFileDraft,
      setFileDraft: rightSurfaceRuntime.setFileDraft,
    }),
    [rightSurfaceRuntime.getFileDraft, rightSurfaceRuntime.setFileDraft],
  );
  const fileTabLifecycle = useFileTabCloseGuard(
    rightSurfaceRuntime.sidePanelTabs.tabs,
    rightSurfaceRuntime.handleCloseSidePanelTab,
  );
  const { t } = useTranslation("agent");
  const root = hostRuntimeParams.canvasWorkbenchRootPath?.trim() || null;
  const navigate = useAppNavigationRequest();
  const openLink = useWorkspaceLinkOpening({
    sessionId: hostRuntimeParams.sceneSessionId,
    threadId: hostRuntimeParams.sceneThreadId,
    workspaceId: runtimeWorkspaceId,
    workspaceRoot: root,
    ensureOwner: hostRuntimeParams.ensureBrowserWorkspaceOwner,
    onOpenBackgroundBrowser: rightSurfaceRuntime.openBrowserInBackground,
    onError: (error) =>
      toast.error(
        t("agentChat.browserWorkspace.loadFailedBody", {
          message: error instanceof Error ? error.message : String(error),
        }),
      ),
  });
  const gitContext = useMemo(() => ({ root }), [root]);
  const [gitRefresh, setGitRefresh] = useState(0);
  const [gitStatus, setGitStatus] = useState<{
    context: typeof gitContext;
    available: boolean;
    status: ProjectGitStatus | null;
    failed: boolean;
  } | null>(null);
  useEffect(() => {
    let current = true;
    if (root)
      void readProjectGitStatus(root).then(
        (status) => {
          if (current)
            setGitStatus({
              context: gitContext,
              available: status.hasGitRepository,
              status,
              failed: false,
            });
        },
        () => {
          if (current)
            setGitStatus({
              context: gitContext,
              available: false,
              status: null,
              failed: true,
            });
        },
      );
    return () => {
      current = false;
    };
  }, [root, gitContext, gitRefresh]);
  const available = new Set(
    rightSurfaceRuntime.rightSurfaceLaunchers
      .filter((action) => !action.disabled)
      .map((action) => action.kind),
  );
  const sidePanelActions: ThreadSidePanelAction[] = [
    ...(root && available.has("files")
      ? [
          {
            id: "open-file",
            kind: "files" as const,
            title: t("agentChat.rightSurface.tabs.files"),
            icon: createElement(Files, { size: 16 }),
            deferSelectionUntilDropdownClose: true,
          },
        ]
      : []),
    ...(available.has("browser")
      ? [
          {
            id: "browser",
            kind: "browser" as const,
            title: t("agentChat.rightSurface.tabs.browser"),
            icon: createElement(Globe, { size: 16 }),
            deferSelectionUntilDropdownClose: true,
          },
        ]
      : []),
    ...(root &&
    gitStatus?.context === gitContext &&
    gitStatus.available &&
    available.has("changes")
      ? [
          {
            id: "review",
            kind: "changes" as const,
            title: t("agentChat.rightSurface.tabs.changes"),
            icon: createElement(FileDiff, { size: 16 }),
          },
        ]
      : []),
    ...(root && available.has("shell")
      ? [
          {
            id: "terminal",
            kind: "shell" as const,
            title: t("agentChat.rightSurface.tabs.shell"),
            icon: createElement(SquareTerminal, { size: 16 }),
          },
        ]
      : []),
  ];

  const handleArticleWorkspaceActionIntent = useCallback(
    async (intent: WorkspaceArticleWorkspaceActionIntent) => {
      setLayoutMode("chat");
      await submitWorkspaceArticleEditorActionIntent({
        intent,
        restoreInput,
        submit: async (prompt, options) =>
          await handleSendRef.current(
            [],
            undefined,
            undefined,
            prompt,
            "react",
            undefined,
            options,
          ),
      });
    },
    [handleSendRef, restoreInput, setLayoutMode],
  );

  const surfaces = renderWorkspaceRightSurfaceHostRuntime({
    ...hostRuntimeParams,
    idPrefix,
    sidePanelTabs: rightSurfaceRuntime.sidePanelTabs,
    backgroundTerminalItems: rightSurfaceRuntime.backgroundTerminalItems,
    sidePanelActions,
    outputs: rightSurfaceRuntime.outputs,
    onOpenWebsite: openLink,
    onNewSidePanelTab: rightSurfaceRuntime.handleNewSidePanelTab,
    onSelectSidePanelTab: rightSurfaceRuntime.handleSelectSidePanelTab,
    onCloseSidePanelTab: fileTabLifecycle.requestClose,
    onSelectSidePanelAction: (
      kind: WorkspaceRightSurfaceKind,
      replaceTabId?: string,
    ) => rightSurfaceRuntime.handleSelectRightSurfaceTab(kind, replaceTabId),
    onSelectChatFromNewTab: rightSurfaceRuntime.handleSelectChatFromNewTab,
    onOpenWorkspaceFile: rightSurfaceRuntime.openWorkspaceFile,
    onPinSidePanelTab: rightSurfaceRuntime.pinSidePanelTab,
    activePluginSurfaceContainerId:
      rightSurfaceRuntime.activePluginSurfaceContainerId,
    browserRightSurfaceAvailable:
      rightSurfaceRuntime.browserRightSurfaceAvailable,
    browserRightSurfaceInitialUrl:
      rightSurfaceRuntime.browserRightSurfaceIntent?.launchUrl ?? null,
    browserRightSurfaceLaunchTabId:
      rightSurfaceRuntime.browserRightSurfaceIntent?.tabId ?? null,
    browserRightSurfaceLaunchRequestId: rightSurfaceRuntime
      .browserRightSurfaceIntent?.launchApplied
      ? null
      : (rightSurfaceRuntime.browserRightSurfaceIntent?.sourceRequestId ??
        null),
    onBrowserLaunchApplied: rightSurfaceRuntime.handleBrowserLaunchApplied,
    browserRightSurfaceIntentTitle:
      rightSurfaceRuntime.browserRightSurfaceIntent?.title ?? null,
    browserRightSurfaceHistoricalProjection:
      rightSurfaceRuntime.browserRightSurfaceIntent?.historicalProjection ??
      null,
    filesRightSurfaceAvailable: rightSurfaceRuntime.filesRightSurfaceAvailable,
    filesRightSurfaceTarget: rightSurfaceRuntime.filesRightSurfaceTarget,
    pluginSurfaceRightSurface: rightSurfaceRuntime.pluginSurfaceRightSurface,
    pluginSurfaceRightSurfaces: rightSurfaceRuntime.pluginSurfaceRightSurfaces,
    rightSurfaceBrowserTitle: rightSurfaceRuntime.rightSurfaceBrowserTitle,
    rightSurfaceHarnessEnabled: rightSurfaceRuntime.rightSurfaceHarnessEnabled,
    rightSurfaceState: rightSurfaceRuntime.rightSurfaceState,
    onArticleActionIntent: handleArticleWorkspaceActionIntent,
    onArticleSelectedObjectChange: undefined,
    onClosePluginSurface: rightSurfaceRuntime.handleClosePluginSurface,
    onOpenArticlePreviewArtifact,
    onRightSurfaceBrowserNavigate:
      rightSurfaceRuntime.handleRightSurfaceBrowserNavigate,
    onSelectPluginSurface: rightSurfaceRuntime.handleSelectPluginSurface,
  });
  return {
    ...surfaces,
    openLink,
    tabStrip: createElement(FileTabLifecycleProvider, {
      lifecycle: fileTabLifecycle,
      children: surfaces.tabStrip,
    }),
    content: createElement(FileTabLifecycleProvider, {
      lifecycle: fileTabLifecycle,
      children: createElement(
        "div",
        { className: "contents" },
        createElement(WorkspaceBrowserNavigationContext.Provider, {
          value: {
            setAddressDraft: rightSurfaceRuntime.setNewTabAddressDraft,
            openAddress: (sourceTabId: string, url: string) =>
              rightSurfaceRuntime.handleOpenBrowserAddress(
                sourceTabId,
                url,
                hostRuntimeParams.ensureBrowserWorkspaceOwner,
              ),
          },
          children: createElement(FileTabDraftContext.Provider, {
            value: fileTabDrafts,
            children: surfaces.content,
          }),
        }),
        fileTabLifecycle.confirmation,
      ),
    }),
    launcher: createElement(
      Fragment,
      null,
      root && hostRuntimeParams.sceneSessionId && available.has("shell")
        ? createElement(LocalConversationActions, {
            key: JSON.stringify([hostRuntimeParams.sceneSessionId, root]),
            workspaceRoot: root,
            status: gitStatus?.context === gitContext ? gitStatus.status : null,
            loading: gitStatus?.context !== gitContext,
            failed: gitStatus?.context === gitContext && gitStatus.failed,
            onRefresh: () => setGitRefresh((value) => value + 1),
            onRunAction: rightSurfaceRuntime.handleRunAction,
            onConfigureActions: navigate
              ? (configPath: string | null) =>
                  navigate("settings", {
                    tab: SettingsTabs.LocalEnvironments,
                    localEnvironmentFocus: {
                      workspaceRoot: root,
                      ...(configPath ? { configPath } : {}),
                      requestKey: Date.now(),
                    },
                  })
              : undefined,
          })
        : null,
      createElement(ThreadSidePanelLauncher, {
        open: rightSurfaceRuntime.rightSurfaceState.activeSurface !== null,
        onToggle: () =>
          rightSurfaceRuntime.handleToggleSidePanel(
            sidePanelActions.length === 1
              ? sidePanelActions[0].kind
              : undefined,
          ),
      }),
    ),
  };
}
