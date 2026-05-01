/**
 * 应用页面分发层
 *
 * 负责根据当前页面类型渲染对应主内容，避免主入口继续膨胀。
 */

import { lazy, useEffect, useState, type ReactNode } from "react";
import styled from "styled-components";
import {
  normalizeSceneAppsPageParams,
  serializeSceneAppsPageParams,
} from "@/lib/sceneapp";
import type {
  AgentPageParams,
  AutomationPageParams,
  BrowserRuntimePageParams,
  KnowledgePageParams,
  MemoryPageParams,
  OpenClawPageParams,
  Page,
  PageParams,
  ResourcesPageParams,
  SceneAppsPageParams,
  SettingsPageParams,
  SkillsPageParams,
} from "@/types/page";
import { AutomationPage } from "./automation";
import { ImConfigPage } from "./channels/ImConfigPage";
import { SceneAppsPage } from "./sceneapps";
import { SettingsPageV2 } from "./settings-v2";

const PageWrapper = styled.div<{ $isActive: boolean }>`
  flex: 1;
  padding: 24px;
  overflow: auto;
  display: ${(props) => (props.$isActive ? "block" : "none")};
`;

const KeepAliveColumnPage = styled.div<{ $isActive: boolean }>`
  flex: 1;
  min-height: 0;
  display: ${(props) => (props.$isActive ? "flex" : "none")};
`;

const columnPageStyle = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
} as const;

const loadResourcesPage = () =>
  import("./resources").then((module) => ({
    default: module.ResourcesPage,
  }));
const loadMemoryPage = () =>
  import("./memory").then((module) => ({
    default: module.MemoryPage,
  }));
const loadPluginsPage = () =>
  import("./plugins/PluginsPage").then((module) => ({
    default: module.PluginsPage,
  }));
const loadOpenClawPage = () =>
  import("./openclaw").then((module) => ({
    default: module.OpenClawPage,
  }));
const loadSkillsWorkspacePage = () =>
  import("./skills").then((module) => ({
    default: module.SkillsWorkspacePage,
  }));
const loadKnowledgePage = () =>
  import("@/features/knowledge").then((module) => ({
    default: module.KnowledgePage,
  }));
const loadBrowserRuntimeWorkspace = () =>
  import("@/features/browser-runtime").then((module) => ({
    default: module.BrowserRuntimeWorkspace,
  }));
const loadAgentChatPage = () =>
  import("./agent/chat").then((module) => ({
    default: module.AgentChatPage,
  }));

const ResourcesPage = lazy(loadResourcesPage);
const MemoryPage = lazy(loadMemoryPage);
const PluginsPage = lazy(loadPluginsPage);
const OpenClawPage = lazy(loadOpenClawPage);
const SkillsWorkspacePage = lazy(loadSkillsWorkspacePage);
const KnowledgePage = lazy(loadKnowledgePage);
const BrowserRuntimeWorkspace = lazy(loadBrowserRuntimeWorkspace);
const AgentChatPage = lazy(loadAgentChatPage);

function serializeInitialInputCapabilityKey(params: AgentPageParams): string {
  const route = params.initialInputCapability?.capabilityRoute;
  if (!route) {
    return "::0";
  }

  const routeKey =
    route.kind === "installed_skill"
      ? route.skillKey
      : route.kind === "builtin_command"
        ? route.commandKey
        : route.kind === "runtime_scene"
          ? route.sceneKey
          : route.taskId;

  return `${route.kind}:${routeKey}:${params.initialInputCapability?.requestKey ?? 0}`;
}

interface AppPageContentProps {
  currentPage: Page;
  pageParams: PageParams;
  requestedPage?: Page;
  requestedPageParams?: PageParams;
  navigationRequestId?: number;
  onNavigate: (page: Page, params?: PageParams) => void;
  onAgentHasMessagesChange: (hasMessages: boolean) => void;
}

