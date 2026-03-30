import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  resolveBrowserAssistSessionScopeKey,
  resolveBrowserAssistSessionStorageKey,
} from "./utils/browserAssistSession";

const {
  mockUseDeveloperFeatureFlags,
  mockUseAgentChatUnified,
  mockUseArtifactAutoPreviewSync,
  mockUseThemeContextWorkspace,
  mockUseTopicBranchBoard,
  mockUseTeamWorkspaceRuntime,
  mockUseCompatSubagentRuntime,
  mockGetProject,
  mockGetDefaultProject,
  mockGetOrCreateDefaultProject,
  mockGetContent,
  mockGetThemeWorkbenchDocumentState,
  mockEnsureWorkspaceReady,
  mockUpdateContent,
  mockGetProjectMemory,
  mockToast,
  mockArtifactsAtom,
  mockSelectedArtifactAtom,
  mockSelectedArtifactIdAtom,
  mockSetArtifactsAtom,
  mockSetSelectedArtifactIdAtom,
  mockJotaiState,
  mockGenerateContentCreationPrompt,
  mockIsContentCreationTheme,
  mockEmptyState,
  mockInputbar,
  mockMessageList,
  mockExecutionRunGetThemeWorkbenchState,
  mockExecutionRunListThemeWorkbenchHistory,
  mockExecutionRunGet,
  mockContentWorkflowCreate,
  mockContentWorkflowGetByContent,
  mockSkillExecutionGetDetail,
  mockSkillsGetAll,
  mockSkillsGetLocal,
  mockCloseAgentRuntimeSubagent,
  mockGetAgentRuntimeToolInventory,
  mockResumeAgentRuntimeSubagent,
  mockSendAgentRuntimeSubagentInput,
  mockWaitAgentRuntimeSubagents,
  mockCanvasWorkbenchLayoutState,
  mockCanvasWorkbenchLayout,
  mockLaunchBrowserSession,
  mockBrowserExecuteAction,
} = vi.hoisted(() => ({
  mockUseDeveloperFeatureFlags: vi.fn(),
  mockUseAgentChatUnified: vi.fn(),
  mockUseArtifactAutoPreviewSync: vi.fn(),
  mockUseThemeContextWorkspace: vi.fn(),
  mockUseTopicBranchBoard: vi.fn(),
  mockUseTeamWorkspaceRuntime: vi.fn(),
  mockUseCompatSubagentRuntime: vi.fn(),
  mockGetProject: vi.fn(),
  mockGetDefaultProject: vi.fn(),
  mockGetOrCreateDefaultProject: vi.fn(),
  mockGetContent: vi.fn(),
  mockGetThemeWorkbenchDocumentState: vi.fn(),
  mockEnsureWorkspaceReady: vi.fn(),
  mockUpdateContent: vi.fn(),
  mockGetProjectMemory: vi.fn(),
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
  mockArtifactsAtom: { key: "artifacts" },
  mockSelectedArtifactAtom: { key: "selectedArtifact" },
  mockSelectedArtifactIdAtom: { key: "selectedArtifactId" },
  mockJotaiState: {
    artifacts: [] as Array<Record<string, unknown>>,
    selectedArtifact: null as Record<string, unknown> | null,
    selectedArtifactId: null as string | null,
  },
  mockSetArtifactsAtom: vi.fn(),
  mockSetSelectedArtifactIdAtom: vi.fn(),
  mockGenerateContentCreationPrompt: vi.fn(() => "mock-system-prompt"),
  mockIsContentCreationTheme: vi.fn(() => false),
  mockEmptyState: vi.fn((props?: { input?: string }) => (
    <div data-testid="empty-state">{props?.input || ""}</div>
  )),
  mockInputbar: vi.fn(
    (props?: { overlayAccessory?: ReactNode; input?: string }) => (
      <div data-testid="inputbar" data-input={props?.input || ""}>
        {props?.overlayAccessory}
      </div>
    ),
  ),
  mockMessageList: vi.fn((_props?: Record<string, unknown>) => (
    <div data-testid="message-list" />
  )),
  mockExecutionRunGetThemeWorkbenchState: vi.fn(),
  mockExecutionRunListThemeWorkbenchHistory: vi.fn(),
  mockExecutionRunGet: vi.fn(),
  mockContentWorkflowCreate: vi.fn(),
  mockContentWorkflowGetByContent: vi.fn(),
  mockSkillExecutionGetDetail: vi.fn(),
  mockSkillsGetAll: vi.fn(),
  mockSkillsGetLocal: vi.fn(),
  mockCloseAgentRuntimeSubagent: vi.fn(),
  mockGetAgentRuntimeToolInventory: vi.fn(),
  mockResumeAgentRuntimeSubagent: vi.fn(),
  mockSendAgentRuntimeSubagentInput: vi.fn(),
  mockWaitAgentRuntimeSubagents: vi.fn(),
  mockCanvasWorkbenchLayoutState: {
    renderPreview: false,
  },
  mockCanvasWorkbenchLayout: vi.fn((props?: Record<string, unknown>) => {
    const preview =
      mockCanvasWorkbenchLayoutState.renderPreview &&
      typeof props?.renderPreview === "function"
        ? props.renderPreview(
            {
              kind: "default-canvas",
              title: "当前画布草稿",
              content: "# 新文档\n\n在这里开始编写内容...",
            },
            {
              stackedWorkbenchTrigger: (
                <button type="button" data-testid="stacked-workbench-trigger">
                  切换工作台
                </button>
              ),
            },
          )
        : null;

    return (
      <div
        data-testid="canvas-workbench-layout-mock"
        data-workspace-root={
          typeof props?.workspaceRoot === "string" ? props.workspaceRoot : ""
        }
        data-artifact-count={
          Array.isArray(props?.artifacts) ? String(props.artifacts.length) : "0"
        }
        data-default-preview-title={
          props?.defaultPreview &&
          typeof props.defaultPreview === "object" &&
          "title" in props.defaultPreview &&
          typeof props.defaultPreview.title === "string"
            ? props.defaultPreview.title
            : ""
        }
      >
        {preview}
      </div>
    );
  }),
  mockLaunchBrowserSession: vi.fn(),
  mockBrowserExecuteAction: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: mockToast,
}));

vi.mock("./hooks", () => ({
  useAgentChatUnified: mockUseAgentChatUnified,
  useArtifactAutoPreviewSync: mockUseArtifactAutoPreviewSync,
  useThemeContextWorkspace: mockUseThemeContextWorkspace,
  useTopicBranchBoard: mockUseTopicBranchBoard,
  useTeamWorkspaceRuntime: mockUseTeamWorkspaceRuntime,
}));

vi.mock("./hooks/useCompatSubagentRuntime", () => ({
  useCompatSubagentRuntime: mockUseCompatSubagentRuntime,
}));

vi.mock("@/hooks/useDeveloperFeatureFlags", () => ({
  useDeveloperFeatureFlags: mockUseDeveloperFeatureFlags,
}));

vi.mock("./hooks/useSessionFiles", () => ({
  useSessionFiles: () => ({
    saveFile: vi.fn(async () => undefined),
    files: [],
    readFile: vi.fn(async () => null),
    meta: null,
  }),
}));

vi.mock("./hooks/useContentSync", () => ({
  useContentSync: () => ({
    syncContent: vi.fn(),
    syncStatus: "idle",
  }),
}));

vi.mock("@/components/content-creator/hooks/useWorkflow", () => ({
  useWorkflow: () => ({
    steps: [],
    currentStepIndex: 0,
    goToStep: vi.fn(),
    completeStep: vi.fn(),
  }),
}));

vi.mock(
  "@/components/content-creator/core/LayoutTransition/LayoutTransition",
  () => ({
    LayoutTransition: ({
      mode,
      chatContent,
      canvasContent,
    }: {
      mode: string;
      chatContent: ReactNode;
      canvasContent: ReactNode;
    }) => (
      <div data-testid="layout-transition" data-mode={mode}>
        <div data-testid="layout-chat" hidden={mode === "canvas"}>
          {chatContent}
        </div>
        <div data-testid="layout-canvas" hidden={mode !== "canvas"}>
          {canvasContent}
        </div>
      </div>
    ),
  }),
);

