import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceConversationSceneRuntime } from "./useWorkspaceConversationSceneRuntime";

type HookProps = Parameters<typeof useWorkspaceConversationSceneRuntime>[0];

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function createBaseParams(overrides: Record<string, unknown> = {}) {
  const noop = vi.fn();
  const setCanvasWorkbenchLayoutMode = vi.fn();

  return {
    navigationActions: {
      handleDismissEntryBanner: noop,
      handleWorkspaceAlertSelectDirectory: noop,
      handleDismissWorkspaceAlert: noop,
      handleManageProviders: noop,
      handleProjectChange: noop,
      handleOpenAppearanceSettings: noop,
      handleOpenChannels: noop,
      handleOpenChromeRelay: noop,
      handleOpenOpenClaw: noop,
      handleBackToResources: noop,
      handleCompactContext: noop,
      handleOpenRuntimeMemoryWorkbench: noop,
    },
    inputbarScene: {
      inputbarNode: null,
      generalWorkbenchDialog: undefined,
      teamWorkbenchSurfaceProps: {},
      runtimeToolAvailability: null,
    },
    canvasScene: {
      hasLiveCanvasPreviewContent: false,
      liveCanvasPreview: null,
      shouldShowCanvasLoadingState: false,
      teamWorkbenchView: null,
      canvasWorkbenchDefaultPreview: null,
      handleOpenCanvasWorkbenchPath: noop,
      handleRevealCanvasWorkbenchPath: noop,
      renderCanvasWorkbenchPreview: noop,
    },
    handleSendFromEmptyState: noop,
    shellChromeRuntime: {
      showChatLayout: true,
      isWorkspaceCompactChrome: false,
      workflowLayoutBottomSpacing: {
        messageViewportBottomPadding: "0px",
        shellBottomInset: "0px",
      },
      shouldHideGeneralWorkbenchInputForTheme: false,
      shouldRenderTopBar: true,
      layoutTransitionChatPanelWidth: undefined,
      layoutTransitionChatPanelMinWidth: undefined,
      shouldShowGeneralWorkbenchFloatingInputOverlay: false,
      shouldRenderInlineA2UI: false,
    },
    generalWorkbenchHarnessDialog: undefined,
    entryBannerVisible: false,
    entryBannerMessage: undefined,
    sceneAppExecutionSummaryCard: undefined,
    serviceSkillExecutionCard: undefined,
    contextWorkspaceEnabled: false,
    input: "",
    setInput: noop,
    providerType: "mock-provider",
    setProviderType: noop,
    model: "mock-model",
    setModel: noop,
    executionStrategy: "default",
    setExecutionStrategy: noop,
    accessMode: "default",
    setAccessMode: noop,
    chatToolPreferences: {
      webSearch: false,
      thinking: false,
      task: false,
      subagent: false,
    },
    setChatToolPreferences: noop,
    selectedTeam: null,
    handleSelectTeam: noop,
    handleEnableSuggestedTeam: noop,
    creationMode: "guided",
    setCreationMode: noop,
    activeTheme: "general",
    setActiveTheme: noop,
    lockTheme: false,
    artifacts: [],
    generalCanvasContent: "",
    resolvedCanvasState: null,
    contentId: null,
    selectedText: "",
    handleRecommendationClick: noop,
    projectCharacters: [],
    skills: [],
    serviceSkills: [],
    skillsLoading: false,
    onSelectServiceSkill: noop,
    handleNavigateToSkillSettings: noop,
    handleRefreshSkills: noop,
    handleOpenBrowserAssistInCanvas: noop,
    browserAssistLaunching: false,
    projectId: "project-1",
    hideHistoryToggle: false,
    showChatPanel: true,
    topBarChrome: "full",
    onBackToProjectManagement: undefined,
    fromResources: false,
    handleBackHome: noop,
    handleToggleSidebar: noop,
    showHarnessToggle: false,
    navbarHarnessPanelVisible: false,
    handleToggleHarnessPanel: noop,
    harnessPendingCount: 0,
    harnessAttentionLevel: "idle",
    harnessToggleLabel: undefined,
    sessionId: null,
    syncStatus: "idle",
    pendingA2UIForm: undefined,
    pendingA2UISource: null,
    a2uiSubmissionNotice: undefined,
    handlePendingA2UISubmit: noop,
    handleToggleCanvas: noop,
    currentImageWorkbenchActive: false,
    hideInlineStepProgress: false,
    isSpecializedThemeMode: false,
    hasMessages: false,
    steps: [],
    currentStepIndex: 0,
    goToStep: noop,
    displayMessages: [],
    turns: [],
    effectiveThreadItems: [],
    currentTurnId: null,
    threadRead: false,
    pendingActions: [],
    submittedActionsInFlight: [],
    queuedTurns: [],
    isPreparingSend: false,
    isSending: false,
    stopSending: noop,
    resumeThread: noop,
    replayPendingAction: noop,
    promoteQueuedTurn: noop,
    deleteMessage: noop,
    editMessage: noop,
    handleA2UISubmit: noop,
    handleWriteFile: noop,
    handleFileClick: noop,
    handleOpenArtifactFromTimeline: noop,
    handleOpenSavedSiteContent: noop,
    handleArtifactClick: noop,
    handleOpenSubagentSession: noop,
    handlePermissionResponse: noop,
    pendingPromotedA2UIActionRequest: null,
    shouldCollapseCodeBlocks: false,
    shouldCollapseCodeBlockInChat: noop,
    handleCodeBlockClick: noop,
    teamWorkspaceEnabled: false,
    layoutMode: "chat-canvas",
    handleActivateTeamWorkbench: noop,
    isThemeWorkbench: false,
    settledWorkbenchArtifacts: [],
    taskFiles: [],
    selectedFileId: undefined,
    projectRootPath: "/tmp/project-1",
    handleHarnessLoadFilePreview: noop,
    setCanvasWorkbenchLayoutMode,
    workspacePathMissing: false,
    workspaceHealthError: false,
    focusedTimelineItemId: null,
    timelineFocusRequestKey: 0,
    ...overrides,
  } as any;
}