export function AppPageContent({
  currentPage,
  pageParams,
  requestedPage,
  requestedPageParams,
  navigationRequestId = 0,
  onNavigate,
  onAgentHasMessagesChange,
}: AppPageContentProps) {
  const activePage = requestedPage ?? currentPage;
  const activePageParams = requestedPageParams ?? pageParams;
  const activeSceneAppsPageParams =
    activePage === "sceneapps"
      ? normalizeSceneAppsPageParams(activePageParams as SceneAppsPageParams)
      : null;
  const activeSceneAppsPageParamsKey = serializeSceneAppsPageParams(
    activeSceneAppsPageParams ?? {},
  );
  const [hasVisitedSceneApps, setHasVisitedSceneApps] = useState(
    activePage === "sceneapps",
  );
  const [cachedSceneAppsPageParams, setCachedSceneAppsPageParams] =
    useState<SceneAppsPageParams>(() => activeSceneAppsPageParams ?? {});

  useEffect(() => {
    if (activePage !== "sceneapps" || !activeSceneAppsPageParams) {
      return;
    }

    setHasVisitedSceneApps(true);
    setCachedSceneAppsPageParams((current) =>
      serializeSceneAppsPageParams(current) === activeSceneAppsPageParamsKey
        ? current
        : activeSceneAppsPageParams,
    );
  }, [activeSceneAppsPageParams, activeSceneAppsPageParamsKey, activePage]);

  const shouldRenderSceneApps =
    hasVisitedSceneApps || activePage === "sceneapps";
  const sceneAppsContent = shouldRenderSceneApps ? (
    <KeepAliveColumnPage $isActive={activePage === "sceneapps"}>
      <SceneAppsPage
        isActive={activePage === "sceneapps"}
        isNavigationTargetOwner={activePage === "sceneapps"}
        navigationRequestId={navigationRequestId}
        onNavigate={onNavigate}
        pageParams={activeSceneAppsPageParams ?? cachedSceneAppsPageParams}
      />
    </KeepAliveColumnPage>
  ) : null;
  const wrapWithSceneApps = (content: ReactNode) =>
    sceneAppsContent ? (
      <>
        {sceneAppsContent}
        {content}
      </>
    ) : (
      content
    );

  if (activePage === "sceneapps") {
    return wrapWithSceneApps(null);
  }

  if (activePage === "automation") {
    const content = (
      <div style={columnPageStyle}>
        <AutomationPage
          onNavigate={onNavigate}
          pageParams={activePageParams as AutomationPageParams}
        />
      </div>
    );

    return wrapWithSceneApps(content);
  }

  if (activePage === "channels") {
    const content = (
      <div style={columnPageStyle}>
        <div className="flex-1 overflow-auto px-6 py-6">
          <div className="mx-auto w-full max-w-[1440px]">
            <ImConfigPage />
          </div>
        </div>
      </div>
    );

    return wrapWithSceneApps(content);
  }

  if (activePage === "agent") {
    const agentPageParams = activePageParams as AgentPageParams;

    const content = (
      <div style={columnPageStyle}>
        <AgentChatPage
          key={`${agentPageParams.projectId || ""}:${agentPageParams.contentId || ""}:${agentPageParams.theme || ""}:${agentPageParams.lockTheme ? "1" : "0"}:${agentPageParams.agentEntry || "claw"}:${agentPageParams.immersiveHome ? "immersive" : "standard"}:${agentPageParams.newChatAt ?? 0}:${agentPageParams.initialPendingServiceSkillLaunch?.skillId || ""}:${agentPageParams.initialPendingServiceSkillLaunch?.requestKey ?? 0}:${serializeInitialInputCapabilityKey(agentPageParams)}:${agentPageParams.initialProjectFileOpenTarget?.relativePath || ""}:${agentPageParams.initialProjectFileOpenTarget?.requestKey ?? 0}`}
          onNavigate={onNavigate}
          projectId={agentPageParams.projectId}
          contentId={agentPageParams.contentId}
          initialSessionId={agentPageParams.initialSessionId}
          initialSceneAppExecutionSummary={
            agentPageParams.initialSceneAppExecutionSummary
          }
          initialRequestMetadata={agentPageParams.initialRequestMetadata}
          initialAutoSendRequestMetadata={
            agentPageParams.initialAutoSendRequestMetadata
          }
          initialUserPrompt={agentPageParams.initialUserPrompt}
          initialUserImages={agentPageParams.initialUserImages}
          initialCreationMode={agentPageParams.initialCreationMode}
          initialSessionName={agentPageParams.initialSessionName}
          entryBannerMessage={agentPageParams.entryBannerMessage}
          immersiveHome={agentPageParams.immersiveHome}
          openBrowserAssistOnMount={agentPageParams.openBrowserAssistOnMount}
          initialSiteSkillLaunch={agentPageParams.initialSiteSkillLaunch}
          initialPendingServiceSkillLaunch={
            agentPageParams.initialPendingServiceSkillLaunch
          }
          initialInputCapability={agentPageParams.initialInputCapability}
          initialProjectFileOpenTarget={
            agentPageParams.initialProjectFileOpenTarget
          }
          theme={agentPageParams.theme}
          lockTheme={agentPageParams.lockTheme}
          fromResources={agentPageParams.fromResources}
          agentEntry={agentPageParams.agentEntry}
          showChatPanel={
            agentPageParams.agentEntry !== "new-task" &&
            !agentPageParams.immersiveHome
          }
          newChatAt={agentPageParams.newChatAt}
          onHasMessagesChange={onAgentHasMessagesChange}
        />
      </div>
    );

    return wrapWithSceneApps(content);
  }

  if (activePage === "resources") {
    const content = (
      <div style={columnPageStyle}>
        <ResourcesPage
          onNavigate={onNavigate}
          pageParams={activePageParams as ResourcesPageParams}
        />
      </div>
    );

    return wrapWithSceneApps(content);
  }

  if (activePage === "browser-runtime") {
    const browserRuntimeParams = activePageParams as BrowserRuntimePageParams;

    const content = (
      <PageWrapper $isActive={true}>
        <BrowserRuntimeWorkspace
          active={true}
          onNavigate={onNavigate}
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

    return wrapWithSceneApps(content);
  }

  if (activePage === "plugins") {
    const content = (
      <PageWrapper $isActive={true}>
        <PluginsPage onNavigate={onNavigate} />
      </PageWrapper>
    );

    return wrapWithSceneApps(content);
  }

  if (activePage === "memory") {
    const content = (
      <div style={columnPageStyle}>
        <div className="flex-1 min-h-0 overflow-auto">
          <MemoryPage
            onNavigate={onNavigate}
            pageParams={activePageParams as MemoryPageParams}
          />
        </div>
      </div>
    );

    return wrapWithSceneApps(content);
  }

  if (activePage === "openclaw") {
    const content = (
      <div
        style={{
          ...columnPageStyle,
          overflowY: "auto",
        }}
      >
        <OpenClawPage
          onNavigate={onNavigate}
          pageParams={activePageParams as OpenClawPageParams}
          isActive={true}
        />
      </div>
    );

    return wrapWithSceneApps(content);
  }

  if (activePage === "skills") {
    const content = (
      <div style={columnPageStyle}>
        <SkillsWorkspacePage
          onNavigate={onNavigate}
          pageParams={activePageParams as SkillsPageParams}
        />
      </div>
    );

    return wrapWithSceneApps(content);
  }

  if (activePage === "knowledge") {
    const content = (
      <div style={{ ...columnPageStyle, overflow: "hidden" }}>
        <KnowledgePage
          onNavigate={onNavigate}
          pageParams={activePageParams as KnowledgePageParams}
        />
      </div>
    );

    return wrapWithSceneApps(content);
  }

  if (activePage === "settings") {
    const content = (
      <div style={columnPageStyle}>
        <SettingsPageV2
          onNavigate={onNavigate}
          initialTab={(activePageParams as SettingsPageParams).tab}
          initialProviderView={
            (activePageParams as SettingsPageParams).providerView
          }
        />
      </div>
    );

    return wrapWithSceneApps(content);
  }

  return null;
}
