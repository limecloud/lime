import { describe, expect, it, vi } from "vitest";
import {
  collectPendingA2UIFormIds,
  createMockAgentChatUnifiedState,
  flushEffects,
  getIndexTestMocks,
  installMockAgentChatUnifiedState,
  observedWorkspaceIds,
  renderPage,
  sharedSendMessageMock,
  sharedSwitchTopicMock,
  sharedTriggerAIGuideMock,
} from "./index.testFixtures";

const {
  mockMessageList,
  mockUseAgentChatUnified,
  mockWorkspacePendingA2UIPanel,
} = getIndexTestMocks();

describe("LocalConversationPage 当前 A2UI 事实源", () => {
  it("历史问卷正文不应再提升为输入区 A2UI", async () => {
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

    renderPage({
      projectId: "project-theme-a2ui",
      contentId: "content-theme-a2ui",
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
    expect(latestMessageListProps?.messages?.[1]?.content).toContain(
      "这次内容主要面向谁？",
    );

    const latestPendingPanelProps = mockWorkspacePendingA2UIPanel.mock.calls.at(
      -1,
    )?.[0] as
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
    expect(latestPendingPanelProps?.pendingA2UIForm ?? null).toBeNull();
    expect(latestPendingPanelProps?.a2uiSubmissionNotice ?? null).toBeNull();
  });

  it("ask/tool_calls 残留问卷正文应原样显示且不生成 pending A2UI", async () => {
    installMockAgentChatUnifiedState(
      createMockAgentChatUnifiedState({
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
      }),
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
    expect(latestMessageListProps?.messages?.[1]?.content).toContain(
      "请提供您希望我研究的具体主题",
    );
    expect(latestMessageListProps?.messages?.[1]?.content).toContain(
      "</tool_calls>",
    );

    const latestPendingPanelProps = mockWorkspacePendingA2UIPanel.mock.calls.at(
      -1,
    )?.[0] as
      | {
          pendingA2UIForm?: {
            id?: string;
          } | null;
        }
      | undefined;
    expect(latestPendingPanelProps?.pendingA2UIForm ?? null).toBeNull();
  });

  it("历史问卷已出现用户补充摘要时也不应折叠原正文", async () => {
    installMockAgentChatUnifiedState(
      createMockAgentChatUnifiedState({
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
      }),
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
    expect(latestMessageListProps?.messages?.[1]?.content).toContain(
      "为了继续推进，我需要你先补充以下信息",
    );
    expect(latestMessageListProps?.messages?.[1]?.content).not.toBe(
      "补充信息表单已提交。",
    );

    const latestPendingPanelProps = mockWorkspacePendingA2UIPanel.mock.calls.at(
      -1,
    )?.[0] as
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
    expect(latestPendingPanelProps?.pendingA2UIForm ?? null).toBeNull();
    expect(latestPendingPanelProps?.a2uiSubmissionNotice ?? null).toBeNull();
  });

  it("真实 action_required 不应派生第二份 A2UI source 或输入区表单", async () => {
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
      // This request arrives in the live session, not restored history.
      initialSessionId: undefined,
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    const latestMessageListProps = mockMessageList.mock.calls.at(-1)?.[0] as
      | {
          activePendingA2UISource?: {
            kind?: string;
            requestId?: string;
          } | null;
          messages?: Array<Record<string, unknown>>;
          renderA2UIInline?: boolean;
        }
      | undefined;
    expect(latestMessageListProps?.messages?.[1]?.content).toContain(
      "为了继续推进，我需要你先补充以下信息",
    );
    expect(latestMessageListProps?.renderA2UIInline).toBe(true);
    expect(latestMessageListProps?.activePendingA2UISource).toBeNull();
    expect(collectPendingA2UIFormIds()).not.toContain(
      "action-request-req-action-required",
    );
  });

  it("真实 action_required 已提交后，不应残留表单或旧兼容提示", async () => {
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

    const latestPendingPanelProps = mockWorkspacePendingA2UIPanel.mock.calls.at(
      -1,
    )?.[0] as
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

    expect(latestPendingPanelProps?.pendingA2UIForm ?? null).toBeNull();
    expect(latestPendingPanelProps?.a2uiSubmissionNotice ?? null).toBeNull();
  });
});
