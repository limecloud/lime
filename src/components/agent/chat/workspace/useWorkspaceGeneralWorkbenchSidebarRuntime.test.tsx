import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  GeneralWorkbenchRunState,
  GeneralWorkbenchRunTerminalItem,
  GeneralWorkbenchRunTodoItem,
} from "@/lib/api/executionRun";
import { useWorkspaceGeneralWorkbenchSidebarRuntime } from "./useWorkspaceGeneralWorkbenchSidebarRuntime";

const mockExecutionRunGet = vi.hoisted(() => vi.fn());
const mockExecutionRunListGeneralWorkbenchHistory = vi.hoisted(() => vi.fn());
const mockSkillGetDetail = vi.hoisted(() => vi.fn());
const mockListExecutableSkills = vi.hoisted(() => vi.fn());
const mockReadWorkflow = vi.hoisted(() => vi.fn());
const mockCancelWorkflow = vi.hoisted(() => vi.fn());
const mockRetryWorkflow = vi.hoisted(() => vi.fn());
const mockRespondWorkflow = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/executionRun", () => ({
  executionRunGet: mockExecutionRunGet,
  executionRunListGeneralWorkbenchHistory:
    mockExecutionRunListGeneralWorkbenchHistory,
}));

vi.mock("@/lib/api/skill-execution", () => ({
  skillExecutionApi: {
    getSkillDetail: mockSkillGetDetail,
    listExecutableSkills: mockListExecutableSkills,
  },
  resolveExecutableSkillId: (
    skills: Array<{ skill_id: string; name: string }>,
    reference: string,
  ) => {
    const exact = skills.filter((skill) => skill.skill_id === reference);
    if (exact.length === 1) return exact[0].skill_id;
    if (exact.length > 1) return null;
    const byName = skills.filter((skill) => skill.name === reference);
    return byName.length === 1 ? byName[0].skill_id : null;
  },
}));

vi.mock("@/lib/api/appServer", () => ({
  createAppServerClient: () => ({
    readWorkflow: mockReadWorkflow,
    cancelWorkflow: mockCancelWorkflow,
    retryWorkflow: mockRetryWorkflow,
    respondWorkflow: mockRespondWorkflow,
  }),
}));

interface HookProps {
  isThemeWorkbench: boolean;
  sidebarVisible: boolean;
  sessionId?: string | null;
  messages: Parameters<
    typeof useWorkspaceGeneralWorkbenchSidebarRuntime
  >[0]["messages"];
  isSending: boolean;
  themeWorkbenchBackendRunState: Parameters<
    typeof useWorkspaceGeneralWorkbenchSidebarRuntime
  >[0]["themeWorkbenchBackendRunState"];
  historyPageSize: number;
}

interface HookHarness {
  getValue: () => ReturnType<typeof useWorkspaceGeneralWorkbenchSidebarRuntime>;
  rerender: (props?: Partial<HookProps>) => void;
  unmount: () => void;
}

