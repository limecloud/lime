import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceConversationScene } from "./WorkspaceConversationScene";

vi.mock("../components/CanvasWorkbenchLayout", () => ({
  CanvasWorkbenchLayout: () => <div data-testid="canvas-layout-stub" />,
}));

vi.mock("../components/ChatNavbar", () => ({
  ChatNavbar: () => <div data-testid="chat-navbar-stub" />,
}));

vi.mock("../components/EmptyState", () => ({
  EmptyState: () => <div data-testid="empty-state-stub" />,
}));

vi.mock("../components/MessageList", () => ({
  MessageList: ({ leadingContent }: { leadingContent?: React.ReactNode }) => (
    <div data-testid="message-list-stub">{leadingContent}</div>
  ),
}));

vi.mock("../components/TeamWorkspaceDock", () => ({
  TeamWorkspaceDock: () => <div data-testid="team-dock-stub" />,
}));

vi.mock("./WorkspaceMainArea", () => ({
  WorkspaceMainArea: ({
    navbarNode,
    chatContent,
    canvasContent,
  }: {
    navbarNode?: React.ReactNode;
    chatContent?: React.ReactNode;
    canvasContent?: React.ReactNode;
  }) => (
    <div data-testid="workspace-main-area-stub">
      {navbarNode}
      {chatContent}
      {canvasContent}
    </div>
  ),
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function renderScene(
  props?: Partial<React.ComponentProps<typeof WorkspaceConversationScene>>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultProps: React.ComponentProps<typeof WorkspaceConversationScene> =
    {
      entryBannerVisible: false,
      entryBannerMessage: undefined,
      onDismissEntryBanner: vi.fn(),
      creationReplaySurface: null,
      showChatLayout: true,
      compactChrome: false,
      contextWorkspaceEnabled: false,
      messageListProps: {
        messages: [],
        turns: [],
        threadItems: [],
        currentTurnId: null,
        threadRead: false,
        pendingActions: [],
        submittedActionsInFlight: [],
        queuedTurns: [],
        isSending: false,
        onInterruptCurrentTurn: vi.fn(),
      } as any,
      workspaceAlertVisible: false,
      onSelectWorkspaceDirectory: vi.fn(),
      onDismissWorkspaceAlert: vi.fn(),
      shouldHideGeneralWorkbenchInputForTheme: false,
      inputbarNode: null,
      input: "",
      setInput: vi.fn(),
      onSendMessage: vi.fn(),
      emptyStateIsLoading: false,
      emptyStateDisabled: false,
      providerType: "openai",
      setProviderType: vi.fn(),
      model: "gpt-4.1",
      setModel: vi.fn(),
      executionStrategy: "react",
      setExecutionStrategy: vi.fn(),
      accessMode: "default" as any,
      setAccessMode: vi.fn(),
      onManageProviders: vi.fn(),
      toolPreferences: {
        webSearch: false,
        thinking: false,
        task: false,
        subagent: false,
      },
      onToolPreferenceChange: vi.fn(),
      selectedTeam: null,
      onSelectTeam: vi.fn(),
      onEnableSuggestedTeam: vi.fn(),
      creationMode: "guided",
      onCreationModeChange: vi.fn(),
      activeTheme: "general",
      onThemeChange: vi.fn(),
      themeLocked: false,
      artifactsCount: 0,
      generalCanvasContent: "",
      resolvedCanvasState: null,
      selectedText: "",
      onRecommendationClick: vi.fn(),
      characters: [],
      skills: [],
      serviceSkills: [],
      serviceSkillGroups: [],
      isSkillsLoading: false,
      onSelectServiceSkill: vi.fn(),
      onNavigateToSettings: vi.fn(),
      onRefreshSkills: vi.fn(),
      onLaunchBrowserAssist: vi.fn(),
      browserAssistLoading: false,
      featuredSceneApps: [],
      sceneAppsLoading: false,
      sceneAppLaunchingId: null,
      onLaunchSceneApp: vi.fn(),
      canResumeRecentSceneApp: false,
      onResumeRecentSceneApp: vi.fn(),
      onOpenSceneAppsDirectory: vi.fn(),
      projectId: null,
      onProjectChange: vi.fn(),
      onOpenSettings: vi.fn(),
      runtimeToolAvailability: null,
      runtimeTaskCard: null,
      onOpenMemoryWorkbench: vi.fn(),
      onOpenChannels: vi.fn(),
      onOpenChromeRelay: vi.fn(),
      onOpenOpenClaw: vi.fn(),
      navbarVisible: false,
      isRunning: false,
      navbarChrome: "default" as any,
      onToggleHistory: vi.fn(),
      showHistoryToggle: false,
      onBackToProjectManagement: undefined,
      onBackToResources: undefined,
      layoutMode: "chat" as any,
      onToggleCanvas: vi.fn(),
      onBackHome: vi.fn(),
      showHarnessToggle: false,
      harnessPanelVisible: false,
      onToggleHarnessPanel: vi.fn(),
      harnessPendingCount: 0,
      harnessAttentionLevel: "idle" as any,
      harnessToggleLabel: undefined,
      showContextCompactionAction: false,
      contextCompactionRunning: false,
      onCompactContext: vi.fn(),
      isThemeWorkbench: false,
      contentId: undefined,
      syncStatus: "idle",
      hasLiveCanvasPreviewContent: false,
      liveCanvasPreview: null,
      currentImageWorkbenchActive: false,
      shouldShowCanvasLoadingState: false,
      teamWorkbenchView: null,
      canvasWorkbenchLayoutProps: {
        artifacts: [],
      } as any,
      shellBottomInset: "0px",
      chatPanelWidth: undefined,
      chatPanelMinWidth: undefined,
      generalWorkbenchDialog: null,
      generalWorkbenchHarnessDialog: null,
      showFloatingInputOverlay: false,
      hasPendingA2UIForm: false,
    } as any;

  act(() => {
    root.render(<WorkspaceConversationScene {...defaultProps} {...props} />);
  });

  mountedRoots.push({ root, container });
  return container;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      break;
    }
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
});

describe("WorkspaceConversationScene", () => {
  it("生成主执行面应显示当前带入的灵感横条", () => {
    const container = renderScene({
      creationReplaySurface: {
        kind: "memory_entry",
        eyebrow: "当前带入灵感",
        badgeLabel: "参考",
        title: "品牌风格样本",
        summary: "保留轻盈但专业的表达。",
        hint: "后续结果模板会默认把它一起带入。",
        defaultReferenceMemoryIds: ["memory-1"],
        defaultReferenceEntries: [
          {
            id: "memory-1",
            title: "品牌风格样本",
            summary: "保留轻盈但专业的表达。",
            category: "context",
            categoryLabel: "参考",
            tags: ["品牌", "语气"],
          },
        ],
      },
    });

    expect(container.textContent).toContain("当前带入灵感");
    expect(container.textContent).toContain("品牌风格样本");
    expect(container.textContent).toContain("后续结果模板会默认把它一起带入。");
  });
});
