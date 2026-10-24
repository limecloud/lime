import { act } from "react";
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

const {
  mockExecutionRunGetGeneralWorkbenchState,
  mockGetContent,
  mockGetGeneralWorkbenchDocumentState,
  mockInputbar,
  mockIsSpecializedWorkbenchTheme,
  mockMessageList,
  mockUpdateContent,
  mockUseAgentChatUnified,
  mockUseTopicBranchBoard,
} = getIndexTestMocks();

describe("AgentChatPage 自动引导", { timeout: 20_000 }, () => {
  it("工作区编排写入损坏的 markdown 产物时不应覆盖主稿正文", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);
    mockGetContent.mockResolvedValue({
      id: "content-theme-corrupted-markdown",
      body: "旧内容",
      metadata: {},
    });
    mockExecutionRunGetGeneralWorkbenchState.mockResolvedValue({
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
      theme: "general",
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
          article_path: "content-posts/demo-post.md",
          pipeline: ["topic_select", "write_mode", "publish_confirm"],
        }),
        "content-posts/demo-post.md",
      );
    });
    await flushEffects(16);

    const bodyUpdateCalls = mockUpdateContent.mock.calls.filter((call) => {
      const payload = call[1] as Record<string, unknown> | undefined;
      return Boolean(payload && "body" in payload);
    });

    expect(bodyUpdateCalls).toHaveLength(0);
  });

  it("工作区编排在队列状态未就绪时写入主稿仍应创建可见版本", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);
    mockGetContent.mockResolvedValue({
      id: "content-theme-fallback-version",
      body: "旧内容",
      metadata: {},
    });
    mockGetGeneralWorkbenchDocumentState.mockResolvedValue(null);
    mockExecutionRunGetGeneralWorkbenchState.mockResolvedValue({
      run_state: "idle",
      queue_items: [],
      latest_terminal: null,
      updated_at: "2026-03-06T03:31:10.000Z",
    });

    renderPage({
      projectId: "project-theme-fallback-version",
      contentId: "content-theme-fallback-version",
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
        "# 新主稿标题\n\n这是在队列未就绪时写入的主稿。",
        "content-posts/local-fallback.md",
      );
    });
    await flushEffects(16);

    const latestTopicBranchCall = mockUseTopicBranchBoard.mock.calls.at(
      -1,
    )?.[0] as
      | { topics?: Array<{ id: string }>; currentTopicId?: string | null }
      | undefined;
    expect(latestTopicBranchCall?.currentTopicId).toBe(
      "artifact:content-posts/local-fallback.md",
    );
    expect(latestTopicBranchCall?.topics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "artifact:content-posts/local-fallback.md",
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
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);
    mockGetContent.mockResolvedValue({
      id: "content-theme-harness-metadata",
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
      projectId: "project-theme-harness-metadata",
      contentId: "content-theme-harness-metadata",
      theme: "general",
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
        "content-posts/demo-post.md",
      );
    });
    await flushEffects(16);

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

  it("工作区编排运行中应展示真实技能与工具步骤，而不是默认占位流程", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);
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
              id: "user-1",
              role: "user",
              content: "/content_post_with_cover 请生成一篇 AI 眼镜的社媒稿",
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
                  arguments: JSON.stringify({ path: "content-posts/final.md" }),
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
      theme: "general",
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
        expect.objectContaining({ title: "生成内容主稿", status: "completed" }),
        expect.objectContaining({
          title: "写入 content-posts/final.md",
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

  it("工作区编排运行中应优先使用后端 current_gate_key", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);
    mockExecutionRunGetGeneralWorkbenchState.mockResolvedValue({
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
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(12);

    const latestInputbarProps = mockInputbar.mock.calls.at(-1)?.[0] as
      | {
          workflowGate?: { key?: string };
          workflowSteps?: Array<{ title: string; status: string }>;
        }
      | undefined;
    expect(latestInputbarProps?.workflowGate?.key).toBe("publish_confirm");
    const workflowSteps = latestInputbarProps?.workflowSteps || [];
    expect(workflowSteps.length).toBeGreaterThan(0);
    expect(workflowSteps.at(-1)?.status).toBe("active");
    if (workflowSteps.length > 1) {
      expect(workflowSteps[0]?.status).toBe("completed");
    }
  });

  it("工作区编排应基于 execution_id 将工具日志映射到真实 runId", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);
    mockExecutionRunGetGeneralWorkbenchState.mockResolvedValue({
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
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(12);

    const sidebar = container.querySelector(
      '[data-testid="general-workbench-sidebar"]',
    ) as HTMLElement | null;
    expect(sidebar).toBeTruthy();
    expect(sidebar?.getAttribute("data-activity-runs")).toContain("run-map-1");
    expect(sidebar?.getAttribute("data-activity-executions")).toContain(
      "exec-map-1",
    );
  });

  it("工作区编排日志应保留最近终态历史，而不是只显示最新一轮", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);
    mockExecutionRunGetGeneralWorkbenchState.mockResolvedValue({
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
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(12);

    const sidebar = container.querySelector(
      '[data-testid="general-workbench-sidebar"]',
    ) as HTMLElement | null;
    expect(sidebar).toBeTruthy();

    const activityRuns = sidebar?.getAttribute("data-activity-runs") || "";
    expect(activityRuns).toContain("run-latest");
    expect(activityRuns).toContain("run-previous");
  });
});
