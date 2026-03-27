/**
 * 应用主入口组件
 *
 * 管理页面路由和全局状态
 * 支持静态页面和动态插件页面路由
 * 包含启动画面和全局图标侧边栏
 *
 * _需求: 2.2, 3.2, 5.2_
 */

import React, { Suspense, lazy, useState, useEffect, useCallback } from "react";
import styled from "styled-components";
import { getWindowsStartupDiagnostics } from "@/lib/api/serverRuntime";
import { withI18nPatch } from "./i18n/withI18nPatch";
import { SplashScreen } from "./components/SplashScreen";
import { AppSidebar } from "./components/AppSidebar";
import {
  ProjectType,
  createProject,
  ensureDefaultWorkspaceReady,
  isUserProjectType,
  resolveProjectRootPath,
} from "./lib/api/project";
import { useOnboardingState } from "./components/onboarding";
import { showRegistryLoadError } from "./lib/utils/connectError";
import { useDeepLink } from "./hooks/useDeepLink";
import { useRelayRegistry } from "./hooks/useRelayRegistry";
import { useServiceSkillCatalogBootstrap } from "./hooks/useServiceSkillCatalogBootstrap";
import { useSiteAdapterCatalogBootstrap } from "./hooks/useSiteAdapterCatalogBootstrap";
import { useGlobalTrayModelSync } from "./hooks/useGlobalTrayModelSync";
import { useOemLimeHubProviderSync } from "./hooks/useOemLimeHubProviderSync";
import { ComponentDebugProvider } from "./contexts/ComponentDebugContext";
import { SoundProvider } from "./contexts/SoundProvider";
import { ComponentDebugOverlay } from "./components/dev";
import {
  AgentPageParams,
  AutomationPageParams,
  BrowserRuntimePageParams,
  getThemeByWorkspacePage,
  getThemeWorkspacePage,
  isThemeWorkspacePage,
  LAST_THEME_WORKSPACE_PAGE_STORAGE_KEY,
  MemoryPageParams,
  OpenClawPageParams,
  Page,
  PageParams,
  ProjectDetailPageParams,
  SettingsPageParams,
  StylePageParams,
  ThemeWorkspacePage,
  WorkspaceTheme,
} from "./types/page";
import { toast } from "sonner";
import { recordWorkspaceRepair } from "@/lib/workspaceHealthTelemetry";
import { buildHomeAgentParams } from "@/lib/workspace/navigation";
import { hasTauriInvokeCapability } from "@/lib/tauri-runtime";

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

const PageWrapper = styled.div<{ $isActive: boolean }>`
  flex: 1;
  padding: 24px;
  overflow: auto;
  display: ${(props) => (props.$isActive ? "block" : "none")};
`;

const FullscreenWrapper = styled.div<{ $isActive: boolean }>`
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: ${(props) => (props.$isActive ? "flex" : "none")};
  flex-direction: column;
  position: relative;
`;

const THEME_WORKSPACE_PAGES: ThemeWorkspacePage[] = [
  "workspace-general",
  "workspace-social-media",
  "workspace-poster",
  "workspace-music",
  "workspace-knowledge",
  "workspace-planning",
  "workspace-document",
  "workspace-video",
  "workspace-novel",
];

