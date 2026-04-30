/**
 * 应用主入口组件
 *
 * 管理页面路由和全局状态
 * 支持静态页面和动态插件页面路由
 * 包含启动画面和全局图标侧边栏
 *
 * _需求: 2.2, 3.2, 5.2_
 */

import React, { Suspense, lazy, useState, useCallback } from "react";
import styled from "styled-components";
import { withI18nPatch } from "./i18n/withI18nPatch";
import { AppPageContent } from "./components/AppPageContent";
import { SplashScreen } from "./components/SplashScreen";
import { AppSidebar } from "./components/AppSidebar";
import {
  ProjectType,
  createProject,
  isUserProjectType,
  resolveProjectRootPath,
} from "./lib/api/project";
import { useOnboardingState } from "./components/onboarding";
import { useDeepLink } from "./hooks/useDeepLink";
import { useRelayRegistry } from "./hooks/useRelayRegistry";
import { useSkillCatalogBootstrap } from "./hooks/useSkillCatalogBootstrap";
import { useServiceSkillCatalogBootstrap } from "./hooks/useServiceSkillCatalogBootstrap";
import { useSiteAdapterCatalogBootstrap } from "./hooks/useSiteAdapterCatalogBootstrap";
import { useAppNavigation } from "./hooks/useAppNavigation";
import { useAppShellLayout } from "./hooks/useAppShellLayout";
import { useAppStartupEffects } from "./hooks/useAppStartupEffects";
import { useCompanionProviderBridge } from "./hooks/useCompanionProviderBridge";
import { useGlobalTrayModelSync } from "./hooks/useGlobalTrayModelSync";
import { useOemLimeHubProviderSync } from "./hooks/useOemLimeHubProviderSync";
import { ComponentDebugProvider } from "./contexts/ComponentDebugContext";
import { SoundProvider } from "./contexts/SoundProvider";
import { ComponentDebugOverlay } from "./components/dev";
import {
  useResourceManagerNavigationIntents,
  type ResourceManagerNavigationDestination,
  type ResourceManagerNavigationIntent,
} from "./features/resource-manager";
import type { OpenDeepLinkPayload } from "./hooks/useDeepLink";
import { buildClawAgentParams } from "./lib/workspace/navigation";
import { resolveWebsiteOpenNavigation } from "./lib/deepLink/websiteLaunch";
import { toast } from "sonner";
import { SettingsTabs } from "./types/settings";
import { hasTauriInvokeCapability } from "./lib/tauri-runtime";
import { shouldReserveMacWindowControls } from "./lib/windowControls";
import { startWindowDragFromMouseEvent } from "./lib/windowDrag";

const AppContainer = styled.div`
  display: flex;
  height: 100vh;
  width: 100vw;
  background: var(--lime-app-bg, hsl(var(--background)));
  overflow: hidden;
`;

const MainContent = styled.main<{ $withSidebarGap?: boolean }>`
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding-left: ${(props) => (props.$withSidebarGap ? "10px" : "0")};
  background: var(--lime-app-bg, hsl(var(--background)));
`;

const WINDOW_DRAG_TOP_HEIGHT = 30;
const WINDOW_DRAG_EDGE_WIDTH = 8;
const WINDOW_DRAG_DEFAULT_SAFE_LEFT = 160;
const WINDOW_DRAG_MAC_SAFE_LEFT = 92;

const WindowDragLayer = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1000;
  pointer-events: none;
`;

const WindowTopDragRegion = styled.div<{ $reserveMacWindowControls?: boolean }>`
  position: absolute;
  top: 0;
  left: ${({ $reserveMacWindowControls }) =>
    $reserveMacWindowControls
      ? `${WINDOW_DRAG_MAC_SAFE_LEFT}px`
      : `${WINDOW_DRAG_DEFAULT_SAFE_LEFT}px`};
  right: 0;
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
const OnboardingWizard = lazy(() =>
  import("./components/onboarding").then((module) => ({
    default: module.OnboardingWizard,
  })),
);
const ConnectConfirmDialog = lazy(() =>
  import("./components/connect").then((module) => ({
    default: module.ConnectConfirmDialog,
  })),
);
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
    页面加载中...
  </div>
);

