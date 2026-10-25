import { describe, expect, it, vi } from "vitest";
import {
  clickButton,
  flushEffects,
  getIndexTestMocks,
  getSendMessageCall,
  mountedRoots,
  mountPage,
  observedWorkspaceIds,
  renderPage,
  sharedSendMessageMock,
  sharedSwitchTopicMock,
  sharedTriggerAIGuideMock,
} from "./index.testFixtures";

const {
  mockExecutionRunGetGeneralWorkbenchState,
  mockInputbar,
  mockIsSpecializedWorkbenchTheme,
  mockMessageList,
  mockUseAgentChatUnified,
} = getIndexTestMocks();

describe("LocalConversationPage 自动引导", { timeout: 20_000 }, () => {
  it("general 空文稿应预填通用引导词且不自动发送", async () => {
    renderPage({
      projectId: "project-social",
      contentId: "content-social",
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    expect(sharedTriggerAIGuideMock).not.toHaveBeenCalled();
    expect(sharedSendMessageMock).not.toHaveBeenCalled();
    const latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | { input?: string }
      | undefined;
    expect(latestInputbarProps?.input || "").toContain("通用工作台协作助手");
  });

  it("general 空文稿应统一预填通用引导词，而不是直接触发 AI 引导", async () => {
    renderPage({
      projectId: "project-document",
      contentId: "content-document",
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    expect(sharedTriggerAIGuideMock).not.toHaveBeenCalled();
    expect(sharedSendMessageMock).not.toHaveBeenCalled();
    const latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | { input?: string }
      | undefined;
    expect(latestInputbarProps?.input || "").toContain("通用工作台协作助手");
  });

  it("存在 initialUserPrompt 时应先预填并等待确认", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);
    const onInitialUserPromptConsumed = vi.fn();
    const initialUserPrompt = "请先帮我写一篇社媒文案提纲。";

    const container = renderPage({
      projectId: "project-social-intent",
      contentId: "content-social-intent",
      theme: "general",
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
    expect(sendCall.content).toBe(initialUserPrompt);
    expect(sendCall.images).toEqual([]);
    expect(sendCall.webSearch).toBeUndefined();
    expect(sendCall.thinking).toBeUndefined();
    expect(sendCall.skipUserMessage).toBe(false);
    expect(sendCall.executionStrategy).toBe("react");
    expect(sendCall.modelOverride).toBeUndefined();
    expect(sendCall.autoContinue).toBeUndefined();
    expect(sendCall.options).toEqual(
      expect.objectContaining({
        requestMetadata: expect.objectContaining({
          harness: expect.objectContaining({
            theme: "general",
          }),
        }),
      }),
    );
    expect(onInitialUserPromptConsumed).toHaveBeenCalledTimes(1);
    expect(sharedTriggerAIGuideMock).not.toHaveBeenCalled();
  });

  it("无文稿入口存在 initialUserPrompt 时也应预填而不是默认自动发送", async () => {
    const initialUserPrompt = "请基于当前项目资料生成内容";

    renderPage({
      projectId: "project-knowledge-prefill",
      initialUserPrompt,
    });
    await flushEffects(12);

    expect(sharedSendMessageMock).not.toHaveBeenCalled();
    const latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | { input?: string }
      | undefined;
    expect(latestInputbarProps?.input || "").toBe(initialUserPrompt);
    expect(sharedTriggerAIGuideMock).not.toHaveBeenCalled();
  });

  it("初始创作意图点击重新开始后应清空输入并消费待执行意图", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);
    const onInitialUserPromptConsumed = vi.fn();
    const initialUserPrompt = "请先帮我写一篇社媒文案提纲。";

    const container = renderPage({
      projectId: "project-social-intent-restart",
      contentId: "content-social-intent-restart",
      theme: "general",
      lockTheme: true,
      initialUserPrompt,
      onInitialUserPromptConsumed,
    });
    await flushEffects(12);

    clickButton(container, "theme-workbench-entry-restart");
    await flushEffects(12);

    expect(sharedSendMessageMock).not.toHaveBeenCalled();
    const latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | { input?: string }
      | undefined;
    expect(latestInputbarProps?.input || "").toBe("");
    expect(
      container.querySelector('[data-testid="theme-workbench-entry-prompt"]'),
    ).toBeNull();
    expect(onInitialUserPromptConsumed).toHaveBeenCalledTimes(1);
  });

  it("存在 initialRequestMetadata 时应把结构化回放透传到首发 requestMetadata", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);

    const initialUserPrompt = "请继续扩写这条已验证结果";
    const initialRequestMetadata = {
      harness: {
        creation_replay: {
          version: 1,
          kind: "memory_entry",
          source: {
            page: "memory_store",
            project_id: "project-creation-replay",
            entry_id: "memory-creation-replay",
          },
          data: {
            category: "experience",
            title: "高转化开头结构",
            summary: "先给反差，再给结论。",
            tags: ["短视频", "开头"],
          },
        },
      },
    };

    const container = renderPage({
      projectId: "project-creation-replay",
      contentId: "content-creation-replay",
      theme: "general",
      lockTheme: true,
      initialUserPrompt,
      initialRequestMetadata,
      onInitialUserPromptConsumed: vi.fn(),
    });
    await flushEffects(12);

    expect(sharedSendMessageMock).not.toHaveBeenCalled();

    clickButton(container, "theme-workbench-entry-continue");
    await flushEffects(12);

    expect(sharedSendMessageMock).toHaveBeenCalledTimes(1);
    const sendCall = getSendMessageCall();
    expect(sendCall.options).toEqual(
      expect.objectContaining({
        requestMetadata: expect.objectContaining({
          harness: expect.objectContaining({
            theme: "general",
            session_mode: "general_workbench",
            creation_replay: initialRequestMetadata.harness.creation_replay,
          }),
        }),
      }),
    );
  });

  it("启用自动执行首条意图时应直接发送而不是等待确认", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);

    const initialUserPrompt = "请先帮我写一篇社媒文案提纲。";
    const onInitialUserPromptConsumed = vi.fn();
    const container = renderPage({
      projectId: "project-social-intent-autorun",
      contentId: "content-social-intent-autorun",
      theme: "general",
      lockTheme: true,
      initialUserPrompt,
      autoRunInitialPromptOnMount: true,
      onInitialUserPromptConsumed,
    });
    await flushEffects(12);

    expect(sharedSendMessageMock).toHaveBeenCalledTimes(1);
    const sendCall = getSendMessageCall();
    expect(sendCall.content).toBe(initialUserPrompt);
    expect(sendCall.images).toEqual([]);
    expect(sendCall.webSearch).toBeUndefined();
    expect(sendCall.thinking).toBeUndefined();
    expect(sendCall.skipUserMessage).toBe(false);
    expect(sendCall.options).toEqual(
      expect.objectContaining({
        requestMetadata: expect.objectContaining({
          harness: expect.objectContaining({
            theme: "general",
            session_mode: "general_workbench",
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

  it("存在 initialUserPrompt 时应使用当前选中模型发送", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);
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
      theme: "general",
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
    expect(sendCall.content).toBe(initialUserPrompt);
    expect(sendCall.images).toEqual([]);
    expect(sendCall.webSearch).toBeUndefined();
    expect(sendCall.thinking).toBeUndefined();
    expect(sendCall.skipUserMessage).toBe(false);
    expect(sendCall.executionStrategy).toBe("react");
    expect(sendCall.modelOverride).toBeUndefined();
    expect(sendCall.autoContinue).toBeUndefined();
    expect(sendCall.options).toEqual(
      expect.objectContaining({
        requestMetadata: expect.objectContaining({
          harness: expect.objectContaining({
            theme: "general",
          }),
        }),
      }),
    );
    expect(onInitialUserPromptConsumed).toHaveBeenCalledTimes(1);
  });

  it("检测到未完成工作流时应提示继续或重新开始", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);
    mockExecutionRunGetGeneralWorkbenchState.mockResolvedValue({
      run_state: "auto_running",
      current_gate_key: "write_mode",
      queue_items: [
        {
          run_id: "run-resume-1",
          execution_id: "exec-resume-1",
          session_id: "session-default",
          artifact_paths: [],
          title: "撰写主稿",
          gate_key: "write_mode",
          status: "running",
          source: "chat",
          source_ref: "content-social-resume",
          started_at: new Date(Date.now() - 10_000).toISOString(),
        },
      ],
      latest_terminal: null,
      recent_terminals: [],
      updated_at: new Date().toISOString(),
    });

    const container = renderPage({
      projectId: "project-social-resume",
      contentId: "content-social-resume",
      theme: "general",
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
      "请基于当前文稿与最近一次未完成的运行继续推进。任务标题：撰写主稿。优先衔接“写作推进”阶段。不要从头开始，先概括已有进度，再继续执行。",
    );
    expect(sendCall.images).toEqual([]);
    expect(sendCall.webSearch).toBeUndefined();
    expect(sendCall.thinking).toBeUndefined();
    expect(sendCall.skipUserMessage).toBe(false);
    expect(sendCall.executionStrategy).toBe("react");
    expect(sendCall.modelOverride).toBeUndefined();
    expect(sendCall.autoContinue).toBeUndefined();
    expect(sendCall.options).toEqual(
      expect.objectContaining({
        requestMetadata: expect.objectContaining({
          harness: expect.objectContaining({
            theme: "general",
            session_mode: "general_workbench",
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
          providerType: "openai",
          setProviderType: vi.fn(),
          model: "mock-model",
          setModel: vi.fn(),
          executionStrategy: "react",
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
      theme: "general",
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
        content: "任务已进入处理队列…",
      }),
    ]);
  });
});
