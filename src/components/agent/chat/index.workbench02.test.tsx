import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  clickButton,
  createMockAgentChatUnifiedState,
  flushEffects,
  getIndexTestMocks,
  installMockAgentChatUnifiedState,
  type MockInputbarSendProps,
  mountPage,
  observedWorkspaceIds,
  renderPage,
  sharedSendMessageMock,
  sharedSwitchTopicMock,
  sharedTriggerAIGuideMock,
} from "./index.testFixtures";

const { mockInputbar, mockSkillsGetAll, mockUseAgentChatUnified } =
  getIndexTestMocks();

describe("LocalConversationPage 通用工作台", { timeout: 20_000 }, () => {
  it("用户手动关闭侧面板后，同一轮重渲染不应再次抢焦点", async () => {
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
          providerType: "openai",
          setProviderType: vi.fn(),
          model: "mock-model",
          setModel: vi.fn(),
          executionStrategy: "react",
          setExecutionStrategy: vi.fn(),
          messages: [],
          currentTurnId: null,
          turns: [],
          threadItems: [],
          todoItems: [],
          queuedTurns: [],
          isSending: false,
          sendMessage: sharedSendMessageMock,
          stopSending: vi.fn(async () => undefined),
          resumeThread: vi.fn(async () => false),
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
        textOverride:
          "请用 Subagents 推进这项修复，先分析根因、复现路径、边界风险，再分别落实修复与回归验证。",
      });
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

    mounted.rerender();
    await flushEffects(8);

    expect(
      mounted.container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat");

    clickButton(mounted.container, "thread-side-panel-toggle");
    await flushEffects(8);

    expect(
      mounted.container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat-canvas");

    clickButton(mounted.container, "thread-side-panel-toggle");
    await flushEffects(8);

    expect(
      mounted.container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat");

    mounted.rerender();
    await flushEffects(8);

    expect(
      mounted.container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat");
  });

  it("同一会话没有画布信号时，重渲染仍应保持聊天态", async () => {
    mockUseAgentChatUnified.mockImplementation(
      ({ workspaceId }: { workspaceId: string }) => {
        observedWorkspaceIds.push(workspaceId);
        return {
          providerType: "openai",
          setProviderType: vi.fn(),
          model: "mock-model",
          setModel: vi.fn(),
          executionStrategy: "react",
          setExecutionStrategy: vi.fn(),
          messages: [],
          currentTurnId: null,
          turns: [],
          threadItems: [],
          todoItems: [],
          queuedTurns: [],
          isSending: false,
          sendMessage: sharedSendMessageMock,
          stopSending: vi.fn(async () => undefined),
          resumeThread: vi.fn(async () => false),
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

    mounted.rerender();
    await flushEffects(10);

    expect(
      mounted.container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat");
  });

  it("已选 Subagents profile 不应改变工具新标签的显式打开行为", async () => {
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
        textOverride: "请用 Subagents 推进这项修复",
      });
    });
    await flushEffects(8);

    expect(
      mounted.container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat");

    clickButton(mounted.container, "thread-side-panel-toggle");
    await flushEffects(8);

    expect(
      mounted.container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat-canvas");
    expect(
      mounted.container.querySelector(
        '[data-testid="thread-side-panel-new-tab"]',
      ),
    ).not.toBeNull();

    clickButton(mounted.container, "thread-side-panel-toggle");
    await flushEffects(8);

    expect(
      mounted.container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat");
  });

  it("已安装 skills 不应自动打开或恢复旧 Harness 技能区块", async () => {
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
    installMockAgentChatUnifiedState(
      createMockAgentChatUnifiedState({
        isSending: true,
      }),
    );

    const container = renderPage({
      projectId: "project-side-panel-skills",
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    expect(
      container
        .querySelector('[data-testid="thread-side-panel-toggle"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
    clickButton(container, "thread-side-panel-toggle");
    await flushEffects();

    expect(
      container.querySelector('[data-testid="thread-side-panel-new-tab"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="toggle-harness"]'),
    ).toBeNull();
    expect(document.body.textContent).not.toContain("已激活技能");
    expect(
      document.body.querySelector('button[aria-label="跳转到已激活技能"]'),
    ).toBeNull();
  });

  it("显式 slash skill 消息不应恢复旧 Harness 弹窗或自动打开侧面板", async () => {
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
          providerType: "openai",
          setProviderType: vi.fn(),
          model: "mock-model",
          setModel: vi.fn(),
          executionStrategy: "react",
          setExecutionStrategy: vi.fn(),
          messages: [
            {
              id: "msg-skill-1",
              role: "user",
              content: "/research 帮我整理当前主题",
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
      projectId: "project-side-panel-skills",
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    expect(
      container
        .querySelector('[data-testid="thread-side-panel-toggle"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
    clickButton(container, "thread-side-panel-toggle");
    await flushEffects();

    expect(
      container.querySelector('[data-testid="thread-side-panel-new-tab"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="toggle-harness"]'),
    ).toBeNull();
    expect(document.body.textContent).not.toContain("已激活技能");
  });
});
