import { act } from "react";
import { describe, expect, it } from "vitest";
import { acceptedSubmission } from "./hooks/agentSendResult.testFixtures";
import {
  clickButton,
  createMockAgentChatUnifiedState,
  createProject,
  flushEffects,
  getIndexTestMocks,
  getSendMessageCall,
  installMockAgentChatUnifiedState,
  type MockInputbarSendPayload,
  type MockInputbarSendProps,
  mountPage,
  renderPage,
  sharedSendMessageMock,
  waitForElement,
} from "./index.testFixtures";

const {
  mockEmptyState,
  mockGetAgentRuntimeToolInventory,
  mockGetProject,
  mockInputbar,
  mockIsSpecializedWorkbenchTheme,
  mockMessageList,
  mockRequestWorkspaceRightSurface,
  mockUseAgentChatUnified,
} = getIndexTestMocks();

describe("AgentChatPage 通用工作台", { timeout: 20_000 }, () => {
  it("空白新建任务首页应去掉项目栏和会话标签，将工具区放入共享页头", async () => {
    const container = renderPage({
      agentEntry: "new-task",
      showChatPanel: false,
      theme: "general",
      projectId: "project-home",
    });
    await flushEffects(10);

    expect(
      container.querySelector(
        '[data-testid="workspace-main-area"] [data-testid="chat-navbar"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="task-center-chrome-shell"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="task-center-tab-strip"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="task-center-tab-new-task-home"]'),
    ).toBeNull();
    expect(
      container.querySelector(
        '[data-testid="task-center-tab-close-new-task-home"]',
      ),
    ).toBeNull();
    expect(container.textContent).not.toContain("新对话");
    expect(
      container.querySelector(
        '[data-testid="app-shell-header"] [data-app-shell-header-toolbar] [data-testid="task-center-utility-toolbar"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="task-center-utility-toolbar"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="toggle-harness"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="toggle-settings"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="empty-state"]'),
    ).not.toBeNull();
  });

  it("空白新建任务首页不应再展示顶部加号和草稿标签", async () => {
    const mounted = mountPage({
      agentEntry: "new-task",
      showChatPanel: false,
      theme: "general",
      projectId: "project-home",
    });
    await flushEffects(10);

    expect(
      mounted.container.querySelector(
        '[data-testid="task-center-tab-new-task-home"]',
      ),
    ).toBeNull();
    expect(
      mounted.container.querySelector(
        '[data-testid="task-center-tab-create-button"]',
      ),
    ).toBeNull();
    const draftTabs = mounted.container.querySelectorAll(
      '[data-testid^="task-center-tab-task-draft-"]',
    );
    expect(draftTabs).toHaveLength(0);
    expect(
      mounted.container.querySelector(
        '[data-testid="app-shell-header"] [data-app-shell-header-toolbar] [data-testid="task-center-utility-toolbar"]',
      ),
    ).not.toBeNull();
  });

  it("空白新建任务首页刷新后不应自动恢复最近会话", async () => {
    renderPage({
      agentEntry: "new-task",
      newChatAt: 1234567890,
      projectId: "project-home",
      showChatPanel: false,
      theme: "general",
    });
    await flushEffects();

    const workspaceCall = mockUseAgentChatUnified.mock.calls
      .map(
        (call) =>
          call[0] as {
            disableSessionRestore?: boolean;
            workspaceId?: string;
          },
      )
      .find((options) => options.workspaceId === "project-home");

    expect(workspaceCall?.disableSessionRestore).toBe(true);
  });

  it("空白新建任务发送后应立即展示轻量对话预览", async () => {
    type MockEmptyStateProps = {
      input?: string;
      setInput?: (value: string) => void;
      onSend?: (payload?: MockInputbarSendPayload) => void;
    };
    mockEmptyState.mockImplementation((props?: MockEmptyStateProps) => (
      <div data-testid="empty-state" data-input={props?.input || ""}>
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
          onClick={() =>
            props?.onSend?.({ textOverride: props.input || "你好" })
          }
        >
          发送
        </button>
      </div>
    ));
    sharedSendMessageMock.mockImplementationOnce(
      () => new Promise<ReturnType<typeof acceptedSubmission>>(() => undefined),
    );
    installMockAgentChatUnifiedState(
      createMockAgentChatUnifiedState({
        sessionId: null,
        topics: [],
      }),
    );

    const mounted = mountPage({
      agentEntry: "new-task",
      showChatPanel: false,
      theme: "general",
      projectId: "project-home",
    });
    await flushEffects();

    expect(
      await waitForElement(
        mounted.container,
        '[data-testid="mock-empty-type"]',
      ),
    ).not.toBeNull();
    clickButton(mounted.container, "mock-empty-type");
    await flushEffects(1);
    clickButton(mounted.container, "mock-empty-send");

    const latestMessageListProps = mockMessageList.mock.calls.at(-1)?.[0] as
      | { messages?: Array<{ content?: string; role?: string }> }
      | undefined;
    expect(
      mounted.container.querySelector('[data-testid="message-list"]'),
    ).not.toBeNull();
    expect(latestMessageListProps?.messages?.[0]).toMatchObject({
      content: "你好",
      role: "user",
    });
    expect(latestMessageListProps?.messages?.[1]).toMatchObject({
      role: "assistant",
    });
  });

  it("空白新建任务发送派发完成但真实消息未接管前应继续保留轻量预览", async () => {
    type MockEmptyStateProps = {
      input?: string;
      setInput?: (value: string) => void;
      onSend?: (payload?: MockInputbarSendPayload) => void;
    };
    mockEmptyState.mockImplementation((props?: MockEmptyStateProps) => (
      <div data-testid="empty-state" data-input={props?.input || ""}>
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
          onClick={() =>
            props?.onSend?.({ textOverride: props.input || "你好" })
          }
        >
          发送
        </button>
      </div>
    ));
    sharedSendMessageMock.mockResolvedValueOnce(acceptedSubmission());
    installMockAgentChatUnifiedState(
      createMockAgentChatUnifiedState({
        sessionId: null,
        topics: [],
      }),
    );

    const mounted = mountPage({
      agentEntry: "new-task",
      showChatPanel: false,
      theme: "general",
      projectId: "project-home",
    });
    await flushEffects();

    expect(
      await waitForElement(
        mounted.container,
        '[data-testid="mock-empty-type"]',
      ),
    ).not.toBeNull();
    clickButton(mounted.container, "mock-empty-type");
    await flushEffects(1);
    clickButton(mounted.container, "mock-empty-send");
    await flushEffects(12);
    mounted.rerender();
    await flushEffects(4);

    expect(
      mounted.container.querySelector('[data-testid="empty-state"]'),
    ).toBeNull();
    expect(
      mounted.container.querySelector('[data-testid="message-list"]'),
    ).not.toBeNull();
    const latestMessageListProps = mockMessageList.mock.calls.at(-1)?.[0] as
      | { messages?: Array<{ content?: string; role?: string }> }
      | undefined;
    expect(latestMessageListProps?.messages?.[0]).toMatchObject({
      content: "你好",
      role: "user",
    });
  });

  it("新建任务首页即使记住了文档项目也应保留真实首页", async () => {
    mockIsSpecializedWorkbenchTheme.mockImplementation(
      (theme?: string) => theme !== "general",
    );
    mockGetProject.mockResolvedValue({
      ...createProject("project-document-home"),
      workspaceType: "general",
    });

    const container = renderPage({
      agentEntry: "new-task",
      projectId: "project-document-home",
      theme: "general",
    });
    await flushEffects(10);

    expect(
      container.querySelector('[data-testid="empty-state"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="canvas-workbench-layout-mock"]'),
    ).toBeNull();
  });

  it("共享页头通过当前侧面板入口展开工具新标签，并可折叠和重开", async () => {
    const container = renderPage({
      theme: "general",
      lockTheme: true,
      projectId: "project-side-panel",
    });
    await flushEffects();
    const toggle = () =>
      container.querySelector<HTMLButtonElement>(
        '[data-testid="thread-side-panel-toggle"]',
      );
    expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[data-testid="toggle-canvas"]')).toBeNull();
    clickButton(container, "thread-side-panel-toggle");
    await flushEffects();
    expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
    expect(
      container.querySelector('[data-testid="thread-side-panel-new-tab"]'),
    ).not.toBeNull();
    expect(
      container
        .querySelector('[data-testid="workspace-right-surface-host"]')
        ?.getAttribute("data-surface"),
    ).toBe("workspace-new-tab");
    clickButton(container, "thread-side-panel-toggle");
    await flushEffects();
    expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
    clickButton(container, "thread-side-panel-toggle");
    await flushEffects();
    expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
    expect(
      container
        .querySelector('[data-testid="workspace-right-surface-host"]')
        ?.getAttribute("data-surface"),
    ).toBe("workspace-new-tab");
  });

  it("新标签工具选择通过当前 Browser surface 打开内容，不回到旧画布", async () => {
    const container = renderPage({
      theme: "general",
      lockTheme: true,
      projectId: "project-side-panel",
    });
    await flushEffects();
    clickButton(container, "thread-side-panel-toggle");
    await flushEffects();
    clickButton(container, "side-panel-new-tab-browser");
    await flushEffects(4);
    expect(
      container
        .querySelector('[data-testid="workspace-right-surface-host"]')
        ?.getAttribute("data-surface"),
    ).toBe("browser");
    expect(
      container.querySelector('[data-testid="canvas-workbench-layout-mock"]'),
    ).toBeNull();
  });

  it("点击 WebSearch 来源应请求右侧 Browser，而不是打开旧 Canvas 预览", async () => {
    installMockAgentChatUnifiedState(
      createMockAgentChatUnifiedState({
        messages: [
          {
            id: "msg-search-assistant",
            role: "assistant",
            content: "已整理搜索来源。",
            timestamp: new Date("2026-06-24T10:00:00.000Z"),
          },
        ],
      }),
    );

    const mounted = mountPage({
      theme: "general",
      lockTheme: true,
    });
    await flushEffects();

    const latestMessageListProps = mockMessageList.mock.calls.at(-1)?.[0] as
      | {
          onOpenUrlPreview?: (item: {
            id: string;
            title: string;
            url: string;
            hostname: string;
            snippet?: string;
            snapshotContent?: string;
          }) => void;
        }
      | undefined;
    expect(latestMessageListProps?.onOpenUrlPreview).toEqual(
      expect.any(Function),
    );

    act(() => {
      latestMessageListProps?.onOpenUrlPreview?.({
        id: "source-1",
        title: "Reuters World News",
        url: " https://www.reuters.com/world/ ",
        hostname: "www.reuters.com",
        snippet: "搜索结果摘要",
        snapshotContent: "# Reuters snapshot\n\n正文来自 WebFetch。",
      });
    });
    await flushEffects(4);

    expect(
      mounted.container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat");

    expect(mockRequestWorkspaceRightSurface).toHaveBeenCalledWith({
      surfaceKind: "browser",
      origin: "user",
      priority: "foreground",
      reason: "open_url_preview",
      sessionId: null,
      workspaceId: null,
      candidateId: "source-1",
      metadata: {
        browser: {
          launchUrl: "https://www.reuters.com/world/",
          title: "Reuters World News",
        },
      },
    });
  });

  it.each([false, true])(
    "发送中=%s 时侧面板保持显式打开，退出旧 Harness 顶栏和库存读取",
    async (isSending) => {
      installMockAgentChatUnifiedState(
        createMockAgentChatUnifiedState({ isSending }),
      );
      const mounted = mountPage({
        theme: "general",
        lockTheme: true,
        projectId: "project-side-panel",
      });
      await flushEffects();
      expect(
        mounted.container
          .querySelector('[data-testid="thread-side-panel-toggle"]')
          ?.getAttribute("aria-expanded"),
      ).toBe("false");
      clickButton(mounted.container, "thread-side-panel-toggle");
      await flushEffects();
      expect(
        mounted.container.querySelector(
          '[data-testid="thread-side-panel-new-tab"]',
        ),
      ).not.toBeNull();
      expect(
        mounted.container.querySelector('[data-testid="toggle-harness"]'),
      ).toBeNull();
      expect(
        mounted.container.querySelector(
          '[data-testid="task-center-harness-toggle"]',
        ),
      ).toBeNull();
      expect(mockGetAgentRuntimeToolInventory).not.toHaveBeenCalled();
      clickButton(mounted.container, "thread-side-panel-toggle");
      await flushEffects();
      mounted.rerender();
      await flushEffects();
      expect(
        mounted.container
          .querySelector('[data-testid="thread-side-panel-toggle"]')
          ?.getAttribute("aria-expanded"),
      ).toBe("false");
    },
  );

  it("关闭调试信息时侧面板仍可用，工具新标签不读取旧库存", async () => {
    const container = renderPage({
      theme: "general",
      lockTheme: true,
      projectId: "project-side-panel",
    });
    await flushEffects();
    clickButton(container, "thread-side-panel-toggle");
    await flushEffects();
    expect(
      container.querySelector('[data-testid="thread-side-panel-new-tab"]'),
    ).not.toBeNull();
    expect(mockGetAgentRuntimeToolInventory).not.toHaveBeenCalled();
  });

  it("侧面板打开、折叠、重开时不恢复旧对话侧栏", async () => {
    const container = renderPage({
      theme: "general",
      lockTheme: true,
      projectId: "project-side-panel",
    });
    await flushEffects();
    for (let step = 0; step < 3; step += 1) {
      clickButton(container, "thread-side-panel-toggle");
      await flushEffects();
      expect(
        container.querySelector('[data-testid="chat-sidebar"]'),
      ).toBeNull();
      expect(
        container.querySelector('[data-testid="toggle-history"]'),
      ).toBeNull();
    }
  });

  it("发送时不再先调用本地 Team 规划模型，而是直接发送并透传已选 Team 约束", async () => {
    installMockAgentChatUnifiedState(
      createMockAgentChatUnifiedState({
        executionStrategy: "react",
      }),
    );
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
      latestInputbarProps?.onToolStatesChange?.({
        subagent: true,
      });
    });
    await flushEffects(8);

    latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | MockInputbarSendProps
      | undefined;

    act(() => {
      void latestInputbarProps?.onSend?.({
        images: [],
        textOverride: "请帮我拆解并推进这个修复任务",
      });
    });
    await flushEffects(8);

    expect(sharedSendMessageMock).toHaveBeenCalledTimes(1);
    const sendCall = getSendMessageCall();
    expect(sendCall.content).toBe("请帮我拆解并推进这个修复任务");
    expect(sendCall.images).toEqual([]);
    expect(sendCall.webSearch).toBeUndefined();
    expect(sendCall.thinking).toBeUndefined();
    expect(sendCall.skipUserMessage).toBe(false);
    expect(sendCall.executionStrategy).toBe("react");
    expect(sendCall.modelOverride).toBeUndefined();
    expect(sendCall.autoContinue).toBeUndefined();
    const sendOptions = sendCall.options;
    expect(sendOptions?.requestMetadata?.harness).not.toHaveProperty(
      "selected_team_id",
    );
    expect(sendOptions?.requestMetadata?.harness).not.toHaveProperty(
      "selected_team_roles",
    );
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
});
