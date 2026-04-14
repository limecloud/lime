/**
 * 应用页面分发层
 *
 * 负责根据当前页面类型渲染对应主内容，避免主入口继续膨胀。
 */

import { lazy } from "react";
import styled from "styled-components";
import type {
  AgentPageParams,
  AutomationPageParams,
  BrowserRuntimePageParams,
  MemoryPageParams,
  OpenClawPageParams,
  Page,
  PageParams,
  SettingsPageParams,
  SkillsPageParams,
} from "@/types/page";
import { SettingsPageV2 } from "./settings-v2";

const PageWrapper = styled.div<{ $isActive: boolean }>`
  flex: 1;
  padding: 24px;
  overflow: auto;
  display: ${(props) => (props.$isActive ? "block" : "none")};
`;

const columnPageStyle = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
} as const;

const ResourcesPage = lazy(() =>
  import("./resources").then((module) => ({
    default: module.ResourcesPage,
  })),
);
const MemoryPage = lazy(() =>
  import("./memory").then((module) => ({
    default: module.MemoryPage,
  })),
);
const PluginsPage = lazy(() =>
  import("./plugins/PluginsPage").then((module) => ({
    default: module.PluginsPage,
  })),
);
const AutomationPage = lazy(() =>
  import("./automation").then((module) => ({
    default: module.AutomationPage,
  })),
);
const ImConfigPage = lazy(() =>
  import("./channels/ImConfigPage").then((module) => ({
    default: module.ImConfigPage,
  })),
);
const OpenClawPage = lazy(() =>
  import("./openclaw").then((module) => ({
    default: module.OpenClawPage,
  })),
);
const SkillsWorkspacePage = lazy(() =>
  import("./skills").then((module) => ({
    default: module.SkillsWorkspacePage,
  })),
);
const BrowserRuntimeWorkspace = lazy(() =>
  import("@/features/browser-runtime").then((module) => ({
    default: module.BrowserRuntimeWorkspace,
  })),
);
const AgentChatPage = lazy(() =>
  import("./agent/chat").then((module) => ({
    default: module.AgentChatPage,
  })),
);

interface AppPageContentProps {
  currentPage: Page;
  pageParams: PageParams;
  onNavigate: (page: Page, params?: PageParams) => void;
  onAgentHasMessagesChange: (hasMessages: boolean) => void;
}

export function AppPageContent({
  currentPage,
  pageParams,
  onNavigate,
  onAgentHasMessagesChange,
}: AppPageContentProps) {
  if (currentPage === "automation") {
    return (
      <div style={columnPageStyle}>
        <AutomationPage
          onNavigate={onNavigate}
          pageParams={pageParams as AutomationPageParams}
        />
      </div>
    );
  }

  if (currentPage === "channels") {
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

  if (currentPage === "agent") {
    const agentPageParams = pageParams as AgentPageParams;

    return (
      <div style={columnPageStyle}>
        <AgentChatPage
          key={`${agentPageParams.projectId || ""}:${agentPageParams.contentId || ""}:${agentPageParams.theme || ""}:${agentPageParams.lockTheme ? "1" : "0"}:${agentPageParams.agentEntry || "claw"}:${agentPageParams.immersiveHome ? "immersive" : "standard"}:${agentPageParams.newChatAt ?? 0}:${agentPageParams.initialPendingServiceSkillLaunch?.skillId || ""}:${agentPageParams.initialPendingServiceSkillLaunch?.requestKey ?? 0}:${agentPageParams.initialProjectFileOpenTarget?.relativePath || ""}:${agentPageParams.initialProjectFileOpenTarget?.requestKey ?? 0}`}
          onNavigate={onNavigate}
          projectId={agentPageParams.projectId}
          contentId={agentPageParams.contentId}
          initialRequestMetadata={agentPageParams.initialRequestMetadata}
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
  }

  if (currentPage === "resources") {
    return (
      <div style={columnPageStyle}>
        <ResourcesPage onNavigate={onNavigate} />
      </div>
    );
  }

  if (currentPage === "browser-runtime") {
    const browserRuntimeParams = pageParams as BrowserRuntimePageParams;

    return (
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
  }

  if (currentPage === "plugins") {
    return (
      <PageWrapper $isActive={true}>
        <PluginsPage onNavigate={onNavigate} />
      </PageWrapper>
    );
  }

  if (currentPage === "memory") {
    return (
      <div style={columnPageStyle}>
        <div className="flex-1 min-h-0 overflow-auto">
          <MemoryPage
            onNavigate={onNavigate}
            pageParams={pageParams as MemoryPageParams}
          />
        </div>
      </div>
    );
  }

  if (currentPage === "openclaw") {
    return (
      <div
        style={{
          ...columnPageStyle,
          overflowY: "auto",
        }}
      >
        <OpenClawPage
          onNavigate={onNavigate}
          pageParams={pageParams as OpenClawPageParams}
          isActive={true}
        />
      </div>
    );
  }

  if (currentPage === "skills") {
    return (
      <div style={columnPageStyle}>
        <SkillsWorkspacePage
          onNavigate={onNavigate}
          pageParams={pageParams as SkillsPageParams}
        />
      </div>
    );
  }

  if (currentPage === "settings") {
    return (
      <div style={columnPageStyle}>
        <SettingsPageV2
          onNavigate={onNavigate}
          initialTab={(pageParams as SettingsPageParams).tab}
          initialProviderView={(pageParams as SettingsPageParams).providerView}
        />
      </div>
    );
  }

  return null;
}
