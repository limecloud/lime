import { describe, expect, it, vi } from "vitest";
import {
  flushEffects,
  getIndexTestMocks,
  observedWorkspaceIds,
  renderPage,
  sharedSendMessageMock,
  sharedSwitchTopicMock,
  sharedTriggerAIGuideMock,
} from "./index.testFixtures";

const { mockLaunchBrowserSession, mockUseAgentChatUnified } =
  getIndexTestMocks();

describe("LocalConversationPage 通用工作台", { timeout: 20_000 }, () => {
  it("当前待处理任务不再暴露旧侧栏恢复入口", async () => {
    const onNavigate = vi.fn();
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
                  prompt: "请先确认发布标题",
                  questions: [{ question: "这篇文章的最终标题是什么？" }],
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
      initialSessionId: "topic-a",
      onNavigate,
      projectId: "project-sidebar-resume",
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    expect(
      container.querySelector('[data-testid="toggle-history"]'),
    ).toBeNull();
    expect(container.querySelector('[data-testid="chat-sidebar"]')).toBeNull();
    expect(sharedSwitchTopicMock).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(mockLaunchBrowserSession).not.toHaveBeenCalled();
  });
});