function renderHook(initialProps: HookProps) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latestValue: ReturnType<typeof useWorkspaceConversationSceneRuntime> | null =
    null;

  function Probe(currentProps: HookProps) {
    latestValue = useWorkspaceConversationSceneRuntime(currentProps);
    return null;
  }

  const render = (nextProps: HookProps) => {
    act(() => {
      root.render(React.createElement(Probe, nextProps));
    });
  };

  render(initialProps);
  mountedRoots.push({ root, container });

  return {
    getValue: () => {
      if (!latestValue) {
        throw new Error("hook 尚未初始化");
      }
      return latestValue;
    },
    render,
  };
}

function getRenderedSceneProps(params: ReturnType<typeof createBaseParams>) {
  const { getValue } = renderHook(params);
  return (getValue().mainAreaNode as any).props;
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
  vi.restoreAllMocks();
});

describe("useWorkspaceConversationSceneRuntime", () => {
  it("通用 Claw 双栏场景应继续同步 stacked/split 布局状态", () => {
    const params = createBaseParams();
    const setCanvasWorkbenchLayoutMode = params.setCanvasWorkbenchLayoutMode;

    const sceneProps = getRenderedSceneProps(params);
    expect(sceneProps.canvasWorkbenchLayoutProps.onLayoutModeChange).toBe(
      setCanvasWorkbenchLayoutMode,
    );
  });

  it("主题工作台场景不应再向外回写 stacked/split 布局状态", () => {
    const params = createBaseParams({
      activeTheme: "general",
      isThemeWorkbench: true,
      isSpecializedThemeMode: true,
      layoutMode: "canvas",
    });

    const sceneProps = getRenderedSceneProps(params);
    expect(sceneProps.canvasWorkbenchLayoutProps.onLayoutModeChange).toBeUndefined();
  });

  it("生成场景应继续向页面层透传顶栏上下文变体", () => {
    const params = createBaseParams({
      navbarContextVariant: "task-center",
    });

    const sceneProps = getRenderedSceneProps(params);
    expect(sceneProps.navbarContextVariant).toBe("task-center");
  });

  it("存在处理工作台入口时应透传顶栏按钮文案", () => {
    const params = createBaseParams({
      showHarnessToggle: true,
      harnessToggleLabel: "工作台",
    });

    const sceneProps = getRenderedSceneProps(params);
    expect(sceneProps.harnessToggleLabel).toBe("工作台");
  });

  it("首页空态应继续透传 service skills 与选择回调", () => {
    const onSelectServiceSkill = vi.fn();
    const serviceSkills = [
      {
        id: "daily-trend-briefing",
        title: "每日趋势摘要",
      },
    ];
    const params = createBaseParams({
      serviceSkills,
      onSelectServiceSkill,
    });

    const sceneProps = getRenderedSceneProps(params);
    expect(sceneProps.serviceSkills).toBe(serviceSkills);
    expect(sceneProps.onSelectServiceSkill).toBe(onSelectServiceSkill);
  });

  it("应向画布壳透传解耦后的 sessionView 过程面板", () => {
    const params = createBaseParams({
      turns: [
        {
          id: "turn-1",
          thread_id: "thread-1",
          prompt_text: "请抓取文章并整理成 markdown",
          status: "running",
          started_at: "2026-04-09T10:00:00.000Z",
          created_at: "2026-04-09T10:00:00.000Z",
          updated_at: "2026-04-09T10:00:01.000Z",
        },
      ],
      currentTurnId: "turn-1",
      effectiveThreadItems: [
        {
          id: "item-1",
          thread_id: "thread-1",
          turn_id: "turn-1",
          sequence: 1,
          status: "in_progress",
          started_at: "2026-04-09T10:00:00.000Z",
          updated_at: "2026-04-09T10:00:01.000Z",
          type: "tool_call",
          tool_name: "Skill(url_parse)",
          arguments: { url: "https://example.com" },
        },
      ],
      pendingActions: [
        {
          requestId: "req-1",
          actionType: "elicitation",
          prompt: "请补充导出目录",
          status: "pending",
        },
      ],
      queuedTurns: [
        {
          queued_turn_id: "queued-1",
          message_preview: "继续下载图片",
          message_text: "继续下载图片",
          created_at: 1_712_650_000,
          image_count: 0,
          position: 1,
        },
      ],
      settledWorkbenchArtifacts: [{ id: "artifact-1" }],
      isSending: true,
      focusedTimelineItemId: "item-1",
    });

    const sceneProps = getRenderedSceneProps(params);
    const sessionView = sceneProps.canvasWorkbenchLayoutProps.sessionView;

    expect(sessionView?.title).toBe("Session · Main");
    expect(sessionView?.tabLabel).toBe("Session · Main");
    expect(sessionView?.tabBadge).toBe("进行中 1");
    expect(sessionView?.tabBadgeTone).toBe("sky");
    expect(sessionView?.subtitle).toContain("请抓取文章并整理成 markdown");
    expect(sessionView?.summaryStats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "session-status",
          label: "会话状态",
          value: "执行中",
        }),
        expect.objectContaining({
          key: "session-follow-up",
          label: "待补信息",
          value: "待补信息 1",
        }),
      ]),
    );
    expect(sessionView?.badges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "session-status",
          label: "执行中",
        }),
        expect.objectContaining({
          key: "session-pending-actions",
          label: "待补信息 1",
        }),
      ]),
    );
    expect(typeof sessionView?.renderPanel).toBe("function");
  });

  it("应向画布壳透传 workspaceView 头部语义", () => {
    const params = createBaseParams({
      settledWorkbenchArtifacts: [{ id: "artifact-1" }, { id: "artifact-2" }],
      taskFiles: [{ id: "task-1", name: "draft.md" }],
      projectRootPath: "/tmp/demo-project",
      workspacePathMissing: false,
      workspaceHealthError: false,
      queuedTurns: [
        {
          queued_turn_id: "queued-1",
          message_preview: "继续处理",
          message_text: "继续处理",
          created_at: 1_712_650_000,
          image_count: 0,
          position: 1,
        },
      ],
    });

    const sceneProps = getRenderedSceneProps(params);
    const workspaceView = sceneProps.canvasWorkbenchLayoutProps.workspaceView;

    expect(workspaceView?.title).toBe("项目工作区文件");
    expect(workspaceView?.tabLabel).toBe("文件");
    expect(workspaceView?.tabBadge).toBe("demo-project");
    expect(workspaceView?.tabBadgeTone).toBe("sky");
    expect(workspaceView?.badges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "workspace-root",
          label: "demo-project",
        }),
      ]),
    );
    expect(workspaceView?.summaryStats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "workspace-root",
          label: "工作区",
          value: "demo-project",
        }),
        expect.objectContaining({
          key: "workspace-binding",
          label: "目录状态",
          value: "已连接",
        }),
      ]),
    );
    expect(workspaceView?.panelCopy).toEqual(
      expect.objectContaining({
        unavailableText: "当前工作区路径不可用，暂时无法浏览项目文件。",
        emptyText: "当前会话没有绑定可浏览的工作区目录。",
        sectionEyebrow: "项目目录",
      }),
    );
  });

  it("应把创作场景执行摘要卡透传给 WorkspaceConversationScene", () => {
    const sceneAppExecutionSummaryCard = React.createElement(
      "div",
      { "data-testid": "sceneapp-summary-card-probe" },
      "sceneapp summary",
    );
    const params = createBaseParams({
      sceneAppExecutionSummaryCard,
    });

    const sceneProps = getRenderedSceneProps(params);

    expect(sceneProps.sceneAppExecutionSummaryCard).toBe(
      sceneAppExecutionSummaryCard,
    );
  });
});
