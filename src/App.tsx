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
import { buildClawAgentParams } from "./lib/workspace/navigation";
import { toast } from "sonner";
import { SettingsTabs } from "./types/settings";
import { hasTauriInvokeCapability } from "./lib/tauri-runtime";

const AppContainer = styled.div`
  display: flex;
  height: 100vh;
  width: 100vw;
  background-color: hsl(var(--background));
  overflow: hidden;
`;

const MainContent = styled.main<{ $withSidebarGap?: boolean }>`
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding-left: ${(props) => (props.$withSidebarGap ? "10px" : "0")};
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
          {shouldShowAppSidebar && (
            <AppSidebar
              currentPage={currentPage}
              currentPageParams={pageParams}
              requestedPage={requestedPage}
              requestedPageParams={requestedPageParams}
              onNavigate={handleNavigate}
            />
          )}
          <MainContent $withSidebarGap={shouldAddMainContentGap}>
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