vi.mock("./components/ChatNavbar", () => ({
  ChatNavbar: ({
    onToggleHistory,
    onToggleCanvas,
    showCanvasToggle,
    isCanvasOpen,
    onProjectChange,
    showHarnessToggle,
    harnessPanelVisible,
    onToggleHarnessPanel,
    harnessToggleLabel,
    browserAssistLabel,
    browserAssistAttentionLevel,
  }: {
    onToggleHistory?: () => void;
    onToggleCanvas?: () => void;
    showCanvasToggle?: boolean;
    isCanvasOpen?: boolean;
    onProjectChange?: (projectId: string) => void;
    showHarnessToggle?: boolean;
    harnessPanelVisible?: boolean;
    onToggleHarnessPanel?: () => void;
    harnessToggleLabel?: string;
    browserAssistLabel?: string;
    browserAssistAttentionLevel?: string;
  }) => (
    <div
      data-testid="chat-navbar"
      data-show-harness-toggle={showHarnessToggle ? "true" : "false"}
      data-harness-panel-visible={harnessPanelVisible ? "true" : "false"}
      data-harness-toggle-label={harnessToggleLabel || "Harness"}
      data-show-canvas-toggle={showCanvasToggle ? "true" : "false"}
      data-canvas-open={isCanvasOpen ? "true" : "false"}
      data-browser-assist-label={browserAssistLabel || ""}
      data-browser-assist-attention={browserAssistAttentionLevel || "idle"}
    >
      <button
        type="button"
        data-testid="toggle-history"
        onClick={() => {
          onToggleHistory?.();
        }}
      >
        切换侧边栏
      </button>
      {showCanvasToggle ? (
        <button
          type="button"
          data-testid="toggle-canvas"
          onClick={() => {
            onToggleCanvas?.();
          }}
        >
          {isCanvasOpen ? "折叠画布" : "展开画布"}
        </button>
      ) : null}
      <button
        type="button"
        data-testid="set-project"
        onClick={() => {
          onProjectChange?.("project-manual");
        }}
      >
        选择项目
      </button>
      {showHarnessToggle ? (
        <button
          type="button"
          data-testid="toggle-harness"
          onClick={() => {
            onToggleHarnessPanel?.();
          }}
        >
          切换 {harnessToggleLabel || "Harness"}
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock("./components/ChatSidebar", () => ({
  ChatSidebar: ({
    onSwitchTopic,
    onResumeTask,
  }: {
    onSwitchTopic?: (topicId: string) => Promise<void> | void;
    onResumeTask?: (
      topicId: string,
      statusReason?: string,
    ) => Promise<void> | void;
  }) => (
    <div data-testid="chat-sidebar">
      <button
        type="button"
        data-testid="switch-topic"
        onClick={() => {
          void onSwitchTopic?.("topic-a");
        }}
      >
        切换话题
      </button>
      <button
        type="button"
        data-testid="resume-topic"
        onClick={() => {
          void onResumeTask?.("topic-a", "browser_awaiting_user");
        }}
      >
        恢复任务
      </button>
    </div>
  ),
}));

vi.mock("./components/ThemeWorkbenchSidebar", () => ({
  ThemeWorkbenchSidebar: ({
    onSwitchTopic,
    onSetBranchStatus,
    workflowSteps,
    activityLogs,
    historyHasMore,
    historyLoading,
    onLoadMoreHistory,
    headerActionSlot,
    topSlot,
  }: {
    onSwitchTopic?: (topicId: string) => Promise<void> | void;
    onSetBranchStatus?: (
      topicId: string,
      status: "in_progress" | "pending" | "merged" | "candidate",
    ) => void;
    workflowSteps?: Array<{ title: string; status: string }>;
    activityLogs?: Array<{ runId?: string; executionId?: string; id: string }>;
    historyHasMore?: boolean;
    historyLoading?: boolean;
    onLoadMoreHistory?: () => void;
    headerActionSlot?: ReactNode;
    topSlot?: ReactNode;
  }) => (
    <div
      data-testid="theme-workbench-sidebar"
      data-workflow-summary={(workflowSteps || [])
        .map((step) => `${step.title}:${step.status}`)
        .join("|")}
      data-activity-runs={(activityLogs || [])
        .map((log) => log.runId || "-")
        .join("|")}
      data-activity-executions={(activityLogs || [])
        .map((log) => log.executionId || "-")
        .join("|")}
    >
      <div data-testid="theme-workbench-sidebar-header-action">
        {headerActionSlot}
      </div>
      <div data-testid="theme-workbench-sidebar-top-slot">{topSlot}</div>
      <div
        data-testid="theme-workbench-sidebar-history-state"
        data-history-has-more={historyHasMore ? "true" : "false"}
        data-history-loading={historyLoading ? "true" : "false"}
      />
      {onLoadMoreHistory ? (
        <button
          type="button"
          data-testid="theme-load-more-history"
          onClick={() => {
            onLoadMoreHistory();
          }}
        >
          加载更早历史
        </button>
      ) : null}
      <button
        type="button"
        data-testid="theme-switch-topic"
        onClick={() => {
          void onSwitchTopic?.("topic-a");
        }}
      >
        切换主题分支
      </button>
      <button
        type="button"
        data-testid="theme-mark-merged"
        onClick={() => {
          onSetBranchStatus?.("topic-a", "merged");
        }}
      >
        标记合并
      </button>
    </div>
  ),
}));

vi.mock("./components/MessageList", () => ({
  MessageList: (props: Record<string, unknown>) => mockMessageList(props),
}));

vi.mock("./components/TeamWorkspaceDock", () => ({
  TeamWorkspaceDock: ({
    placement,
    withBottomOverlay,
    shellVisible,
    childSubagentSessions,
    teamDispatchPreviewState,
    onActivateWorkbench,
  }: {
    placement?: "floating" | "inline";
    withBottomOverlay?: boolean;
    shellVisible?: boolean;
    childSubagentSessions?: Array<{ id: string }>;
    teamDispatchPreviewState?: {
      status?: string;
      members?: Array<{ id: string }>;
    } | null;
    onActivateWorkbench?: () => void;
  }) => (
    <div
      data-testid="team-workspace-dock"
      data-placement={placement || "floating"}
      data-with-bottom-overlay={withBottomOverlay ? "true" : "false"}
      data-shell-visible={shellVisible ? "true" : "false"}
      data-child-count={String(childSubagentSessions?.length ?? 0)}
      data-runtime-status={teamDispatchPreviewState?.status || ""}
      data-runtime-member-count={String(
        teamDispatchPreviewState?.members?.length ?? 0,
      )}
    >
      {onActivateWorkbench ? (
        <button
          type="button"
          data-testid="team-workspace-dock-activate"
          onClick={() => {
            onActivateWorkbench();
          }}
        >
          打开创作协作
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock("./components/Inputbar", () => ({
  Inputbar: (props: Record<string, unknown>) => mockInputbar(props),
}));

vi.mock("./components/EmptyState", () => ({
  EmptyState: (props?: { input?: string }) => mockEmptyState(props),
}));

vi.mock("./components/CanvasWorkbenchLayout", () => ({
  CanvasWorkbenchLayout: (props: Record<string, unknown>) =>
    mockCanvasWorkbenchLayout(props),
}));

vi.mock("@/components/content-creator/core/StepGuide/StepProgress", () => ({
  StepProgress: () => <div data-testid="step-progress" />,
}));

vi.mock("@/components/content-creator/canvas/CanvasFactory", () => ({
  CanvasFactory: () => <div data-testid="canvas-factory" />,
}));

vi.mock("@/components/general-chat/bridge", () => ({
  CanvasPanel: ({ toolbarActions }: { toolbarActions?: ReactNode }) => (
    <div data-testid="general-canvas">
      <div data-testid="general-canvas-toolbar">{toolbarActions}</div>
    </div>
  ),
  DEFAULT_CANVAS_STATE: {
    isOpen: false,
    contentType: null,
    content: "",
    isEditing: false,
  },
}));

vi.mock("@/components/artifact", () => ({
  ArtifactList: () => <div data-testid="artifact-list" />,
  ArtifactRenderer: () => <div data-testid="artifact-renderer" />,
  ArtifactToolbar: ({ onClose }: { onClose?: () => void }) => (
    <div data-testid="artifact-toolbar">
      <button
        type="button"
        data-testid="artifact-toolbar-close"
        onClick={() => {
          onClose?.();
        }}
      >
        关闭
      </button>
    </div>
  ),
}));

vi.mock("@/lib/artifact/store", () => ({
  artifactsAtom: mockArtifactsAtom,
  selectedArtifactAtom: mockSelectedArtifactAtom,
  selectedArtifactIdAtom: mockSelectedArtifactIdAtom,
}));

vi.mock("jotai", () => ({
  useAtomValue: (atom: unknown) => {
    if (atom === mockSelectedArtifactAtom) {
      return mockJotaiState.selectedArtifact;
    }
    if (atom === mockArtifactsAtom) {
      return mockJotaiState.artifacts;
    }
    if (atom === mockSelectedArtifactIdAtom) {
      return mockJotaiState.selectedArtifactId;
    }
    return [];
  },
  useSetAtom: (atom: unknown) => {
    if (atom === mockArtifactsAtom) {
      return mockSetArtifactsAtom;
    }
    if (atom === mockSelectedArtifactIdAtom) {
      return mockSetSelectedArtifactIdAtom;
    }
    return vi.fn();
  },
}));

vi.mock("@/components/content-creator/utils/systemPrompt", () => ({
  generateContentCreationPrompt: mockGenerateContentCreationPrompt,
  isContentCreationTheme: mockIsContentCreationTheme,
}));

vi.mock("@/components/content-creator/utils/projectPrompt", () => ({
  generateProjectMemoryPrompt: vi.fn(() => ""),
}));

vi.mock("@/components/content-creator/canvas/canvasUtils", () => ({
  createInitialCanvasState: vi.fn(() => null),
}));

vi.mock("@/components/content-creator/canvas/document", () => ({
  createInitialDocumentState: vi.fn((content = "") => ({
    type: "document",
    content,
    platform: "markdown",
    versions: [],
    currentVersionId: "",
    isEditing: true,
  })),
}));

vi.mock("./utils/workflowMapping", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./utils/workflowMapping")>();
  return {
    ...actual,
    getFileToStepMap: vi.fn(() => ({})),
    getSupportedFilenames: vi.fn(() => []),
  };
});

vi.mock("@/lib/workspace/navigation", () => ({
  buildHomeAgentParams: vi.fn(() => ({})),
  buildClawAgentParams: vi.fn((overrides?: Record<string, unknown>) => ({
    ...(overrides || {}),
    agentEntry: "claw",
    theme: typeof overrides?.theme === "string" ? overrides.theme : "general",
    lockTheme: false,
    immersiveHome:
      typeof overrides?.immersiveHome === "boolean"
        ? overrides.immersiveHome
        : false,
  })),
}));

vi.mock("@/lib/api/project", () => ({
  getProject: mockGetProject,
  getDefaultProject: mockGetDefaultProject,
  getOrCreateDefaultProject: mockGetOrCreateDefaultProject,
  getContent: mockGetContent,
  getThemeWorkbenchDocumentState: mockGetThemeWorkbenchDocumentState,
  ensureWorkspaceReady: mockEnsureWorkspaceReady,
  updateContent: mockUpdateContent,
}));

vi.mock("@/lib/api/memory", () => ({
  getProjectMemory: mockGetProjectMemory,
}));

vi.mock("@/lib/api/executionRun", () => ({
  executionRunGet: mockExecutionRunGet,
  executionRunGetThemeWorkbenchState: mockExecutionRunGetThemeWorkbenchState,
  executionRunListThemeWorkbenchHistory:
    mockExecutionRunListThemeWorkbenchHistory,
}));

vi.mock("@/lib/api/content-workflow", () => ({
  contentWorkflowApi: {
    create: mockContentWorkflowCreate,
    getByContent: mockContentWorkflowGetByContent,
  },
}));

vi.mock("@/lib/api/skill-execution", () => ({
  skillExecutionApi: {
    getSkillDetail: mockSkillExecutionGetDetail,
  },
}));

vi.mock("@/lib/api/skills", () => ({
  skillsApi: {
    getAll: mockSkillsGetAll,
    getLocal: mockSkillsGetLocal,
  },
}));

vi.mock("@/lib/webview-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/webview-api")>(
      "@/lib/webview-api",
    );

  return {
    ...actual,
    launchBrowserSession: mockLaunchBrowserSession,
    browserExecuteAction: mockBrowserExecuteAction,
  };
});

vi.mock("@/lib/api/agentRuntime", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/agentRuntime")>(
    "@/lib/api/agentRuntime",
  );

  return {
    ...actual,
    closeAgentRuntimeSubagent: mockCloseAgentRuntimeSubagent,
    getAgentRuntimeToolInventory: mockGetAgentRuntimeToolInventory,
    resumeAgentRuntimeSubagent: mockResumeAgentRuntimeSubagent,
    sendAgentRuntimeSubagentInput: mockSendAgentRuntimeSubagentInput,
    waitAgentRuntimeSubagents: mockWaitAgentRuntimeSubagents,
  };
});

import * as configuredProvidersModule from "@/hooks/useConfiguredProviders";
import * as providerModelsModule from "@/hooks/useProviderModels";
import { AgentChatPage } from "./index";

const preloadAgentChatWorkspaceModule = import("./AgentChatWorkspace");

interface MountedHarness {
  container: HTMLDivElement;
  root: Root;
  rerender: (props?: Partial<ComponentProps<typeof AgentChatPage>>) => void;
}

type MockInputbarSendProps = {
  onToolStatesChange?: (
    next:
      | Record<string, unknown>
      | ((prev: Record<string, unknown>) => Record<string, unknown>),
  ) => void;
  onSend?: (
    images?: unknown[],
    webSearch?: boolean,
    thinking?: boolean,
    textOverride?: string,
    executionStrategy?: "react" | "code_orchestrated" | "auto",
  ) => void | Promise<void> | Promise<boolean | void> | boolean;
  onStop?: () => void | Promise<void>;
};

const mountedRoots: MountedHarness[] = [];
const observedWorkspaceIds: string[] = [];
let sharedSwitchTopicMock: ReturnType<typeof vi.fn>;
let sharedSendMessageMock: ReturnType<typeof vi.fn>;
let sharedTriggerAIGuideMock: ReturnType<typeof vi.fn>;
const FIXED_TOPIC_UPDATED_AT = 1710385200000;

function buildMockProviderModel(
  overrides: Partial<
    Awaited<ReturnType<typeof providerModelsModule.loadProviderModels>>[number]
  > = {},
) {
  return {
    id: "mock-model",
    display_name: "Mock Model",
    provider_id: "kiro",
    provider_name: "Kiro",
    family: "mock-model",
    tier: "pro" as const,
    capabilities: {
      vision: true,
      tools: true,
      streaming: true,
      json_mode: true,
      function_calling: true,
      reasoning: false,
      ...(overrides.capabilities || {}),
    },
    pricing: null,
    limits: {
      context_length: null,
      max_output_tokens: null,
      requests_per_minute: null,
      tokens_per_minute: null,
    },
    status: "active" as const,
    release_date: "2026-03-19",
    is_latest: true,
    description: null,
    source: "local" as const,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

function createProject(id: string, archived = false) {
  return {
    id,
    name: `Project ${id}`,
    workspaceType: "general",
    rootPath: `/tmp/${id}`,
    isDefault: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isFavorite: false,
    isArchived: archived,
    tags: [],
  };
}

function mountPage(
  initialProps: Partial<ComponentProps<typeof AgentChatPage>> = {},
): MountedHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let currentProps = initialProps;

  const render = () => {
    root.render(<AgentChatPage {...currentProps} />);
  };

  act(() => {
    render();
  });

  const harness: MountedHarness = {
    container,
    root,
    rerender: (props = {}) => {
      currentProps = { ...currentProps, ...props };
      act(() => {
        render();
      });
    },
  };

  mountedRoots.push(harness);
  return harness;
}

function renderPage(
  props: Partial<ComponentProps<typeof AgentChatPage>> = {},
): HTMLDivElement {
  return mountPage(props).container;
}

function createMockThemeContextWorkspaceState(
  overrides: Partial<ReturnType<typeof mockUseThemeContextWorkspace>> = {},
) {
  const merged = {
    enabled: false,
    contextSearchQuery: "",
    setContextSearchQuery: vi.fn(),
    contextSearchMode: "web" as const,
    setContextSearchMode: vi.fn(),
    contextSearchLoading: false,
    contextSearchError: null,
    contextSearchBlockedReason: null,
    submitContextSearch: vi.fn(),
    sidebarContextItems: [],
    toggleContextActive: vi.fn(),
    contextBudget: {
      activeCount: 0,
      activeCountLimit: 12,
      estimatedTokens: 0,
      tokenLimit: 32000,
    },
    activityLogs: [],
    activeContextPrompt: "",
    prepareActiveContextPrompt: vi.fn().mockResolvedValue(""),
    ...overrides,
  };

  if (!("prepareActiveContextPrompt" in overrides)) {
    merged.prepareActiveContextPrompt = vi
      .fn()
      .mockResolvedValue(merged.activeContextPrompt || "");
  }

  return merged;
}

async function flushEffects(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 20);
    });
    act(() => {});
  }
}

function getSendMessageCall(callIndex = 0) {
  const call = sharedSendMessageMock.mock.calls[callIndex];
  if (!call) {
    throw new Error(`未找到第 ${callIndex + 1} 次 sendMessage 调用`);
  }

  return {
    raw: call,
    content: call[0],
    images: call[1],
    webSearch: call[2],
    thinking: call[3],
    skipUserMessage: call[4],
    executionStrategy: call[5],
    modelOverride: call[6],
    autoContinue: call[7],
    options: call[8],
  };
}

function clickButton(container: HTMLElement, testId: string) {
  const button = container.querySelector(
    `[data-testid="${testId}"]`,
  ) as HTMLButtonElement | null;
  if (!button) {
    throw new Error(`未找到按钮: ${testId}`);
  }

  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function createMockAgentChatUnifiedState(
  overrides: Record<string, unknown> = {},
) {
  return {
    providerType: "kiro",
    setProviderType: vi.fn(),
    model: "mock-model",
    setModel: vi.fn(),
    executionStrategy: "auto",
    setExecutionStrategy: vi.fn(),
    messages: [],
    isSending: false,
    sendMessage: sharedSendMessageMock,
    stopSending: vi.fn(async () => undefined),
    clearMessages: vi.fn(),
    deleteMessage: vi.fn(),
    editMessage: vi.fn(),
    handlePermissionResponse: vi.fn(),
    triggerAIGuide: sharedTriggerAIGuideMock,
    topics: [
      {
        id: "topic-a",
        title: "话题 A",
        updatedAt: FIXED_TOPIC_UPDATED_AT,
      },
    ],
    sessionId: "session-1",
    switchTopic: sharedSwitchTopicMock,
    deleteTopic: vi.fn(),
    renameTopic: vi.fn(),
    workspacePathMissing: false,
    fixWorkspacePathAndRetry: vi.fn(),
    dismissWorkspacePathError: vi.fn(),
    ...overrides,
  };
}

function installMockAgentChatUnifiedState(state: Record<string, unknown>) {
  mockUseAgentChatUnified.mockImplementation(
    ({ workspaceId }: { workspaceId: string }) => {
      observedWorkspaceIds.push(workspaceId);
      return state;
    },
  );
}

function getHookCallOrderForWorkspace(workspaceId: string): number {
  const index = mockUseAgentChatUnified.mock.calls.findIndex(
    (args: unknown[]) =>
      (args[0] as { workspaceId?: string } | undefined)?.workspaceId ===
      workspaceId,
  );
  if (index < 0) {
    throw new Error(`未找到 workspaceId=${workspaceId} 的 hook 调用`);
  }
  return mockUseAgentChatUnified.mock.invocationCallOrder[index];
}

function mockBrowserAssistCompletedSession() {
  const state = createMockAgentChatUnifiedState({
    messages: [
      {
        id: "msg-browser-user",
        role: "user",
        content: "打开浏览器并访问官网",
        timestamp: new Date("2026-03-14T03:00:00.000Z"),
      },
      {
        id: "msg-browser-assistant",
        role: "assistant",
        content: "",
        timestamp: new Date("2026-03-14T03:00:01.000Z"),
        toolCalls: [
          {
            id: "tool-browser-open",
            name: "mcp__lime-browser__browser_navigate",
            arguments: JSON.stringify({
              url: "https://www.rokid.com",
              profile_key: "general_browser_assist",
            }),
            status: "completed",
            startTime: new Date("2026-03-14T03:00:01.100Z"),
            endTime: new Date("2026-03-14T03:00:02.000Z"),
            result: {
              success: true,
              output: "已连接浏览器会话并完成首屏加载",
              metadata: {
                result: {
                  session_id: "browser-session-1",
                  profile_key: "general_browser_assist",
                  page_info: {
                    title: "Rokid",
                    url: "https://www.rokid.com",
                  },
                },
              },
            },
          },
        ],
      },
    ],
  });

  installMockAgentChatUnifiedState(state);
}

beforeAll(async () => {
  await preloadAgentChatWorkspaceModule;
});

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );

  vi.clearAllMocks();
  const originalConsoleError = console.error.bind(console);
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    const message = String(args[0] ?? "");
    if (
      message.includes("not wrapped in act") ||
      message.includes("A suspended resource finished loading inside a test")
    ) {
      return;
    }
    originalConsoleError(...args);
  });
  localStorage.clear();
  sessionStorage.clear();
  observedWorkspaceIds.length = 0;

  mockGetProject.mockImplementation(async (projectId: string) => {
    if (!projectId) {
      return null;
    }
    return createProject(projectId);
  });
  mockGetDefaultProject.mockResolvedValue(null);
  mockGetOrCreateDefaultProject.mockResolvedValue(null);
  mockGetContent.mockResolvedValue(null);
  mockGetThemeWorkbenchDocumentState.mockResolvedValue(null);
  mockEnsureWorkspaceReady.mockResolvedValue({
    workspaceId: "workspace-test",
    rootPath: "/tmp/workspace-test",
    existed: true,
    created: false,
    repaired: false,
    relocated: false,
    previousRootPath: null,
    warning: null,
  });
  mockUpdateContent.mockResolvedValue(undefined);
  mockGetProjectMemory.mockResolvedValue(null);
  mockExecutionRunGetThemeWorkbenchState.mockResolvedValue({
    run_state: "idle",
    queue_items: [],
    latest_terminal: null,
    recent_terminals: [],
    updated_at: "2026-03-06T00:00:00.000Z",
  });
  mockExecutionRunListThemeWorkbenchHistory.mockResolvedValue({
    items: [],
    has_more: false,
    next_offset: null,
  });
  mockExecutionRunGet.mockResolvedValue(null);
  mockContentWorkflowCreate.mockResolvedValue({
    id: "wf-default",
    content_id: "content-default",
    theme: "social-media",
    mode: "guided",
    steps: [],
    current_step_index: 0,
    created_at: Date.now(),
    updated_at: Date.now(),
  });
  mockContentWorkflowGetByContent.mockResolvedValue(null);
  mockSkillExecutionGetDetail.mockResolvedValue({
    name: "social_post_with_cover",
    display_name: "社媒主稿与封面",
    description: "生成社媒内容",
    execution_mode: "prompt",
    has_workflow: false,
    workflow_steps: [],
  });
  mockSkillsGetAll.mockResolvedValue([]);
  mockSkillsGetLocal.mockResolvedValue([]);
  mockCloseAgentRuntimeSubagent.mockResolvedValue({
    previous_status: {
      session_id: "child-session-1",
      kind: "running",
    },
    cascade_session_ids: [],
    changed_session_ids: ["child-session-1"],
  });
  mockGetAgentRuntimeToolInventory.mockResolvedValue({
    surface: {
      creator: false,
      browser_assist: false,
    },
    catalog: [],
    registry: [],
    extensions: {
      surface_entries: [],
      tool_entries: [],
    },
    mcp_tools: [],
    counts: {
      catalog_total: 0,
      catalog_current_total: 0,
      catalog_compat_total: 0,
      registry_total: 0,
      extension_surface_total: 0,
      extension_tool_total: 0,
      mcp_total: 0,
      visible_total: 0,
    },
  });
  mockResumeAgentRuntimeSubagent.mockResolvedValue({
    status: {
      session_id: "child-session-1",
      kind: "closed",
    },
    cascade_session_ids: [],
    changed_session_ids: [],
  });
  mockSendAgentRuntimeSubagentInput.mockResolvedValue({
    submission_id: "submission-1",
  });
  mockWaitAgentRuntimeSubagents.mockResolvedValue({
    status: {},
    timed_out: false,
  });
  mockLaunchBrowserSession.mockResolvedValue({
    profile: {
      success: true,
      reused: true,
      browser_source: "system",
    },
    session: {
      session_id: "auto-browser-session-1",
      profile_key: "general_browser_assist",
      target_id: "target-auto-1",
      target_title: "账户中心",
      target_url: "https://accounts.example.com",
      remote_debugging_port: 16312,
      ws_debugger_url: "ws://127.0.0.1:16312/devtools/page/target-auto-1",
      devtools_frontend_url: undefined,
      stream_mode: "both",
      transport_kind: "cdp_frames",
      lifecycle_state: "live",
      control_mode: "agent",
      human_reason: undefined,
      last_page_info: {
        title: "账户中心",
        url: "https://accounts.example.com",
        markdown: "",
        updated_at: "2026-03-14T03:10:02.000Z",
      },
      last_event_at: "2026-03-14T03:10:02.000Z",
      last_frame_at: "2026-03-14T03:10:02.200Z",
      last_error: undefined,
      created_at: "2026-03-14T03:10:01.500Z",
      connected: true,
    },
  });
  mockBrowserExecuteAction.mockResolvedValue({
    success: true,
    backend: "cdp_direct",
    session_id: "browser-session-1",
    target_id: "target-auto-1",
    action: "navigate",
    request_id: "browser-action-1",
    data: {
      page_info: {
        title: "新页面",
        url: "https://example.com",
      },
    },
    error: undefined,
    attempts: [],
  });
  vi.spyOn(
    configuredProvidersModule,
    "loadConfiguredProviders",
  ).mockResolvedValue([
    {
      key: "kiro",
      label: "Kiro",
      registryId: "kiro",
      type: "kiro",
    },
  ]);
  vi.spyOn(providerModelsModule, "loadProviderModels").mockResolvedValue([
    buildMockProviderModel(),
  ]);
  mockGenerateContentCreationPrompt.mockReturnValue("mock-system-prompt");
  mockIsContentCreationTheme.mockReturnValue(false);
  mockEmptyState.mockImplementation((props?: { input?: string }) => (
    <div data-testid="empty-state">{props?.input || ""}</div>
  ));
  mockUseThemeContextWorkspace.mockReturnValue(
    createMockThemeContextWorkspaceState(),
  );
  mockUseDeveloperFeatureFlags.mockReturnValue({
    workspaceHarnessEnabled: true,
  });
  mockInputbar.mockClear();
  mockUseTopicBranchBoard.mockReturnValue({
    branchItems: [
      {
        id: "topic-a",
        title: "话题 A",
        status: "in_progress",
        isCurrent: true,
      },
    ],
    setTopicStatus: vi.fn(),
  });
  mockUseTeamWorkspaceRuntime.mockReturnValue({
    liveRuntimeBySessionId: {},
    liveActivityBySessionId: {},
    activityRefreshVersionBySessionId: {},
  });
  mockUseCompatSubagentRuntime.mockReturnValue({
    isRunning: false,
    progress: null,
    events: [],
    result: null,
    error: null,
    recentActivity: [],
    hasSignals: false,
  });
  mockCanvasWorkbenchLayoutState.renderPreview = false;

  mockJotaiState.artifacts = [];
  mockJotaiState.selectedArtifact = null;
  mockJotaiState.selectedArtifactId = null;
  mockSetArtifactsAtom.mockImplementation((next) => {
    mockJotaiState.artifacts =
      typeof next === "function" ? next(mockJotaiState.artifacts) : next;
    const nextId = mockJotaiState.selectedArtifactId;
    mockJotaiState.selectedArtifact =
      nextId == null
        ? null
        : (mockJotaiState.artifacts.find(
            (artifact) =>
              (artifact as { id?: string } | null | undefined)?.id === nextId,
          ) as Record<string, unknown> | null) || null;
  });
  mockSetSelectedArtifactIdAtom.mockImplementation((next) => {
    mockJotaiState.selectedArtifactId =
      typeof next === "function"
        ? next(mockJotaiState.selectedArtifactId)
        : next;
    const nextId = mockJotaiState.selectedArtifactId;
    mockJotaiState.selectedArtifact =
      nextId == null
        ? null
        : (mockJotaiState.artifacts.find(
            (artifact) =>
              (artifact as { id?: string } | null | undefined)?.id === nextId,
          ) as Record<string, unknown> | null) || null;
  });

  sharedSwitchTopicMock = vi.fn(async () => undefined);
  sharedSendMessageMock = vi.fn(async () => undefined);
  sharedTriggerAIGuideMock = vi.fn();
  installMockAgentChatUnifiedState(createMockAgentChatUnifiedState());
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
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AgentChatPage 停止 Team 协作", () => {
  it("点击停止时应一并暂停仍在运行或排队的 Team 子会话", async () => {
    const stopSendingMock = vi.fn(async () => undefined);

    installMockAgentChatUnifiedState(
      createMockAgentChatUnifiedState({
        isSending: true,
        stopSending: stopSendingMock,
        childSubagentSessions: [
          {
            id: "child-session-running",
            name: "运行中成员",
            created_at: 1700000000,
            updated_at: 1700000001,
            session_type: "sub_agent",
            runtime_status: "running",
          },
          {
            id: "child-session-queued",
            name: "排队中成员",
            created_at: 1700000002,
            updated_at: 1700000003,
            session_type: "sub_agent",
            runtime_status: "queued",
          },
          {
            id: "child-session-done",
            name: "已完成成员",
            created_at: 1700000004,
            updated_at: 1700000005,
            session_type: "sub_agent",
            runtime_status: "completed",
          },
        ],
      }),
    );
    mockCloseAgentRuntimeSubagent
      .mockResolvedValueOnce({
        previous_status: {
          session_id: "child-session-running",
          kind: "running",
        },
        cascade_session_ids: [],
        changed_session_ids: ["child-session-running"],
      })
      .mockResolvedValueOnce({
        previous_status: {
          session_id: "child-session-queued",
          kind: "queued",
        },
        cascade_session_ids: [],
        changed_session_ids: ["child-session-queued"],
      });

    renderPage();
    await flushEffects();

    const latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | MockInputbarSendProps
      | undefined;

    await latestInputbarProps?.onStop?.();
    await flushEffects();

    expect(stopSendingMock).toHaveBeenCalledTimes(1);
    expect(mockCloseAgentRuntimeSubagent).toHaveBeenCalledTimes(2);
    expect(mockCloseAgentRuntimeSubagent).toHaveBeenNthCalledWith(1, {
      id: "child-session-running",
    });
    expect(mockCloseAgentRuntimeSubagent).toHaveBeenNthCalledWith(2, {
      id: "child-session-queued",
    });
  });
});

