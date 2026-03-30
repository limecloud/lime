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
  StylePageParams,
} from "@/types/page";
import {
  getThemeByWorkspacePage,
  isThemeWorkspacePage,
  type ThemeWorkspacePage,
} from "@/types/page";

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

const columnPageStyle = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
} as const;

const SettingsPageV2 = lazy(() =>
  import("./settings-v2").then((module) => ({
    default: module.SettingsPageV2,
  })),
);
const ToolsPage = lazy(() =>
  import("./tools/ToolsPage").then((module) => ({
    default: module.ToolsPage,
  })),
);
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
const StylePage = lazy(() =>
  import("./style").then((module) => ({
    default: module.StylePage,
  })),
);
const PluginsPage = lazy(() =>
  import("./plugins/PluginsPage").then((module) => ({
    default: module.PluginsPage,
  })),
);
const ImageGenPage = lazy(() =>
  import("./image-gen").then((module) => ({
    default: module.ImageGenPage,
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
const WorkbenchPage = lazy(() =>
  import("./workspace").then((module) => ({
    default: module.WorkbenchPage,
  })),
);
const BrowserRuntimeWorkspace = lazy(() =>
  import("@/features/browser-runtime").then((module) => ({
    default: module.BrowserRuntimeWorkspace,
  })),
);
const TerminalWorkspace = lazy(() =>
  import("./terminal").then((module) => ({
    default: module.TerminalWorkspace,
  })),
);
const SysinfoView = lazy(() =>
  import("./terminal").then((module) => ({
    default: module.SysinfoView,
  })),
);
const FileBrowserView = lazy(() =>
  import("./terminal").then((module) => ({
    default: module.FileBrowserView,
  })),
);
const WebView = lazy(() =>
  import("./terminal").then((module) => ({
    default: module.WebView,
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

function renderThemeWorkspace(
  currentPage: ThemeWorkspacePage,
  pageParams: PageParams,
  onNavigate: (page: Page, params?: PageParams) => void,
) {
  const theme = getThemeByWorkspacePage(currentPage);
  const agentPageParams = pageParams as AgentPageParams;

  return (
    <div key={currentPage} style={columnPageStyle}>
      <WorkbenchPage
        onNavigate={onNavigate}
        projectId={agentPageParams.projectId}
        contentId={agentPageParams.contentId}
        theme={theme}
        viewMode={agentPageParams.workspaceViewMode}
        resetAt={agentPageParams.workspaceResetAt}
        initialStyleGuideDialogOpen={
          agentPageParams.workspaceOpenProjectStyleGuide
        }
        initialStyleGuideSourceEntryId={
          agentPageParams.workspaceOpenProjectStyleGuideSourceEntryId
        }
        initialCreatePrompt={agentPageParams.workspaceCreatePrompt}
        initialCreateSource={agentPageParams.workspaceCreateSource}
        initialCreateFallbackTitle={
          agentPageParams.workspaceCreateFallbackTitle
        }
      />
    </div>
  );
}

export function AppPageContent({
  currentPage,
  pageParams,
  onNavigate,
  onAgentHasMessagesChange,
}: AppPageContentProps) {
  if (currentPage === "image-gen") {
    return (
      <div style={columnPageStyle}>
        <ImageGenPage onNavigate={onNavigate} />
      </div>
    );
  }

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
          key={`${agentPageParams.projectId || ""}:${agentPageParams.contentId || ""}:${agentPageParams.theme || ""}:${agentPageParams.lockTheme ? "1" : "0"}:${agentPageParams.agentEntry || "claw"}:${agentPageParams.immersiveHome ? "immersive" : "standard"}:${agentPageParams.newChatAt ?? 0}`}
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

  if (isThemeWorkspacePage(currentPage)) {
    return renderThemeWorkspace(currentPage, pageParams, onNavigate);
  }

  if (currentPage === "terminal") {
    return (
      <div style={columnPageStyle}>
        <TerminalWorkspace onNavigate={onNavigate} isActive />
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
      <div style={columnPageStyle}>
        <ResourcesPage onNavigate={onNavigate} />
      </div>
    );
  }

  if (currentPage === "tools") {
    return (
      <PageWrapper $isActive={true}>
        <ToolsPage onNavigate={onNavigate} />
      </PageWrapper>
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

  if (currentPage === "style") {
    return (
      <div style={columnPageStyle}>
        <StylePage
          onNavigate={onNavigate}
          pageParams={pageParams as StylePageParams}
        />
      </div>
    );
  }

  if (currentPage === "memory") {
    return (
      <div style={columnPageStyle}>
        <MemoryPage
          onNavigate={onNavigate}
          pageParams={pageParams as MemoryPageParams}
        />
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
        <SkillsWorkspacePage onNavigate={onNavigate} />
      </div>
    );
  }

  if (currentPage === "settings") {
    return (
      <div style={columnPageStyle}>
        <SettingsPageV2
          onNavigate={onNavigate}
          initialTab={(pageParams as SettingsPageParams).tab}
        />
      </div>
    );
  }

  return null;
}