function AppContent() {
  const hasTauriDesktopRuntime = hasTauriInvokeCapability();
  const reserveMacWindowControls = shouldReserveMacWindowControls();
  const [showSplash, setShowSplash] = useState(true);
  const {
    currentPage,
    pageParams,
    requestedPage,
    requestedPageParams,
    navigationRequestId,
    handleNavigate,
  } = useAppNavigation();
  const [agentHasMessages, setAgentHasMessages] = useState(false);
  const { needsOnboarding, completeOnboarding } = useOnboardingState();

  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [pendingRecommendation, setPendingRecommendation] = useState<{
    shortLabel: string;
    fullPrompt: string;
    projectType: ProjectType;
    projectName: string;
  } | null>(null);

  useSkillCatalogBootstrap();
  useServiceSkillCatalogBootstrap();
  useSiteAdapterCatalogBootstrap();
  useOemLimeHubProviderSync();
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
    toast.info("当前资源暂时不能自动回跳", {
      description: "已记录来源信息，但主窗口还没有对应的业务入口。",
    });
  }, []);
  useResourceManagerNavigationIntents({
    onNavigate: handleNavigate,
    onHandled: handleResourceManagerNavigationHandled,
    onUnsupported: handleResourceManagerNavigationUnsupported,
  });
  useGlobalTrayModelSync({
    currentPage,
    pageParams,
  });
  useCompanionProviderBridge({
    onNavigate: handleNavigate,
  });

  const _handleRequestRecommendation = useCallback(
    (shortLabel: string, fullPrompt: string, currentTheme: string) => {
      const themeLabels: Record<string, string> = {
        general: "对话",
      };

      const prefix = themeLabels[currentTheme] || "项目";
      const projectName = `${prefix}：${shortLabel}`;

      setPendingRecommendation({
        shortLabel,
        fullPrompt,
        projectType: currentTheme as ProjectType,
        projectName,
      });
      setProjectDialogOpen(true);
    },
    [],
  );

  const handleCreateProjectFromRecommendation = async (
    name: string,
    type: ProjectType,
  ) => {
    const projectPath = await resolveProjectRootPath(name);

    const project = await createProject({
      name,
      rootPath: projectPath,
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

    toast.success("项目创建成功");
  };

  const handleOpenBrowserConnectorSettings = useCallback(
    ({ enable }: { enable: boolean }) => {
      handleNavigate("settings", {
        tab: SettingsTabs.ChromeRelay,
      });

      if (enable) {
        toast.info("已打开连接器设置", {
          description: "在“连接器”页中开启浏览器连接器或重新同步扩展。",
        });
      }
    },
    [handleNavigate],
  );

  const handleOpenWebsiteDeepLink = useCallback(
    (payload: OpenDeepLinkPayload) => {
      const resolved = resolveWebsiteOpenNavigation(payload);

      if (!resolved) {
        toast.error("无法打开这个官网入口", {
          description:
            "当前 slug 没有对应到桌面端可用能力，请同步官网与客户端目录。",
        });
        return;
      }

      handleNavigate(resolved.page, resolved.params);
    },
    [handleNavigate],
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
    onOpenBrowserConnectorSettings: handleOpenBrowserConnectorSettings,
    onOpenWebsiteDeepLink: handleOpenWebsiteDeepLink,
  });

  const { error: registryError, refresh: _refreshRegistry } = useRelayRegistry({
    autoLoad: hasTauriDesktopRuntime,
  });
  useAppStartupEffects({
    currentPage,
    registryError,
  });
  const { shouldShowAppSidebar, shouldAddMainContentGap } = useAppShellLayout({
    currentPage,
    pageParams,
    agentHasMessages,
  });

  const handleSplashComplete = useCallback(() => {
    setShowSplash(false);
  }, []);

  const handleOnboardingComplete = useCallback(() => {
    completeOnboarding();
  }, [completeOnboarding]);

  const handleWindowDragStart = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      void startWindowDragFromMouseEvent(event, { source: "app_shell" });
    },
    [],
  );

  if (showSplash) {
    return <SplashScreen onComplete={handleSplashComplete} />;
  }

  if (needsOnboarding === null) {
    return null;
  }

  if (needsOnboarding) {
    return (
      <Suspense fallback={null}>
        <OnboardingWizard onComplete={handleOnboardingComplete} />
      </Suspense>
    );
  }

  return (
    <SoundProvider>
      <ComponentDebugProvider>
        <AppContainer>
          {hasTauriDesktopRuntime ? (
            <WindowDragLayer aria-hidden="true">
              <WindowTopDragRegion
                $reserveMacWindowControls={reserveMacWindowControls}
                data-tauri-drag-region
                data-lime-window-drag-region
                onMouseDown={handleWindowDragStart}
              />
              <WindowSideDragRegion
                $side="left"
                data-tauri-drag-region
                data-lime-window-drag-region
                onMouseDown={handleWindowDragStart}
              />
              <WindowSideDragRegion
                $side="right"
                data-tauri-drag-region
                data-lime-window-drag-region
                onMouseDown={handleWindowDragStart}
              />
            </WindowDragLayer>
          ) : null}
          {shouldShowAppSidebar && (
            <AppSidebar
              currentPage={currentPage}
              currentPageParams={pageParams}
              requestedPage={requestedPage}
              requestedPageParams={requestedPageParams}
              onNavigate={handleNavigate}
              onStartWindowDrag={handleWindowDragStart}
            />
          )}
          <MainContent
            $withSidebarGap={shouldAddMainContentGap}
            data-lime-window-drag-region
            onMouseDown={(event) => {
              void startWindowDragFromMouseEvent(event, {
                allowDescendantTargets: false,
                source: "main_content",
              });
            }}
          >
            <Suspense fallback={pageLoadingFallback}>
              <AppPageContent
                currentPage={currentPage}
                pageParams={pageParams}
                requestedPage={requestedPage}
                requestedPageParams={requestedPageParams}
                navigationRequestId={navigationRequestId}
                onNavigate={handleNavigate}
                onAgentHasMessagesChange={setAgentHasMessages}
              />
            </Suspense>
          </MainContent>
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
        </AppContainer>
      </ComponentDebugProvider>
    </SoundProvider>
  );
}

const App = withI18nPatch(AppContent);
export default App;
