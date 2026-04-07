import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceConversationSceneRuntime } from "./useWorkspaceConversationSceneRuntime";

const { mockPresentation } = vi.hoisted(() => ({
  mockPresentation: vi.fn((params) => params),
}));

vi.mock("./useWorkspaceConversationScenePresentation", () => ({
  useWorkspaceConversationScenePresentation: mockPresentation,
}));

function createBaseParams(overrides: Record<string, unknown> = {}) {
  const noop = vi.fn();
  const setCanvasWorkbenchLayoutMode = vi.fn();

  return {
    navigationActions: {
      handleDismissEntryBanner: noop,
      handleWorkspaceAlertSelectDirectory: noop,
      handleDismissWorkspaceAlert: noop,
      handleManageProviders: noop,
    },
    inputbarScene: {
      inputbarNode: null,
      teamWorkbenchSurfaceProps: {},
      activeCanvasTaskFile: null,
    },
    canvasScene: {
      canvasWorkbenchDefaultPreview: null,
      handleOpenCanvasWorkbenchPath: noop,
      handleRevealCanvasWorkbenchPath: noop,
      renderCanvasWorkbenchPreview: noop,
    },
    conversationSendRuntime: {
      handleSendFromEmptyState: noop,
    },
    shellChromeRuntime: {
      showChatLayout: true,
      isWorkspaceCompactChrome: false,
      workflowLayoutBottomSpacing: {
        messageViewportBottomPadding: "0px",
      },
      shouldHideGeneralWorkbenchInputForTheme: false,
      shouldRenderInlineA2UI: false,
    },
    generalWorkbenchHarnessDialog: undefined,
    entryBannerVisible: false,
    entryBannerMessage: undefined,
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
    skillsLoading: false,
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
    chatMode: "chat",
    showHarnessToggle: false,
    navbarHarnessPanelVisible: false,
    handleToggleHarnessPanel: noop,
    harnessPendingCount: 0,
    harnessAttentionLevel: "idle",
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
    showTeamWorkspaceBoard: false,
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

describe("useWorkspaceConversationSceneRuntime", () => {
  beforeEach(() => {
    mockPresentation.mockClear();
  });

  it("通用 Claw 双栏场景应继续同步 stacked/split 布局状态", () => {
    const params = createBaseParams();
    const setCanvasWorkbenchLayoutMode = params.setCanvasWorkbenchLayoutMode;

    useWorkspaceConversationSceneRuntime(params);

    const presentationParams = mockPresentation.mock.calls.at(-1)?.[0];
    expect(presentationParams?.canvasWorkbenchLayout?.onLayoutModeChange).toBe(
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

    useWorkspaceConversationSceneRuntime(params);

    const presentationParams = mockPresentation.mock.calls.at(-1)?.[0];
    expect(
      presentationParams?.canvasWorkbenchLayout?.onLayoutModeChange,
    ).toBeUndefined();
  });

  it("任务中心场景应继续向页面层透传顶栏上下文变体", () => {
    const params = createBaseParams({
      navbarContextVariant: "task-center",
    });

    useWorkspaceConversationSceneRuntime(params);

    const presentationParams = mockPresentation.mock.calls.at(-1)?.[0];
    expect(presentationParams?.scene.navbarContextVariant).toBe("task-center");
  });
});
