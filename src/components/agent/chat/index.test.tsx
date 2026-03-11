import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockUseAgentChatUnified,
  mockUseThemeContextWorkspace,
  mockUseTopicBranchBoard,
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
  mockGenerateContentCreationPrompt,
  mockIsContentCreationTheme,
  mockEmptyState,
  mockInputbar,
  mockMessageList,
  mockExecutionRunGetThemeWorkbenchState,
  mockExecutionRunGet,
  mockSkillExecutionGetDetail,
} = vi.hoisted(() => ({
  mockUseAgentChatUnified: vi.fn(),
  mockUseThemeContextWorkspace: vi.fn(),
  mockUseTopicBranchBoard: vi.fn(),
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
  mockGenerateContentCreationPrompt: vi.fn(() => "mock-system-prompt"),
  mockIsContentCreationTheme: vi.fn(() => false),
  mockEmptyState: vi.fn((props?: { input?: string }) => (
    <div data-testid="empty-state">{props?.input || ""}</div>
  )),
  mockInputbar: vi.fn((_props?: Record<string, unknown>) => (
    <div data-testid="inputbar" />
  )),
  mockMessageList: vi.fn((_props?: Record<string, unknown>) => (
    <div data-testid="message-list" />
  )),
  mockExecutionRunGetThemeWorkbenchState: vi.fn(),
  mockExecutionRunGet: vi.fn(),
  mockSkillExecutionGetDetail: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: mockToast,
}));

vi.mock("./hooks", () => ({
  useAgentChatUnified: mockUseAgentChatUnified,
  useThemeContextWorkspace: mockUseThemeContextWorkspace,
  useTopicBranchBoard: mockUseTopicBranchBoard,
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
    onProjectChange,
  }: {
    onToggleHistory?: () => void;
    onProjectChange?: (projectId: string) => void;
  }) => (
    <div data-testid="chat-navbar">
      <button
        type="button"
        data-testid="toggle-history"
        onClick={() => {
          onToggleHistory?.();
        }}
      >
        切换侧边栏
      </button>
      <button
        type="button"
        data-testid="set-project"
        onClick={() => {
          onProjectChange?.("project-manual");
        }}
      >
        选择项目
      </button>
    </div>
  ),
}));

