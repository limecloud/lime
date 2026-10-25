import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  clickButton,
  createMockAgentChatUnifiedState,
  flushEffects,
  getIndexTestMocks,
  getSendMessageCall,
  installMockAgentChatUnifiedState,
  type MockInputbarSendPayload,
  mountedRoots,
  renderPage,
  sharedSendMessageMock,
} from "./index.testFixtures";

const {
  mockExecutionRunGetGeneralWorkbenchState,
  mockGetContent,
  mockGetGeneralWorkbenchDocumentState,
  mockInputbar,
  mockIsSpecializedWorkbenchTheme,
  mockMessageList,
  mockToast,
  mockUpdateContent,
  mockUseTopicBranchBoard,
} = getIndexTestMocks();

describe("LocalConversationPage 自动引导", { timeout: 20_000 }, () => {
  it("工作区编排启用时应仅保留专用侧栏，不再渲染右侧旧操作面板", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);
    const container = renderPage({
      projectId: "project-social-layout",
      contentId: "content-social-layout",
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    expect(
      container.querySelector('[data-testid="general-workbench-sidebar"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="theme-workbench-skills"]'),
    ).toBeNull();
    expect(container.querySelector('[data-testid="chat-sidebar"]')).toBeNull();
    expect(container.querySelector('[data-testid="empty-state"]')).toBeNull();
    expect(container.querySelector('[data-testid="inputbar"]')).not.toBeNull();
  });

  it("工作区编排在初始意图稍后注入时应改为预填并等待确认", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);
    const onInitialUserPromptConsumed = vi.fn();

    renderPage({
      projectId: "project-theme-delayed-intent",
      contentId: "content-theme-delayed-intent",
      theme: "general",
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

    mounted.rerender({
      projectId: "project-theme-delayed-intent",
      contentId: "content-theme-delayed-intent",
      theme: "general",
      lockTheme: true,
      initialUserPrompt: "请基于当前上下文直接开始生成首版社媒主稿。",
      onInitialUserPromptConsumed,
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
    expect(sendCall.content).toBe("请基于当前上下文直接开始生成首版社媒主稿。");
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
    expect(onInitialUserPromptConsumed).toHaveBeenCalledTimes(1);
  });

  it("工作区编排空文稿不应再自动注入旧版提问引导词", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);

    renderPage({
      projectId: "project-theme-no-legacy-guide",
      contentId: "content-theme-no-legacy-guide",
      theme: "general",
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
    installMockAgentChatUnifiedState(
      createMockAgentChatUnifiedState({
        executionStrategy: "react",
      }),
    );

    renderPage({
      projectId: "project-image-vision-block",
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    const latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | {
          onSend?: (
            payload?: MockInputbarSendPayload,
          ) => Promise<boolean | void> | boolean | void;
        }
      | undefined;

    const images = [{ data: "aGVsbG8=", mediaType: "image/png" }];
    act(() => {
      void latestInputbarProps?.onSend?.({
        images,
        textOverride: "请看图",
      });
    });
    await flushEffects(8);

    expect(sharedSendMessageMock).toHaveBeenCalledTimes(1);
    const sendCall = getSendMessageCall();
    expect(sendCall.content).toBe("请看图");
    expect(sendCall.images).toEqual(images);
    expect(sendCall.webSearch).toBeUndefined();
    expect(sendCall.thinking).toBeUndefined();
    expect(sendCall.skipUserMessage).toBe(false);
    expect(sendCall.executionStrategy).toBe("react");
    expect(sendCall.modelOverride).toBeUndefined();
    expect(sendCall.autoContinue).toBeUndefined();
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it("工作区编排空闲时应把 success 终态版本标记为 merged", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);
    mockGetContent.mockResolvedValue({
      id: "content-theme-success",
      body: "当前主稿",
      metadata: {},
    });
    mockGetGeneralWorkbenchDocumentState.mockResolvedValue({
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
    mockExecutionRunGetGeneralWorkbenchState.mockResolvedValue({
      run_state: "idle",
      queue_items: [],
      latest_terminal: {
        run_id: "run-success",
        title: "执行工作区技能",
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
      theme: "general",
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

  it("工作区编排空闲时应把 error 终态版本标记为 candidate", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);
    mockGetContent.mockResolvedValue({
      id: "content-theme-error",
      body: "当前主稿",
      metadata: {},
    });
    mockGetGeneralWorkbenchDocumentState.mockResolvedValue({
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
    mockExecutionRunGetGeneralWorkbenchState.mockResolvedValue({
      run_state: "idle",
      queue_items: [],
      latest_terminal: {
        run_id: "run-error",
        title: "执行工作区技能",
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
      theme: "general",
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

  it("工作区编排写入辅助产物时不应覆盖主稿正文", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);
    mockGetContent.mockResolvedValue({
      id: "content-theme-artifact-guard",
      body: "旧内容",
      metadata: {},
    });
    mockExecutionRunGetGeneralWorkbenchState.mockResolvedValue({
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
      theme: "general",
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
        "content-posts/demo-post.md",
      );
      latestMessageListProps?.onWriteFile?.(
        '{"pipeline":["topic_select","write_mode","publish_confirm"]}',
        "content-posts/demo-post.publish-pack.json",
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
  });
});