function mountHook(initialProps?: Partial<HookProps>): HookHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let hookValue: ReturnType<
    typeof useWorkspaceGeneralWorkbenchSidebarRuntime
  > | null = null;
  let currentProps: HookProps = {
    isThemeWorkbench: true,
    sidebarVisible: true,
    sessionId: null,
    messages: [],
    isSending: false,
    themeWorkbenchBackendRunState: null,
    historyPageSize: 20,
    ...initialProps,
  };

  function TestComponent() {
    hookValue = useWorkspaceGeneralWorkbenchSidebarRuntime(currentProps);
    return null;
  }

  const render = (nextProps?: Partial<HookProps>) => {
    currentProps = {
      ...currentProps,
      ...nextProps,
    };
    act(() => {
      root.render(<TestComponent />);
    });
  };

  render();

  return {
    getValue: () => {
      if (!hookValue) {
        throw new Error("hook 尚未初始化");
      }
      return hookValue;
    },
    rerender: render,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("useWorkspaceGeneralWorkbenchSidebarRuntime", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    mockExecutionRunListGeneralWorkbenchHistory.mockResolvedValue({
      items: [],
      has_more: false,
      next_offset: null,
    });
    mockExecutionRunGet.mockResolvedValue(null);
    mockSkillGetDetail.mockResolvedValue(null);
    mockListExecutableSkills.mockResolvedValue([]);
    mockReadWorkflow.mockResolvedValue({
      result: {
        sessionId: "session-general-1",
        workflow: {
          workflowRuns: [],
          workflowSteps: [],
        },
        workflowRuns: [],
        workflowSteps: [],
      },
    });
    mockCancelWorkflow.mockResolvedValue({
      result: {
        sessionId: "session-general-1",
        workflow: {
          workflowRuns: [],
          workflowSteps: [],
        },
      },
    });
    mockRetryWorkflow.mockResolvedValue({
      result: {
        sessionId: "session-general-1",
        workflow: {
          workflowRuns: [],
          workflowSteps: [],
        },
      },
    });
    mockRespondWorkflow.mockResolvedValue({
      result: {
        sessionId: "session-general-1",
        workflow: {
          workflowRuns: [],
          workflowSteps: [],
        },
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("侧栏不可见时不应预取工作台历史和 Skill 详情", async () => {
    const harness = mountHook({
      sidebarVisible: false,
      sessionId: "session-general-1",
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "/content_post 写一篇新品稿",
          timestamp: new Date("2026-03-24T14:00:00.000Z"),
        },
      ],
    });

    try {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(
        mockExecutionRunListGeneralWorkbenchHistory,
      ).not.toHaveBeenCalled();
      expect(mockSkillGetDetail).not.toHaveBeenCalled();
      expect(mockListExecutableSkills).not.toHaveBeenCalled();
      expect(mockReadWorkflow).not.toHaveBeenCalled();
      expect(harness.getValue().generalWorkbenchHistoryLoading).toBe(false);
      expect(harness.getValue().generalWorkbenchHistoryHasMore).toBe(false);
    } finally {
      harness.unmount();
    }
  });

  it("应通过 typed catalog 将唯一 Skill name 解析为 stable id 后读取详情", async () => {
    mockListExecutableSkills.mockResolvedValue([
      { skill_id: "project:content_post", name: "content_post" },
    ]);
    const harness = mountHook({
      sidebarVisible: true,
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "/content_post 写一篇新品稿",
          timestamp: new Date("2026-03-24T14:00:00.000Z"),
        },
      ],
    });

    try {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mockListExecutableSkills).toHaveBeenCalledTimes(1);
      expect(mockSkillGetDetail).toHaveBeenCalledWith("project:content_post");
    } finally {
      harness.unmount();
    }
  });

  it("后端 source_ref 已是 stable id 时应精确读取同一 Skill", async () => {
    mockListExecutableSkills.mockResolvedValue([
      { skill_id: "user:content_post", name: "content_post" },
      { skill_id: "project:content_post", name: "content_post" },
    ]);
    const harness = mountHook({
      sidebarVisible: true,
      themeWorkbenchBackendRunState: {
        run_state: "auto_running",
        current_gate_key: "write_mode",
        queue_items: [
          {
            run_id: "run-stable-skill",
            title: "生成社媒初稿",
            gate_key: "write_mode",
            status: "running",
            source: "skill",
            source_ref: "user:content_post",
            started_at: "2026-03-24T14:00:00.000Z",
          },
        ],
        latest_terminal: null,
        updated_at: "2026-03-24T14:00:01.000Z",
      } as GeneralWorkbenchRunState,
    });

    try {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mockSkillGetDetail).toHaveBeenCalledWith("user:content_post");
    } finally {
      harness.unmount();
    }
  });

  it("Skill name 跨 scope 重名时应 fail closed", async () => {
    mockListExecutableSkills.mockResolvedValue([
      { skill_id: "project:content_post", name: "content_post" },
      { skill_id: "user:content_post", name: "content_post" },
    ]);
    const harness = mountHook({
      sidebarVisible: true,
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "/content_post 写一篇新品稿",
          timestamp: new Date("2026-03-24T14:00:00.000Z"),
        },
      ],
    });

    try {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mockListExecutableSkills).toHaveBeenCalledTimes(1);
      expect(mockSkillGetDetail).not.toHaveBeenCalled();
    } finally {
      harness.unmount();
    }
  });

  it("应通过 artifact protocol 将后端运行项映射为侧栏产物路径", () => {
    const queueItem = {
      run_id: "run-queue",
      title: "生成社媒初稿",
      gate_key: "write_mode",
      status: "running",
      source: "skill",
      source_ref: null,
      started_at: "2026-03-24T14:00:00.000Z",
      filePath: "content-posts/demo.md",
    } as unknown as GeneralWorkbenchRunTodoItem;
    const latestTerminal = {
      run_id: "run-terminal",
      title: "生成封面",
      gate_key: "write_mode",
      status: "success",
      source: "skill",
      source_ref: null,
      started_at: "2026-03-24T14:00:01.000Z",
      finished_at: "2026-03-24T14:00:03.000Z",
      artifactPath: "content-posts\\demo-cover.png",
    } as unknown as GeneralWorkbenchRunTerminalItem;
    const backendRunState = {
      run_state: "auto_running",
      current_gate_key: "write_mode",
      queue_items: [queueItem],
      latest_terminal: latestTerminal,
      updated_at: "2026-03-24T14:00:03.000Z",
    } as GeneralWorkbenchRunState;

    const harness = mountHook({
      themeWorkbenchBackendRunState: backendRunState,
    });

    try {
      expect(harness.getValue().generalWorkbenchActivityLogs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            runId: "run-queue",
            artifactPaths: ["content-posts/demo.md"],
          }),
          expect.objectContaining({
            runId: "run-terminal",
            artifactPaths: ["content-posts/demo-cover.png"],
          }),
        ]),
      );
    } finally {
      harness.unmount();
    }
  });

  it("应优先用 Workflow Read Model 驱动步骤、活动日志和运行详情", async () => {
    mockReadWorkflow.mockResolvedValue({
      result: {
        sessionId: "session-general-1",
        workflow: {
          workflowRuns: [
            {
              workflowRunId: "workflow-run-1",
              workflowKey: "content_article_workflow",
              workflowTitle: "写文章工作流",
              status: "failed",
              sessionId: "session-general-1",
              startedAt: "2026-03-24T14:00:00.000Z",
              updatedAt: "2026-03-24T14:01:00.000Z",
              failedAt: "2026-03-24T14:01:00.000Z",
              artifactRefs: ["content-posts/demo.md"],
              failure: {
                reasonCode: "worker_output",
              },
              retry: {
                sourceTurnId: "turn-source",
                rescheduledTurnId: "turn-retry",
              },
              actions: [
                {
                  workflowRunId: "workflow-run-1",
                  actionType: "ask_user",
                  stepId: "approval",
                  requestId: "request-1",
                },
              ],
              steps: [
                {
                  workflowRunId: "workflow-run-1",
                  id: "draft",
                  title: "起草正文",
                  index: 0,
                  status: "failed",
                  artifactRefs: ["content-posts/demo.md"],
                  failure: {
                    message: "正文为空",
                  },
                },
              ],
            },
          ],
          workflowSteps: [],
        },
        workflowRuns: [],
        workflowSteps: [],
      },
    });

    const harness = mountHook({
      sessionId: "session-general-1",
    });

    try {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(harness.getValue().generalWorkbenchWorkflowSteps).toEqual([
        {
          id: "workflow-run-1-draft",
          title: "起草正文",
          status: "error",
        },
      ]);
      expect(harness.getValue().generalWorkbenchActivityLogs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            runId: "workflow-run-1",
            source: "workflow",
            artifactPaths: ["content-posts/demo.md"],
          }),
        ]),
      );

      act(() => {
        harness
          .getValue()
          .handleViewGeneralWorkbenchRunDetail("workflow-run-1");
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(mockExecutionRunGet).not.toHaveBeenCalled();
      expect(harness.getValue().selectedGeneralWorkbenchRunDetail).toEqual(
        expect.objectContaining({
          id: "workflow-run-1",
          status: "error",
          session_id: "session-general-1",
          metadata: expect.stringContaining("workflow_read_model"),
        }),
      );
    } finally {
      harness.unmount();
    }
  });

  it("应通过 App Server workflow/retry 执行失败步骤控制并刷新 read model", async () => {
    mockReadWorkflow.mockResolvedValue({
      result: {
        sessionId: "session-general-1",
        workflow: {
          workflowRuns: [
            {
              workflowRunId: "workflow-run-1",
              workflowKey: "content_article_workflow",
              workflowTitle: "写文章工作流",
              status: "failed",
              sessionId: "session-general-1",
              steps: [
                {
                  workflowRunId: "workflow-run-1",
                  stepId: "draft",
                  title: "起草正文",
                  status: "failed",
                },
              ],
            },
          ],
        },
      },
    });
    mockRetryWorkflow.mockResolvedValue({
      result: {
        sessionId: "session-general-1",
        workflow: {
          workflowRuns: [
            {
              workflowRunId: "workflow-run-1",
              workflowKey: "content_article_workflow",
              workflowTitle: "写文章工作流",
              status: "retrying",
              sessionId: "session-general-1",
              steps: [
                {
                  workflowRunId: "workflow-run-1",
                  stepId: "draft",
                  title: "起草正文",
                  status: "retrying",
                },
              ],
            },
          ],
        },
      },
    });

    const harness = mountHook({
      sessionId: "session-general-1",
    });

    try {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(harness.getValue().generalWorkbenchWorkflowControlItems).toEqual([
        expect.objectContaining({
          kind: "retry",
          workflowRunId: "workflow-run-1",
          stepId: "draft",
        }),
      ]);

      await act(async () => {
        await harness
          .getValue()
          .handleTriggerGeneralWorkbenchWorkflowControl(
            harness.getValue().generalWorkbenchWorkflowControlItems[0]!,
          );
      });

      expect(mockRetryWorkflow).toHaveBeenCalledWith({
        sessionId: "session-general-1",
        workflowRunId: "workflow-run-1",
        stepId: "draft",
        reasonCode: "user_retry_from_general_workbench",
        reason: "Retried from General Workbench workflow controls.",
      });
      expect(harness.getValue().generalWorkbenchWorkflowSteps).toEqual([
        {
          id: "workflow-run-1-draft",
          title: "起草正文",
          status: "active",
        },
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("应通过 App Server workflow/respond 执行等待动作控制", async () => {
    mockReadWorkflow.mockResolvedValue({
      result: {
        sessionId: "session-general-1",
        workflow: {
          workflowRuns: [
            {
              workflowRunId: "workflow-run-1",
              workflowKey: "content_article_workflow",
              workflowTitle: "写文章工作流",
              status: "waiting",
              sessionId: "session-general-1",
              actions: [
                {
                  workflowRunId: "workflow-run-1",
                  actionType: "respond",
                  stepId: "review",
                  requestId: "request-1",
                  agentActionType: "ask_user",
                },
              ],
            },
          ],
        },
      },
    });
    mockRespondWorkflow.mockResolvedValue({
      result: {
        sessionId: "session-general-1",
        workflow: {
          workflowRuns: [
            {
              workflowRunId: "workflow-run-1",
              workflowKey: "content_article_workflow",
              workflowTitle: "写文章工作流",
              status: "running",
              sessionId: "session-general-1",
              steps: [
                {
                  workflowRunId: "workflow-run-1",
                  stepId: "review",
                  title: "人工确认",
                  status: "running",
                },
              ],
            },
          ],
        },
      },
    });

    const harness = mountHook({
      sessionId: "session-general-1",
    });

    try {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      const respondItem =
        harness.getValue().generalWorkbenchWorkflowControlItems[0];
      expect(respondItem).toEqual(
        expect.objectContaining({
          kind: "respond",
          workflowRunId: "workflow-run-1",
          stepId: "review",
          requestId: "request-1",
        }),
      );

      await act(async () => {
        await harness
          .getValue()
          .handleTriggerGeneralWorkbenchWorkflowControl(respondItem!);
      });

      expect(mockRespondWorkflow).toHaveBeenCalledWith({
        sessionId: "session-general-1",
        workflowRunId: "workflow-run-1",
        stepId: "review",
        requestId: "request-1",
        actionType: "ask_user",
        confirmed: true,
        response: {
          decision: "confirmed",
          source: "general_workbench_sidebar",
        },
      });
      expect(harness.getValue().generalWorkbenchWorkflowControlItems).toEqual([
        expect.objectContaining({
          kind: "cancel",
          workflowRunId: "workflow-run-1",
          stepId: "review",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });
});