describe("AgentChatPage 话题切换项目恢复", () => {
  it("应先切换到话题绑定项目，再执行话题切换", async () => {
    localStorage.setItem(
      "agent_session_workspace_topic-a",
      JSON.stringify("project-topic"),
    );

    const container = renderPage();
    await flushEffects();

    clickButton(container, "toggle-history");
    await flushEffects();
    clickButton(container, "switch-topic");
    await flushEffects();

    const switchTopicMock = mockUseAgentChatUnified.mock.results[0]?.value
      ?.switchTopic as ReturnType<typeof vi.fn>;
    expect(switchTopicMock).toHaveBeenCalledWith("topic-a");

    const workspaceHookOrder = getHookCallOrderForWorkspace("project-topic");
    const switchTopicOrder = switchTopicMock.mock.invocationCallOrder[0];
    expect(workspaceHookOrder).toBeLessThan(switchTopicOrder);
    expect(observedWorkspaceIds).toContain("project-topic");
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it("外部锁定项目与话题绑定冲突时应阻止切换并提示", async () => {
    localStorage.setItem(
      "agent_session_workspace_topic-a",
      JSON.stringify("topic-project"),
    );

    const container = renderPage({ projectId: "locked-project" });
    await flushEffects();

    clickButton(container, "toggle-history");
    await flushEffects();
    clickButton(container, "switch-topic");
    await flushEffects();

    const switchTopicMock = mockUseAgentChatUnified.mock.results[0]?.value
      ?.switchTopic as ReturnType<typeof vi.fn>;
    expect(switchTopicMock).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith(
      "该任务绑定了其他项目，请先切换到对应项目",
    );
    expect(mockGetOrCreateDefaultProject).not.toHaveBeenCalled();
  });

  it("无可用项目时应自动创建默认项目并继续切换话题", async () => {
    mockGetProject.mockResolvedValue(null);
    mockGetDefaultProject.mockResolvedValue(null);
    mockGetOrCreateDefaultProject.mockResolvedValue(
      createProject("default-new"),
    );

    const container = renderPage();
    await flushEffects();

    clickButton(container, "toggle-history");
    await flushEffects();
    clickButton(container, "switch-topic");
    await flushEffects();

    const switchTopicMock = mockUseAgentChatUnified.mock.results[0]?.value
      ?.switchTopic as ReturnType<typeof vi.fn>;
    expect(mockGetOrCreateDefaultProject).toHaveBeenCalledTimes(1);
    expect(mockToast.info).toHaveBeenCalledWith(
      "未找到可用项目，已自动创建默认项目",
    );
    expect(switchTopicMock).toHaveBeenCalledWith("topic-a");

    const workspaceHookOrder = getHookCallOrderForWorkspace("default-new");
    const switchTopicOrder = switchTopicMock.mock.invocationCallOrder[0];
    expect(workspaceHookOrder).toBeLessThan(switchTopicOrder);
  });

  it("存在 newChatAt 时手动选项目不应被重置", async () => {
    const container = renderPage({ newChatAt: 1234567890 });
    await flushEffects();

    clickButton(container, "set-project");
    await flushEffects();

    expect(observedWorkspaceIds).toContain("project-manual");
    expect(observedWorkspaceIds[observedWorkspaceIds.length - 1]).toBe(
      "project-manual",
    );
  });

  it("收到首页新会话请求时应先丢弃内部项目上下文", async () => {
    const mounted = mountPage();
    await flushEffects();

    clickButton(mounted.container, "set-project");
    await flushEffects();
    expect(observedWorkspaceIds[observedWorkspaceIds.length - 1]).toBe(
      "project-manual",
    );

    mounted.rerender({ newChatAt: 2233445566 });

    expect(observedWorkspaceIds[observedWorkspaceIds.length - 1]).toBe("");

    await flushEffects();
    expect(observedWorkspaceIds[observedWorkspaceIds.length - 1]).toBe("");
  });
});

describe("AgentChatPage 侧栏显示控制", () => {
  it("Claw 模式有消息时默认收起侧栏，且切换项目不应意外展开", async () => {
    mockUseAgentChatUnified.mockImplementation(
      ({ workspaceId }: { workspaceId: string }) => {
        observedWorkspaceIds.push(workspaceId);
        return {
          providerType: "kiro",
          setProviderType: vi.fn(),
          model: "mock-model",
          setModel: vi.fn(),
          executionStrategy: "auto",
          setExecutionStrategy: vi.fn(),
          messages: [{ id: "msg-1", role: "user", content: "你好" }],
          isSending: false,
          sendMessage: sharedSendMessageMock,
          stopSending: vi.fn(async () => undefined),
          clearMessages: vi.fn(),
          deleteMessage: vi.fn(),
          editMessage: vi.fn(),
          handlePermissionResponse: vi.fn(),
          triggerAIGuide: sharedTriggerAIGuideMock,
          topics: [
            {
              id: "topic-a",
              title: "话题 A",
              updatedAt: Date.now(),
            },
          ],
          sessionId: "session-1",
          switchTopic: sharedSwitchTopicMock,
          deleteTopic: vi.fn(),
          renameTopic: vi.fn(),
        };
      },
    );

    const container = renderPage();
    await flushEffects();

    expect(container.querySelector('[data-testid="chat-sidebar"]')).toBeNull();

    clickButton(container, "set-project");
    await flushEffects();
    expect(container.querySelector('[data-testid="chat-sidebar"]')).toBeNull();
  });

  it("锁定 general 主题进入 Claw 页面时也应默认收起左侧对话列表", async () => {
    const container = renderPage({
      theme: "general",
      lockTheme: true,
    });
    await flushEffects();

    expect(container.querySelector('[data-testid="chat-sidebar"]')).toBeNull();

    clickButton(container, "toggle-history");
    await flushEffects();

    expect(
      container.querySelector('[data-testid="chat-sidebar"]'),
    ).not.toBeNull();
  });

  it("Claw 模式可通过顶栏手动展开侧栏", async () => {
    const container = renderPage();
    await flushEffects();

    expect(container.querySelector('[data-testid="chat-sidebar"]')).toBeNull();

    clickButton(container, "toggle-history");
    await flushEffects();
    expect(
      container.querySelector('[data-testid="chat-sidebar"]'),
    ).not.toBeNull();
  });

  it("重新进入新的 Claw 对话页时，不应沿用上一次手动展开的侧栏状态", async () => {
    const mounted = mountPage({
      theme: "general",
      lockTheme: true,
      contentId: "content-a",
    });
    await flushEffects();

    expect(
      mounted.container.querySelector('[data-testid="chat-sidebar"]'),
    ).toBeNull();

    clickButton(mounted.container, "toggle-history");
    await flushEffects();

    expect(
      mounted.container.querySelector('[data-testid="chat-sidebar"]'),
    ).not.toBeNull();

    mounted.rerender({
      contentId: "content-b",
    });
    await flushEffects();

    expect(
      mounted.container.querySelector('[data-testid="chat-sidebar"]'),
    ).toBeNull();
  });

  it("showChatPanel=false 时应保持侧栏隐藏", async () => {
    const container = renderPage({ showChatPanel: false });
    await flushEffects();

    expect(container.querySelector('[data-testid="chat-sidebar"]')).toBeNull();

    clickButton(container, "toggle-history");
    await flushEffects();
    expect(container.querySelector('[data-testid="chat-sidebar"]')).toBeNull();
  });

  it("Claw 模式无激活任务时应展示任务选择空态", async () => {
    mockUseAgentChatUnified.mockImplementation(
      ({ workspaceId }: { workspaceId: string }) => {
        observedWorkspaceIds.push(workspaceId);
        return {
          providerType: "kiro",
          setProviderType: vi.fn(),
          model: "mock-model",
          setModel: vi.fn(),
          executionStrategy: "auto",
          setExecutionStrategy: vi.fn(),
          messages: [],
          isSending: false,
          sendMessage: sharedSendMessageMock,
          stopSending: vi.fn(async () => undefined),
          clearMessages: vi.fn(),
          deleteMessage: vi.fn(),
          editMessage: vi.fn(),
          handlePermissionResponse: vi.fn(),
          triggerAIGuide: sharedTriggerAIGuideMock,
          topics: [
            {
              id: "topic-a",
              title: "任务 A",
              updatedAt: Date.now(),
            },
          ],
          sessionId: null,
          switchTopic: sharedSwitchTopicMock,
          deleteTopic: vi.fn(),
          renameTopic: vi.fn(),
          pendingActions: [],
          workspacePathMissing: false,
          fixWorkspacePathAndRetry: vi.fn(),
          dismissWorkspacePathError: vi.fn(),
        };
      },
    );

    const container = renderPage({ agentEntry: "claw" });
    await flushEffects();

    expect(
      container.querySelector('[data-testid="claw-empty-state"]'),
    ).toBeNull();
    expect(container.querySelector('[data-testid="empty-state"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="message-list"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="inputbar"]')).not.toBeNull();
  });
});

describe("AgentChatPage 通用工作台", () => {
  it("聊天态应通过顶栏按钮展开画布，并支持在展开后再次折叠", async () => {
    const container = renderPage({
      theme: "general",
      lockTheme: true,
    });
    await flushEffects();

    const navbar = container.querySelector(
      '[data-testid="chat-navbar"]',
    ) as HTMLDivElement | null;
    const toggleCanvasButton = container.querySelector(
      '[data-testid="toggle-canvas"]',
    ) as HTMLButtonElement | null;

    expect(navbar?.dataset.showCanvasToggle).toBe("true");
    expect(navbar?.dataset.canvasOpen).toBe("false");
    expect(toggleCanvasButton?.textContent).toContain("展开画布");
    expect(
      container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat");

    act(() => {
      toggleCanvasButton?.click();
    });
    await flushEffects();

    expect(
      (
        container.querySelector(
          '[data-testid="chat-navbar"]',
        ) as HTMLDivElement | null
      )?.dataset.canvasOpen,
    ).toBe("true");
    expect(
      container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat-canvas");

    act(() => {
      (
        container.querySelector(
          '[data-testid="toggle-canvas"]',
        ) as HTMLButtonElement | null
      )?.click();
    });
    await flushEffects();

    expect(
      (
        container.querySelector(
          '[data-testid="chat-navbar"]',
        ) as HTMLDivElement | null
      )?.dataset.canvasOpen,
    ).toBe("false");
    expect(
      container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat");
  });

  it("普通画布应将工作台触发按钮并入头部工具栏，避免覆盖关闭区", async () => {
    mockCanvasWorkbenchLayoutState.renderPreview = true;

    const container = renderPage({
      theme: "general",
      lockTheme: true,
    });
    await flushEffects();

    clickButton(container, "toggle-canvas");
    await flushEffects(4);

    const toolbar = container.querySelector(
      '[data-testid="general-canvas-toolbar"]',
    ) as HTMLDivElement | null;
    const triggers = container.querySelectorAll(
      '[data-testid="stacked-workbench-trigger"]',
    );

    expect(
      container.querySelector('[data-testid="general-canvas"]'),
    ).not.toBeNull();
    expect(toolbar).not.toBeNull();
    expect(triggers).toHaveLength(1);
    expect(
      toolbar?.querySelector('[data-testid="stacked-workbench-trigger"]'),
    ).not.toBeNull();
  });

  it("通用模式应通过顶部按钮打开工作台弹窗，而不是常驻右侧占位", async () => {
    const container = renderPage({
      theme: "general",
      lockTheme: true,
    });
    await flushEffects();

    const navbar = container.querySelector(
      '[data-testid="chat-navbar"]',
    ) as HTMLDivElement | null;
    expect(navbar?.dataset.showHarnessToggle).toBe("true");
    expect(navbar?.dataset.harnessToggleLabel).toBe("工作台");
    expect(document.body.textContent).not.toContain("处理工作台");
    expect(document.body.textContent).not.toContain("通用助手");

    clickButton(container, "toggle-harness");
    await flushEffects();

    expect(document.body.textContent).toContain("处理工作台");
    expect(document.body.textContent).toContain("通用助手");
  });

  it("处理工作台开关关闭时不应显示入口，也不应触发工具库存读取", async () => {
    mockUseDeveloperFeatureFlags.mockReturnValue({
      workspaceHarnessEnabled: false,
    });

    const container = renderPage({
      theme: "general",
      lockTheme: true,
    });
    await flushEffects();

    const navbar = container.querySelector(
      '[data-testid="chat-navbar"]',
    ) as HTMLDivElement | null;
    expect(navbar?.dataset.showHarnessToggle).toBe("false");
    expect(
      container.querySelector('[data-testid="toggle-harness"]'),
    ).toBeNull();
    expect(document.body.textContent).not.toContain("处理工作台");
    expect(mockGetAgentRuntimeToolInventory).not.toHaveBeenCalled();
  });

  it("窄屏工作台在手动展开侧栏后切到 stacked 时应自动收起，恢复 split 也不应自动重开", async () => {
    mockCanvasWorkbenchLayoutState.renderPreview = true;

    const container = renderPage({
      theme: "general",
      lockTheme: true,
    });
    await flushEffects();

    expect(container.querySelector('[data-testid="chat-sidebar"]')).toBeNull();

    clickButton(container, "toggle-history");
    await flushEffects();

    expect(
      container.querySelector('[data-testid="chat-sidebar"]'),
    ).not.toBeNull();

    clickButton(container, "toggle-canvas");
    await flushEffects(4);

    const getWorkbenchProps = () =>
      (mockCanvasWorkbenchLayout.mock.calls.at(-1)?.[0] || null) as {
        onLayoutModeChange?: (mode: "split" | "stacked") => void;
      } | null;

    expect(
      container.querySelector('[data-testid="canvas-workbench-layout-mock"]'),
    ).not.toBeNull();

    act(() => {
      getWorkbenchProps()?.onLayoutModeChange?.("stacked");
    });
    await flushEffects(4);

    expect(container.querySelector('[data-testid="chat-sidebar"]')).toBeNull();

    act(() => {
      getWorkbenchProps()?.onLayoutModeChange?.("split");
    });
    await flushEffects(4);

    expect(container.querySelector('[data-testid="chat-sidebar"]')).toBeNull();
  });

  it("发送时不再先调用本地 Team 规划模型，而是直接发送并透传已选 Team 约束", async () => {
    localStorage.setItem(
      "lime.chat.team_selection.v1.general",
      JSON.stringify({
        id: "code-triage-team",
        source: "builtin",
      }),
    );

    const mounted = mountPage({
      projectId: "project-team-runtime",
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    let latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | MockInputbarSendProps
      | undefined;

    act(() => {
      latestInputbarProps?.onToolStatesChange?.((previous) => ({
        ...previous,
        subagent: true,
      }));
    });
    await flushEffects(8);

    latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | MockInputbarSendProps
      | undefined;

    act(() => {
      void latestInputbarProps?.onSend?.(
        [],
        false,
        false,
        "请帮我拆解并推进这个修复任务",
        "auto",
      );
    });
    await flushEffects(8);

    expect(sharedSendMessageMock).toHaveBeenCalledTimes(1);
    const sendCall = getSendMessageCall();
    expect(sendCall.content).toBe("请帮我拆解并推进这个修复任务");
    expect(sendCall.images).toEqual([]);
    expect(sendCall.webSearch).toBe(false);
    expect(sendCall.thinking).toBe(false);
    expect(sendCall.skipUserMessage).toBe(false);
    expect(sendCall.executionStrategy).toBe("auto");
    expect(sendCall.modelOverride).toBeUndefined();
    expect(sendCall.autoContinue).toBeUndefined();
    const sendOptions = sendCall.options;
    expect(sendOptions?.requestMetadata?.harness).toMatchObject({
      preferred_team_preset_id: "code-triage-team",
      selected_team_id: "code-triage-team",
      selected_team_source: "builtin",
      selected_team_label: "代码排障团队",
      selected_team_roles: expect.arrayContaining([
        expect.objectContaining({
          id: "explorer",
          label: "分析",
          profile_id: "code-explorer",
        }),
        expect.objectContaining({
          id: "executor",
          label: "执行",
          profile_id: "code-executor",
        }),
      ]),
    });
    expect(
      sendOptions?.requestMetadata?.harness?.turn_team_decision,
    ).toBeUndefined();
    expect(
      sendOptions?.requestMetadata?.harness?.turn_team_blueprint,
    ).toBeUndefined();
    expect(sendOptions?.assistantDraft).toBeUndefined();

    expect(
      mounted.container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat");
    const formedRuntimeDock = mounted.container.querySelector(
      '[data-testid="team-workspace-dock"]',
    );
    if (formedRuntimeDock) {
      expect(formedRuntimeDock.getAttribute("data-runtime-status")).not.toBe(
        "forming",
      );
    }
  });

  it("用户手动关闭真实 Team 画布后，同一轮后续成员更新不应再次抢焦点", async () => {
    const runtimeState = {
      childSubagentSessions: [] as Array<{
        id: string;
        name: string;
        created_at: number;
        updated_at: number;
        session_type: "sub_agent";
        runtime_status: "running";
        task_summary: string;
        role_hint: string;
      }>,
    };

    localStorage.setItem(
      "lime.chat.team_selection.v1.general",
      JSON.stringify({
        id: "code-triage-team",
        source: "builtin",
      }),
    );
    mockUseAgentChatUnified.mockImplementation(
      ({ workspaceId }: { workspaceId: string }) => {
        observedWorkspaceIds.push(workspaceId);
        return {
          providerType: "kiro",
          setProviderType: vi.fn(),
          model: "mock-model",
          setModel: vi.fn(),
          executionStrategy: "auto",
          setExecutionStrategy: vi.fn(),
          messages: [],
          currentTurnId: null,
          turns: [],
          threadItems: [],
          todoItems: [],
          childSubagentSessions: runtimeState.childSubagentSessions,
          subagentParentContext: null,
          queuedTurns: [],
          isSending: false,
          sendMessage: sharedSendMessageMock,
          stopSending: vi.fn(async () => undefined),
          resumeThread: vi.fn(async () => false),
          promoteQueuedTurn: vi.fn(async () => false),
          removeQueuedTurn: vi.fn(async () => false),
          clearMessages: vi.fn(),
          deleteMessage: vi.fn(),
          editMessage: vi.fn(),
          handlePermissionResponse: vi.fn(),
          pendingActions: [],
          triggerAIGuide: sharedTriggerAIGuideMock,
          topics: [
            {
              id: "topic-a",
              title: "话题 A",
              updatedAt: Date.now(),
            },
          ],
          sessionId: "session-1",
          switchTopic: sharedSwitchTopicMock,
          deleteTopic: vi.fn(),
          renameTopic: vi.fn(),
          workspacePathMissing: false,
          fixWorkspacePathAndRetry: vi.fn(),
          dismissWorkspacePathError: vi.fn(),
        };
      },
    );

    const mounted = mountPage({
      projectId: "project-team-manual-open",
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    let latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | MockInputbarSendProps
      | undefined;

    act(() => {
      latestInputbarProps?.onToolStatesChange?.((previous) => ({
        ...previous,
        subagent: true,
      }));
    });
    await flushEffects(8);

    latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | MockInputbarSendProps
      | undefined;

    act(() => {
      void latestInputbarProps?.onSend?.(
        [],
        false,
        false,
        "请组织一个协作团队推进这项修复",
        "auto",
      );
    });
    await flushEffects(8);

    expect(
      mounted.container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat");

    expect(
      mounted.container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat");

    runtimeState.childSubagentSessions = [
      {
        id: "child-1",
        name: "执行成员",
        created_at: Date.now(),
        updated_at: Date.now(),
        session_type: "sub_agent",
        runtime_status: "running",
        task_summary: "继续执行修复任务",
        role_hint: "executor",
      },
    ];
    mounted.rerender();
    await flushEffects(8);

    expect(
      mounted.container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat-canvas");

    clickButton(mounted.container, "toggle-canvas");
    await flushEffects(8);

    expect(
      mounted.container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat");

    runtimeState.childSubagentSessions = [
      ...runtimeState.childSubagentSessions,
      {
        id: "child-2",
        name: "分析成员",
        created_at: Date.now(),
        updated_at: Date.now(),
        session_type: "sub_agent",
        runtime_status: "running",
        task_summary: "补充定位根因",
        role_hint: "explorer",
      },
    ];
    mounted.rerender();
    await flushEffects(8);

    expect(
      mounted.container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat");
  });

  it("同一会话首次出现真实 Team 成员时，应自动切到 Team 画布", async () => {
    const runtimeState = {
      childSubagentSessions: [] as Array<{
        id: string;
        name: string;
        created_at: number;
        updated_at: number;
        session_type: "sub_agent";
        runtime_status: "running";
        task_summary: string;
        role_hint: string;
      }>,
    };

    mockUseAgentChatUnified.mockImplementation(
      ({ workspaceId }: { workspaceId: string }) => {
        observedWorkspaceIds.push(workspaceId);
        return {
          providerType: "kiro",
          setProviderType: vi.fn(),
          model: "mock-model",
          setModel: vi.fn(),
          executionStrategy: "auto",
          setExecutionStrategy: vi.fn(),
          messages: [],
          currentTurnId: null,
          turns: [],
          threadItems: [],
          todoItems: [],
          childSubagentSessions: runtimeState.childSubagentSessions,
          subagentParentContext: null,
          queuedTurns: [],
          isSending: false,
          sendMessage: sharedSendMessageMock,
          stopSending: vi.fn(async () => undefined),
          resumeThread: vi.fn(async () => false),
          promoteQueuedTurn: vi.fn(async () => false),
          removeQueuedTurn: vi.fn(async () => false),
          clearMessages: vi.fn(),
          deleteMessage: vi.fn(),
          editMessage: vi.fn(),
          handlePermissionResponse: vi.fn(),
          pendingActions: [],
          triggerAIGuide: sharedTriggerAIGuideMock,
          topics: [
            {
              id: "topic-a",
              title: "话题 A",
              updatedAt: Date.now(),
            },
          ],
          sessionId: "session-1",
          createFreshSession: vi.fn(async () => undefined),
          switchTopic: sharedSwitchTopicMock,
          deleteTopic: vi.fn(),
          renameTopic: vi.fn(),
          updateTopicSnapshot: vi.fn(),
          workspacePathMissing: false,
          fixWorkspacePathAndRetry: vi.fn(),
          dismissWorkspacePathError: vi.fn(),
        };
      },
    );

    const mounted = mountPage({
      projectId: "project-team-real-graph",
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    expect(
      mounted.container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat");

    runtimeState.childSubagentSessions = [
      {
        id: "child-1",
        name: "分析成员",
        created_at: 1_710_000_000,
        updated_at: 1_710_000_100,
        session_type: "sub_agent",
        runtime_status: "running",
        task_summary: "分析问题边界",
        role_hint: "explorer",
      },
    ];

    mounted.rerender();
    await flushEffects(10);

    expect(
      mounted.container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat-canvas");
    expect(
      (
        mockCanvasWorkbenchLayout.mock.calls.at(-1)?.[0] as
          | {
              teamView?: {
                preferFixedPanel?: boolean;
                preferFullscreenPreview?: boolean;
                renderPanel?: () => unknown;
              } | null;
            }
          | undefined
      )?.teamView?.preferFixedPanel,
    ).toBe(true);
    expect(
      (
        mockCanvasWorkbenchLayout.mock.calls.at(-1)?.[0] as
          | {
              teamView?: {
                preferFixedPanel?: boolean;
                preferFullscreenPreview?: boolean;
                renderPanel?: () => unknown;
              } | null;
            }
          | undefined
      )?.teamView?.preferFullscreenPreview,
    ).not.toBe(true);
    expect(
      typeof (
        mockCanvasWorkbenchLayout.mock.calls.at(-1)?.[0] as
          | {
              teamView?: {
                preferFixedPanel?: boolean;
                preferFullscreenPreview?: boolean;
                renderPanel?: () => unknown;
              } | null;
            }
          | undefined
      )?.teamView?.renderPanel,
    ).toBe("function");
  });

  it("仅有 runtime Team 方案时，顶部展开与协作按钮都应能手动打开 Team 画布", async () => {
    localStorage.setItem(
      "lime.chat.team_selection.v1.general",
      JSON.stringify({
        id: "code-triage-team",
        source: "builtin",
      }),
    );

    const mounted = mountPage({
      projectId: "project-team-manual-canvas-open",
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    let latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | MockInputbarSendProps
      | undefined;

    act(() => {
      latestInputbarProps?.onToolStatesChange?.((previous) => ({
        ...previous,
        subagent: true,
      }));
    });
    await flushEffects(8);

    latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | MockInputbarSendProps
      | undefined;

    act(() => {
      void latestInputbarProps?.onSend?.(
        [],
        false,
        false,
        "请组织一个协作团队推进这项修复",
        "auto",
      );
    });
    await flushEffects(8);

    expect(
      mounted.container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat");

    clickButton(mounted.container, "toggle-canvas");
    await flushEffects(8);

    expect(
      mounted.container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat-canvas");
    expect(
      (
        mockCanvasWorkbenchLayout.mock.calls.at(-1)?.[0] as
          | {
              teamView?: {
                title?: string;
                renderPanel?: () => unknown;
              } | null;
            }
          | undefined
      )?.teamView?.title,
    ).toBe("代码排障团队");
    expect(
      typeof (
        mockCanvasWorkbenchLayout.mock.calls.at(-1)?.[0] as
          | {
              teamView?: {
                title?: string;
                renderPanel?: () => unknown;
              } | null;
            }
          | undefined
      )?.teamView?.renderPanel,
    ).toBe("function");

    clickButton(mounted.container, "toggle-canvas");
    await flushEffects(8);

    expect(
      mounted.container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat");

    clickButton(mounted.container, "team-workspace-dock-activate");
    await flushEffects(8);

    expect(
      mounted.container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat-canvas");
    expect(
      (
        mockCanvasWorkbenchLayout.mock.calls.at(-1)?.[0] as
          | {
              teamView?: {
                title?: string;
                renderPanel?: () => unknown;
              } | null;
            }
          | undefined
      )?.teamView?.title,
    ).toBe("代码排障团队");
  });

  it("已安装 skills 但未显式激活时，通用工作台不应展示技能区块", async () => {
    mockSkillsGetAll.mockResolvedValue([
      {
        key: "research",
        name: "Research",
        description: "检索与整理",
        directory: "research",
        installed: true,
        sourceKind: "builtin",
      },
    ]);

    const container = renderPage({
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    expect(mockSkillsGetLocal).toHaveBeenCalledWith("lime");

    clickButton(container, "toggle-harness");
    await flushEffects();

    expect(document.body.textContent).toContain("处理工作台");
    expect(document.body.textContent).not.toContain("已激活技能");
    expect(
      document.body.querySelector('button[aria-label="跳转到已激活技能"]'),
    ).toBeNull();
  });

  it("用户消息显式触发 slash skill 后，通用工作台应展示已激活技能", async () => {
    mockSkillsGetAll.mockResolvedValue([
      {
        key: "research",
        name: "Research",
        description: "检索与整理",
        directory: "research",
        installed: true,
        sourceKind: "builtin",
      },
    ]);
    mockUseAgentChatUnified.mockImplementation(
      ({ workspaceId }: { workspaceId: string }) => {
        observedWorkspaceIds.push(workspaceId);
        return {
          providerType: "kiro",
          setProviderType: vi.fn(),
          model: "mock-model",
          setModel: vi.fn(),
          executionStrategy: "auto",
          setExecutionStrategy: vi.fn(),
          messages: [
            {
              id: "msg-skill-1",
              role: "user",
              content: "/research 帮我整理当前主题",
            },
          ],
          isSending: false,
          sendMessage: sharedSendMessageMock,
          stopSending: vi.fn(async () => undefined),
          clearMessages: vi.fn(),
          deleteMessage: vi.fn(),
          editMessage: vi.fn(),
          handlePermissionResponse: vi.fn(),
          triggerAIGuide: sharedTriggerAIGuideMock,
          topics: [
            {
              id: "topic-a",
              title: "话题 A",
              updatedAt: Date.now(),
            },
          ],
          sessionId: "session-1",
          switchTopic: sharedSwitchTopicMock,
          deleteTopic: vi.fn(),
          renameTopic: vi.fn(),
        };
      },
    );

    const container = renderPage({
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    clickButton(container, "toggle-harness");
    await flushEffects();

    expect(document.body.textContent).toContain("已激活技能");
    expect(document.body.textContent).toContain("research");
  });

  it("浏览器工具返回真实会话后不应再自动打开浏览器协助画布", async () => {
    mockBrowserAssistCompletedSession();

    const container = renderPage({
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    expect(
      container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat");
    expect(mockJotaiState.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "browser-assist:general",
          type: "browser_assist",
          title: "Rokid",
          meta: expect.objectContaining({
            sessionId: "browser-session-1",
            profileKey: "general_browser_assist",
            url: "https://www.rokid.com",
          }),
        }),
      ]),
    );
    expect(
      container.querySelector('[data-testid="canvas-workbench-layout-mock"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="artifact-renderer"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="artifact-toolbar"]'),
    ).toBeNull();
    expect(mockCanvasWorkbenchLayout).not.toHaveBeenCalled();
  });

  it("默认回退时不应把浏览器协助当作首选 artifact", async () => {
    installMockAgentChatUnifiedState(
      createMockAgentChatUnifiedState({
        messages: [
          {
            id: "msg-artifact-doc",
            role: "assistant",
            content: "",
            timestamp: new Date("2026-03-14T03:00:01.000Z"),
            artifacts: [
              {
                id: "artifact-doc-1",
                type: "document",
                title: "需求草稿",
                content: "# 需求草稿",
                status: "complete",
                meta: {
                  filePath: "docs/prd.md",
                },
                position: { start: 0, end: 0 },
                createdAt: 1,
                updatedAt: 2,
              },
            ],
          },
        ],
      }),
    );
    mockJotaiState.artifacts = [
      {
        id: "browser-assist:general",
        type: "browser_assist",
        title: "浏览器协助",
        content: "",
        status: "complete",
        meta: {
          persistOutsideMessages: true,
          browserAssistScopeKey: resolveBrowserAssistSessionScopeKey(
            undefined,
            "session-1",
          ),
        },
        position: { start: 0, end: 0 },
        createdAt: 3,
        updatedAt: 4,
      },
    ];

    renderPage({
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    expect(mockJotaiState.selectedArtifactId).toBe("artifact-doc-1");
    expect(mockSetSelectedArtifactIdAtom).toHaveBeenCalledWith(
      "artifact-doc-1",
    );
    expect(mockSetSelectedArtifactIdAtom).not.toHaveBeenCalledWith(
      "browser-assist:general",
    );
  });

  it("只有浏览器协助 artifact 时默认不应进入浏览器画布", async () => {
    mockJotaiState.artifacts = [
      {
        id: "browser-assist:general",
        type: "browser_assist",
        title: "浏览器协助",
        content: "",
        status: "complete",
        meta: {
          persistOutsideMessages: true,
          browserAssistScopeKey: resolveBrowserAssistSessionScopeKey(
            undefined,
            "session-1",
          ),
        },
        position: { start: 0, end: 0 },
        createdAt: 1,
        updatedAt: 2,
      },
    ];

    const container = renderPage({
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    expect(mockJotaiState.selectedArtifactId).toBeNull();
    expect(mockSetSelectedArtifactIdAtom).not.toHaveBeenCalledWith(
      "browser-assist:general",
    );
    expect(
      container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat");
  });

  it("浏览器工具刚启动且只有 profile_key 时不应自动打开浏览器协助画布", async () => {
    mockUseAgentChatUnified.mockImplementation(
      ({ workspaceId }: { workspaceId: string }) => {
        observedWorkspaceIds.push(workspaceId);
        return {
          providerType: "kiro",
          setProviderType: vi.fn(),
          model: "mock-model",
          setModel: vi.fn(),
          executionStrategy: "auto",
          setExecutionStrategy: vi.fn(),
          messages: [
            {
              id: "msg-browser-user-pending",
              role: "user",
              content: "打开浏览器并开始处理登录",
              timestamp: new Date("2026-03-14T03:10:00.000Z"),
            },
            {
              id: "msg-browser-assistant-pending",
              role: "assistant",
              content: "",
              timestamp: new Date("2026-03-14T03:10:01.000Z"),
              toolCalls: [
                {
                  id: "tool-browser-pending",
                  name: "mcp__lime-browser__browser_navigate",
                  arguments: JSON.stringify({
                    url: "https://accounts.example.com",
                    profile_key: "general_browser_assist",
                  }),
                  status: "running",
                  startTime: new Date("2026-03-14T03:10:01.100Z"),
                },
              ],
            },
          ],
          isSending: true,
          sendMessage: sharedSendMessageMock,
          stopSending: vi.fn(async () => undefined),
          clearMessages: vi.fn(),
          deleteMessage: vi.fn(),
          editMessage: vi.fn(),
          handlePermissionResponse: vi.fn(),
          triggerAIGuide: sharedTriggerAIGuideMock,
          topics: [
            {
              id: "topic-browser-pending",
              title: "话题 B",
              updatedAt: Date.now(),
            },
          ],
          sessionId: "session-browser-pending",
          switchTopic: sharedSwitchTopicMock,
          deleteTopic: vi.fn(),
          renameTopic: vi.fn(),
          workspacePathMissing: false,
          fixWorkspacePathAndRetry: vi.fn(),
          dismissWorkspacePathError: vi.fn(),
        };
      },
    );

    const container = renderPage({
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    expect(
      container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat");
    expect(
      mockJotaiState.artifacts.some(
        (artifact) =>
          artifact.type === "browser_assist" && artifact.status !== "complete",
      ),
    ).toBe(false);
  });

  it("浏览器协助自动拉起失败后不应重复自旋重试", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    mockLaunchBrowserSession.mockRejectedValue(new Error("Chrome 启动失败"));
    mockUseAgentChatUnified.mockImplementation(
      ({ workspaceId }: { workspaceId: string }) => {
        observedWorkspaceIds.push(workspaceId);
        return {
          providerType: "kiro",
          setProviderType: vi.fn(),
          model: "mock-model",
          setModel: vi.fn(),
          executionStrategy: "auto",
          setExecutionStrategy: vi.fn(),
          messages: [
            {
              id: "msg-browser-user-failed",
              role: "user",
              content: "打开浏览器并开始处理登录",
              timestamp: new Date("2026-03-14T03:10:00.000Z"),
            },
            {
              id: "msg-browser-assistant-failed",
              role: "assistant",
              content: "",
              timestamp: new Date("2026-03-14T03:10:01.000Z"),
              toolCalls: [
                {
                  id: "tool-browser-failed",
                  name: "mcp__lime-browser__browser_navigate",
                  arguments: JSON.stringify({
                    url: "https://accounts.example.com",
                    profile_key: "general_browser_assist",
                  }),
                  status: "running",
                  startTime: new Date("2026-03-14T03:10:01.100Z"),
                },
              ],
            },
          ],
          isSending: true,
          sendMessage: sharedSendMessageMock,
          stopSending: vi.fn(async () => undefined),
          clearMessages: vi.fn(),
          deleteMessage: vi.fn(),
          editMessage: vi.fn(),
          handlePermissionResponse: vi.fn(),
          triggerAIGuide: sharedTriggerAIGuideMock,
          topics: [
            {
              id: "topic-browser-failed",
              title: "话题 C",
              updatedAt: Date.now(),
            },
          ],
          sessionId: "session-browser-failed",
          switchTopic: sharedSwitchTopicMock,
          deleteTopic: vi.fn(),
          renameTopic: vi.fn(),
          workspacePathMissing: false,
          fixWorkspacePathAndRetry: vi.fn(),
          dismissWorkspacePathError: vi.fn(),
        };
      },
    );

    renderPage({
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(16);

    const autoLaunchWarnings = consoleWarnSpy.mock.calls.filter((args) =>
      String(args[0] ?? "").includes(
        "[AgentChatPage] 自动拉起浏览器协助实时会话失败",
      ),
    );

    expect(mockLaunchBrowserSession.mock.calls.length).toBeLessThanOrEqual(1);
    expect(autoLaunchWarnings.length).toBeLessThanOrEqual(1);
  });

  it("即使没有最新 tool result，也应从 session scoped Browser Assist 状态恢复实时画布", async () => {
    sessionStorage.setItem(
      resolveBrowserAssistSessionStorageKey(undefined, "session-1"),
      JSON.stringify({
        sessionId: "restored-browser-session-1",
        profileKey: "general_browser_assist",
        url: "https://restored.example.com",
        title: "恢复的浏览器会话",
        source: "runtime_launch",
        updatedAt: 1710387000000,
      }),
    );

    const container = renderPage({
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    expect(
      container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat");
    expect(mockLaunchBrowserSession).not.toHaveBeenCalled();
    expect(mockJotaiState.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "browser-assist:general",
          type: "browser_assist",
          title: "恢复的浏览器会话",
          meta: expect.objectContaining({
            sessionId: "restored-browser-session-1",
            profileKey: "general_browser_assist",
            url: "https://restored.example.com",
          }),
        }),
      ]),
    );
  });

  it("同 scope 会话更新不应再自动重新打开浏览器协助画布", async () => {
    mockBrowserAssistCompletedSession();

    const harness = mountPage({
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    expect(
      harness.container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat");

    mockUseAgentChatUnified.mockImplementation(
      ({ workspaceId }: { workspaceId: string }) => {
        observedWorkspaceIds.push(workspaceId);
        return {
          providerType: "kiro",
          setProviderType: vi.fn(),
          model: "mock-model",
          setModel: vi.fn(),
          executionStrategy: "auto",
          setExecutionStrategy: vi.fn(),
          messages: [
            {
              id: "msg-browser-user-refresh",
              role: "user",
              content: "继续浏览器流程",
              timestamp: new Date("2026-03-14T03:00:00.000Z"),
            },
            {
              id: "msg-browser-assistant-refresh",
              role: "assistant",
              content: "",
              timestamp: new Date("2026-03-14T03:00:01.000Z"),
              toolCalls: [
                {
                  id: "tool-browser-open-refresh",
                  name: "mcp__lime-browser__browser_navigate",
                  arguments: JSON.stringify({
                    url: "https://www.rokid.com/news",
                    profile_key: "general_browser_assist",
                  }),
                  status: "completed",
                  startTime: new Date("2026-03-14T03:00:01.100Z"),
                  endTime: new Date("2026-03-14T03:00:02.000Z"),
                  result: {
                    success: true,
                    output: "已刷新页面",
                    metadata: {
                      result: {
                        session_id: "browser-session-1",
                        profile_key: "general_browser_assist",
                        page_info: {
                          title: "Rokid News",
                          url: "https://www.rokid.com/news",
                        },
                      },
                    },
                  },
                },
              ],
            },
          ],
          isSending: false,
          sendMessage: sharedSendMessageMock,
          stopSending: vi.fn(async () => undefined),
          clearMessages: vi.fn(),
          deleteMessage: vi.fn(),
          editMessage: vi.fn(),
          handlePermissionResponse: vi.fn(),
          triggerAIGuide: sharedTriggerAIGuideMock,
          topics: [
            {
              id: "topic-a",
              title: "话题 A",
              updatedAt: Date.now(),
            },
          ],
          sessionId: "session-1",
          switchTopic: sharedSwitchTopicMock,
          deleteTopic: vi.fn(),
          renameTopic: vi.fn(),
          workspacePathMissing: false,
          fixWorkspacePathAndRetry: vi.fn(),
          dismissWorkspacePathError: vi.fn(),
        };
      },
    );

    harness.rerender({});
    await flushEffects(10);

    expect(
      harness.container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat");
  });

  it("显式新 URL 的浏览器请求应复用现有会话并导航到新页面", async () => {
    mockBrowserAssistCompletedSession();
    mockBrowserExecuteAction.mockResolvedValueOnce({
      success: true,
      backend: "cdp_direct",
      session_id: "browser-session-1",
      target_id: "target-news-1",
      action: "navigate",
      request_id: "browser-action-news",
      data: {
        page_info: {
          title: "百度新闻",
          url: "https://news.baidu.com",
        },
      },
      error: undefined,
      attempts: [],
    });

    renderPage({
      projectId: "project-browser-intent",
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    const prompt =
      "打开 https://news.baidu.com，使用浏览器协助模式执行，并把实时浏览器画面显示在右侧画布中，然后告诉我页面主要内容。";
    const inputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | {
          onSend?: (
            images?: unknown[],
            webSearch?: boolean,
            thinking?: boolean,
            textOverride?: string,
          ) => Promise<void>;
        }
      | undefined;

    act(() => {
      void inputbarProps?.onSend?.([], false, false, prompt);
    });
    await flushEffects(12);

    expect(mockBrowserExecuteAction).toHaveBeenCalledWith({
      profile_key: "general_browser_assist",
      backend: "cdp_direct",
      action: "navigate",
      args: {
        action: "goto",
        url: "https://news.baidu.com",
        wait_for_page_info: true,
      },
      timeout_ms: 20000,
    });
    expect(sharedSendMessageMock).toHaveBeenCalledTimes(1);
    const sendCall = getSendMessageCall();
    expect(sendCall.content).toBe(prompt);
    expect(sendCall.images).toEqual([]);
    expect(sendCall.webSearch).toBe(false);
    expect(sendCall.thinking).toBe(false);
    expect(sendCall.skipUserMessage).toBe(false);
    expect(sendCall.executionStrategy).toBeUndefined();
    expect(sendCall.modelOverride).toBeUndefined();
    expect(sendCall.autoContinue).toBeUndefined();
    expect(sendCall.options).toEqual(
      expect.objectContaining({
        requestMetadata: expect.objectContaining({
          harness: expect.objectContaining({
            theme: "general",
            browser_assist: expect.objectContaining({
              enabled: true,
              profile_key: "general_browser_assist",
            }),
          }),
        }),
      }),
    );
    expect(mockJotaiState.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "browser-assist:general",
          type: "browser_assist",
          title: "百度新闻",
          meta: expect.objectContaining({
            sessionId: "browser-session-1",
            profileKey: "general_browser_assist",
            url: "https://news.baidu.com",
          }),
        }),
      ]),
    );
  });

  it("强浏览器任务应先进入浏览器前置引导，而不是立刻退化为普通发送", async () => {
    const container = renderPage({
      projectId: "project-browser-required",
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    const prompt = "帮我把这篇文章发布到微信公众号后台";
    const inputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | {
          onSend?: (
            images?: unknown[],
            webSearch?: boolean,
            thinking?: boolean,
            textOverride?: string,
            executionStrategy?: "react" | "code_orchestrated" | "auto",
          ) => void | Promise<void>;
        }
      | undefined;

    act(() => {
      void inputbarProps?.onSend?.([], false, false, prompt, "auto");
    });
    await flushEffects(12);

    expect(sharedSendMessageMock).not.toHaveBeenCalled();

    const messageListProps = mockMessageList.mock.calls.at(-1)?.[0] as
      | {
          messages?: Array<Record<string, unknown>>;
        }
      | undefined;
    expect(messageListProps?.messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: prompt,
      }),
      expect.objectContaining({
        role: "assistant",
        content: expect.stringContaining("回到当前任务重新发起"),
      }),
    ]);
    const latestAssistant = messageListProps?.messages?.at(-1) as
      | {
          actionRequests?: Array<Record<string, unknown>>;
        }
      | undefined;

    expect(latestAssistant?.actionRequests?.[0]).toBeUndefined();
    expect(mockToast.info).toHaveBeenCalledWith(
      expect.stringContaining("回到当前任务重新发起"),
    );
    const browserAssistLabel = container
      .querySelector('[data-testid="chat-navbar"]')
      ?.getAttribute("data-browser-assist-label");
    expect(["待浏览器处理", "浏览器已就绪"]).toContain(browserAssistLabel);
    expect(["warning", "idle"]).toContain(
      container
        .querySelector('[data-testid="chat-navbar"]')
        ?.getAttribute("data-browser-assist-attention") || "idle",
    );
  });

  it("自动首条命中浏览器前置引导时也应按已有展示消息处理，避免工作台继续落回空白态", async () => {
    const onHasMessagesChange = vi.fn();
    const prompt = "帮我把这篇文章发布到微信公众号后台";

    renderPage({
      projectId: "project-browser-required-bootstrap",
      contentId: "content-browser-required-bootstrap",
      theme: "general",
      lockTheme: true,
      initialUserPrompt: prompt,
      autoRunInitialPromptOnMount: true,
      initialAutoSendRequestMetadata: {
        harness: {
          browser_assist: {
            enabled: true,
            profile_key: "general_browser_assist",
            preferred_backend: "lime_extension_bridge",
            auto_launch: false,
          },
        },
      },
      onHasMessagesChange,
    });
    await flushEffects(12);

    expect(sharedSendMessageMock).not.toHaveBeenCalled();
    const messageListProps = mockMessageList.mock.calls.at(-1)?.[0] as
      | {
          messages?: Array<Record<string, unknown>>;
        }
      | undefined;
    expect(messageListProps?.messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: prompt,
      }),
      expect.objectContaining({
        role: "assistant",
        content: expect.stringContaining("回到当前任务重新发起"),
      }),
    ]);
    expect(onHasMessagesChange).toHaveBeenLastCalledWith(true);
  });

  it("浏览器前置引导不应再注入继续执行确认消息", async () => {
    renderPage({
      projectId: "project-browser-required-continue",
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    const prompt = "帮我把这篇文章发布到微信公众号后台";
    const inputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | {
          onSend?: (
            images?: unknown[],
            webSearch?: boolean,
            thinking?: boolean,
            textOverride?: string,
            executionStrategy?: "react" | "code_orchestrated" | "auto",
          ) => void | Promise<void>;
        }
      | undefined;

    act(() => {
      void inputbarProps?.onSend?.([], false, false, prompt, "auto");
    });
    await flushEffects(12);

    const messageListProps = mockMessageList.mock.calls.at(-1)?.[0] as
      | {
          messages?: Array<Record<string, unknown>>;
        }
      | undefined;
    const latestAssistant = messageListProps?.messages?.at(-1) as
      | {
          actionRequests?: Array<Record<string, unknown>>;
        }
      | undefined;

    expect(latestAssistant?.actionRequests?.[0]).toBeUndefined();
    expect(sharedSendMessageMock).not.toHaveBeenCalled();
    expect(mockToast.info).toHaveBeenCalledWith(
      expect.stringContaining("回到当前任务重新发起"),
    );
  });

  it("切换到新会话时不应复用旧 scope 的浏览器协助 artifact", async () => {
    mockJotaiState.artifacts = [
      {
        id: "browser-assist:general",
        type: "browser_assist",
        title: "旧浏览器会话",
        content: "",
        status: "complete",
        meta: {
          persistOutsideMessages: true,
          browserAssistScopeKey: resolveBrowserAssistSessionScopeKey(
            undefined,
            "session-old",
          ),
          sessionId: "browser-session-old",
          profileKey: "general_browser_assist",
          url: "https://stale.example.com",
        },
        position: { start: 0, end: 0 },
        createdAt: 1,
        updatedAt: 2,
      },
    ];

    const container = renderPage({
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    expect(
      container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat");
    expect(mockJotaiState.artifacts).toEqual([]);
  });

  it("当前待继续任务可从侧栏直接打开浏览器工作台", async () => {
    const onNavigate = vi.fn();
    mockUseAgentChatUnified.mockImplementation(
      ({ workspaceId }: { workspaceId: string }) => {
        observedWorkspaceIds.push(workspaceId);
        return {
          providerType: "kiro",
          setProviderType: vi.fn(),
          model: "mock-model",
          setModel: vi.fn(),
          executionStrategy: "auto",
          setExecutionStrategy: vi.fn(),
          messages: [
            {
              id: "msg-browser-user",
              role: "user",
              content: "帮我把文章发布到微信公众号后台",
              timestamp: new Date("2026-03-15T09:00:00.000Z"),
            },
            {
              id: "msg-browser-assistant",
              role: "assistant",
              content: "请先完成登录。",
              timestamp: new Date("2026-03-15T09:00:01.000Z"),
              actionRequests: [
                {
                  requestId: "req-browser-sidebar",
                  actionType: "ask_user",
                  uiKind: "browser_preflight",
                  browserRequirement: "required_with_user_step",
                  browserPrepState: "awaiting_user",
                  prompt: "请先在浏览器完成登录",
                },
              ],
            },
          ],
          isSending: false,
          sendMessage: sharedSendMessageMock,
          stopSending: vi.fn(async () => undefined),
          clearMessages: vi.fn(),
          deleteMessage: vi.fn(),
          editMessage: vi.fn(),
          handlePermissionResponse: vi.fn(),
          triggerAIGuide: sharedTriggerAIGuideMock,
          topics: [
            {
              id: "topic-a",
              title: "话题 A",
              updatedAt: Date.now(),
            },
          ],
          sessionId: "topic-a",
          switchTopic: sharedSwitchTopicMock,
          deleteTopic: vi.fn(),
          renameTopic: vi.fn(),
          workspacePathMissing: false,
          fixWorkspacePathAndRetry: vi.fn(),
          dismissWorkspacePathError: vi.fn(),
        };
      },
    );

    const container = renderPage({
      onNavigate,
      projectId: "project-sidebar-resume",
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    clickButton(container, "toggle-history");
    await flushEffects();
    clickButton(container, "resume-topic");
    await flushEffects(12);

    expect(sharedSwitchTopicMock).not.toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledWith("browser-runtime", {
      projectId: "project-sidebar-resume",
      contentId: undefined,
      initialProfileKey: "general_browser_assist",
      initialSessionId: undefined,
      initialTargetId: undefined,
    });
    expect(mockLaunchBrowserSession).not.toHaveBeenCalled();
  });
});

describe("AgentChatPage 自动引导", () => {
  it("社媒空文稿应预填引导词且不自动发送", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);

    renderPage({
      projectId: "project-social",
      contentId: "content-social",
      theme: "social-media",
      lockTheme: true,
    });
    await flushEffects(10);

    expect(sharedTriggerAIGuideMock).not.toHaveBeenCalled();
    expect(sharedSendMessageMock).not.toHaveBeenCalled();
    const latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | { input?: string }
      | undefined;
    expect(latestInputbarProps?.input || "").toContain("社媒内容创作教练");
  });

  it("非社媒空文稿应维持原始自动引导调用", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);

    renderPage({
      projectId: "project-document",
      contentId: "content-document",
      theme: "document",
      lockTheme: true,
    });
    await flushEffects(10);

    expect(sharedTriggerAIGuideMock).toHaveBeenCalledTimes(1);
    expect(sharedTriggerAIGuideMock).toHaveBeenCalledWith();
  });

  it("存在 initialUserPrompt 时应先预填并等待确认", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
      }),
    );
    const onInitialUserPromptConsumed = vi.fn();
    const initialUserPrompt = "请先帮我写一篇社媒文案提纲。";

    const container = renderPage({
      projectId: "project-social-intent",
      contentId: "content-social-intent",
      theme: "social-media",
      lockTheme: true,
      initialUserPrompt,
      onInitialUserPromptConsumed,
    });
    await flushEffects(12);

    expect(sharedSendMessageMock).not.toHaveBeenCalled();
    const latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | { input?: string }
      | undefined;
    expect(latestInputbarProps?.input || "").toBe(initialUserPrompt);
    expect(
      container.querySelector('[data-testid="theme-workbench-entry-prompt"]'),
    ).not.toBeNull();

    clickButton(container, "theme-workbench-entry-continue");
    await flushEffects(12);

    expect(sharedSendMessageMock).toHaveBeenCalledTimes(1);
    const sendCall = getSendMessageCall();
    expect(sendCall.content).toBe(
      `/social_post_with_cover ${initialUserPrompt}`,
    );
    expect(sendCall.images).toEqual([]);
    expect(sendCall.webSearch).toBe(false);
    expect(sendCall.thinking).toBe(false);
    expect(sendCall.skipUserMessage).toBe(false);
    expect(sendCall.executionStrategy).toBeUndefined();
    expect(sendCall.modelOverride).toBeUndefined();
    expect(sendCall.autoContinue).toBeUndefined();
    expect(sendCall.options).toEqual(
      expect.objectContaining({
        requestMetadata: expect.objectContaining({
          harness: expect.objectContaining({
            theme: "social-media",
          }),
        }),
      }),
    );
    expect(onInitialUserPromptConsumed).toHaveBeenCalledTimes(1);
    expect(sharedTriggerAIGuideMock).not.toHaveBeenCalled();
  });

  it("启用自动执行首条意图时应直接发送而不是等待确认", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
      }),
    );

    const initialUserPrompt = "请先帮我写一篇社媒文案提纲。";
    const onInitialUserPromptConsumed = vi.fn();
    const container = renderPage({
      projectId: "project-social-intent-autorun",
      contentId: "content-social-intent-autorun",
      theme: "social-media",
      lockTheme: true,
      initialUserPrompt,
      autoRunInitialPromptOnMount: true,
      onInitialUserPromptConsumed,
    });
    await flushEffects(12);

    expect(sharedSendMessageMock).toHaveBeenCalledTimes(1);
    const sendCall = getSendMessageCall();
    expect(sendCall.content).toBe(
      `/social_post_with_cover ${initialUserPrompt}`,
    );
    expect(sendCall.images).toEqual([]);
    expect(sendCall.webSearch).toBe(false);
    expect(sendCall.thinking).toBe(false);
    expect(sendCall.skipUserMessage).toBe(false);
    expect(sendCall.options).toEqual(
      expect.objectContaining({
        requestMetadata: expect.objectContaining({
          harness: expect.objectContaining({
            theme: "social-media",
            session_mode: "theme_workbench",
          }),
        }),
      }),
    );
    expect(
      container.querySelector('[data-testid="theme-workbench-entry-prompt"]'),
    ).toBeNull();
    expect(onInitialUserPromptConsumed).toHaveBeenCalledTimes(1);
    expect(sharedTriggerAIGuideMock).not.toHaveBeenCalled();
  });

  it("主题上下文启用时应把生效上下文前置到发送内容", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
        activeContextPrompt: "[生效上下文]\n1. [素材] 品牌手册",
      }),
    );

    const initialUserPrompt = "请写一条小红书文案";
    renderPage({
      projectId: "project-social-context",
      contentId: "content-social-context",
      theme: "social-media",
      lockTheme: true,
      initialUserPrompt,
      onInitialUserPromptConsumed: vi.fn(),
    });
    await flushEffects(12);

    expect(sharedSendMessageMock).not.toHaveBeenCalled();
    const contextContainer = mountedRoots.at(-1)?.container as HTMLDivElement;
    clickButton(contextContainer, "theme-workbench-entry-continue");
    await flushEffects(12);

    expect(sharedSendMessageMock).toHaveBeenCalledTimes(1);
    const sendCall = getSendMessageCall();
    expect(sendCall.content).toBe(
      `/social_post_with_cover [生效上下文]\n1. [素材] 品牌手册\n\n${initialUserPrompt}`,
    );
    expect(sendCall.images).toEqual([]);
    expect(sendCall.webSearch).toBe(false);
    expect(sendCall.thinking).toBe(false);
    expect(sendCall.skipUserMessage).toBe(false);
    expect(sendCall.executionStrategy).toBeUndefined();
    expect(sendCall.modelOverride).toBeUndefined();
    expect(sendCall.autoContinue).toBeUndefined();
    expect(sendCall.options).toEqual(
      expect.objectContaining({
        requestMetadata: expect.objectContaining({
          harness: expect.objectContaining({
            theme: "social-media",
            session_mode: "theme_workbench",
          }),
        }),
      }),
    );
  });

  it("存在 initialUserPrompt 时应使用当前选中模型发送", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
      }),
    );
    const selectedModel = "gemini-2.5-pro";
    const onInitialUserPromptConsumed = vi.fn();
    const initialUserPrompt = "请生成面向 CTO 的社媒提纲";

    mockUseAgentChatUnified.mockImplementation(
      ({ workspaceId }: { workspaceId: string }) => {
        observedWorkspaceIds.push(workspaceId);
        return {
          providerType: "gemini",
          setProviderType: vi.fn(),
          model: selectedModel,
          setModel: vi.fn(),
          executionStrategy: "auto",
          setExecutionStrategy: vi.fn(),
          messages: [],
          isSending: false,
          sendMessage: sharedSendMessageMock,
          stopSending: vi.fn(async () => undefined),
          clearMessages: vi.fn(),
          deleteMessage: vi.fn(),
          editMessage: vi.fn(),
          handlePermissionResponse: vi.fn(),
          triggerAIGuide: sharedTriggerAIGuideMock,
          topics: [
            {
              id: "topic-a",
              title: "话题 A",
              updatedAt: Date.now(),
            },
          ],
          sessionId: "session-1",
          switchTopic: sharedSwitchTopicMock,
          deleteTopic: vi.fn(),
          renameTopic: vi.fn(),
        };
      },
    );

    renderPage({
      projectId: "project-social-selected-model",
      contentId: "content-social-selected-model",
      theme: "social-media",
      lockTheme: true,
      initialUserPrompt,
      onInitialUserPromptConsumed,
    });
    await flushEffects(12);

    const selectedModelContainer = mountedRoots.at(-1)
      ?.container as HTMLDivElement;
    expect(sharedSendMessageMock).not.toHaveBeenCalled();
    const latestSelectedModelProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | { model?: string }
      | undefined;
    expect(latestSelectedModelProps?.model).toBe(selectedModel);
    clickButton(selectedModelContainer, "theme-workbench-entry-continue");
    await flushEffects(12);

    expect(sharedSendMessageMock).toHaveBeenCalledTimes(1);
    const sendCall = getSendMessageCall();
    expect(sendCall.content).toBe(
      `/social_post_with_cover ${initialUserPrompt}`,
    );
    expect(sendCall.images).toEqual([]);
    expect(sendCall.webSearch).toBe(false);
    expect(sendCall.thinking).toBe(false);
    expect(sendCall.skipUserMessage).toBe(false);
    expect(sendCall.executionStrategy).toBeUndefined();
    expect(sendCall.modelOverride).toBeUndefined();
    expect(sendCall.autoContinue).toBeUndefined();
    expect(sendCall.options).toEqual(
      expect.objectContaining({
        requestMetadata: expect.objectContaining({
          harness: expect.objectContaining({
            theme: "social-media",
          }),
        }),
      }),
    );
    expect(onInitialUserPromptConsumed).toHaveBeenCalledTimes(1);
  });

  it("检测到未完成工作流时应提示继续或重新开始", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
      }),
    );
    mockContentWorkflowGetByContent.mockResolvedValue({
      id: "wf-resume-1",
      content_id: "content-social-resume",
      theme: "social-media",
      mode: "guided",
      current_step_index: 1,
      created_at: Date.now() - 10_000,
      updated_at: Date.now(),
      steps: [
        {
          id: "clarify",
          type: "clarify",
          title: "明确选题",
          description: "",
          behavior: {
            skippable: true,
            redoable: true,
            auto_advance: false,
          },
          status: "completed",
        },
        {
          id: "write",
          type: "write",
          title: "撰写主稿",
          description: "",
          behavior: {
            skippable: false,
            redoable: true,
            auto_advance: false,
          },
          status: "pending",
        },
      ],
    });

    const container = renderPage({
      projectId: "project-social-resume",
      contentId: "content-social-resume",
      theme: "social-media",
      lockTheme: true,
    });
    await flushEffects(14);

    expect(sharedSendMessageMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("发现上次未完成任务");
    expect(container.textContent).toContain("撰写主稿");

    clickButton(container, "theme-workbench-entry-continue");
    await flushEffects(12);

    expect(sharedSendMessageMock).toHaveBeenCalledTimes(1);
    const sendCall = getSendMessageCall();
    expect(sendCall.content).toBe(
      "/social_post_with_cover 请基于当前文稿与已有上下文，继续推进上次未完成的任务。优先继续“撰写主稿”阶段，不要从头重复已经完成的内容。先简要确认当前进度，再继续执行。",
    );
    expect(sendCall.images).toEqual([]);
    expect(sendCall.webSearch).toBe(false);
    expect(sendCall.thinking).toBe(false);
    expect(sendCall.skipUserMessage).toBe(false);
    expect(sendCall.executionStrategy).toBeUndefined();
    expect(sendCall.modelOverride).toBeUndefined();
    expect(sendCall.autoContinue).toBeUndefined();
    expect(sendCall.options).toEqual(
      expect.objectContaining({
        requestMetadata: expect.objectContaining({
          harness: expect.objectContaining({
            theme: "social-media",
            session_mode: "theme_workbench",
          }),
        }),
      }),
    );
  });

  it("首条意图被父层消费后，发送中仍应保留 bootstrap 预览，避免空白对话框", async () => {
    mockUseAgentChatUnified.mockImplementation(
      ({ workspaceId }: { workspaceId: string }) => {
        observedWorkspaceIds.push(workspaceId);
        return {
          providerType: "kiro",
          setProviderType: vi.fn(),
          model: "mock-model",
          setModel: vi.fn(),
          executionStrategy: "auto",
          setExecutionStrategy: vi.fn(),
          messages: [],
          isSending: true,
          sendMessage: sharedSendMessageMock,
          stopSending: vi.fn(async () => undefined),
          clearMessages: vi.fn(),
          deleteMessage: vi.fn(),
          editMessage: vi.fn(),
          handlePermissionResponse: vi.fn(),
          triggerAIGuide: sharedTriggerAIGuideMock,
          topics: [],
          sessionId: "session-bootstrap",
          switchTopic: sharedSwitchTopicMock,
          deleteTopic: vi.fn(),
          renameTopic: vi.fn(),
        };
      },
    );

    const harness = mountPage({
      projectId: "project-bootstrap-preview",
      contentId: "content-bootstrap-preview",
      theme: "social-media",
      lockTheme: true,
      initialUserPrompt: "请直接开始处理这个任务",
    });

    await flushEffects(10);

    harness.rerender({
      initialUserPrompt: undefined,
    });
    await flushEffects(10);

    const latestMessageListProps = mockMessageList.mock.calls.at(-1)?.[0] as
      | {
          messages?: Array<{
            role?: string;
            content?: string;
          }>;
        }
      | undefined;

    expect(latestMessageListProps?.messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: "请直接开始处理这个任务",
      }),
      expect.objectContaining({
        role: "assistant",
        content: "正在开始处理任务…",
      }),
    ]);
  });

  it("主题工作台启用时应优先展示画布，不再回退到旧聊天预留页", async () => {
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
      }),
    );

    const container = renderPage({
      projectId: "project-social-canvas-first",
      contentId: "content-social-canvas-first",
      theme: "social-media",
      lockTheme: true,
    });
    await flushEffects(10);

    const layout = container.querySelector('[data-testid="layout-transition"]');
    expect(layout?.getAttribute("data-mode")).toBe("canvas");
    expect(
      container.querySelector('[data-testid="canvas-loading-state"]'),
    ).not.toBeNull();
    expect(
      container
        .querySelector('[data-testid="layout-chat"]')
        ?.hasAttribute("hidden"),
    ).toBe(true);
  });

  it("主题工作台打开已有文稿时首帧应直接显示画布，避免旧对话闪现", async () => {
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
      }),
    );
    mockGetContent.mockResolvedValue({
      id: "content-social-canvas-sync",
      body: "# 已有主稿\n\n这里是正文。",
      metadata: {},
    });

    mockUseAgentChatUnified.mockImplementation(
      ({ workspaceId }: { workspaceId: string }) => {
        observedWorkspaceIds.push(workspaceId);
        return {
          providerType: "kiro",
          setProviderType: vi.fn(),
          model: "mock-model",
          setModel: vi.fn(),
          executionStrategy: "auto",
          setExecutionStrategy: vi.fn(),
          messages: [{ id: "msg-restored", role: "user", content: "历史对话" }],
          isSending: false,
          sendMessage: sharedSendMessageMock,
          stopSending: vi.fn(async () => undefined),
          clearMessages: vi.fn(),
          deleteMessage: vi.fn(),
          editMessage: vi.fn(),
          handlePermissionResponse: vi.fn(),
          triggerAIGuide: sharedTriggerAIGuideMock,
          topics: [
            {
              id: "topic-a",
              title: "话题 A",
              updatedAt: Date.now(),
            },
          ],
          sessionId: "session-1",
          switchTopic: sharedSwitchTopicMock,
          deleteTopic: vi.fn(),
          renameTopic: vi.fn(),
        };
      },
    );

    const container = renderPage({
      projectId: "project-social-canvas-sync",
      contentId: "content-social-canvas-sync",
      theme: "social-media",
      lockTheme: true,
    });

    const layout = container.querySelector('[data-testid="layout-transition"]');
    expect(layout?.getAttribute("data-mode")).toBe("canvas");
    expect(
      container
        .querySelector('[data-testid="layout-chat"]')
        ?.hasAttribute("hidden"),
    ).toBe(true);
    expect(
      container.querySelector('[data-testid="canvas-loading-state"]'),
    ).not.toBeNull();
    expect(container.textContent).not.toContain("历史对话");

    await flushEffects(10);

    expect(
      container.querySelector('[data-testid="canvas-workbench-layout-mock"]'),
    ).not.toBeNull();
  });

  it("主题工作台启用时应仅保留专用侧栏，不再渲染右侧旧操作面板", async () => {
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
      }),
    );

    const container = renderPage({
      projectId: "project-social-layout",
      contentId: "content-social-layout",
      theme: "social-media",
      lockTheme: true,
    });
    await flushEffects(10);

    expect(
      container.querySelector('[data-testid="theme-workbench-sidebar"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="theme-workbench-skills"]'),
    ).toBeNull();
    expect(container.querySelector('[data-testid="chat-sidebar"]')).toBeNull();
    expect(container.querySelector('[data-testid="empty-state"]')).toBeNull();
    expect(container.querySelector('[data-testid="inputbar"]')).not.toBeNull();
  });

  it("主题工作台在初始意图稍后注入时应改为预填并等待确认", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
      }),
    );
    const onInitialUserPromptConsumed = vi.fn();

    renderPage({
      projectId: "project-theme-delayed-intent",
      contentId: "content-theme-delayed-intent",
      theme: "social-media",
      lockTheme: true,
      initialUserPrompt: undefined,
      onInitialUserPromptConsumed,
    });
    await flushEffects(8);

    expect(sharedSendMessageMock).not.toHaveBeenCalled();

    const mounted = mountedRoots.at(-1);
    expect(mounted).toBeTruthy();
    if (!mounted) {
      throw new Error("未找到挂载页面");
    }

    act(() => {
      mounted.root.render(
        <AgentChatPage
          projectId="project-theme-delayed-intent"
          contentId="content-theme-delayed-intent"
          theme="social-media"
          lockTheme={true}
          initialUserPrompt="请基于当前上下文直接开始生成首版社媒主稿。"
          onInitialUserPromptConsumed={onInitialUserPromptConsumed}
        />,
      );
    });
    await flushEffects(10);

    expect(sharedSendMessageMock).not.toHaveBeenCalled();
    const latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | { input?: string }
      | undefined;
    expect(latestInputbarProps?.input || "").toBe(
      "请基于当前上下文直接开始生成首版社媒主稿。",
    );

    clickButton(mounted.container, "theme-workbench-entry-continue");
    await flushEffects(10);

    expect(sharedSendMessageMock).toHaveBeenCalledTimes(1);
    const sendCall = getSendMessageCall();
    expect(sendCall.content).toBe(
      "/social_post_with_cover 请基于当前上下文直接开始生成首版社媒主稿。",
    );
    expect(sendCall.images).toEqual([]);
    expect(sendCall.webSearch).toBe(false);
    expect(sendCall.thinking).toBe(false);
    expect(sendCall.skipUserMessage).toBe(false);
    expect(sendCall.executionStrategy).toBeUndefined();
    expect(sendCall.modelOverride).toBeUndefined();
    expect(sendCall.autoContinue).toBeUndefined();
    expect(sendCall.options).toEqual(
      expect.objectContaining({
        requestMetadata: expect.objectContaining({
          harness: expect.objectContaining({
            theme: "social-media",
            session_mode: "theme_workbench",
          }),
        }),
      }),
    );
    expect(onInitialUserPromptConsumed).toHaveBeenCalledTimes(1);
  });

  it("主题工作台空文稿不应再自动注入旧版提问引导词", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
      }),
    );

    renderPage({
      projectId: "project-theme-no-legacy-guide",
      contentId: "content-theme-no-legacy-guide",
      theme: "social-media",
      lockTheme: true,
    });
    await flushEffects(12);

    expect(sharedSendMessageMock).not.toHaveBeenCalled();
    const latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | { input?: string }
      | undefined;
    expect(latestInputbarProps?.input || "").toBe("");
  });

  it("附图发送时应透传图片，由 Inputbar 独立负责多模态模型提醒", async () => {
    renderPage({
      projectId: "project-image-vision-block",
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    const latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | {
          onSend?: (
            images?: unknown[],
            webSearch?: boolean,
            thinking?: boolean,
            textOverride?: string,
            executionStrategy?: "react" | "code_orchestrated" | "auto",
          ) => Promise<boolean | void> | boolean | void;
        }
      | undefined;

    const images = [{ data: "aGVsbG8=", mediaType: "image/png" }];
    act(() => {
      void latestInputbarProps?.onSend?.(
        images,
        false,
        false,
        "请看图",
        "auto",
      );
    });
    await flushEffects(8);

    expect(sharedSendMessageMock).toHaveBeenCalledTimes(1);
    const sendCall = getSendMessageCall();
    expect(sendCall.content).toBe("请看图");
    expect(sendCall.images).toEqual(images);
    expect(sendCall.webSearch).toBe(false);
    expect(sendCall.thinking).toBe(false);
    expect(sendCall.skipUserMessage).toBe(false);
    expect(sendCall.executionStrategy).toBe("auto");
    expect(sendCall.modelOverride).toBeUndefined();
    expect(sendCall.autoContinue).toBeUndefined();
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it("主题工作台空闲时应把 success 终态版本标记为 merged", async () => {
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
      }),
    );
    mockGetContent.mockResolvedValue({
      id: "content-theme-success",
      body: "当前主稿",
      metadata: {},
    });
    mockGetThemeWorkbenchDocumentState.mockResolvedValue({
      content_id: "content-theme-success",
      current_version_id: "run-success",
      version_count: 1,
      versions: [
        {
          id: "run-success",
          created_at: Date.now(),
          description: "版本 1",
          status: "in_progress",
          is_current: true,
        },
      ],
    });
    mockExecutionRunGetThemeWorkbenchState.mockResolvedValue({
      run_state: "idle",
      queue_items: [],
      latest_terminal: {
        run_id: "run-success",
        title: "执行主题工作台技能",
        status: "success",
        source: "skill",
        source_ref: null,
        started_at: "2026-03-06T01:00:00.000Z",
        finished_at: "2026-03-06T01:00:10.000Z",
      },
      updated_at: "2026-03-06T01:00:10.000Z",
    });

    renderPage({
      projectId: "project-theme-success",
      contentId: "content-theme-success",
      theme: "social-media",
      lockTheme: true,
    });
    await flushEffects(16);

    const latestCall = mockUseTopicBranchBoard.mock.calls.at(-1)?.[0] as
      | { externalStatusMap?: Record<string, string> }
      | undefined;
    expect(latestCall?.externalStatusMap).toMatchObject({
      "run-success": "merged",
    });
  });

  it("主题工作台空闲时应把 error 终态版本标记为 candidate", async () => {
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
      }),
    );
    mockGetContent.mockResolvedValue({
      id: "content-theme-error",
      body: "当前主稿",
      metadata: {},
    });
    mockGetThemeWorkbenchDocumentState.mockResolvedValue({
      content_id: "content-theme-error",
      current_version_id: "run-error",
      version_count: 1,
      versions: [
        {
          id: "run-error",
          created_at: Date.now(),
          description: "版本 1",
          status: "in_progress",
          is_current: true,
        },
      ],
    });
    mockExecutionRunGetThemeWorkbenchState.mockResolvedValue({
      run_state: "idle",
      queue_items: [],
      latest_terminal: {
        run_id: "run-error",
        title: "执行主题工作台技能",
        status: "error",
        source: "skill",
        source_ref: null,
        started_at: "2026-03-06T02:00:00.000Z",
        finished_at: "2026-03-06T02:00:10.000Z",
      },
      updated_at: "2026-03-06T02:00:10.000Z",
    });

    renderPage({
      projectId: "project-theme-error",
      contentId: "content-theme-error",
      theme: "social-media",
      lockTheme: true,
    });
    await flushEffects(16);

    const latestCall = mockUseTopicBranchBoard.mock.calls.at(-1)?.[0] as
      | { externalStatusMap?: Record<string, string> }
      | undefined;
    expect(latestCall?.externalStatusMap).toMatchObject({
      "run-error": "candidate",
    });
  });

  it("主题工作台写入辅助产物时不应覆盖主稿正文", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
      }),
    );
    mockGetContent.mockResolvedValue({
      id: "content-theme-artifact-guard",
      body: "旧内容",
      metadata: {},
    });
    mockExecutionRunGetThemeWorkbenchState.mockResolvedValue({
      run_state: "auto_running",
      current_gate_key: "write_mode",
      queue_items: [
        {
          run_id: "run-write-main",
          title: "写作阶段",
          gate_key: "write_mode",
          status: "running",
          source: "skill",
          source_ref: null,
          started_at: "2026-03-06T03:30:00.000Z",
        },
      ],
      latest_terminal: null,
      updated_at: "2026-03-06T03:30:10.000Z",
    });

    renderPage({
      projectId: "project-theme-artifact-guard",
      contentId: "content-theme-artifact-guard",
      theme: "social-media",
      lockTheme: true,
    });
    await flushEffects(12);

    const latestMessageListProps = mockMessageList.mock.calls.at(-1)?.[0] as
      | {
          onWriteFile?: (content: string, fileName: string) => void;
        }
      | undefined;

    expect(typeof latestMessageListProps?.onWriteFile).toBe("function");

    act(() => {
      latestMessageListProps?.onWriteFile?.(
        "# 主稿标题\n\n这是主稿正文。",
        "social-posts/demo-post.md",
      );
      latestMessageListProps?.onWriteFile?.(
        '{"pipeline":["topic_select","write_mode","publish_confirm"]}',
        "social-posts/demo-post.publish-pack.json",
      );
    });
    await flushEffects(16);

    const bodyUpdateCalls = mockUpdateContent.mock.calls.filter((call) => {
      const payload = call[1] as Record<string, unknown> | undefined;
      return Boolean(payload && "body" in payload);
    });

    expect(bodyUpdateCalls).toHaveLength(1);
    expect(bodyUpdateCalls[0]?.[1]).toMatchObject({
      body: "# 主稿标题\n\n这是主稿正文。",
    });

    const latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | {
          taskFiles?: Array<{
            id: string;
            name: string;
            type: string;
            content?: string;
          }>;
          onTaskFileClick?: (file: {
            id: string;
            name: string;
            type: string;
            content?: string;
          }) => void;
        }
      | undefined;

    expect(latestInputbarProps?.taskFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "social-posts/demo-post.md",
          type: "document",
        }),
      ]),
    );
    expect(
      latestInputbarProps?.taskFiles?.some((file) =>
        file.name.endsWith(".publish-pack.json"),
      ),
    ).toBe(false);
  });

  it("主题工作台写入损坏的 markdown 产物时不应覆盖主稿正文", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
      }),
    );
    mockGetContent.mockResolvedValue({
      id: "content-theme-corrupted-markdown",
      body: "旧内容",
      metadata: {},
    });
    mockExecutionRunGetThemeWorkbenchState.mockResolvedValue({
      run_state: "auto_running",
      current_gate_key: "write_mode",
      queue_items: [
        {
          run_id: "run-write-markdown",
          title: "写作阶段",
          gate_key: "write_mode",
          status: "running",
          source: "skill",
          source_ref: null,
          started_at: "2026-03-06T03:35:00.000Z",
        },
      ],
      latest_terminal: null,
      updated_at: "2026-03-06T03:35:10.000Z",
    });

    renderPage({
      projectId: "project-theme-corrupted-markdown",
      contentId: "content-theme-corrupted-markdown",
      theme: "social-media",
      lockTheme: true,
    });
    await flushEffects(12);

    const latestMessageListProps = mockMessageList.mock.calls.at(-1)?.[0] as
      | {
          onWriteFile?: (content: string, fileName: string) => void;
        }
      | undefined;

    act(() => {
      latestMessageListProps?.onWriteFile?.(
        JSON.stringify({
          article_path: "social-posts/demo-post.md",
          pipeline: ["topic_select", "write_mode", "publish_confirm"],
        }),
        "social-posts/demo-post.md",
      );
    });
    await flushEffects(16);

    const bodyUpdateCalls = mockUpdateContent.mock.calls.filter((call) => {
      const payload = call[1] as Record<string, unknown> | undefined;
      return Boolean(payload && "body" in payload);
    });

    expect(bodyUpdateCalls).toHaveLength(0);

    const latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | {
          taskFiles?: Array<{
            id: string;
            name: string;
            type: string;
          }>;
        }
      | undefined;

    expect(
      latestInputbarProps?.taskFiles?.some(
        (file) => file.name === "social-posts/demo-post.md",
      ),
    ).toBe(false);
  });

  it("主题工作台在队列状态未就绪时写入主稿仍应创建可见版本", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
      }),
    );
    mockGetContent.mockResolvedValue({
      id: "content-theme-fallback-version",
      body: "旧内容",
      metadata: {},
    });
    mockGetThemeWorkbenchDocumentState.mockResolvedValue(null);
    mockExecutionRunGetThemeWorkbenchState.mockResolvedValue({
      run_state: "idle",
      queue_items: [],
      latest_terminal: null,
      updated_at: "2026-03-06T03:31:10.000Z",
    });

    renderPage({
      projectId: "project-theme-fallback-version",
      contentId: "content-theme-fallback-version",
      theme: "social-media",
      lockTheme: true,
    });
    await flushEffects(12);

    const latestMessageListProps = mockMessageList.mock.calls.at(-1)?.[0] as
      | {
          onWriteFile?: (content: string, fileName: string) => void;
        }
      | undefined;

    expect(typeof latestMessageListProps?.onWriteFile).toBe("function");

    act(() => {
      latestMessageListProps?.onWriteFile?.(
        "# 新主稿标题\n\n这是在队列未就绪时写入的主稿。",
        "social-posts/local-fallback.md",
      );
    });
    await flushEffects(16);

    const latestTopicBranchCall = mockUseTopicBranchBoard.mock.calls.at(
      -1,
    )?.[0] as
      | { topics?: Array<{ id: string }>; currentTopicId?: string | null }
      | undefined;
    expect(latestTopicBranchCall?.currentTopicId).toBe(
      "artifact:social-posts/local-fallback.md",
    );
    expect(latestTopicBranchCall?.topics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "artifact:social-posts/local-fallback.md",
        }),
      ]),
    );

    const bodyUpdateCalls = mockUpdateContent.mock.calls.filter((call) => {
      const payload = call[1] as Record<string, unknown> | undefined;
      return Boolean(payload && "body" in payload);
    });
    expect(bodyUpdateCalls.length).toBeGreaterThan(0);
    expect(bodyUpdateCalls.at(-1)?.[1]).toMatchObject({
      body: "# 新主稿标题\n\n这是在队列未就绪时写入的主稿。",
    });
  });

  it("社媒主稿写入时应为任务文件与版本链附加 harness 语义", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
      }),
    );
    mockGetContent.mockResolvedValue({
      id: "content-theme-harness-metadata",
      body: "旧内容",
      metadata: {},
    });
    mockExecutionRunGetThemeWorkbenchState.mockResolvedValue({
      run_state: "auto_running",
      current_gate_key: "write_mode",
      queue_items: [
        {
          run_id: "run-write-main",
          title: "写作阶段",
          gate_key: "write_mode",
          status: "running",
          source: "skill",
          source_ref: null,
          started_at: "2026-03-06T03:30:00.000Z",
        },
      ],
      latest_terminal: null,
      updated_at: "2026-03-06T03:30:10.000Z",
    });

    renderPage({
      projectId: "project-theme-harness-metadata",
      contentId: "content-theme-harness-metadata",
      theme: "social-media",
      lockTheme: true,
    });
    await flushEffects(12);

    const latestMessageListProps = mockMessageList.mock.calls.at(-1)?.[0] as
      | {
          onWriteFile?: (content: string, fileName: string) => void;
        }
      | undefined;

    act(() => {
      latestMessageListProps?.onWriteFile?.(
        "# 主稿标题\n\n这是用于验证 harness 语义的主稿。",
        "social-posts/demo-post.md",
      );
    });
    await flushEffects(16);

    const latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | {
          taskFiles?: Array<{
            id: string;
            name: string;
            type: string;
            metadata?: Record<string, unknown>;
          }>;
        }
      | undefined;
    const writtenFile = latestInputbarProps?.taskFiles?.find(
      (file) => file.name === "social-posts/demo-post.md",
    );

    expect(writtenFile?.metadata).toMatchObject({
      artifactType: "draft",
      stage: "drafting",
      versionLabel: "社媒初稿",
      runId: "run-write-main",
    });

    const latestTopicBranchCall = mockUseTopicBranchBoard.mock.calls.at(
      -1,
    )?.[0] as
      | {
          topics?: Array<{ id: string; title: string }>;
          currentTopicId?: string | null;
        }
      | undefined;

    expect(latestTopicBranchCall?.currentTopicId).toBe("run-write-main");
    expect(latestTopicBranchCall?.topics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "run-write-main",
          title: "社媒初稿",
        }),
      ]),
    );
  });

  it("主题工作台运行中应展示真实技能与工具步骤，而不是默认占位流程", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
      }),
    );
    mockUseAgentChatUnified.mockImplementation(
      ({ workspaceId }: { workspaceId: string }) => {
        observedWorkspaceIds.push(workspaceId);
        return {
          providerType: "kiro",
          setProviderType: vi.fn(),
          model: "mock-model",
          setModel: vi.fn(),
          executionStrategy: "auto",
          setExecutionStrategy: vi.fn(),
          messages: [
            {
              id: "user-1",
              role: "user",
              content: "/social_post_with_cover 请生成一篇 AI 眼镜的社媒稿",
              timestamp: new Date("2026-03-06T10:00:00.000Z"),
            },
            {
              id: "assistant-1",
              role: "assistant",
              content: "",
              timestamp: new Date("2026-03-06T10:00:01.000Z"),
              isThinking: true,
              toolCalls: [
                {
                  id: "tool-write-1",
                  name: "write_file",
                  arguments: JSON.stringify({ path: "social-posts/final.md" }),
                  status: "completed",
                  startTime: new Date("2026-03-06T10:00:01.500Z"),
                  endTime: new Date("2026-03-06T10:00:02.000Z"),
                },
                {
                  id: "tool-cover-1",
                  name: "social_generate_cover_image",
                  arguments: JSON.stringify({ size: "1024x1024" }),
                  status: "running",
                  startTime: new Date("2026-03-06T10:00:02.000Z"),
                },
              ],
            },
          ],
          isSending: true,
          sendMessage: sharedSendMessageMock,
          stopSending: vi.fn(async () => undefined),
          clearMessages: vi.fn(),
          deleteMessage: vi.fn(),
          editMessage: vi.fn(),
          handlePermissionResponse: vi.fn(),
          triggerAIGuide: sharedTriggerAIGuideMock,
          topics: [],
          sessionId: "session-1",
          switchTopic: sharedSwitchTopicMock,
          deleteTopic: vi.fn(),
          renameTopic: vi.fn(),
          workspacePathMissing: false,
          fixWorkspacePathAndRetry: vi.fn(),
          dismissWorkspacePathError: vi.fn(),
        };
      },
    );

    renderPage({
      projectId: "project-theme-real-steps",
      contentId: "content-theme-real-steps",
      theme: "social-media",
      lockTheme: true,
    });
    await flushEffects(12);

    const latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | {
          workflowSteps?: Array<{ title: string; status: string }>;
        }
      | undefined;
    const workflowSteps = latestInputbarProps?.workflowSteps || [];

    expect(workflowSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "生成社媒主稿", status: "completed" }),
        expect.objectContaining({
          title: "写入 social-posts/final.md",
          status: "completed",
        }),
        expect.objectContaining({
          title: "生成封面图（1024x1024）",
          status: "active",
        }),
      ]),
    );
    expect(workflowSteps.some((step) => step.title === "平台适配")).toBe(false);
  });

  it("主题工作台封面工具失败时不应将主稿步骤误判为异常", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
      }),
    );
    mockUseAgentChatUnified.mockImplementation(
      ({ workspaceId }: { workspaceId: string }) => {
        observedWorkspaceIds.push(workspaceId);
        return {
          providerType: "kiro",
          setProviderType: vi.fn(),
          model: "mock-model",
          setModel: vi.fn(),
          executionStrategy: "auto",
          setExecutionStrategy: vi.fn(),
          messages: [
            {
              id: "user-err-1",
              role: "user",
              content: "/social_post_with_cover 请生成一篇 AI 眼镜的社媒稿",
              timestamp: new Date("2026-03-06T10:10:00.000Z"),
            },
            {
              id: "assistant-err-1",
              role: "assistant",
              content: "",
              timestamp: new Date("2026-03-06T10:10:01.000Z"),
              isThinking: true,
              toolCalls: [
                {
                  id: "tool-write-ok",
                  name: "write_file",
                  arguments: JSON.stringify({ path: "social-posts/final.md" }),
                  status: "completed",
                  startTime: new Date("2026-03-06T10:10:01.500Z"),
                  endTime: new Date("2026-03-06T10:10:02.000Z"),
                },
                {
                  id: "tool-cover-failed",
                  name: "social_generate_cover_image",
                  arguments: JSON.stringify({ size: "1024x1024" }),
                  status: "failed",
                  startTime: new Date("2026-03-06T10:10:02.000Z"),
                  endTime: new Date("2026-03-06T10:10:03.000Z"),
                },
              ],
            },
          ],
          isSending: true,
          sendMessage: sharedSendMessageMock,
          stopSending: vi.fn(async () => undefined),
          clearMessages: vi.fn(),
          deleteMessage: vi.fn(),
          editMessage: vi.fn(),
          handlePermissionResponse: vi.fn(),
          triggerAIGuide: sharedTriggerAIGuideMock,
          topics: [],
          sessionId: "session-1",
          switchTopic: sharedSwitchTopicMock,
          deleteTopic: vi.fn(),
          renameTopic: vi.fn(),
          workspacePathMissing: false,
          fixWorkspacePathAndRetry: vi.fn(),
          dismissWorkspacePathError: vi.fn(),
        };
      },
    );

    renderPage({
      projectId: "project-theme-step-status",
      contentId: "content-theme-step-status",
      theme: "social-media",
      lockTheme: true,
    });
    await flushEffects(12);

    const latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | {
          workflowSteps?: Array<{ title: string; status: string }>;
        }
      | undefined;
    const workflowSteps = latestInputbarProps?.workflowSteps || [];

    expect(workflowSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "生成社媒主稿", status: "completed" }),
        expect.objectContaining({
          title: "生成封面图（1024x1024）",
          status: "error",
        }),
      ]),
    );
  });

  it("主题工作台应将搜索与浏览工具映射为业务化标题", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
      }),
    );
    mockUseAgentChatUnified.mockImplementation(
      ({ workspaceId }: { workspaceId: string }) => {
        observedWorkspaceIds.push(workspaceId);
        return {
          providerType: "kiro",
          setProviderType: vi.fn(),
          model: "mock-model",
          setModel: vi.fn(),
          executionStrategy: "auto",
          setExecutionStrategy: vi.fn(),
          messages: [
            {
              id: "user-2",
              role: "user",
              content: "/social_post_with_cover 请整理 Rokid Glasses 的亮点",
              timestamp: new Date("2026-03-06T11:00:00.000Z"),
            },
            {
              id: "assistant-2",
              role: "assistant",
              content: "",
              timestamp: new Date("2026-03-06T11:00:01.000Z"),
              isThinking: true,
              toolCalls: [
                {
                  id: "tool-search-1",
                  name: "WebSearch",
                  arguments: JSON.stringify({
                    query: "Rokid Glasses 最新功能",
                  }),
                  status: "completed",
                  startTime: new Date("2026-03-06T11:00:01.500Z"),
                  endTime: new Date("2026-03-06T11:00:02.000Z"),
                },
                {
                  id: "tool-browser-1",
                  name: "browser_navigate",
                  arguments: JSON.stringify({
                    url: "https://www.rokid.com/glasses",
                  }),
                  status: "running",
                  startTime: new Date("2026-03-06T11:00:02.500Z"),
                },
              ],
            },
          ],
          isSending: true,
          sendMessage: sharedSendMessageMock,
          stopSending: vi.fn(async () => undefined),
          clearMessages: vi.fn(),
          deleteMessage: vi.fn(),
          editMessage: vi.fn(),
          handlePermissionResponse: vi.fn(),
          triggerAIGuide: sharedTriggerAIGuideMock,
          topics: [],
          sessionId: "session-1",
          switchTopic: sharedSwitchTopicMock,
          deleteTopic: vi.fn(),
          renameTopic: vi.fn(),
          workspacePathMissing: false,
          fixWorkspacePathAndRetry: vi.fn(),
          dismissWorkspacePathError: vi.fn(),
        };
      },
    );

    renderPage({
      projectId: "project-theme-search-browser",
      contentId: "content-theme-search-browser",
      theme: "social-media",
      lockTheme: true,
    });
    await flushEffects(12);

    const latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | {
          workflowSteps?: Array<{ title: string; status: string }>;
        }
      | undefined;
    const workflowSteps = latestInputbarProps?.workflowSteps || [];

    expect(workflowSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "检索 Rokid Glasses 最新功能",
          status: "completed",
        }),
        expect.objectContaining({
          title: "打开 https://www.rokid.com/glasses",
          status: "active",
        }),
      ]),
    );
  });

  it("主题工作台应将点击、截图与命令工具映射为业务化标题", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
      }),
    );
    mockUseAgentChatUnified.mockImplementation(
      ({ workspaceId }: { workspaceId: string }) => {
        observedWorkspaceIds.push(workspaceId);
        return {
          providerType: "kiro",
          setProviderType: vi.fn(),
          model: "mock-model",
          setModel: vi.fn(),
          executionStrategy: "auto",
          setExecutionStrategy: vi.fn(),
          messages: [
            {
              id: "user-3",
              role: "user",
              content: "/social_post_with_cover 请继续完善并导出发布版",
              timestamp: new Date("2026-03-06T12:00:00.000Z"),
            },
            {
              id: "assistant-3",
              role: "assistant",
              content: "",
              timestamp: new Date("2026-03-06T12:00:01.000Z"),
              isThinking: true,
              toolCalls: [
                {
                  id: "tool-click-1",
                  name: "browser_click",
                  arguments: JSON.stringify({ element: "发布按钮" }),
                  status: "completed",
                  startTime: new Date("2026-03-06T12:00:01.500Z"),
                  endTime: new Date("2026-03-06T12:00:02.000Z"),
                },
                {
                  id: "tool-snapshot-1",
                  name: "browser_snapshot",
                  arguments: JSON.stringify({ element: "结果区域" }),
                  status: "completed",
                  startTime: new Date("2026-03-06T12:00:02.500Z"),
                  endTime: new Date("2026-03-06T12:00:03.000Z"),
                },
                {
                  id: "tool-bash-1",
                  name: "bash",
                  arguments: JSON.stringify({
                    command: "ffmpeg -i input.mp4 output.mp4",
                  }),
                  status: "running",
                  startTime: new Date("2026-03-06T12:00:03.500Z"),
                },
              ],
            },
          ],
          isSending: true,
          sendMessage: sharedSendMessageMock,
          stopSending: vi.fn(async () => undefined),
          clearMessages: vi.fn(),
          deleteMessage: vi.fn(),
          editMessage: vi.fn(),
          handlePermissionResponse: vi.fn(),
          triggerAIGuide: sharedTriggerAIGuideMock,
          topics: [],
          sessionId: "session-1",
          switchTopic: sharedSwitchTopicMock,
          deleteTopic: vi.fn(),
          renameTopic: vi.fn(),
          workspacePathMissing: false,
          fixWorkspacePathAndRetry: vi.fn(),
          dismissWorkspacePathError: vi.fn(),
        };
      },
    );

    renderPage({
      projectId: "project-theme-browser-bash",
      contentId: "content-theme-browser-bash",
      theme: "social-media",
      lockTheme: true,
    });
    await flushEffects(12);

    const latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | {
          workflowSteps?: Array<{ title: string; status: string }>;
        }
      | undefined;
    const workflowSteps = latestInputbarProps?.workflowSteps || [];

    expect(workflowSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "点击「发布按钮」",
          status: "completed",
        }),
        expect.objectContaining({
          title: "分析页面区域：结果区域",
          status: "completed",
        }),
        expect.objectContaining({ title: "处理音视频素材", status: "active" }),
      ]),
    );
  });

  it("主题工作台运行中应优先使用后端 current_gate_key", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
      }),
    );
    mockExecutionRunGetThemeWorkbenchState.mockResolvedValue({
      run_state: "auto_running",
      current_gate_key: "publish_confirm",
      queue_items: [
        {
          run_id: "run-publish",
          title: "选题调研中（用于验证 current_gate_key 优先级）",
          gate_key: "topic_select",
          status: "running",
          source: "skill",
          source_ref: null,
          started_at: "2026-03-06T03:00:00.000Z",
        },
      ],
      latest_terminal: null,
      updated_at: "2026-03-06T03:00:10.000Z",
    });

    renderPage({
      projectId: "project-theme-gate-priority",
      contentId: "content-theme-gate-priority",
      theme: "social-media",
      lockTheme: true,
    });
    await flushEffects(12);

    const latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | {
          themeWorkbenchGate?: { key?: string };
          workflowSteps?: Array<{ title: string; status: string }>;
        }
      | undefined;
    expect(latestInputbarProps?.themeWorkbenchGate?.key).toBe(
      "publish_confirm",
    );
    const workflowSteps = latestInputbarProps?.workflowSteps || [];
    expect(workflowSteps.length).toBeGreaterThan(0);
    expect(workflowSteps.at(-1)?.status).toBe("active");
    if (workflowSteps.length > 1) {
      expect(workflowSteps[0]?.status).toBe("completed");
    }
  });

  it("主题工作台应基于 execution_id 将工具日志映射到真实 runId", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
        activityLogs: [
          {
            id: "exec-map-1-social-write-exec-map-1-1a2b3c4d",
            messageId: "exec-map-1",
            name: "write_file",
            status: "completed",
            timeLabel: "10:30",
            applyTarget: "主稿内容",
            contextIds: ["material:1"],
          },
        ],
      }),
    );
    mockExecutionRunGetThemeWorkbenchState.mockResolvedValue({
      run_state: "auto_running",
      current_gate_key: "write_mode",
      queue_items: [
        {
          run_id: "run-map-1",
          execution_id: "exec-map-1",
          title: "写作阶段",
          gate_key: "write_mode",
          status: "running",
          source: "skill",
          source_ref: null,
          started_at: "2026-03-06T04:00:00.000Z",
        },
      ],
      latest_terminal: null,
      updated_at: "2026-03-06T04:00:02.000Z",
    });

    const container = renderPage({
      projectId: "project-theme-run-map",
      contentId: "content-theme-run-map",
      theme: "social-media",
      lockTheme: true,
    });
    await flushEffects(12);

    const sidebar = container.querySelector(
      '[data-testid="theme-workbench-sidebar"]',
    ) as HTMLElement | null;
    expect(sidebar).toBeTruthy();
    expect(sidebar?.getAttribute("data-activity-runs")).toContain("run-map-1");
    expect(sidebar?.getAttribute("data-activity-executions")).toContain(
      "exec-map-1",
    );
  });

  it("主题工作台日志应保留最近终态历史，而不是只显示最新一轮", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
        activityLogs: [],
      }),
    );
    mockExecutionRunGetThemeWorkbenchState.mockResolvedValue({
      run_state: "idle",
      current_gate_key: "idle",
      queue_items: [],
      latest_terminal: {
        run_id: "run-latest",
        execution_id: "exec-latest",
        title: "最新一轮写作",
        gate_key: "write_mode",
        status: "success",
        source: "skill",
        source_ref: null,
        started_at: "2026-03-06T05:00:00.000Z",
        finished_at: "2026-03-06T05:06:00.000Z",
      },
      recent_terminals: [
        {
          run_id: "run-latest",
          execution_id: "exec-latest",
          title: "最新一轮写作",
          gate_key: "write_mode",
          status: "success",
          source: "skill",
          source_ref: null,
          started_at: "2026-03-06T05:00:00.000Z",
          finished_at: "2026-03-06T05:06:00.000Z",
        },
        {
          run_id: "run-previous",
          execution_id: "exec-previous",
          title: "上一轮选题",
          gate_key: "topic_select",
          status: "error",
          source: "skill",
          source_ref: null,
          started_at: "2026-03-06T04:00:00.000Z",
          finished_at: "2026-03-06T04:03:00.000Z",
        },
      ],
      updated_at: "2026-03-06T05:06:00.000Z",
    });

    const container = renderPage({
      projectId: "project-theme-run-history",
      contentId: "content-theme-run-history",
      theme: "social-media",
      lockTheme: true,
    });
    await flushEffects(12);

    const sidebar = container.querySelector(
      '[data-testid="theme-workbench-sidebar"]',
    ) as HTMLElement | null;
    expect(sidebar).toBeTruthy();

    const activityRuns = sidebar?.getAttribute("data-activity-runs") || "";
    expect(activityRuns).toContain("run-latest");
    expect(activityRuns).toContain("run-previous");
  });

  it("主题工作台日志应支持继续加载更早的会话历史", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
        activityLogs: [],
      }),
    );
    mockExecutionRunGetThemeWorkbenchState.mockResolvedValue({
      run_state: "idle",
      current_gate_key: "idle",
      queue_items: [],
      latest_terminal: {
        run_id: "run-current",
        execution_id: "exec-current",
        title: "当前运行",
        gate_key: "write_mode",
        status: "success",
        source: "skill",
        source_ref: null,
        started_at: "2026-03-06T06:00:00.000Z",
        finished_at: "2026-03-06T06:05:00.000Z",
      },
      recent_terminals: [
        {
          run_id: "run-current",
          execution_id: "exec-current",
          title: "当前运行",
          gate_key: "write_mode",
          status: "success",
          source: "skill",
          source_ref: null,
          started_at: "2026-03-06T06:00:00.000Z",
          finished_at: "2026-03-06T06:05:00.000Z",
        },
      ],
      updated_at: "2026-03-06T06:05:00.000Z",
    });
    mockExecutionRunListThemeWorkbenchHistory
      .mockResolvedValueOnce({
        items: [
          {
            run_id: "run-older-1",
            execution_id: "exec-older-1",
            title: "更早一轮",
            gate_key: "topic_select",
            status: "error",
            source: "skill",
            source_ref: null,
            started_at: "2026-03-06T05:00:00.000Z",
            finished_at: "2026-03-06T05:04:00.000Z",
          },
        ],
        has_more: true,
        next_offset: 1,
      })
      .mockResolvedValueOnce({
        items: [
          {
            run_id: "run-older-2",
            execution_id: "exec-older-2",
            title: "更早二轮",
            gate_key: "publish_confirm",
            status: "success",
            source: "skill",
            source_ref: null,
            started_at: "2026-03-06T04:00:00.000Z",
            finished_at: "2026-03-06T04:05:00.000Z",
          },
        ],
        has_more: false,
        next_offset: null,
      });

    const container = renderPage({
      projectId: "project-theme-load-history",
      contentId: "content-theme-load-history",
      theme: "social-media",
      lockTheme: true,
    });
    await flushEffects(12);

    const sidebar = container.querySelector(
      '[data-testid="theme-workbench-sidebar"]',
    ) as HTMLElement | null;
    expect(sidebar).toBeTruthy();

    const firstRuns = sidebar?.getAttribute("data-activity-runs") || "";
    expect(firstRuns).toContain("run-current");
    expect(firstRuns).toContain("run-older-1");

    clickButton(container, "theme-load-more-history");
    await flushEffects(12);

    const secondRuns = sidebar?.getAttribute("data-activity-runs") || "";
    expect(secondRuns).toContain("run-older-2");
    expect(mockExecutionRunListThemeWorkbenchHistory).toHaveBeenNthCalledWith(
      1,
      "session-1",
      20,
      0,
    );
    expect(mockExecutionRunListThemeWorkbenchHistory).toHaveBeenNthCalledWith(
      2,
      "session-1",
      20,
      1,
    );
  });

  it("主题工作台不应把聊天命令 source_ref 当成 Skill 详情去加载", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
      }),
    );
    mockExecutionRunGetThemeWorkbenchState.mockResolvedValue({
      run_state: "auto_running",
      current_gate_key: "write_mode",
      queue_items: [
        {
          run_id: "run-chat-command",
          title: "执行主题工作台编排",
          gate_key: "write_mode",
          status: "running",
          source: "chat",
          source_ref: "agent_runtime_submit_turn",
          started_at: "2026-03-06T04:00:00.000Z",
        },
      ],
      latest_terminal: null,
      updated_at: "2026-03-06T04:00:02.000Z",
    });

    renderPage({
      projectId: "project-theme-chat-command",
      contentId: "content-theme-chat-command",
      theme: "social-media",
      lockTheme: true,
    });
    await flushEffects(12);

    expect(mockSkillExecutionGetDetail).not.toHaveBeenCalledWith(
      "agent_runtime_submit_turn",
    );
  });

  it("社媒主题工作台空闲时也应常显 harness 图标入口", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
      }),
    );

    const container = renderPage({
      projectId: "project-social-harness-idle",
      contentId: "content-social-harness-idle",
      theme: "social-media",
      lockTheme: true,
    });
    await flushEffects(12);

    const navbar = container.querySelector(
      '[data-testid="chat-navbar"]',
    ) as HTMLElement | null;
    const harnessCard = container.querySelector(
      '[data-testid="social-harness-card"]',
    ) as HTMLElement | null;
    const sidebar = container.querySelector(
      '[data-testid="theme-workbench-sidebar"]',
    ) as HTMLElement | null;

    expect(navbar?.getAttribute("data-show-harness-toggle")).toBe("true");
    expect(navbar?.getAttribute("data-harness-panel-visible")).toBe("false");
    expect(harnessCard).not.toBeNull();
    expect(harnessCard?.getAttribute("data-run-state")).toBe("idle");
    expect(harnessCard?.getAttribute("data-layout")).toBe("icon");
    expect(sidebar?.contains(harnessCard as Node)).toBe(true);
    expect(harnessCard?.textContent).toContain("社媒 Harness");
    expect(harnessCard?.textContent).toContain("编排待启动");
    expect(
      document.body.querySelector('[data-testid="harness-status-panel"]'),
    ).toBeNull();
  });

  it("社媒主题工作台应以弹窗展示 harness 运行详情", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
      }),
    );
    const startedAt = new Date(Date.now() - 10_000).toISOString();
    const updatedAt = new Date().toISOString();
    mockExecutionRunGetThemeWorkbenchState.mockResolvedValue({
      run_state: "auto_running",
      current_gate_key: "write_mode",
      queue_items: [
        {
          run_id: "run-social-harness-active",
          title: "生成社媒初稿",
          gate_key: "write_mode",
          artifact_paths: [
            "social-posts/demo-post.md",
            "social-posts/demo-cover.png",
          ],
          status: "running",
          source: "skill",
          source_ref: null,
          started_at: startedAt,
        },
      ],
      latest_terminal: null,
      updated_at: updatedAt,
    });

    const container = renderPage({
      projectId: "project-social-harness-running",
      contentId: "content-social-harness-running",
      theme: "social-media",
      lockTheme: true,
    });
    await flushEffects(12);

    const harnessCard = container.querySelector(
      '[data-testid="social-harness-card"]',
    ) as HTMLElement | null;
    const sidebar = container.querySelector(
      '[data-testid="theme-workbench-sidebar"]',
    ) as HTMLElement | null;
    const layoutChat = container.querySelector(
      '[data-testid="layout-chat"]',
    ) as HTMLElement | null;
    expect(harnessCard?.getAttribute("data-run-state")).toBe("auto_running");
    expect(harnessCard?.getAttribute("data-layout")).toBe("icon");
    expect(sidebar?.contains(harnessCard as Node)).toBe(true);
    expect(harnessCard?.textContent).toContain("写作闸门");
    expect(harnessCard?.textContent).toContain("生成社媒初稿");
    expect(harnessCard?.textContent).toContain("2 个产物");
    expect(
      layoutChat?.querySelector('[data-testid="social-harness-card"]'),
    ).toBeNull();

    clickButton(container, "social-harness-toggle");
    await flushEffects(2);

    const navbar = container.querySelector(
      '[data-testid="chat-navbar"]',
    ) as HTMLElement | null;
    expect(navbar?.getAttribute("data-harness-panel-visible")).toBe("true");
    expect(
      document.body.querySelector('[data-testid="harness-status-panel"]'),
    ).not.toBeNull();
    expect(
      sidebar?.querySelector('[data-testid="harness-status-panel"]'),
    ).toBeNull();
    expect(
      layoutChat?.querySelector('[data-testid="harness-status-panel"]'),
    ).toBeNull();
    expect(
      document.body
        .querySelector('[data-testid="harness-status-panel"]')
        ?.getAttribute("data-layout"),
    ).toBe("dialog");
  });
});

