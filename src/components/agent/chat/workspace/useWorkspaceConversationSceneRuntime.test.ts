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
  let latestValue: ReturnType<
    typeof useWorkspaceConversationSceneRuntime
  > | null = null;

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

function buildHeavySessionRuntimeFixture(sessionId = "session") {
  const messages = Array.from({ length: 24 }, (_, index) => ({
    id: `${sessionId}-msg-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `${sessionId} 消息 ${index}`,
    timestamp: new Date(2026, 3, 30, 10, index),
  }));
  const turns = Array.from({ length: 6 }, (_, index) => ({
    id: `${sessionId}-turn-${index}`,
    thread_id: `${sessionId}-thread`,
    prompt_text: `${sessionId} 任务 ${index}`,
    status: "completed",
    started_at: `2026-04-30T10:0${index}:00.000Z`,
    created_at: `2026-04-30T10:0${index}:00.000Z`,
    updated_at: `2026-04-30T10:0${index}:01.000Z`,
  }));
  const threadItems = Array.from({ length: 28 }, (_, index) => ({
    id: `${sessionId}-item-${index}`,
    thread_id: `${sessionId}-thread`,
    turn_id: `${sessionId}-turn-${Math.min(5, Math.floor(index / 5))}`,
    sequence: index + 1,
    status: "completed",
    started_at: `2026-04-30T10:00:${String(index).padStart(2, "0")}.000Z`,
    updated_at: `2026-04-30T10:00:${String(index).padStart(2, "0")}.500Z`,
    type: "tool_call",
    tool_name: "Read",
    arguments: { index },
  }));

  return { messages, turns, threadItems };
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
    expect(
      sceneProps.canvasWorkbenchLayoutProps.onLayoutModeChange,
    ).toBeUndefined();
  });

  it("生成场景应继续向页面层透传顶栏上下文变体", () => {
    const params = createBaseParams({
      navbarContextVariant: "task-center",
    });

    const sceneProps = getRenderedSceneProps(params);
    expect(sceneProps.navbarContextVariant).toBe("task-center");
  });

  it("存在 Harness 入口时应透传顶栏按钮文案", () => {
    const params = createBaseParams({
      showHarnessToggle: true,
      harnessToggleLabel: "Harness",
    });

    const sceneProps = getRenderedSceneProps(params);
    expect(sceneProps.harnessToggleLabel).toBe("Harness");
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

  it("恢复旧会话首帧应先透传消息，并延迟运行轨迹投影", () => {
    vi.useFakeTimers();
    const { messages, turns, threadItems } =
      buildHeavySessionRuntimeFixture("restore");
    const params = createBaseParams({
      displayMessages: messages,
      turns,
      currentTurnId: "restore-turn-5",
      effectiveThreadItems: threadItems,
      pendingActions: [
        {
          requestId: "req-1",
          actionType: "elicitation",
          prompt: "补充信息",
          status: "pending",
        },
      ],
      queuedTurns: [
        {
          queued_turn_id: "queued-1",
          message_preview: "继续处理",
          message_text: "继续处理",
          created_at: 1_777_520_000,
          image_count: 0,
          position: 1,
        },
      ],
      isAutoRestoringSession: true,
    });

    const harness = renderHook(params);
    let sceneProps = (harness.getValue().mainAreaNode as any).props;

    expect(sceneProps.messageListProps.messages).toBe(messages);
    expect(sceneProps.messageListProps.turns).toEqual([]);
    expect(sceneProps.messageListProps.threadItems).toEqual([]);
    expect(sceneProps.messageListProps.currentTurnId).toBeNull();
    expect(sceneProps.messageListProps.pendingActions).toEqual([]);
    expect(sceneProps.messageListProps.queuedTurns).toEqual([]);
    expect(
      sceneProps.canvasWorkbenchLayoutProps.sessionView.summaryStats,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "session-runtime-items",
          value: "轨迹 0",
        }),
      ]),
    );

    act(() => {
      vi.advanceTimersByTime(700);
    });

    sceneProps = (harness.getValue().mainAreaNode as any).props;
    expect(sceneProps.messageListProps.turns).toBe(turns);
    expect(sceneProps.messageListProps.threadItems).toBe(threadItems);
    expect(sceneProps.messageListProps.currentTurnId).toBe("restore-turn-5");
    expect(sceneProps.messageListProps.pendingActions).toHaveLength(1);
    expect(sceneProps.messageListProps.queuedTurns).toHaveLength(1);
    vi.useRealTimers();
  });

  it("历史窗口 hydrate 完成后仍应先透传消息，并延迟运行轨迹投影", () => {
    vi.useFakeTimers();
    const { messages, turns, threadItems } =
      buildHeavySessionRuntimeFixture("history-window");
    const params = createBaseParams({
      displayMessages: messages,
      turns,
      currentTurnId: "history-window-turn-5",
      effectiveThreadItems: threadItems,
      isAutoRestoringSession: false,
      sessionHistoryWindow: {
        loadedMessages: 40,
        totalMessages: 320,
        isLoadingFull: false,
        error: null,
      },
    });

    const harness = renderHook(params);
    let sceneProps = (harness.getValue().mainAreaNode as any).props;

    expect(sceneProps.messageListProps.messages).toBe(messages);
    expect(sceneProps.messageListProps.turns).toEqual([]);
    expect(sceneProps.messageListProps.threadItems).toEqual([]);
    expect(sceneProps.messageListProps.currentTurnId).toBeNull();

    act(() => {
      vi.advanceTimersByTime(700);
    });

    sceneProps = (harness.getValue().mainAreaNode as any).props;
    expect(sceneProps.messageListProps.turns).toBe(turns);
    expect(sceneProps.messageListProps.threadItems).toBe(threadItems);
    expect(sceneProps.messageListProps.currentTurnId).toBe(
      "history-window-turn-5",
    );
    vi.useRealTimers();
  });

  it("发送中会话不应延迟运行轨迹投影", () => {
    vi.useFakeTimers();
    const { messages, turns, threadItems } =
      buildHeavySessionRuntimeFixture("sending");
    const params = createBaseParams({
      displayMessages: messages,
      turns,
      currentTurnId: "sending-turn-5",
      effectiveThreadItems: threadItems,
      isAutoRestoringSession: true,
      isSending: true,
    });

    const sceneProps = getRenderedSceneProps(params);
    expect(sceneProps.messageListProps.turns).toBe(turns);
    expect(sceneProps.messageListProps.threadItems).toBe(threadItems);
    expect(sceneProps.messageListProps.currentTurnId).toBe("sending-turn-5");
    vi.useRealTimers();
  });

  it("聚焦 timeline 或存在 A2UI 表单时不应延迟运行轨迹投影", () => {
    const { messages, turns, threadItems } =
      buildHeavySessionRuntimeFixture("interactive");
    const focusedSceneProps = getRenderedSceneProps(
      createBaseParams({
        displayMessages: messages,
        turns,
        currentTurnId: "interactive-turn-5",
        effectiveThreadItems: threadItems,
        isAutoRestoringSession: true,
        focusedTimelineItemId: "interactive-item-1",
      }),
    );
    expect(focusedSceneProps.messageListProps.turns).toBe(turns);
    expect(focusedSceneProps.messageListProps.threadItems).toBe(threadItems);

    const pendingA2UISceneProps = getRenderedSceneProps(
      createBaseParams({
        displayMessages: messages,
        turns,
        currentTurnId: "interactive-turn-5",
        effectiveThreadItems: threadItems,
        isAutoRestoringSession: true,
        pendingA2UIForm: {
          id: "form-1",
          title: "补充信息",
          schema: {},
        },
      }),
    );
    expect(pendingA2UISceneProps.messageListProps.turns).toBe(turns);
    expect(pendingA2UISceneProps.messageListProps.threadItems).toBe(
      threadItems,
    );
  });

  it("切换到另一条同长度旧会话时应重新延迟运行轨迹投影", () => {
    vi.useFakeTimers();
    const buildSession = (sessionId: string) => {
      const messages = Array.from({ length: 24 }, (_, index) => ({
        id: `${sessionId}-msg-${index}`,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `${sessionId} 消息 ${index}`,
        timestamp: new Date(2026, 3, 30, 11, index),
      }));
      const turns = Array.from({ length: 6 }, (_, index) => ({
        id: `${sessionId}-turn-${index}`,
        thread_id: `${sessionId}-thread`,
        prompt_text: `${sessionId} 任务 ${index}`,
        status: "completed",
        started_at: `2026-04-30T11:0${index}:00.000Z`,
        created_at: `2026-04-30T11:0${index}:00.000Z`,
        updated_at: `2026-04-30T11:0${index}:01.000Z`,
      }));
      const threadItems = Array.from({ length: 28 }, (_, index) => ({
        id: `${sessionId}-item-${index}`,
        thread_id: `${sessionId}-thread`,
        turn_id: `${sessionId}-turn-${Math.min(5, Math.floor(index / 5))}`,
        sequence: index + 1,
        status: "completed",
        started_at: `2026-04-30T11:00:${String(index).padStart(2, "0")}.000Z`,
        updated_at: `2026-04-30T11:00:${String(index).padStart(2, "0")}.500Z`,
        type: "tool_call",
        tool_name: "Read",
        arguments: { index },
      }));

      return { messages, turns, threadItems };
    };
    const sessionA = buildSession("session-a");
    const sessionB = buildSession("session-b");
    const buildParams = (
      sessionId: string,
      session: ReturnType<typeof buildSession>,
    ) =>
      createBaseParams({
        sessionId,
        displayMessages: session.messages,
        turns: session.turns,
        currentTurnId: session.turns.at(-1)?.id ?? null,
        effectiveThreadItems: session.threadItems,
        isAutoRestoringSession: true,
      });

    const harness = renderHook(buildParams("session-a", sessionA));
    act(() => {
      vi.advanceTimersByTime(700);
    });

    let sceneProps = (harness.getValue().mainAreaNode as any).props;
    expect(sceneProps.messageListProps.turns).toBe(sessionA.turns);
    expect(sceneProps.messageListProps.threadItems).toBe(sessionA.threadItems);

    harness.render(buildParams("session-b", sessionB));
    sceneProps = (harness.getValue().mainAreaNode as any).props;

    expect(sceneProps.messageListProps.messages).toBe(sessionB.messages);
    expect(sceneProps.messageListProps.turns).toEqual([]);
    expect(sceneProps.messageListProps.threadItems).toEqual([]);
    expect(sceneProps.messageListProps.currentTurnId).toBeNull();

    act(() => {
      vi.advanceTimersByTime(700);
    });

    sceneProps = (harness.getValue().mainAreaNode as any).props;
    expect(sceneProps.messageListProps.turns).toBe(sessionB.turns);
    expect(sceneProps.messageListProps.threadItems).toBe(sessionB.threadItems);
    expect(sceneProps.messageListProps.currentTurnId).toBe("session-b-turn-5");
    vi.useRealTimers();
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

  it("应把做法执行摘要卡透传给 WorkspaceConversationScene", () => {
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
