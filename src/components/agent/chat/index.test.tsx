import { describe, expect, it, vi } from "vitest";
import * as harnessStateModule from "./utils/harnessState";
import * as crashDiagnosticModule from "@/lib/crashDiagnosticAgentUiPerformance";
import * as traceHistoryModule from "@/lib/agentUiPerformanceTraceHistory";
import * as agentTaskRuntimeModule from "./utils/agentTaskRuntime";
import {
  clickButton,
  commitNewConversationRoute,
  createMockAgentChatUnifiedState,
  FIXED_TOPIC_UPDATED_AT,
  flushEffects,
  getIndexTestMocks,
  getSendMessageCall,
  installMockAgentChatUnifiedState,
  type MockEmptyStateProps,
  mountPage,
  renderPage,
  sharedSendMessageMock,
} from "./index.testFixtures";
import { acceptedSubmission } from "./hooks/agentSendResult.testFixtures";
import { createEmptyAgentSessionSnapshot } from "./hooks/agentSessionState";

const {
  mockEmptyState,
  mockEnsureProjectWorkspace,
  mockExpertInfoPanel,
  mockExecutionRunListGeneralWorkbenchHistory,
  mockGetProjectMemory,
  mockMessageList,
  mockSkillExecutionGetDetail,
  mockSkillsGetLocal,
  mockUseAgentChatUnified,
  mockUseSessionFiles,
  mockUseTrayModelShortcuts,
} = getIndexTestMocks();

vi.mock("./utils/harnessState", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./utils/harnessState")>();
  return {
    ...actual,
    deriveHarnessSessionState: vi.fn(actual.deriveHarnessSessionState),
  };
});

vi.mock("./utils/agentTaskRuntime", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./utils/agentTaskRuntime")>();
  return {
    ...actual,
    buildAgentTaskRuntimeCardModel: vi.fn(
      actual.buildAgentTaskRuntimeCardModel,
    ),
  };
});