describe("AgentChatPage 视频主题工作台", () => {
  it("视频主题工作台不应渲染底部通用输入条，也不应自动发送首条请求", async () => {
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
      }),
    );

    const container = renderPage({
      projectId: "project-video",
      contentId: "content-video",
      theme: "video",
      lockTheme: true,
    });
    await flushEffects(10);

    expect(container.querySelector('[data-testid="inputbar"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="theme-workbench-sidebar"]'),
    ).toBeNull();
    expect(sharedTriggerAIGuideMock).not.toHaveBeenCalled();
    expect(sharedSendMessageMock).not.toHaveBeenCalled();
  });
});

describe("AgentChatPage 海报主题工作台", () => {
  it("海报主题工作台不应渲染底部通用输入条、左侧上下文栏，也不应自动发起请求", async () => {
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
      }),
    );

    const container = renderPage({
      projectId: "project-poster",
      contentId: "content-poster",
      theme: "poster",
      lockTheme: true,
    });
    await flushEffects(10);

    expect(container.querySelector('[data-testid="inputbar"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="theme-workbench-sidebar"]'),
    ).toBeNull();
    expect(sharedTriggerAIGuideMock).not.toHaveBeenCalled();
    expect(sharedSendMessageMock).not.toHaveBeenCalled();
  });
});

