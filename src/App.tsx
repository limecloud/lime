/**
 * 应用主入口组件
 *
 * 管理页面路由和全局状态
 * 支持静态页面和动态插件页面路由
 * 包含启动画面、共享窗口页头和上下文导航
 *
 * _需求: 2.2, 3.2, 5.2_
 */

import React, { Suspense, lazy, useState, useCallback, useEffect } from "react";
import styled from "styled-components";
import { useTranslation } from "react-i18next";
import { withI18nPatch } from "./i18n/withI18nPatch";
import { AppPageContent } from "./components/AppPageContent";
import type { AgentBackgroundSessionRuntimeSnapshot } from "./components/agent/chat";
import { AppServerConfigWarningToastBridge } from "./components/AppServerConfigWarningToastBridge";
import { ScheduledTaskNotificationBridge } from "./components/ScheduledTaskNotificationBridge";
import { SplashScreen } from "./components/SplashScreen";
import { AppSidebar } from "./components/AppSidebar";
import {
  AppShell,
  AppShellContent,
  AppShellHeader,
  MainContentLayout,
} from "./components/app-shell/AppShell";
import { startupTracker } from "./lib/diagnostics/startupPerformance";
import { preloadDefaultProject } from "./lib/api/project";
import {
  ProjectType,
  createProject,
  isUserProjectType,
} from "./lib/api/project";
import { useDeepLink } from "./hooks/useDeepLink";
import { useSkillCatalogBootstrap } from "./hooks/useSkillCatalogBootstrap";
import { useServiceSkillCatalogBootstrap } from "./hooks/useServiceSkillCatalogBootstrap";
import { useAppNavigation } from "./hooks/useAppNavigation";
import { useAppShellLayout } from "./hooks/useAppShellLayout";
import { useAppStartupEffects } from "./hooks/useAppStartupEffects";
import { useGlobalTrayModelSync } from "./hooks/useGlobalTrayModelSync";
import { useClawTraceRegressionAlertMonitor } from "./hooks/useClawTraceRegressionAlertMonitor";
import { useOemLimeHubProviderSync } from "./hooks/useOemLimeHubProviderSync";
import { useSkillPackageOpenRequests } from "./hooks/useSkillPackageOpenRequests";
import { ComponentDebugProvider } from "./contexts/ComponentDebugContext";
import { AppNavigationContext } from "./contexts/AppNavigationContext";
import { BrowserHistoryNavigationContext } from "./contexts/BrowserHistoryNavigationContext";
import { useBrowserHistoryNavigation } from "./hooks/useBrowserHistoryNavigation";
import { ComponentDebugOverlay } from "./components/dev";
import {
  useResourceManagerNavigationIntents,
  type ResourceManagerNavigationDestination,
  type ResourceManagerNavigationIntent,
} from "./features/resource-manager";
import type { OpenDeepLinkPayload } from "./hooks/useDeepLink";
import { buildClawAgentParams } from "./lib/workspace/navigation";
import {
  resolveWebsiteInstalledSkillNavigation,
  resolveWebsiteOpenNavigation,
  resolveWebsiteSkillTitle,
} from "./lib/deepLink/websiteLaunch";
import { skillsApi } from "./lib/api/skills";
import { installOfficialMarketplaceSkill } from "./lib/api/officialSkillMarketplace";
import { toast } from "sonner";
import { SettingsTabs } from "./types/settings";
import { hasDesktopHostInvokeCapability } from "./lib/desktop-runtime";
import {
  hasNativeStartupScreen,
  hideNativeStartupOverlayWhenReady,
} from "./lib/nativeStartupScreen";
import { shouldReserveMacWindowControls } from "./lib/windowControls";
import { startWindowDragFromMouseEvent } from "./lib/windowDrag";
import {
  listenOpenVoiceModelSettingsRequest,
  persistVoiceModelSettingsFocusRequest,
} from "./lib/voiceModelSettingsNavigation";

const AppContainer = styled.div`
  display: flex;
  height: 100vh;
  width: 100vw;
  background: var(--lime-app-bg, hsl(var(--background)));
  overflow: hidden;
`;

const WINDOW_DRAG_TOP_HEIGHT = 30;
const WINDOW_DRAG_TOP_HANDLE_WIDTH = 360;
const WINDOW_DRAG_EDGE_WIDTH = 8;
const WINDOW_DRAG_DEFAULT_SAFE_LEFT = 160;
const WINDOW_DRAG_MAC_SAFE_LEFT = 136;

const WindowDragLayer = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1;
  pointer-events: none;