const SettingsPageV2 = lazy(() =>
  import("./components/settings-v2").then((module) => ({
    default: module.SettingsPageV2,
  })),
);
const ToolsPage = lazy(() =>
  import("./components/tools/ToolsPage").then((module) => ({
    default: module.ToolsPage,
  })),
);
const ResourcesPage = lazy(() =>
  import("./components/resources").then((module) => ({
    default: module.ResourcesPage,
  })),
);
const MemoryPage = lazy(() =>
  import("./components/memory").then((module) => ({
    default: module.MemoryPage,
  })),
);
const StylePage = lazy(() =>
  import("./components/style").then((module) => ({
    default: module.StylePage,
  })),
);
const PluginsPage = lazy(() =>
  import("./components/plugins/PluginsPage").then((module) => ({
    default: module.PluginsPage,
  })),
);
const ImageGenPage = lazy(() =>
  import("./components/image-gen").then((module) => ({
    default: module.ImageGenPage,
  })),
);
const AutomationPage = lazy(() =>
  import("./components/automation").then((module) => ({
    default: module.AutomationPage,
  })),
);
const OpenClawPage = lazy(() =>
  import("./components/openclaw").then((module) => ({
    default: module.OpenClawPage,
  })),
);
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
const WorkbenchPage = lazy(() =>
  import("./components/workspace").then((module) => ({
    default: module.WorkbenchPage,
  })),
);
const BrowserRuntimeWorkspace = lazy(() =>
  import("@/features/browser-runtime").then((module) => ({
    default: module.BrowserRuntimeWorkspace,
  })),
);
const TerminalWorkspace = lazy(() =>
  import("./components/terminal").then((module) => ({
    default: module.TerminalWorkspace,
  })),
);
const SysinfoView = lazy(() =>
  import("./components/terminal").then((module) => ({
    default: module.SysinfoView,
  })),
);
const FileBrowserView = lazy(() =>
  import("./components/terminal").then((module) => ({
    default: module.FileBrowserView,
  })),
);
const WebView = lazy(() =>
  import("./components/terminal").then((module) => ({
    default: module.WebView,
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
const AgentChatPage = lazy(() =>
  import("./components/agent/chat").then((module) => ({
    default: module.AgentChatPage,
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

function isTauriDesktopEnvironment(): boolean {
  return hasTauriInvokeCapability();
}

function isWindowsNavigatorPlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  const platform = navigator.platform || "";
  const userAgent = navigator.userAgent || "";
  return /win/i.test(platform) || /windows/i.test(userAgent);
}

function AppContent() {
  const [showSplash, setShowSplash] = useState(true);
  const [currentPage, setCurrentPage] = useState<Page>("agent");
  const [pageParams, setPageParams] = useState<PageParams>(() =>
    buildHomeAgentParams(),
  );
  const [agentHasMessages, setAgentHasMessages] = useState(false);
  const { needsOnboarding, completeOnboarding } = useOnboardingState();

  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [pendingRecommendation, setPendingRecommendation] = useState<{
    shortLabel: string;
    fullPrompt: string;
    projectType: ProjectType;
    projectName: string;
  } | null>(null);

  useServiceSkillCatalogBootstrap();
  useSiteAdapterCatalogBootstrap();
  useOemLimeHubProviderSync();
  useGlobalTrayModelSync({
    currentPage,
    pageParams,
  });

  const resolveWorkspacePage = useCallback(
    (workspaceTheme?: WorkspaceTheme): ThemeWorkspacePage => {
      if (workspaceTheme) {
        return getThemeWorkspacePage(workspaceTheme);
      }

      if (typeof window !== "undefined") {
        const savedPage = localStorage.getItem(
          LAST_THEME_WORKSPACE_PAGE_STORAGE_KEY,
        );

        if (
          savedPage &&
          THEME_WORKSPACE_PAGES.includes(savedPage as ThemeWorkspacePage)
        ) {
          return savedPage as ThemeWorkspacePage;
        }
      }

      return getThemeWorkspacePage("general");
    },
    [],
  );

  const handleNavigate = useCallback(
    (page: Page, params?: PageParams) => {
      if (
        page === "memory" &&
        (params as { section?: string } | undefined)?.section ===
          "style-library"
      ) {
        setCurrentPage("style");
        setPageParams({ section: "library" } as StylePageParams);
        return;
      }

      if (page === "projects") {
        const projectParams = params as
          | {
              projectId?: string;
              workspaceTheme?: WorkspaceTheme;
            }
          | undefined;
        const targetWorkspacePage = resolveWorkspacePage(
          projectParams?.workspaceTheme,
        );

        if (typeof window !== "undefined") {
          localStorage.setItem(
            LAST_THEME_WORKSPACE_PAGE_STORAGE_KEY,
            targetWorkspacePage,
          );
        }

        setCurrentPage(targetWorkspacePage);
        setPageParams({
          ...(projectParams?.projectId
            ? { projectId: projectParams.projectId }
            : {}),
          workspaceViewMode: "project-management",
        });
        return;
      }

      if (page === "project-detail") {
        const projectParams = params as ProjectDetailPageParams | undefined;
        const targetWorkspacePage = resolveWorkspacePage(
          projectParams?.workspaceTheme,
        );
        const workspaceViewMode = projectParams?.projectId
          ? "workspace"
          : "project-management";

        if (typeof window !== "undefined") {
          localStorage.setItem(
            LAST_THEME_WORKSPACE_PAGE_STORAGE_KEY,
            targetWorkspacePage,
          );
        }

        setCurrentPage(targetWorkspacePage);
        setPageParams({
          ...(projectParams?.projectId
            ? { projectId: projectParams.projectId }
            : {}),
          workspaceViewMode,
          workspaceOpenProjectStyleGuide:
            projectParams?.openProjectStyleGuide ?? false,
          workspaceOpenProjectStyleGuideSourceEntryId:
            projectParams?.openProjectStyleGuideSourceEntryId,
        });
        return;
      }

      if (isThemeWorkspacePage(page) && typeof window !== "undefined") {
        localStorage.setItem(LAST_THEME_WORKSPACE_PAGE_STORAGE_KEY, page);
      }

      setCurrentPage(page);
      setPageParams(params ? { ...params } : {});
    },
    [resolveWorkspacePage],
  );

  const _handleRequestRecommendation = useCallback(
    (shortLabel: string, fullPrompt: string, currentTheme: string) => {
      const themeLabels: Record<string, string> = {
        "social-media": "社媒",
        poster: "海报",
        music: "音乐",
        knowledge: "知识",
        planning: "计划",
        novel: "小说",
        document: "文档",
        video: "视频",
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
      handleNavigate(getThemeWorkspacePage(type as WorkspaceTheme), {
        projectId: project.id,
        workspaceViewMode: "workspace",
        workspaceCreatePrompt: pendingRecommendation.fullPrompt,
        workspaceCreateSource: "workspace_prompt",
        workspaceCreateFallbackTitle: name,
      });

      setPendingRecommendation(null);
    } else if (isUserProjectType(type)) {
      handleNavigate(getThemeWorkspacePage(type as WorkspaceTheme), {
        projectId: project.id,
        workspaceViewMode: "project-management",
      });
    } else {
      handleNavigate("agent", {
        projectId: project.id,
      });
    }

    toast.success("项目创建成功");
  };

  const {
    connectPayload,
    relayInfo,
    isVerified,
    isDialogOpen,
    isSaving,
    error,
    handleConfirm,
    handleCancel,
  } = useDeepLink();

  const { error: registryError, refresh: _refreshRegistry } =
    useRelayRegistry();

  useEffect(() => {
    if (registryError) {
      console.warn("[App] Registry 加载失败:", registryError);
      showRegistryLoadError(registryError.message);
    }
  }, [registryError]);

  useEffect(() => {
    if (!isTauriDesktopEnvironment() || !isWindowsNavigatorPlatform()) {
      return;
    }

    void getWindowsStartupDiagnostics()
      .then((diagnostics) => {
        if (!diagnostics.summary_message) {
          return;
        }

        if (diagnostics.has_blocking_issues) {
          toast.error("Windows 启动自检发现阻塞问题", {
            description: diagnostics.summary_message,
            duration: 12000,
          });
          return;
        }

        if (diagnostics.has_warnings) {
          toast.warning("Windows 环境检测提示", {
            description: diagnostics.summary_message,
            duration: 8000,
          });
        }
      })
      .catch((error) => {
        console.warn("[App] 获取 Windows 启动诊断失败:", error);
      });
  }, []);

  useEffect(() => {
    void ensureDefaultWorkspaceReady()
      .then((result) => {
        if (result?.repaired) {
          recordWorkspaceRepair({
            workspaceId: result.workspaceId,
            rootPath: result.rootPath,
            source: "app_startup",
          });
          console.info(
            "[App] 启动时检测到默认工作区目录缺失，已自动修复:",
            result.rootPath,
          );
        }
      })
      .catch((error) => {
        console.warn("[App] 启动时工作区健康检查失败:", error);
      });
  }, []);

  useEffect(() => {
    const mainElement = document.querySelector("main");
    if (mainElement) {
      mainElement.scrollTop = 0;
    }
  }, [currentPage]);

  const handleSplashComplete = useCallback(() => {
    setShowSplash(false);
  }, []);

  const renderThemeWorkspaces = () => {
    if (!THEME_WORKSPACE_PAGES.includes(currentPage as ThemeWorkspacePage)) {
      return null;
    }

    const page = currentPage as ThemeWorkspacePage;
    const theme = getThemeByWorkspacePage(page);

    return (
      <div
        key={page}
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <WorkbenchPage
          onNavigate={handleNavigate}
          projectId={(pageParams as AgentPageParams).projectId}
          contentId={(pageParams as AgentPageParams).contentId}
          theme={theme}
          viewMode={(pageParams as AgentPageParams).workspaceViewMode}
          resetAt={(pageParams as AgentPageParams).workspaceResetAt}
          initialStyleGuideDialogOpen={
            (pageParams as AgentPageParams).workspaceOpenProjectStyleGuide
          }
          initialStyleGuideSourceEntryId={
            (pageParams as AgentPageParams)
              .workspaceOpenProjectStyleGuideSourceEntryId
          }
          initialCreatePrompt={
            (pageParams as AgentPageParams).workspaceCreatePrompt
          }
          initialCreateSource={
            (pageParams as AgentPageParams).workspaceCreateSource
          }
          initialCreateFallbackTitle={
            (pageParams as AgentPageParams).workspaceCreateFallbackTitle
          }
        />
      </div>
    );
  };

  const renderCurrentPage = () => {
    if (currentPage === "image-gen") {
      return (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <ImageGenPage onNavigate={handleNavigate} />
        </div>
      );
    }

    if (currentPage === "automation") {
      return (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <AutomationPage
            onNavigate={handleNavigate}
            pageParams={pageParams as AutomationPageParams}
          />
        </div>
      );
    }

    if (currentPage === "agent") {
      return (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <AgentChatPage
            key={`${(pageParams as AgentPageParams).projectId || ""}:${(pageParams as AgentPageParams).contentId || ""}:${(pageParams as AgentPageParams).theme || ""}:${(pageParams as AgentPageParams).lockTheme ? "1" : "0"}:${(pageParams as AgentPageParams).agentEntry || "claw"}:${(pageParams as AgentPageParams).immersiveHome ? "immersive" : "standard"}:${(pageParams as AgentPageParams).newChatAt ?? 0}`}
            onNavigate={handleNavigate}
            projectId={(pageParams as AgentPageParams).projectId}
            contentId={(pageParams as AgentPageParams).contentId}
            initialRequestMetadata={
              (pageParams as AgentPageParams).initialRequestMetadata
            }
            initialUserPrompt={
              (pageParams as AgentPageParams).initialUserPrompt
            }
            initialUserImages={
              (pageParams as AgentPageParams).initialUserImages
            }
            initialCreationMode={
              (pageParams as AgentPageParams).initialCreationMode
            }
            initialSessionName={
              (pageParams as AgentPageParams).initialSessionName
            }
            entryBannerMessage={
              (pageParams as AgentPageParams).entryBannerMessage
            }
            immersiveHome={(pageParams as AgentPageParams).immersiveHome}
            openBrowserAssistOnMount={
              (pageParams as AgentPageParams).openBrowserAssistOnMount
            }
            theme={(pageParams as AgentPageParams).theme}
            lockTheme={(pageParams as AgentPageParams).lockTheme}
            fromResources={(pageParams as AgentPageParams).fromResources}
            agentEntry={(pageParams as AgentPageParams).agentEntry}
            showChatPanel={
              (pageParams as AgentPageParams).agentEntry !== "new-task" &&
              !(pageParams as AgentPageParams).immersiveHome
            }
            newChatAt={(pageParams as AgentPageParams).newChatAt}
            onHasMessagesChange={setAgentHasMessages}
          />
        </div>
      );
    }

    if (isThemeWorkspacePage(currentPage)) {
      return renderThemeWorkspaces();
    }

    if (currentPage === "terminal") {
      return (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <TerminalWorkspace onNavigate={handleNavigate} isActive />
        </div>
      );
    }

    if (currentPage === "sysinfo") {
      return (
        <FullscreenWrapper $isActive={true}>
          <SysinfoView />
        </FullscreenWrapper>
      );
    }

    if (currentPage === "files") {
      return (
        <FullscreenWrapper $isActive={true}>
          <FileBrowserView />
        </FullscreenWrapper>
      );
    }

    if (currentPage === "web") {
      return (
        <FullscreenWrapper $isActive={true}>
          <WebView />
        </FullscreenWrapper>
      );
    }

    if (currentPage === "resources") {
      return (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <ResourcesPage onNavigate={handleNavigate} />
        </div>
      );
    }

    if (currentPage === "tools") {
      return (
        <PageWrapper $isActive={true}>
          <ToolsPage onNavigate={handleNavigate} />
        </PageWrapper>
      );
    }

    if (currentPage === "browser-runtime") {
      const browserRuntimeParams = pageParams as BrowserRuntimePageParams;
      return (
        <PageWrapper $isActive={true}>
          <BrowserRuntimeWorkspace
            active={true}
            onNavigate={handleNavigate}
            initialProfileKey={browserRuntimeParams.initialProfileKey}
            initialSessionId={browserRuntimeParams.initialSessionId}
            initialTargetId={browserRuntimeParams.initialTargetId}
            currentProjectId={browserRuntimeParams.projectId}
            currentContentId={browserRuntimeParams.contentId}
            initialAdapterName={browserRuntimeParams.initialAdapterName}
            initialArgs={browserRuntimeParams.initialArgs}
            initialAutoRun={browserRuntimeParams.initialAutoRun}
            initialRequireAttachedSession={
              browserRuntimeParams.initialRequireAttachedSession
            }
            initialSaveTitle={browserRuntimeParams.initialSaveTitle}
          />
        </PageWrapper>
      );
    }

    if (currentPage === "plugins") {
      return (
        <PageWrapper $isActive={true}>
          <PluginsPage onNavigate={handleNavigate} />
        </PageWrapper>
      );
    }

    if (currentPage === "style") {
      return (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <StylePage
            onNavigate={handleNavigate}
            pageParams={pageParams as StylePageParams}
          />
        </div>
      );
    }

    if (currentPage === "memory") {
      return (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <MemoryPage
            onNavigate={handleNavigate}
            pageParams={pageParams as MemoryPageParams}
          />
        </div>
      );
    }

    if (currentPage === "openclaw") {
      return (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <OpenClawPage
            onNavigate={handleNavigate}
            pageParams={pageParams as OpenClawPageParams}
            isActive={true}
          />
        </div>
      );
    }

    if (currentPage === "settings") {
      return (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <SettingsPageV2
            onNavigate={handleNavigate}
            initialTab={(pageParams as SettingsPageParams).tab}
          />
        </div>
      );
    }

    return null;
  };

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

  const currentAgentParams = pageParams as AgentPageParams;
  const shouldHideSidebarForAgent =
    currentPage === "agent" &&
    (Boolean(currentAgentParams.fromResources) ||
      Boolean(currentAgentParams.immersiveHome) ||
      (agentHasMessages && Boolean(currentAgentParams.lockTheme)));

  const shouldShowAppSidebar =
    currentPage !== "settings" &&
    currentPage !== "memory" &&
    currentPage !== "image-gen" &&
    currentPage !== "tools" &&
    currentPage !== "plugins" &&
    currentPage !== "resources" &&
    !isThemeWorkspacePage(currentPage) &&
    !shouldHideSidebarForAgent;

  const shouldAddMainContentGap =
    shouldShowAppSidebar && currentPage === "agent";

  return (
    <SoundProvider>
      <ComponentDebugProvider>
        <AppContainer>
          {shouldShowAppSidebar && (
            <AppSidebar
              currentPage={currentPage}
              currentPageParams={pageParams}
              onNavigate={handleNavigate}
            />
          )}
          <MainContent $withSidebarGap={shouldAddMainContentGap}>
            <Suspense fallback={pageLoadingFallback}>
              {renderCurrentPage()}
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