describe("AgentChatPage 小说主题工作台", () => {
  it("小说主题工作台普通进入时不应自动发起请求", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
      }),
    );

    const container = renderPage({
      projectId: "project-novel",
      contentId: "content-novel",
      theme: "novel",
      lockTheme: true,
    });
    await flushEffects(10);

    expect(
      container.querySelector('[data-testid="theme-workbench-sidebar"]'),
    ).not.toBeNull();
    expect(sharedTriggerAIGuideMock).not.toHaveBeenCalled();
    expect(sharedSendMessageMock).not.toHaveBeenCalled();
  });

  it("小说主题工作台带初始意图时应改为预填并等待确认", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
      }),
    );

    const initialUserPrompt = "请基于当前设定生成第一章开篇。";
    const onInitialUserPromptConsumed = vi.fn();

    renderPage({
      projectId: "project-novel-intent",
      contentId: "content-novel-intent",
      theme: "novel",
      lockTheme: true,
      initialUserPrompt,
      onInitialUserPromptConsumed,
    });
    await flushEffects(12);

    const container = mountedRoots.at(-1)?.container as HTMLDivElement;
    expect(sharedSendMessageMock).not.toHaveBeenCalled();
    clickButton(container, "theme-workbench-entry-continue");
    await flushEffects(12);

    expect(sharedSendMessageMock).toHaveBeenCalledTimes(1);
    const sendCall = getSendMessageCall();
    expect(sendCall.content).toBe(initialUserPrompt);
    expect(sendCall.images).toEqual([]);
    expect(sendCall.webSearch).toBe(false);
    expect(sendCall.thinking).toBe(false);
    expect(sendCall.skipUserMessage).toBe(false);
    expect(sendCall.executionStrategy).toBeUndefined();
    expect(sendCall.modelOverride).toBeUndefined();
    expect(sendCall.autoContinue).toBeUndefined();
    expect(sendCall.options).toEqual(
      expect.objectContaining({
        requestMetadata: expect.objectContaining({
          harness: expect.objectContaining({
            theme: "novel",
          }),
        }),
      }),
    );
    expect(onInitialUserPromptConsumed).toHaveBeenCalledTimes(1);
    expect(sharedTriggerAIGuideMock).not.toHaveBeenCalled();
  });
});