describe("LocalConversationPage 任务中心顶部工具区", () => {
  it("任务中心不应再渲染顶部项目栏和会话标签", async () => {
    installMockAgentChatUnifiedState(
      createMockAgentChatUnifiedState({
        sessionId: "topic-current",
        topics: [
          {
            id: "topic-current",
            title: "当前会话",
            updatedAt: new Date(FIXED_TOPIC_UPDATED_AT),
            workspaceId: "workspace-test",
          },
        ],
      }),
    );

    const container = renderPage({
      agentEntry: "conversation",
      initialSessionId: "topic-current",
      projectId: "workspace-test",
    });
    await flushEffects();

    expect(mockEnsureProjectWorkspace).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="chat-navbar"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="task-center-chrome-shell"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="task-center-tab-strip"]'),
    ).toBeNull();
    expect(mockUseAgentChatUnified).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "workspace-test" }),
    );
  });

  it("默认 Claw 对话不应提前触发完整 Harness 派生", async () => {
    installMockAgentChatUnifiedState(
      createMockAgentChatUnifiedState({
        sessionId: "topic-current",
        topics: [
          {
            id: "topic-current",
            title: "当前会话",
            updatedAt: new Date(FIXED_TOPIC_UPDATED_AT),
            workspaceId: "workspace-test",
          },
        ],
      }),
    );

    renderPage({
      agentEntry: "conversation",
      initialSessionId: "topic-current",
      projectId: "workspace-test",
    });
    await flushEffects();

    expect(harnessStateModule.deriveHarnessSessionState).not.toHaveBeenCalled();
  });

  it("默认 Claw 对话不应提前读取 Trace 历史和诊断摘要", async () => {
    const historySpy = vi.spyOn(
      traceHistoryModule,
      "listAgentUiPerformanceTraceHistory",
    );
    const overviewSpy = vi.spyOn(
      traceHistoryModule,
      "getAgentUiPerformanceTraceHistoryOverview",
    );
    const summarySpy = vi.spyOn(
      crashDiagnosticModule,
      "buildAgentUiPerformanceDiagnosticSummary",
    );

    installMockAgentChatUnifiedState(
      createMockAgentChatUnifiedState({
        sessionId: "topic-current",
        topics: [
          {
            id: "topic-current",
            title: "当前会话",
            updatedAt: new Date(FIXED_TOPIC_UPDATED_AT),
            workspaceId: "workspace-test",
          },
        ],
      }),
    );

    renderPage({
      agentEntry: "conversation",
      initialSessionId: "topic-current",
      projectId: "workspace-test",
    });
    await flushEffects();

    expect(historySpy).not.toHaveBeenCalled();
    expect(overviewSpy).not.toHaveBeenCalled();
    expect(summarySpy).not.toHaveBeenCalled();
  });

  it("默认 Claw 对话不应首帧读取已安装 Plugin 插件列表", async () => {
    installMockAgentChatUnifiedState(
      createMockAgentChatUnifiedState({
        sessionId: "topic-current",
        topics: [
          {
            id: "topic-current",
            title: "当前会话",
            updatedAt: new Date(FIXED_TOPIC_UPDATED_AT),
            workspaceId: "workspace-test",
          },
        ],
      }),
    );

    renderPage({
      agentEntry: "conversation",
      initialSessionId: "topic-current",
      projectId: "workspace-test",
    });
    await flushEffects();
  });

  it("默认 Claw 对话不应首帧读取本地 Skills 候选", async () => {
    mockSkillsGetLocal.mockClear();
    installMockAgentChatUnifiedState(
      createMockAgentChatUnifiedState({
        sessionId: "topic-current",
        topics: [
          {
            id: "topic-current",
            title: "当前会话",
            updatedAt: new Date(FIXED_TOPIC_UPDATED_AT),
            workspaceId: "workspace-test",
          },
        ],
      }),
    );

    renderPage({
      agentEntry: "conversation",
      initialSessionId: "topic-current",
      projectId: "workspace-test",
    });
    await flushEffects();

    expect(mockSkillsGetLocal).not.toHaveBeenCalled();
  });

  it("默认 Claw 对话不应预取通用工作台历史和 Skill 详情", async () => {
    mockExecutionRunListGeneralWorkbenchHistory.mockClear();
    mockSkillExecutionGetDetail.mockClear();
    installMockAgentChatUnifiedState(
      createMockAgentChatUnifiedState({
        sessionId: "topic-current",
        topics: [
          {
            id: "topic-current",
            title: "当前会话",
            updatedAt: new Date(FIXED_TOPIC_UPDATED_AT),
            workspaceId: "workspace-test",
          },
        ],
      }),
    );

    renderPage({
      agentEntry: "conversation",
      initialSessionId: "topic-current",
      projectId: "workspace-test",
    });
    await flushEffects();

    expect(mockExecutionRunListGeneralWorkbenchHistory).not.toHaveBeenCalled();
    expect(mockSkillExecutionGetDetail).not.toHaveBeenCalled();
  });

  it("默认 Claw 对话不应首帧同步托盘模型候选", async () => {
    mockUseTrayModelShortcuts.mockClear();
    installMockAgentChatUnifiedState(
      createMockAgentChatUnifiedState({
        sessionId: "topic-current",
        topics: [
          {
            id: "topic-current",
            title: "当前会话",
            updatedAt: new Date(FIXED_TOPIC_UPDATED_AT),
            workspaceId: "workspace-test",
          },
        ],
      }),
    );

    renderPage({
      agentEntry: "conversation",
      initialSessionId: "topic-current",
      projectId: "workspace-test",
    });
    await flushEffects();

    expect(mockUseTrayModelShortcuts).toHaveBeenCalled();
    for (const [options] of mockUseTrayModelShortcuts.mock.calls) {
      expect(options).toEqual(
        expect.objectContaining({
          autoSyncEnabled: false,
          deferInitialSync: true,
        }),
      );
    }
  });

  it("默认 Claw 对话不应提前渲染专家信息面板", async () => {
    mockExpertInfoPanel.mockClear();
    installMockAgentChatUnifiedState(
      createMockAgentChatUnifiedState({
        sessionId: "topic-current",
        topics: [
          {
            id: "topic-current",
            title: "当前会话",
            updatedAt: new Date(FIXED_TOPIC_UPDATED_AT),
            workspaceId: "workspace-test",
          },
        ],
      }),
    );

    renderPage({
      agentEntry: "conversation",
      initialSessionId: "topic-current",
      projectId: "workspace-test",
    });
    await flushEffects();

    expect(mockExpertInfoPanel).not.toHaveBeenCalled();
  });

  it("默认 Claw 对话有消息时不应构建空态 runtime task card", async () => {
    vi.mocked(
      agentTaskRuntimeModule.buildAgentTaskRuntimeCardModel,
    ).mockClear();
    installMockAgentChatUnifiedState(
      createMockAgentChatUnifiedState({
        isSending: false,
        sessionId: "topic-current",
        topics: [
          {
            id: "topic-current",
            title: "当前会话",
            updatedAt: new Date(FIXED_TOPIC_UPDATED_AT),
            workspaceId: "workspace-test",
          },
        ],
      }),
    );

    renderPage({
      agentEntry: "conversation",
      initialSessionId: "topic-current",
      projectId: "workspace-test",
    });
    await flushEffects();

    expect(
      agentTaskRuntimeModule.buildAgentTaskRuntimeCardModel,
    ).not.toHaveBeenCalled();
  });

  it("侧边栏新建会话请求应在任务中心内嵌首页起手页，不恢复顶部标签", async () => {
    const onNavigate = vi.fn();
    const state: Record<string, unknown> = createMockAgentChatUnifiedState({
      sessionId: "topic-current",
      topics: [
        {
          id: "topic-current",
          title: "当前会话",
          updatedAt: new Date(FIXED_TOPIC_UPDATED_AT),
          workspaceId: "workspace-test",
        },
      ],
    });
    const createFreshSession = vi.fn(async () => {
      return "new-topic";
    });
    const clearMessages = vi.fn();
    state.createFreshSession = createFreshSession;
    state.clearMessages = clearMessages;
    installMockAgentChatUnifiedState(state);

    const mounted = mountPage({
      agentEntry: "conversation",
      initialSessionId: "topic-current",
      projectId: "workspace-test",
      onNavigate,
    });
    const { container } = mounted;
    await flushEffects();

    expect(
      commitNewConversationRoute(mounted, {
        projectId: "workspace-test",
      }),
    ).toBe(true);
    await flushEffects();
    mounted.rerender();
    await flushEffects();

    expect(createFreshSession).not.toHaveBeenCalled();
    expect(clearMessages).toHaveBeenCalledWith({ showToast: false });
    expect(
      container.querySelector('[data-testid="task-center-chrome-shell"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="task-center-tab-strip"]'),
    ).toBeNull();
    expect(
      container.querySelector(
        '[data-testid^="task-center-tab-task-draft-"][data-active="true"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector(
        '[data-testid="workspace-main-area"] [data-testid="chat-navbar"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="task-center-utility-toolbar"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="toggle-harness"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="toggle-settings"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="empty-state"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="message-list"]')).toBeNull();
  });

  it("侧边栏新建会话请求应保留在当前页面且不恢复顶部草稿标签", async () => {
    const onNavigate = vi.fn();
    const state: Record<string, unknown> = createMockAgentChatUnifiedState({
      sessionId: "topic-current",
      topics: [
        {
          id: "topic-current",
          title: "当前会话",
          updatedAt: new Date(FIXED_TOPIC_UPDATED_AT),
          workspaceId: "workspace-test",
          messagesCount: 1,
        },
      ],
      messages: [
        {
          id: "msg-existing-user",
          role: "user",
          content: "上一轮历史消息",
          timestamp: new Date(FIXED_TOPIC_UPDATED_AT),
        },
      ],
    });
    const createFreshSession = vi.fn(async () => "new-topic");
    const clearMessages = vi.fn(() => {
      state.messages = [];
    });
    const switchTopic = vi.fn(async () => "success");
    state.createFreshSession = createFreshSession;
    state.clearMessages = clearMessages;
    state.switchTopic = switchTopic;
    installMockAgentChatUnifiedState(state);

    const mounted = mountPage({
      agentEntry: "conversation",
      initialSessionId: "topic-current",
      projectId: "workspace-test",
      onNavigate,
    });
    const { container } = mounted;
    await flushEffects();

    expect(switchTopic).not.toHaveBeenCalled();

    expect(
      commitNewConversationRoute(mounted, {
        projectId: "workspace-test",
      }),
    ).toBe(true);
    await flushEffects();
    mounted.rerender();
    await flushEffects();

    expect(createFreshSession).not.toHaveBeenCalled();
    expect(clearMessages).toHaveBeenCalledWith({ showToast: false });
    expect(switchTopic).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-testid="task-center-tab-strip"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid^="task-center-tab-task-draft-"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="task-center-utility-toolbar"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="empty-state"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="message-list"]')).toBeNull();
  });

  it("历史会话 route 提交无项目新建会话后应展示独立空首页", async () => {
    const onNavigate = vi.fn();
    const state: Record<string, unknown> = createMockAgentChatUnifiedState({
      sessionId: "topic-project",
      topics: [
        {
          id: "topic-project",
          title: "项目会话",
          updatedAt: new Date(FIXED_TOPIC_UPDATED_AT),
          workspaceId: "workspace-test",
        },
      ],
    });
    state.clearMessages = vi.fn();
    installMockAgentChatUnifiedState(state);

    const mounted = mountPage({
      agentEntry: "conversation",
      initialSessionId: "topic-project",
      projectId: "workspace-test",
      onNavigate,
    });
    const { container } = mounted;
    await flushEffects();

    expect(commitNewConversationRoute(mounted, { projectId: null })).toBe(true);
    await flushEffects();
    mounted.rerender();
    await flushEffects();

    expect(state.clearMessages).toHaveBeenCalledWith({ showToast: false });
    expect(
      container.querySelector('[data-testid="task-center-utility-toolbar"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="empty-state"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="message-list"]')).toBeNull();
  });

  it("项目会话收到顶部新建会话请求时应保留当前项目上下文", async () => {
    const onNavigate = vi.fn();
    const state: Record<string, unknown> = createMockAgentChatUnifiedState({
      sessionId: "topic-project",
      topics: [
        {
          id: "topic-project",
          title: "项目会话",
          updatedAt: new Date(FIXED_TOPIC_UPDATED_AT),
          workspaceId: "workspace-test",
        },
      ],
    });
    state.clearMessages = vi.fn();
    installMockAgentChatUnifiedState(state);

    const mounted = mountPage({
      agentEntry: "conversation",
      initialSessionId: "topic-project",
      projectId: "workspace-test",
      onNavigate,
    });
    await flushEffects();

    expect(
      commitNewConversationRoute(mounted, {
        projectId: "workspace-test",
      }),
    ).toBe(true);
    await flushEffects();

    expect(state.clearMessages).toHaveBeenCalledWith({ showToast: false });
  });

  it("打开旧会话后在新首页编辑不应继承旧消息或提前创建会话", async () => {
    mockEmptyState.mockImplementation((props?: MockEmptyStateProps) => (
      <div
        data-testid="empty-state"
        data-active-theme={props?.activeTheme || ""}
        data-input={props?.input || ""}
        data-session-id={props?.sessionId ?? ""}
      >
        {props?.activeTheme === "general" ? (
          <div data-testid="home-composer-page" />
        ) : null}
        <button
          type="button"
          data-testid="mock-empty-type"
          onClick={() => props?.setInput?.("新的独立对话")}
        >
          输入
        </button>
      </div>
    ));

    const state: Record<string, unknown> = createMockAgentChatUnifiedState({
      sessionId: "topic-current",
      messages: [
        {
          id: "old-user",
          role: "user",
          content: "旧会话问题",
          timestamp: new Date(FIXED_TOPIC_UPDATED_AT),
        },
        {
          id: "old-assistant",
          role: "assistant",
          content: "旧会话回答",
          timestamp: new Date(FIXED_TOPIC_UPDATED_AT + 1_000),
        },
      ],
      topics: [
        {
          id: "topic-current",
          title: "旧会话",
          updatedAt: new Date(FIXED_TOPIC_UPDATED_AT),
          workspaceId: "workspace-test",
        },
      ],
    });
    const createFreshSession = vi.fn(async () => "new-topic");
    const clearMessages = vi.fn();
    state.createFreshSession = createFreshSession;
    state.clearMessages = clearMessages;
    installMockAgentChatUnifiedState(state);

    const mounted = mountPage({
      agentEntry: "conversation",
      initialSessionId: "topic-current",
      projectId: "workspace-test",
    });
    await flushEffects();

    mockMessageList.mockClear();
    expect(commitNewConversationRoute(mounted, {})).toBe(true);
    await flushEffects();
    mounted.rerender();
    await flushEffects();

    expect(mounted.container.textContent).not.toContain("旧会话问题");
    expect(mounted.container.textContent).not.toContain("旧会话回答");
    expect(clearMessages).toHaveBeenCalledWith({ showToast: false });
    expect(
      mounted.container.querySelector('[data-testid="empty-state"]'),
    ).not.toBeNull();
    expect(
      mounted.container.querySelector('[data-testid="home-composer-page"]'),
    ).not.toBeNull();
    const latestEmptyStateProps = mockEmptyState.mock.calls.at(-1)?.[0] as
      | MockEmptyStateProps
      | undefined;
    expect(latestEmptyStateProps?.activeTheme).toBe("general");
    expect(latestEmptyStateProps?.sessionId).toBeNull();

    clickButton(mounted.container, "mock-empty-type");
    await flushEffects(8);

    expect(createFreshSession).not.toHaveBeenCalled();
    expect(sharedSendMessageMock).not.toHaveBeenCalled();
    expect(mockEmptyState.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ input: "新的独立对话", sessionId: null }),
    );
    expect(
      mounted.container.querySelector('[data-testid="message-list"]'),
    ).toBeNull();
  });

  it("首页编辑不创建会话，首次发送只派发一次并由接受回执激活 canonical 会话", async () => {
    mockEmptyState.mockImplementation((props?: MockEmptyStateProps) => (
      <div data-testid="empty-state" data-session-id={props?.sessionId ?? ""}>
        <button
          type="button"
          data-testid="mock-empty-type"
          onClick={() => props?.setInput?.("你好")}
        >
          输入
        </button>
        <button
          type="button"
          data-testid="mock-empty-send"
          onClick={() => props?.onSend?.({ textOverride: "你好" })}
        >
          发送
        </button>
      </div>
    ));
    const state: Record<string, unknown> = createMockAgentChatUnifiedState({
      sessionId: "topic-current",
      isAutoRestoringSession: true,
      topics: [
        {
          id: "topic-current",
          title: "当前会话",
          updatedAt: new Date(FIXED_TOPIC_UPDATED_AT),
          workspaceId: "workspace-test",
        },
      ],
    });
    const createFreshSession = vi.fn(async () => "unexpected-eager-session");
    state.createFreshSession = createFreshSession;
    // Mirror the unified runtime's real clearMessages snapshot boundary.
    state.clearMessages = vi.fn(() => {
      Object.assign(state, createEmptyAgentSessionSnapshot(), {
        isAutoRestoringSession: false,
        isSessionHydrating: false,
      });
    });
    let accept!: () => void;
    // The unified runtime is the test boundary; only a typed acceptance can select its new canonical session.
    sharedSendMessageMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          accept = () => {
            state.sessionId = "new-topic";
            state.currentTurnId = "pending-turn:test";
            state.isSending = true;
            state.topics = [
              {
                id: "new-topic",
                title: "新对话",
                updatedAt: new Date(FIXED_TOPIC_UPDATED_AT + 1_000),
                workspaceId: "workspace-test",
              },
            ];
            resolve(acceptedSubmission("new-topic"));
          };
        }),
    );
    installMockAgentChatUnifiedState(state);
    const mounted = mountPage({
      agentEntry: "conversation",
      initialSessionId: "topic-current",
      projectId: "workspace-test",
    });
    await flushEffects();
    commitNewConversationRoute(mounted, { projectId: "workspace-test" });
    await flushEffects();
    mounted.rerender();
    await flushEffects();
    expect(state.clearMessages).toHaveBeenCalledExactlyOnceWith({
      showToast: false,
    });
    expect(state.sessionId).toBeNull();
    expect(mockEmptyState.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ sessionId: null }),
    );
    clickButton(mounted.container, "mock-empty-type");
    await flushEffects(8);
    expect(createFreshSession).not.toHaveBeenCalled();
    expect(sharedSendMessageMock).not.toHaveBeenCalled();
    expect(mockEmptyState.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ input: "你好", sessionId: null }),
    );
    clickButton(mounted.container, "mock-empty-send");
    await flushEffects(2);
    expect(createFreshSession).not.toHaveBeenCalled();
    expect(sharedSendMessageMock).toHaveBeenCalledTimes(1);
    expect(getSendMessageCall().content).toBe("你好");
    expect(getSendMessageCall().options).toEqual(
      expect.objectContaining({ skipSessionRestore: true }),
    );
    expect(
      (
        getSendMessageCall().options?.requestMetadata as Record<
          string,
          Record<string, unknown>
        >
      )?.agentUiPerformanceTrace?.sessionId,
    ).toBeNull();
    expect(
      mounted.container.querySelector('[data-testid="empty-state"]'),
    ).toBeNull();
    expect(accept).toBeTypeOf("function");
    accept();
    await flushEffects(10);
    mounted.rerender();
    await flushEffects();
    expect(sharedSendMessageMock).toHaveBeenCalledTimes(1);
    expect(createFreshSession).not.toHaveBeenCalled();
    expect(mockUseSessionFiles).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionId: "new-topic", autoInit: false }),
    );
    expect(mounted.container.textContent).not.toContain("正在恢复生成会话");
  }, 60_000);

  it("从导航栏直达会话时应延后加载 topics，优先恢复目标会话详情", async () => {
    installMockAgentChatUnifiedState(
      createMockAgentChatUnifiedState({
        sessionId: "topic-selected",
        topics: [
          {
            id: "topic-selected",
            title: "目标对话",
            updatedAt: new Date(FIXED_TOPIC_UPDATED_AT),
          },
        ],
      }),
    );

    renderPage({
      agentEntry: "conversation",
      initialSessionId: "topic-selected",
      projectId: "workspace-test",
    });
    await flushEffects(1);

    const workspaceCall = mockUseAgentChatUnified.mock.calls
      .map(
        (call) =>
          call[0] as {
            workspaceId?: string;
            initialTopicsLoadMode?: string;
            initialTopicsDeferredDelayMs?: number;
            initialRuntimeWarmupLoadMode?: string;
            initialRuntimeWarmupDeferredDelayMs?: number;
          },
      )
      .find((options) => options.workspaceId === "workspace-test");
    expect(workspaceCall?.initialTopicsLoadMode).toBe("deferred");
    expect(workspaceCall?.initialTopicsDeferredDelayMs).toBe(0);
    expect(workspaceCall?.initialRuntimeWarmupLoadMode).toBe("deferred");
    expect(workspaceCall?.initialRuntimeWarmupDeferredDelayMs).toBe(45_000);
    expect(mockSkillsGetLocal).not.toHaveBeenCalled();
    expect(mockGetProjectMemory).not.toHaveBeenCalled();
  });
});