vi.mock("./components/ChatSidebar", () => ({
  ChatSidebar: ({
    onSwitchTopic,
  }: {
    onSwitchTopic?: (topicId: string) => Promise<void> | void;
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
    </div>
  ),
}));

vi.mock("./components/ThemeWorkbenchSidebar", () => ({
  ThemeWorkbenchSidebar: ({
    onSwitchTopic,
    onSetBranchStatus,
    workflowSteps,
    activityLogs,
  }: {
    onSwitchTopic?: (topicId: string) => Promise<void> | void;
    onSetBranchStatus?: (
      topicId: string,
      status: "in_progress" | "pending" | "merged" | "candidate",
    ) => void;
    workflowSteps?: Array<{ title: string; status: string }>;
    activityLogs?: Array<{ runId?: string; executionId?: string; id: string }>;
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

vi.mock("./components/Inputbar", () => ({
  Inputbar: (props: Record<string, unknown>) => mockInputbar(props),
}));

vi.mock("./components/EmptyState", () => ({
  EmptyState: (props?: { input?: string }) => mockEmptyState(props),
}));

vi.mock("@/components/content-creator/core/StepGuide/StepProgress", () => ({
  StepProgress: () => <div data-testid="step-progress" />,
}));

vi.mock("@/components/content-creator/canvas/CanvasFactory", () => ({
  CanvasFactory: () => <div data-testid="canvas-factory" />,
}));

vi.mock("@/components/general-chat/bridge", () => ({
  CanvasPanel: () => <div data-testid="general-canvas" />,
  DEFAULT_CANVAS_STATE: {
    isOpen: false,
    contentType: null,
    content: "",
    isEditing: false,
  },
}));

vi.mock("@/components/artifact", () => ({
  ArtifactRenderer: () => <div data-testid="artifact-renderer" />,
  ArtifactToolbar: () => <div data-testid="artifact-toolbar" />,
}));

vi.mock("@/lib/artifact/store", () => ({
  artifactsAtom: mockArtifactsAtom,
  selectedArtifactAtom: mockSelectedArtifactAtom,
  selectedArtifactIdAtom: mockSelectedArtifactIdAtom,
}));

vi.mock("jotai", () => ({
  useAtomValue: (atom: unknown) =>
    atom === mockSelectedArtifactAtom ? null : [],
  useSetAtom: () => vi.fn(),
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
}));

vi.mock("@/lib/api/skill-execution", () => ({
  skillExecutionApi: {
    getSkillDetail: mockSkillExecutionGetDetail,
  },
}));

import { AgentChatPage } from "./index";

interface MountedHarness {
  container: HTMLDivElement;
  root: Root;
  rerender: (props?: Partial<ComponentProps<typeof AgentChatPage>>) => void;
}

const mountedRoots: MountedHarness[] = [];
const observedWorkspaceIds: string[] = [];
let sharedSwitchTopicMock: ReturnType<typeof vi.fn>;
let sharedSendMessageMock: ReturnType<typeof vi.fn>;
let sharedTriggerAIGuideMock: ReturnType<typeof vi.fn>;

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
    await act(async () => {
      await Promise.resolve();
    });
  }
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
  localStorage.clear();
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
    updated_at: "2026-03-06T00:00:00.000Z",
  });
  mockExecutionRunGet.mockResolvedValue(null);
  mockSkillExecutionGetDetail.mockResolvedValue({
    name: "social_post_with_cover",
    display_name: "社媒主稿与封面",
    description: "生成社媒内容",
    execution_mode: "prompt",
    has_workflow: false,
    workflow_steps: [],
  });
  mockGenerateContentCreationPrompt.mockReturnValue("mock-system-prompt");
  mockIsContentCreationTheme.mockReturnValue(false);
  mockEmptyState.mockImplementation((props?: { input?: string }) => (
    <div data-testid="empty-state">{props?.input || ""}</div>
  ));
  mockUseThemeContextWorkspace.mockReturnValue(
    createMockThemeContextWorkspaceState(),
  );
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

  sharedSwitchTopicMock = vi.fn(async () => undefined);
  sharedSendMessageMock = vi.fn(async () => undefined);
  sharedTriggerAIGuideMock = vi.fn();
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
  vi.unstubAllGlobals();
});

describe("AgentChatPage 话题切换项目恢复", () => {
  it("应先切换到话题绑定项目，再执行话题切换", async () => {
    localStorage.setItem(
      "agent_session_workspace_topic-a",
      JSON.stringify("project-topic"),
    );

    const container = renderPage();
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

    clickButton(container, "switch-topic");
    await flushEffects();

    const switchTopicMock = mockUseAgentChatUnified.mock.results[0]?.value
      ?.switchTopic as ReturnType<typeof vi.fn>;
    expect(switchTopicMock).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith(
      "该话题绑定了其他项目，请先切换到对应项目",
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
  it("有消息时默认显示侧栏且不应被自动收起", async () => {
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

    expect(
      container.querySelector('[data-testid="chat-sidebar"]'),
    ).not.toBeNull();

    clickButton(container, "set-project");
    await flushEffects();
    expect(
      container.querySelector('[data-testid="chat-sidebar"]'),
    ).not.toBeNull();
  });

  it("showChatPanel=false 时应保持侧栏隐藏", async () => {
    const container = renderPage({ showChatPanel: false });
    await flushEffects();

    expect(container.querySelector('[data-testid="chat-sidebar"]')).toBeNull();

    clickButton(container, "toggle-history");
    await flushEffects();
    expect(container.querySelector('[data-testid="chat-sidebar"]')).toBeNull();
  });
});

describe("AgentChatPage 自动引导", () => {
  it("社媒空文稿应预填引导词且不自动发送", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);

    const container = renderPage({
      projectId: "project-social",
      contentId: "content-social",
      theme: "social-media",
      lockTheme: true,
    });
    await flushEffects(10);

    expect(sharedTriggerAIGuideMock).not.toHaveBeenCalled();
    expect(sharedSendMessageMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("社媒内容创作教练");
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

  it("存在 initialUserPrompt 时应优先发送首条意图", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);
    const onInitialUserPromptConsumed = vi.fn();
    const initialUserPrompt = "请先帮我写一篇社媒文案提纲。";

    renderPage({
      projectId: "project-social-intent",
      contentId: "content-social-intent",
      theme: "social-media",
      lockTheme: true,
      initialUserPrompt,
      onInitialUserPromptConsumed,
    });
    await flushEffects(12);

    expect(sharedSendMessageMock).toHaveBeenCalledWith(
      initialUserPrompt,
      [],
      false,
      false,
      false,
      undefined,
      "mock-model",
      undefined,
      undefined,
    );
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

    expect(sharedSendMessageMock).toHaveBeenCalledWith(
      `/social_post_with_cover [生效上下文]\n1. [素材] 品牌手册\n\n${initialUserPrompt}`,
      [],
      false,
      false,
      false,
      undefined,
      "mock-model",
      undefined,
      undefined,
    );
  });

  it("存在 initialUserPrompt 时应使用当前选中模型发送", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);
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

    expect(sharedSendMessageMock).toHaveBeenCalledWith(
      initialUserPrompt,
      [],
      false,
      false,
      false,
      undefined,
      selectedModel,
      undefined,
      undefined,
    );
    expect(onInitialUserPromptConsumed).toHaveBeenCalledTimes(1);
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
      container.querySelector('[data-testid="canvas-factory"]'),
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

  it("主题工作台在初始意图稍后注入时应自动发送首条创作请求", async () => {
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

    act(() => {
      mounted?.root.render(
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

    expect(sharedSendMessageMock).toHaveBeenCalledWith(
      "/social_post_with_cover 请基于当前上下文直接开始生成首版社媒主稿。",
      [],
      false,
      false,
      false,
      undefined,
      expect.any(String),
      undefined,
      undefined,
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
                  name: "search_query",
                  arguments: JSON.stringify({ q: "Rokid Glasses 最新功能" }),
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
          source_ref: "aster_agent_chat_stream",
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
      "aster_agent_chat_stream",
    );
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

  it("小说主题工作台带初始意图时仍应自动发送首条请求", async () => {
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

    expect(sharedSendMessageMock).toHaveBeenCalledWith(
      initialUserPrompt,
      [],
      false,
      false,
      false,
      undefined,
      "mock-model",
      undefined,
      undefined,
    );
    expect(onInitialUserPromptConsumed).toHaveBeenCalledTimes(1);
    expect(sharedTriggerAIGuideMock).not.toHaveBeenCalled();
  });
});
