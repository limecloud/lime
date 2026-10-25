import { describe, expect, it, vi } from "vitest";
import {
  createMockAgentChatUnifiedState,
  clickButton,
  flushEffects,
  getIndexTestMocks,
  installMockAgentChatUnifiedState,
  mountPage,
  observedWorkspaceIds,
  renderPage,
  sharedSendMessageMock,
  sharedSwitchTopicMock,
  sharedTriggerAIGuideMock,
} from "./index.testFixtures";

const { mockUseAgentChatUnified } = getIndexTestMocks();

describe("LocalConversationPage 侧栏显示控制", () => {
  it("Claw 模式有消息时默认收起侧栏，且切换项目不应意外展开", async () => {
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
    expect(
      container.querySelector('[data-testid="toggle-history"]'),
    ).toBeNull();
    expect(container.querySelector('[data-testid="chat-navbar"]')).toBeNull();
    expect(
      container.querySelector(
        '[data-testid="composer-utility-project-trigger"]',
      ),
    ).toBeNull();
    expect(container.querySelector('[data-testid="chat-sidebar"]')).toBeNull();
  });

  it("锁定 general 主题进入 Claw 页面时不再暴露旧左侧对话列表入口", async () => {
    const container = renderPage({
      theme: "general",
      lockTheme: true,
    });
    await flushEffects();

    expect(container.querySelector('[data-testid="chat-sidebar"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="toggle-history"]'),
    ).toBeNull();
  });

  it("Claw 模式不再通过顶栏手动展开旧侧栏", async () => {
    const container = renderPage();
    await flushEffects();

    expect(container.querySelector('[data-testid="chat-sidebar"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="toggle-history"]'),
    ).toBeNull();
  });

  it("重新进入新的 Claw 对话页时，旧侧栏入口仍不应恢复", async () => {
    const mounted = mountPage({
      theme: "general",
      lockTheme: true,
      contentId: "content-a",
    });
    await flushEffects();

    expect(
      mounted.container.querySelector('[data-testid="chat-sidebar"]'),
    ).toBeNull();
    expect(
      mounted.container.querySelector('[data-testid="toggle-history"]'),
    ).toBeNull();

    mounted.rerender({
      contentId: "content-b",
    });
    await flushEffects();

    expect(
      mounted.container.querySelector('[data-testid="chat-sidebar"]'),
    ).toBeNull();
    expect(
      mounted.container.querySelector('[data-testid="toggle-history"]'),
    ).toBeNull();
  });

  it("showChatPanel=false 时应保持侧栏隐藏", async () => {
    const consoleErrorSpy = vi.mocked(console.error);
    const container = renderPage({ showChatPanel: false });
    await flushEffects();

    expect(container.querySelector('[data-testid="chat-sidebar"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="toggle-history"]'),
    ).toBeNull();
    expect(container.querySelector('[data-testid="chat-sidebar"]')).toBeNull();
    expect(
      consoleErrorSpy.mock.calls.some((call) =>
        String(call[0] ?? "").includes("Maximum update depth exceeded"),
      ),
    ).toBe(false);
  });

  it("new-task 执行态也不再通过顶栏展开旧对话侧栏", async () => {
    installMockAgentChatUnifiedState(
      createMockAgentChatUnifiedState({
        messages: [{ id: "msg-new-task", role: "user", content: "继续执行" }],
        isSending: true,
      }),
    );

    const container = renderPage({
      agentEntry: "new-task",
      showChatPanel: false,
      theme: "general",
    });
    await flushEffects();

    expect(
      container.querySelector('[data-testid="toggle-harness"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="thread-side-panel-toggle"]'),
    ).not.toBeNull();
    clickButton(container, "thread-side-panel-toggle");
    await flushEffects();
    expect(
      container
        .querySelector('[data-testid="thread-side-panel-toggle"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(container.querySelector('[data-testid="chat-sidebar"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="toggle-history"]'),
    ).toBeNull();
  });

  it("Claw 模式无激活会话时应展示独立首页", async () => {
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

    const container = renderPage({ agentEntry: "conversation" });
    await flushEffects();

    expect(
      container.querySelector('[data-testid="claw-empty-state"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="empty-state"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="home-composer-page"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="message-list"]')).toBeNull();
    expect(container.querySelector('[data-testid="inputbar"]')).toBeNull();
  });
});