describe("AgentChatPage legacy 问卷 A2UI", () => {
  it("主题工作台出现待补充 A2UI 时应保持聊天主区域，不展示左侧工作台侧栏", async () => {
    mockUseThemeContextWorkspace.mockReturnValue(
      createMockThemeContextWorkspaceState({
        enabled: true,
      }),
    );

    installMockAgentChatUnifiedState(
      createMockAgentChatUnifiedState({
        messages: [
          {
            id: "msg-theme-user",
            role: "user",
            content: "请继续完善这个方案",
            timestamp: new Date("2026-03-15T09:00:00.000Z"),
          },
          {
            id: "msg-theme-assistant",
            role: "assistant",
            content: `为了继续推进，我需要你先补充以下信息：

1. 目标与对象
- 这次内容主要面向谁？（客户 / 上级 / 同事）
- 这次最想达成的目标是什么？

2. 风格与限制
- 语气偏好：正式严谨 / 友好专业 / 直接高效
- 是否需要加入明确行动号召？`,
            timestamp: new Date("2026-03-15T09:00:01.000Z"),
          },
        ],
      }),
    );

    const container = renderPage({
      projectId: "project-theme-a2ui",
      contentId: "content-theme-a2ui",
      theme: "social-media",
      lockTheme: true,
    });
    await flushEffects(10);

    expect(
      container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat");
    expect(
      container.querySelector('[data-testid="theme-workbench-sidebar"]'),
    ).toBeNull();

    const latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | {
          pendingA2UIForm?: {
            data?: Record<string, unknown>;
          } | null;
        }
      | undefined;

    expect(latestInputbarProps?.pendingA2UIForm?.data).toMatchObject({
      source: "legacy_questionnaire",
      questionCount: 1,
    });
  });

  it("应将结构化问卷提升到输入区浮层，并按字段标签提交摘要", async () => {
    mockUseAgentChatUnified.mockImplementation(
      ({ workspaceId }: { workspaceId: string }) => {
        observedWorkspaceIds.push(workspaceId);
        return {
          providerType: "kiro",
          setProviderType: vi.fn(),
          model: "mock-model",
          setModel: vi.fn(),
          executionStrategy: "auto",
          setExecutionStrategy: vi.fn(),
          messages: [
            {
              id: "msg-legacy-user",
              role: "user",
              content: "帮我先梳理需求",
              timestamp: new Date("2026-03-15T09:00:00.000Z"),
            },
            {
              id: "msg-legacy-assistant",
              role: "assistant",
              content: `为了继续推进，我需要你先补充以下信息：

1. 目标与对象
- 这次内容主要面向谁？（客户 / 上级 / 同事）
- 这次最想达成的目标是什么？

2. 风格与限制
- 语气偏好：正式严谨 / 友好专业 / 直接高效
- 是否需要加入明确行动号召？`,
              timestamp: new Date("2026-03-15T09:00:01.000Z"),
            },
          ],
          isSending: false,
          sendMessage: sharedSendMessageMock,
          stopSending: vi.fn(async () => undefined),
          clearMessages: vi.fn(),
          deleteMessage: vi.fn(),
          editMessage: vi.fn(),
          handlePermissionResponse: vi.fn(),
          triggerAIGuide: sharedTriggerAIGuideMock,
          topics: [
            {
              id: "topic-a",
              title: "话题 A",
              updatedAt: Date.now(),
            },
          ],
          sessionId: "session-1",
          switchTopic: sharedSwitchTopicMock,
          deleteTopic: vi.fn(),
          renameTopic: vi.fn(),
          workspacePathMissing: false,
          fixWorkspacePathAndRetry: vi.fn(),
          dismissWorkspacePathError: vi.fn(),
        };
      },
    );

    renderPage({
      projectId: "project-legacy-a2ui",
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    const latestMessageListProps = mockMessageList.mock.calls.at(-1)?.[0] as
      | {
          messages?: Array<Record<string, unknown>>;
        }
      | undefined;
    expect(latestMessageListProps?.messages?.[1]?.content).toBe(
      "已整理为补充信息表单，请在输入区完成填写。",
    );

    const latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | {
          pendingA2UIForm?: {
            data?: Record<string, unknown>;
            components?: Array<Record<string, unknown>>;
          } | null;
          onA2UISubmit?: (formData: Record<string, unknown>) => void;
        }
      | undefined;

    expect(latestInputbarProps?.pendingA2UIForm).toBeTruthy();
    expect(latestInputbarProps?.pendingA2UIForm?.data).toMatchObject({
      source: "legacy_questionnaire",
      questionCount: 1,
      governance: expect.objectContaining({
        originalQuestionCount: 4,
        deferredQuestionCount: 3,
      }),
    });
    expect(latestInputbarProps?.pendingA2UIForm?.components || []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component: "ChoicePicker",
          label: "这次内容主要面向谁？",
        }),
      ]),
    );
    expect(latestInputbarProps?.pendingA2UIForm?.components || []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "这次最想达成的目标是什么？",
        }),
        expect.objectContaining({
          label: "语气偏好",
        }),
        expect.objectContaining({
          label: "是否需要加入明确行动号召？",
        }),
      ]),
    );

    const componentIdByLabel = Object.fromEntries(
      (latestInputbarProps?.pendingA2UIForm?.components || [])
        .filter(
          (component) =>
            (component.component === "ChoicePicker" ||
              component.component === "TextField") &&
            typeof component.label === "string" &&
            typeof component.id === "string",
        )
        .map((component) => [component.label, component.id]),
    );

    act(() => {
      latestInputbarProps?.onA2UISubmit?.({
        [componentIdByLabel["这次内容主要面向谁？"]]: ["客户"],
      });
    });

    expect(sharedSendMessageMock).toHaveBeenCalledWith(
      `我的选择：
- 这次内容主要面向谁？: 客户`,
      [],
      false,
      false,
      false,
      undefined,
      undefined,
      undefined,
      expect.objectContaining({
        requestMetadata: {
          elicitation_context: expect.objectContaining({
            source: "legacy_questionnaire",
            mode: "compatibility_bridge",
            question_count: 1,
            governance: expect.objectContaining({
              originalQuestionCount: 4,
              deferredQuestionCount: 3,
            }),
            entries: expect.arrayContaining([
              expect.objectContaining({
                label: "这次内容主要面向谁？",
                value: "客户",
                summary: "客户",
              }),
            ]),
          }),
        },
      }),
    );
  });

  it("ask/tool_calls 残留问卷正文也应提升为输入区 A2UI，而不是原样展示", async () => {
    mockUseAgentChatUnified.mockImplementation(
      ({ workspaceId }: { workspaceId: string }) => {
        observedWorkspaceIds.push(workspaceId);
        return {
          providerType: "kiro",
          setProviderType: vi.fn(),
          model: "mock-model",
          setModel: vi.fn(),
          executionStrategy: "auto",
          setExecutionStrategy: vi.fn(),
          messages: [
            {
              id: "msg-legacy-user",
              role: "user",
              content: "请先做网页研究简报",
              timestamp: new Date("2026-03-15T09:00:00.000Z"),
            },
            {
              id: "msg-legacy-assistant-compat-ask",
              role: "assistant",
              content: `我注意到您想让我做“网页研究简报”，但您没有指定具体的研究主题。

我注意到您想让我做“网页研究简报”，但您没有指定具体的研究主题。

在我开始之前，需要先明确几个问题：

ask<arg_key>question</arg_key><arg_key>arg_value>请提供您希望我研究的具体主题。这可以是：

- 一个行业或领域（如“生成式 AI 在医疗领域的应用”）
- 一个产品或服务（如“Claude API vs 竞品对比”）
- 一个公司或组织（如“某公司的最新动态”）
- 一个技术或概念（如“WebAssembly 的新进展”）
- 其他您关心的主题

另外，请告诉我该研究的主要目的是什么？</arg_value></tool_calls>`,
              timestamp: new Date("2026-03-15T09:00:01.000Z"),
            },
          ],
          isSending: false,
          sendMessage: sharedSendMessageMock,
          stopSending: vi.fn(async () => undefined),
          clearMessages: vi.fn(),
          deleteMessage: vi.fn(),
          editMessage: vi.fn(),
          handlePermissionResponse: vi.fn(),
          triggerAIGuide: sharedTriggerAIGuideMock,
          topics: [
            {
              id: "topic-a",
              title: "话题 A",
              updatedAt: Date.now(),
            },
          ],
          sessionId: "session-1",
          switchTopic: sharedSwitchTopicMock,
          deleteTopic: vi.fn(),
          renameTopic: vi.fn(),
          workspacePathMissing: false,
          fixWorkspacePathAndRetry: vi.fn(),
          dismissWorkspacePathError: vi.fn(),
        };
      },
    );

    renderPage({
      projectId: "project-legacy-a2ui-compat-ask",
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    const latestMessageListProps = mockMessageList.mock.calls.at(-1)?.[0] as
      | {
          messages?: Array<Record<string, unknown>>;
        }
      | undefined;
    expect(latestMessageListProps?.messages?.[1]?.content).toBe(
      "已整理为补充信息表单，请在输入区完成填写。",
    );

    const latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | {
          pendingA2UIForm?: {
            data?: Record<string, unknown>;
            components?: Array<Record<string, unknown>>;
          } | null;
        }
      | undefined;

    expect(latestInputbarProps?.pendingA2UIForm?.data).toMatchObject({
      source: "legacy_questionnaire",
      sectionCount: 1,
      questionCount: 1,
      governance: expect.objectContaining({
        originalQuestionCount: 2,
        deferredQuestionCount: 1,
      }),
    });
    expect(
      (latestInputbarProps?.pendingA2UIForm?.components || []).some(
        (component) =>
          component.component === "TextField" &&
          component.label === "请提供您希望我研究的具体主题",
      ),
    ).toBe(true);
  });

  it("普通中文澄清问题也应提升为输入区 A2UI，而不是继续停留在正文里", async () => {
    mockUseAgentChatUnified.mockImplementation(
      ({ workspaceId }: { workspaceId: string }) => {
        observedWorkspaceIds.push(workspaceId);
        return {
          providerType: "kiro",
          setProviderType: vi.fn(),
          model: "mock-model",
          setModel: vi.fn(),
          executionStrategy: "auto",
          setExecutionStrategy: vi.fn(),
          messages: [
            {
              id: "msg-plain-legacy-user",
              role: "user",
              content: "围绕这个主题做研究",
              timestamp: new Date("2026-03-15T09:00:00.000Z"),
            },
            {
              id: "msg-plain-legacy-assistant",
              role: "assistant",
              content: `我需要先明确一下：您希望我研究哪个主题？您的消息中提到了“围绕这个主题”，但没有具体说明主题内容。请告诉我：

- 具体的研究主题（例如：某个产品、技术、公司、市场趋势、政策、事件等）
- 研究目的（例如：投资决策、技术选型、竞争分析、学习了解等）
- 是否有特定关注点（例如：风险、机会、对比、最新动态等）

一旦您明确了主题，我会：
1. 使用联网搜索获取最新信息
2. 整理关键来源和核心发现
3. 识别风险点和待追踪问题
4. 输出一版结构化的研究简报`,
              timestamp: new Date("2026-03-15T09:00:01.000Z"),
            },
          ],
          isSending: false,
          sendMessage: sharedSendMessageMock,
          stopSending: vi.fn(async () => undefined),
          clearMessages: vi.fn(),
          deleteMessage: vi.fn(),
          editMessage: vi.fn(),
          handlePermissionResponse: vi.fn(),
          triggerAIGuide: sharedTriggerAIGuideMock,
          topics: [
            {
              id: "topic-a",
              title: "话题 A",
              updatedAt: Date.now(),
            },
          ],
          sessionId: "session-1",
          switchTopic: sharedSwitchTopicMock,
          deleteTopic: vi.fn(),
          renameTopic: vi.fn(),
          workspacePathMissing: false,
          fixWorkspacePathAndRetry: vi.fn(),
          dismissWorkspacePathError: vi.fn(),
        };
      },
    );

    renderPage({
      projectId: "project-plain-legacy-a2ui",
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    const latestMessageListProps = mockMessageList.mock.calls.at(-1)?.[0] as
      | {
          messages?: Array<Record<string, unknown>>;
        }
      | undefined;
    expect(latestMessageListProps?.messages?.[1]?.content).toBe(
      "已整理为补充信息表单，请在输入区完成填写。",
    );

    const latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | {
          pendingA2UIForm?: {
            data?: Record<string, unknown>;
            components?: Array<Record<string, unknown>>;
          } | null;
        }
      | undefined;

    expect(latestInputbarProps?.pendingA2UIForm?.data).toMatchObject({
      source: "legacy_questionnaire",
      sectionCount: 1,
      questionCount: 1,
      governance: expect.objectContaining({
        originalQuestionCount: 3,
        deferredQuestionCount: 2,
      }),
    });
    expect(latestInputbarProps?.pendingA2UIForm?.components || []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component: "TextField",
          label: "具体的研究主题",
        }),
      ]),
    );
    expect(
      (latestInputbarProps?.pendingA2UIForm?.components || []).filter(
        (component) => component.component === "TextField",
      ),
    ).toHaveLength(1);
    expect(latestInputbarProps?.pendingA2UIForm?.components || []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component: "TextField",
          label: "研究目的",
        }),
        expect.objectContaining({
          component: "TextField",
          label: "是否有特定关注点",
        }),
      ]),
    );
  });

  it("问卷已提交后，消息区应折叠为简短确认而不是继续展示完整题面", async () => {
    mockUseAgentChatUnified.mockImplementation(
      ({ workspaceId }: { workspaceId: string }) => {
        observedWorkspaceIds.push(workspaceId);
        return {
          providerType: "kiro",
          setProviderType: vi.fn(),
          model: "mock-model",
          setModel: vi.fn(),
          executionStrategy: "auto",
          setExecutionStrategy: vi.fn(),
          messages: [
            {
              id: "msg-legacy-user",
              role: "user",
              content: "帮我先梳理需求",
              timestamp: new Date("2026-03-15T09:00:00.000Z"),
            },
            {
              id: "msg-legacy-assistant",
              role: "assistant",
              content: `为了继续推进，我需要你先补充以下信息：

1. 目标与对象
- 这次内容主要面向谁？（客户 / 上级 / 同事）
- 这次最想达成的目标是什么？

2. 风格与限制
- 语气偏好：正式严谨 / 友好专业 / 直接高效
- 是否需要加入明确行动号召？`,
              timestamp: new Date("2026-03-15T09:00:01.000Z"),
            },
            {
              id: "msg-legacy-summary",
              role: "user",
              content: `我的选择：
- 这次内容主要面向谁？: 客户
- 这次最想达成的目标是什么？: 帮助市场团队统一宣传口径`,
              timestamp: new Date("2026-03-15T09:01:00.000Z"),
            },
          ],
          isSending: false,
          sendMessage: sharedSendMessageMock,
          stopSending: vi.fn(async () => undefined),
          clearMessages: vi.fn(),
          deleteMessage: vi.fn(),
          editMessage: vi.fn(),
          handlePermissionResponse: vi.fn(),
          triggerAIGuide: sharedTriggerAIGuideMock,
          topics: [
            {
              id: "topic-a",
              title: "话题 A",
              updatedAt: Date.now(),
            },
          ],
          sessionId: "session-1",
          switchTopic: sharedSwitchTopicMock,
          deleteTopic: vi.fn(),
          renameTopic: vi.fn(),
          workspacePathMissing: false,
          fixWorkspacePathAndRetry: vi.fn(),
          dismissWorkspacePathError: vi.fn(),
        };
      },
    );

    renderPage({
      projectId: "project-legacy-a2ui-completed",
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    const latestMessageListProps = mockMessageList.mock.calls.at(-1)?.[0] as
      | {
          messages?: Array<Record<string, unknown>>;
        }
      | undefined;
    expect(latestMessageListProps?.messages?.[1]?.content).toBe(
      "补充信息表单已提交。",
    );
  });

  it("真实 action_required 存在时，不应被 legacy 折叠逻辑覆盖", async () => {
    mockUseAgentChatUnified.mockImplementation(
      ({ workspaceId }: { workspaceId: string }) => {
        observedWorkspaceIds.push(workspaceId);
        return {
          providerType: "kiro",
          setProviderType: vi.fn(),
          model: "mock-model",
          setModel: vi.fn(),
          executionStrategy: "auto",
          setExecutionStrategy: vi.fn(),
          messages: [
            {
              id: "msg-legacy-user",
              role: "user",
              content: "帮我先梳理需求",
              timestamp: new Date("2026-03-15T09:00:00.000Z"),
            },
            {
              id: "msg-protocol-assistant",
              role: "assistant",
              content: `为了继续推进，我需要你先补充以下信息：

1. 目标与对象
- 这次内容主要面向谁？（客户 / 上级 / 同事）
- 这次最想达成的目标是什么？

2. 风格与限制
- 语气偏好：正式严谨 / 友好专业 / 直接高效
- 是否需要加入明确行动号召？`,
              timestamp: new Date("2026-03-15T09:00:01.000Z"),
              actionRequests: [
                {
                  requestId: "req-action-required",
                  actionType: "elicitation",
                  prompt: "请补充本次任务的关键信息",
                  requestedSchema: {
                    type: "object",
                    properties: {
                      audience: {
                        type: "string",
                        title: "目标受众",
                      },
                    },
                  },
                  status: "pending",
                },
              ],
            },
          ],
          isSending: false,
          sendMessage: sharedSendMessageMock,
          stopSending: vi.fn(async () => undefined),
          clearMessages: vi.fn(),
          deleteMessage: vi.fn(),
          editMessage: vi.fn(),
          handlePermissionResponse: vi.fn(),
          triggerAIGuide: sharedTriggerAIGuideMock,
          topics: [
            {
              id: "topic-a",
              title: "话题 A",
              updatedAt: Date.now(),
            },
          ],
          sessionId: "session-1",
          switchTopic: sharedSwitchTopicMock,
          deleteTopic: vi.fn(),
          renameTopic: vi.fn(),
          workspacePathMissing: false,
          fixWorkspacePathAndRetry: vi.fn(),
          dismissWorkspacePathError: vi.fn(),
        };
      },
    );

    renderPage({
      projectId: "project-action-required-priority",
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    const latestMessageListProps = mockMessageList.mock.calls.at(-1)?.[0] as
      | {
          messages?: Array<Record<string, unknown>>;
        }
      | undefined;
    expect(latestMessageListProps?.messages?.[1]?.content).toContain(
      "为了继续推进，我需要你先补充以下信息",
    );

    const latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | {
          pendingA2UIForm?: {
            id?: string;
          } | null;
        }
      | undefined;
    expect(latestInputbarProps?.pendingA2UIForm?.id).toBe(
      "action-request-req-action-required",
    );
  });

  it("真实 action_required 已提交后，输入区应显示补充信息确认提示而不是继续停留在表单态", async () => {
    mockUseAgentChatUnified.mockImplementation(
      ({ workspaceId }: { workspaceId: string }) => {
        observedWorkspaceIds.push(workspaceId);
        return {
          providerType: "kiro",
          setProviderType: vi.fn(),
          model: "mock-model",
          setModel: vi.fn(),
          executionStrategy: "auto",
          setExecutionStrategy: vi.fn(),
          messages: [
            {
              id: "msg-user-submitted",
              role: "user",
              content: "继续推进当前任务",
              timestamp: new Date("2026-03-15T09:02:00.000Z"),
            },
            {
              id: "msg-assistant-submitted",
              role: "assistant",
              content: "已收到补充信息，正在继续推进。",
              timestamp: new Date("2026-03-15T09:02:10.000Z"),
              actionRequests: [
                {
                  requestId: "req-submitted-action",
                  actionType: "ask_user",
                  prompt: "请选择执行模式",
                  questions: [{ question: "你希望如何执行？" }],
                  status: "submitted",
                  submittedResponse: '{"answer":"自动执行（Auto）"}',
                  submittedUserData: {
                    answer: "自动执行（Auto）",
                  },
                },
              ],
            },
          ],
          isSending: false,
          sendMessage: sharedSendMessageMock,
          stopSending: vi.fn(async () => undefined),
          clearMessages: vi.fn(),
          deleteMessage: vi.fn(),
          editMessage: vi.fn(),
          handlePermissionResponse: vi.fn(),
          triggerAIGuide: sharedTriggerAIGuideMock,
          topics: [
            {
              id: "topic-a",
              title: "话题 A",
              updatedAt: Date.now(),
            },
          ],
          sessionId: "session-1",
          switchTopic: sharedSwitchTopicMock,
          deleteTopic: vi.fn(),
          renameTopic: vi.fn(),
          workspacePathMissing: false,
          fixWorkspacePathAndRetry: vi.fn(),
          dismissWorkspacePathError: vi.fn(),
        };
      },
    );

    renderPage({
      projectId: "project-action-required-submitted",
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    const latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | {
          pendingA2UIForm?: {
            id?: string;
          } | null;
          a2uiSubmissionNotice?: {
            title?: string;
            summary?: string;
          } | null;
        }
      | undefined;

    expect(latestInputbarProps?.pendingA2UIForm ?? null).toBeNull();
    expect(latestInputbarProps?.a2uiSubmissionNotice).toMatchObject({
      title: "补充信息已确认",
      summary: "自动执行（Auto）",
    });
  });
});
