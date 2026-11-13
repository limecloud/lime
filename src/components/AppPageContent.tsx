/**
 * 应用页面分发层
 *
 * 负责根据当前页面类型渲染对应主内容，避免主入口继续膨胀。
 */

import { lazy, useCallback } from "react";
import type {
  AgentLocation,
  AgentPageParams,
  PluginsPageParams,
  ExpertsPageParams,
  Page,
  PageParams,
  ScheduledTasksPageParams,
  SettingsPageParams,
  SkillsPageParams,
} from "@/types/page";
import type { AgentBackgroundSessionRuntimeSnapshot } from "./agent/chat";
import { ScheduledTasksPage } from "./scheduled-tasks/ScheduledTasksPage";
import { ImConfigPage } from "./channels/ImConfigPage";
import { SettingsPage } from "./settings-v2";
import type { NavigationGuard } from "@/lib/navigationGuard";

const columnPageStyle = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
} as const;

const loadSkillsWorkspacePage = () =>
  import("./skills").then((module) => ({
    default: module.SkillsWorkspacePage,
  }));
const loadPluginsPage = () =>
  import("@/features/plugin/ui/PluginCatalogPage").then((module) => ({
    default: module.PluginCatalogPage,
  }));

const loadExpertPlazaPage = () =>
  import("./experts").then((module) => ({
    default: module.ExpertPlazaPage,
  }));
const loadLocalConversationPage = () =>
  import("./agent/chat").then((module) => ({
    default: module.LocalConversationPage,
  }));

const SkillsWorkspacePage = lazy(loadSkillsWorkspacePage);
const PluginsPage = lazy(loadPluginsPage);
const ExpertPlazaPage = lazy(loadExpertPlazaPage);
const LocalConversationPage = lazy(loadLocalConversationPage);

interface AppPageContentProps {
  currentPage: Page;
  pageParams: PageParams;
  requestedPage?: Page;
  requestedPageParams?: PageParams;
  onNavigate: (page: Page, params?: PageParams) => void;
  onStartNewConversation?: import("@/lib/workspace/navigation").StartNewConversation;
  onAgentHasMessagesChange: (hasMessages: boolean) => void;
  onAgentLocationChange?: (location: AgentLocation) => void;
  onSettingsBack: () => void;
  navigationGuard: NavigationGuard;
  onAgentStreamingChange?: (isStreaming: boolean) => void;
  onBackgroundSessionRuntimeChange?: (
    snapshot: AgentBackgroundSessionRuntimeSnapshot | null,
  ) => void;
}

export function AppPageContent({
  currentPage,
  pageParams,
  requestedPage,
  requestedPageParams,
  onNavigate,
  onStartNewConversation,
  onAgentHasMessagesChange,
  onAgentLocationChange,
  onSettingsBack,
  navigationGuard,
  onAgentStreamingChange,
  onBackgroundSessionRuntimeChange,
}: AppPageContentProps) {
  const activePage = requestedPage ?? currentPage;
  const activePageParams = requestedPageParams ?? pageParams;
  const handleAgentLocationChange = useCallback(
    (location: AgentLocation) => {
      onAgentLocationChange?.({
        sessionId: location.sessionId?.trim() || null,
        workspaceId: location.workspaceId?.trim() || null,
      });
    },
    [onAgentLocationChange],
  );

  if (activePage === "scheduled-tasks") {
    return (
      <div style={columnPageStyle}>
        <ScheduledTasksPage
          onNavigate={onNavigate}
          pageParams={activePageParams as ScheduledTasksPageParams}
        />
      </div>
    );
  }

  if (activePage === "channels") {
    return (
      <div style={columnPageStyle}>
        <div className="flex-1 overflow-auto px-6 py-6">
          <div className="mx-auto w-full max-w-[1440px]">
            <ImConfigPage />
          </div>
        </div>
      </div>
    );
  }

  if (activePage === "agent") {
    const agentPageParams = activePageParams as AgentPageParams;
    const committedAgentParams =
      currentPage === "agent" ? (pageParams as AgentPageParams) : null;
    const committedHome =
      committedAgentParams !== null &&
      committedAgentParams.newChatAt === agentPageParams.newChatAt &&
      committedAgentParams?.newConversationRequest?.id ===
        agentPageParams.newConversationRequest?.id;
    const committedRequest = committedHome
      ? committedAgentParams.newConversationRequest
      : undefined;

    return (
      <div style={columnPageStyle}>
        <LocalConversationPage
          onNavigate={onNavigate}
          projectId={agentPageParams.projectId}
          contentId={agentPageParams.contentId}
          initialSessionId={agentPageParams.initialSessionId}
          initialRequestMetadata={agentPageParams.initialRequestMetadata}
          initialAutoSendRequestMetadata={
            agentPageParams.initialAutoSendRequestMetadata
          }
          autoRunInitialPromptOnMount={
            agentPageParams.autoRunInitialPromptOnMount
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
          preferHomeForInitialInputCapability={
            agentPageParams.preferHomeForInitialInputCapability
          }
          initialProjectFileOpenTarget={
            agentPageParams.initialProjectFileOpenTarget
          }
          theme={agentPageParams.theme}
          lockTheme={agentPageParams.lockTheme}
          agentEntry={agentPageParams.agentEntry}
          showChatPanel={
            agentPageParams.agentEntry !== "new-task" &&
            !agentPageParams.immersiveHome
          }
          newChatAt={committedHome ? agentPageParams.newChatAt : undefined}
          newConversationRequest={committedRequest}
          onStartNewConversation={onStartNewConversation}
          expertAgentLaunch={agentPageParams.expertAgentLaunch}
          onHasMessagesChange={onAgentHasMessagesChange}
          onLocationChange={handleAgentLocationChange}
          onAgentStreamingChange={onAgentStreamingChange}
          onBackgroundSessionRuntimeChange={onBackgroundSessionRuntimeChange}
        />
      </div>
    );
  }

  if (activePage === "skills") {
    return (
      <SkillsWorkspacePage
        onNavigate={onNavigate}
        pageParams={activePageParams as SkillsPageParams}
      />
    );
  }

  if (activePage === "plugins") {
    return <PluginsPage pageParams={activePageParams as PluginsPageParams} />;
  }

  if (activePage === "experts") {
    const expertsPageParams = activePageParams as ExpertsPageParams;
    return (
      <ExpertPlazaPage
        onNavigate={onNavigate}
        currentProjectId={
          expertsPageParams.currentProjectId ?? expertsPageParams.projectId
        }
      />
    );
  }

  if (activePage === "settings") {
    return (
      <div style={columnPageStyle}>
        <SettingsPage
          onNavigate={onNavigate}
          pageParams={activePageParams as SettingsPageParams}
          onBack={onSettingsBack}
          navigationGuard={navigationGuard}
        />
      </div>
    );
  }

  return null;
}