`;

const WindowTopDragRegion = styled.div<{ $reserveMacWindowControls?: boolean }>`
  position: absolute;
  top: 0;
  left: ${({ $reserveMacWindowControls }) =>
    $reserveMacWindowControls
      ? `${WINDOW_DRAG_MAC_SAFE_LEFT}px`
      : `${WINDOW_DRAG_DEFAULT_SAFE_LEFT}px`};
  width: ${WINDOW_DRAG_TOP_HANDLE_WIDTH}px;
  height: ${WINDOW_DRAG_TOP_HEIGHT}px;
  pointer-events: auto;
  user-select: none;
  app-region: drag;
  -webkit-app-region: drag;
`;

const WindowSideDragRegion = styled.div<{ $side: "left" | "right" }>`
  position: absolute;
  top: ${WINDOW_DRAG_TOP_HEIGHT}px;
  bottom: 0;
  ${({ $side }) => $side}: 0;
  width: ${WINDOW_DRAG_EDGE_WIDTH}px;
  pointer-events: auto;
  user-select: none;
  app-region: drag;
  -webkit-app-region: drag;
`;

const RecentImageInsertFloating = lazy(() =>
  import("./components/image-gen/RecentImageInsertFloating").then((module) => ({
    default: module.RecentImageInsertFloating,
  })),
);
const CreateProjectDialog = lazy(() =>
  import("./components/projects/CreateProjectDialog").then((module) => ({
    default: module.CreateProjectDialog,
  })),
);
const ConnectConfirmDialog = lazy(() =>
  import("./components/connect").then((module) => ({
    default: module.ConnectConfirmDialog,
  })),
);

function AppContent() {
  startupTracker.mark("AppContent: render start");

  const { t } = useTranslation("common");
  const hasDesktopHostRuntime = hasDesktopHostInvokeCapability();
  const nativeStartupScreenAvailable = hasNativeStartupScreen();
  const reserveMacWindowControls = shouldReserveMacWindowControls();
  const [showSplash, setShowSplash] = useState(!nativeStartupScreenAvailable);
  const {
    currentPage,
    pageParams,
    requestedPage,
    requestedPageParams,
    navigationRequestId,
    handleNavigate,
    tryNavigate,
    startNewConversation,
    returnFromSettings,
    settingsReturnLocation,
    reportAgentLocation,
    agentLocation,
    navigationGuard,
  } = useAppNavigation();
  const { navigateFromBrowser, openHistoryUrl } = useBrowserHistoryNavigation({
    page: requestedPage,
    pageParams: requestedPageParams,
    navigationRequestId,
    agentLocation,
    settingsReturnLocation,
    navigate: handleNavigate,
    tryNavigate,
  });
  const [agentHasMessages, setAgentHasMessages] = useState(false);
  const activeAgentSessionId = agentLocation?.sessionId ?? null;
  const [activeAgentStreaming, setActiveAgentStreaming] = useState(false);
  const [backgroundAgentSessionRuntime, setBackgroundAgentSessionRuntime] =
    useState<AgentBackgroundSessionRuntimeSnapshot | null>(null);
  const activeAgentPage = requestedPage ?? currentPage;

  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [pendingRecommendation, setPendingRecommendation] = useState<{
    shortLabel: string;
    fullPrompt: string;
    projectType: ProjectType;
    projectName: string;
  } | null>(null);

  useSkillCatalogBootstrap();
  useServiceSkillCatalogBootstrap();
  useOemLimeHubProviderSync();
  useClawTraceRegressionAlertMonitor();
  const handleResourceManagerNavigationHandled = useCallback(
    ({
      destination,
    }: {
      intent: ResourceManagerNavigationIntent;
      destination: ResourceManagerNavigationDestination;
    }) => {
      toast.success(destination.noticeTitle, {
        description: destination.noticeDescription,
      });
    },
    [],
  );
  const handleResourceManagerNavigationUnsupported = useCallback(() => {
    toast.info(t("common.app.resourceNavigation.unsupported.title"), {
      description: t("common.app.resourceNavigation.unsupported.description"),
    });
  }, [t]);
  useResourceManagerNavigationIntents({
    onNavigate: handleNavigate,
    onHandled: handleResourceManagerNavigationHandled,
    onUnsupported: handleResourceManagerNavigationUnsupported,
  });
  useGlobalTrayModelSync({
    currentPage,
    pageParams,
  });
  useSkillPackageOpenRequests({
    onNavigate: handleNavigate,
  });
  useEffect(
    () =>
      listenOpenVoiceModelSettingsRequest((detail) => {
        persistVoiceModelSettingsFocusRequest(detail);
        handleNavigate("settings", { tab: SettingsTabs.MediaServices });
      }),
    [handleNavigate],
  );

  const _handleRequestRecommendation = useCallback(
    (shortLabel: string, fullPrompt: string, currentTheme: string) => {
      const themeLabels: Record<string, string> = {
        general: t("common.app.project.type.general"),
      };

      const prefix =
        themeLabels[currentTheme] || t("common.app.project.type.fallback");
      const projectName = t("common.app.project.recommendedName", {
        prefix,
        shortLabel,
      });

      setPendingRecommendation({
        shortLabel,
        fullPrompt,
        projectType: currentTheme as ProjectType,
        projectName,
      });
      setProjectDialogOpen(true);
    },
    [t],
  );

  const handleCreateProjectFromRecommendation = async (
    name: string,
    type: ProjectType,
    rootPath: string,
  ) => {
    const project = await createProject({
      name,
      rootPath,
      workspaceType: type,
    });

    if (pendingRecommendation) {
      handleNavigate(
        "agent",
        buildClawAgentParams({
          projectId: project.id,
          initialUserPrompt: pendingRecommendation.fullPrompt,
        }),
      );

      setPendingRecommendation(null);
    } else if (isUserProjectType(type)) {
      handleNavigate(
        "agent",
        buildClawAgentParams({
          projectId: project.id,
        }),
      );
    } else {
      handleNavigate("agent", {
        projectId: project.id,
      });
    }

    toast.success(t("common.app.project.created"));
  };

  const handleOpenWebsiteDeepLink = useCallback(
    async (payload: OpenDeepLinkPayload) => {
      if (payload.kind === "skill" && payload.action === "install") {
        if (!resolveWebsiteSkillTitle(payload.slug)) {
          toast.error(t("common.app.websiteDeepLink.unsupported.title"), {
            description: t(
              "common.app.websiteDeepLink.unsupported.description",
            ),
          });
          return;
        }

        const title = resolveWebsiteSkillTitle(payload.slug) ?? payload.slug;
        try {
          await installOfficialMarketplaceSkill(payload.slug, "lime");
          toast.success(
            t("common.app.websiteDeepLink.install.success.title", { title }),
            {
              description: t(
                "common.app.websiteDeepLink.install.success.description",
              ),
            },
          );
        } catch (error) {
          const message =
            error instanceof Error && error.message.trim()
              ? error.message.trim()
              : String(error);
          if (!/already exists|已存在/i.test(message)) {
            toast.error(t("common.app.websiteDeepLink.install.failed.title"), {
              description: t(
                "common.app.websiteDeepLink.install.failed.description",
                { message },
              ),
            });
            return;
          }

          toast.info(
            t("common.app.websiteDeepLink.install.alreadyInstalled.title", {
              title,
            }),
            {
              description: t(
                "common.app.websiteDeepLink.install.alreadyInstalled.description",
              ),
            },
          );
        }

        try {
          const installed = (await skillsApi.getRuntimeCatalog()).filter(
            (entry) =>
              entry.directory === payload.slug &&
              entry.catalogSource === "user",
          );
          const skill = installed.length === 1 ? installed[0] : null;
          const navigation = skill
            ? resolveWebsiteInstalledSkillNavigation(payload, skill)
            : null;
          if (!navigation) {
            throw new Error(
              t("common.app.websiteDeepLink.unsupported.description"),
            );
          }
          handleNavigate(navigation.page, navigation.params);
        } catch (error) {
          toast.error(t("common.app.websiteDeepLink.install.failed.title"), {
            description: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }

      const resolved = resolveWebsiteOpenNavigation(payload);

      if (!resolved) {
        toast.error(t("common.app.websiteDeepLink.unsupported.title"), {
          description: t("common.app.websiteDeepLink.unsupported.description"),
        });
        return;
      }

      handleNavigate(resolved.page, resolved.params);
    },
    [handleNavigate, t],
  );

  const {
    connectPayload,
    relayInfo,
    isVerified,
    isDialogOpen,
    isSaving,
    error,
    handleConfirm,
    handleCancel,
  } = useDeepLink({
    onOpenWebsiteDeepLink: handleOpenWebsiteDeepLink,
  });

  useAppStartupEffects({
    currentPage,
  });
  const { shouldShowAppSidebar } = useAppShellLayout({
    currentPage,
    pageParams,
    agentHasMessages,
  });
  const pageLoadingFallback = (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "hsl(var(--muted-foreground))",
        fontSize: "14px",
      }}
    >
      {t("common.app.loadingPage")}
    </div>
  );

  const handleSplashComplete = useCallback(() => {
    startupTracker.mark("SplashScreen: complete");
    setShowSplash(false);

    // Splash 完成后立即预加载默认项目
    preloadDefaultProject();
  }, []);

  useEffect(() => {
    if (showSplash || !nativeStartupScreenAvailable) {
      return;
    }

    startupTracker.mark("Native startup screen: renderer ready");
    preloadDefaultProject();
    hideNativeStartupOverlayWhenReady();
  }, [nativeStartupScreenAvailable, showSplash]);

  const handleWindowDragStart = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      void startWindowDragFromMouseEvent(event, { source: "app_shell" });
    },
    [],
  );
  useEffect(() => {
    if (activeAgentPage !== "agent") {
      setActiveAgentStreaming(false);
    }
  }, [activeAgentPage]);

  const handleBackgroundSessionRuntimeChange = useCallback(
    (snapshot: AgentBackgroundSessionRuntimeSnapshot | null) => {
      const sessionId = snapshot?.sessionId.trim();
      if (!sessionId || !snapshot) {
        setBackgroundAgentSessionRuntime(null);
        return;
      }
      setBackgroundAgentSessionRuntime({ sessionId, status: snapshot.status });
    },
    [],
  );

  if (showSplash) {
    startupTracker.mark("AppContent: showing splash");
    return <SplashScreen onComplete={handleSplashComplete} />;
  }

  startupTracker.mark("AppContent: rendering main app");

  return (
    <ComponentDebugProvider>
      <AppShell>
        <MainContentLayout layout="default" fallback />
        <AppContainer>
          <AppShellHeader reserveWindowControls={reserveMacWindowControls} />
          {hasDesktopHostRuntime ? (
            <WindowDragLayer aria-hidden="true">
              <WindowTopDragRegion
                $reserveMacWindowControls={reserveMacWindowControls}
                data-lime-window-drag-region
                onMouseDown={handleWindowDragStart}
              />
              <WindowSideDragRegion
                $side="left"
                data-lime-window-drag-region
                onMouseDown={handleWindowDragStart}
              />
              <WindowSideDragRegion
                $side="right"
                data-lime-window-drag-region
                onMouseDown={handleWindowDragStart}
              />
            </WindowDragLayer>
          ) : null}
          {shouldShowAppSidebar && (
            <AppSidebar
              currentPage={currentPage}
              currentPageParams={pageParams}
              activeAgentSessionId={activeAgentSessionId}
              activeAgentStreaming={activeAgentStreaming}
              backgroundAgentSessionRuntime={backgroundAgentSessionRuntime}
              requestedPage={requestedPage}
              requestedPageParams={requestedPageParams}
              onNavigate={handleNavigate}
              onStartNewConversation={startNewConversation}
              onStartWindowDrag={handleWindowDragStart}
            />
          )}
          <AppShellContent
            pageSurface={shouldShowAppSidebar}
            data-lime-window-drag-region
            onMouseDown={(event) => {
              void startWindowDragFromMouseEvent(event, {
                allowDescendantTargets: false,
                source: "main_content",
              });
            }}
          >
            <Suspense fallback={pageLoadingFallback}>
              <AppNavigationContext.Provider value={navigateFromBrowser}>
                <BrowserHistoryNavigationContext.Provider
                  value={openHistoryUrl}
                >
                  <AppPageContent
                    currentPage={currentPage}
                    pageParams={pageParams}
                    requestedPage={requestedPage}
                    requestedPageParams={requestedPageParams}
                    onNavigate={handleNavigate}
                    onStartNewConversation={startNewConversation}
                    onAgentHasMessagesChange={setAgentHasMessages}
                    onAgentLocationChange={reportAgentLocation}
                    onSettingsBack={returnFromSettings}
                    navigationGuard={navigationGuard}
                    onAgentStreamingChange={setActiveAgentStreaming}
                    onBackgroundSessionRuntimeChange={
                      handleBackgroundSessionRuntimeChange
                    }
                  />
                </BrowserHistoryNavigationContext.Provider>
              </AppNavigationContext.Provider>
            </Suspense>
          </AppShellContent>
          <Suspense fallback={null}>
            <RecentImageInsertFloating onNavigate={handleNavigate} />
          </Suspense>

          <Suspense fallback={null}>
            <ConnectConfirmDialog
              open={isDialogOpen}
              relay={relayInfo}
              relayId={connectPayload?.relay ?? ""}
              apiKey={connectPayload?.key ?? ""}
              keyName={connectPayload?.name}
              isVerified={isVerified}
              isSaving={isSaving}
              error={error}
              onConfirm={handleConfirm}
              onCancel={handleCancel}
            />
          </Suspense>

          <Suspense fallback={null}>
            <CreateProjectDialog
              open={projectDialogOpen}
              onOpenChange={(open) => {
                setProjectDialogOpen(open);
                if (!open) {
                  setPendingRecommendation(null);
                }
              }}
              onSubmit={handleCreateProjectFromRecommendation}
              defaultType={pendingRecommendation?.projectType}
              defaultName={pendingRecommendation?.projectName}
            />
          </Suspense>

          <ComponentDebugOverlay />
          <AppServerConfigWarningToastBridge />
          <ScheduledTaskNotificationBridge />
        </AppContainer>
      </AppShell>
    </ComponentDebugProvider>
  );
}

const App = withI18nPatch(AppContent);
export default App;
