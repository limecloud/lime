import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@/lib/api/agentProtocol";
import type { TeamWorkspaceRuntimeSessionSnapshot } from "../teamWorkspaceRuntime";
import {
  buildStatusChangedProjection,
  projectRuntimeStreamEvent,
} from "./liveRuntimeProjector";

function createSessionSnapshot(
  overrides: Partial<TeamWorkspaceRuntimeSessionSnapshot> = {},
): TeamWorkspaceRuntimeSessionSnapshot {
  return {
    id: "child-1",
    runtimeStatus: "queued",
    latestTurnStatus: "queued",
    queuedTurnCount: 0,
    ...overrides,
  };
}

describe("liveRuntimeProjector", () => {
  it("team 状态切换应输出稳定的中文状态文案与 runtime patch", () => {
    const projection = buildStatusChangedProjection({
      sessionId: "child-1",
      status: "running",
      session: createSessionSnapshot(),
    });

    expect(projection.entry.title).toBe("状态切换");
    expect(projection.entry.detail).toContain("已切换为处理中");
    expect(projection.liveRuntimePatch).toMatchObject({
      runtimeStatus: "running",
      latestTurnStatus: "running",
      queuedTurnCount: 0,
    });
  });

  it("tool_start 应把工具名映射为中文展示标题", () => {
    const projection = projectRuntimeStreamEvent({
      sessionId: "child-1",
      session: createSessionSnapshot({
        runtimeStatus: "running",
        latestTurnStatus: "running",
      }),
      event: {
        type: "tool_start",
        tool_name: "browser_snapshot",
        tool_id: "tool-1",
      } as AgentEvent,
    });

    expect(projection?.entry?.title).toBe("处理中 · 页面截图");
    expect(projection?.entry?.detail).toContain("正在处理 页面截图");
    expect(projection?.rememberTool).toEqual({
      toolId: "tool-1",
      toolName: "browser_snapshot",
    });
  });

  it("tool_end 应继续沿用已记住的中文工具标题", () => {
    const projection = projectRuntimeStreamEvent({
      sessionId: "child-1",
      session: createSessionSnapshot({
        runtimeStatus: "running",
        latestTurnStatus: "running",
      }),
      toolNameById: {
        "tool-1": "browser_snapshot",
      },
      event: {
        type: "tool_end",
        tool_id: "tool-1",
        result: {
          success: true,
          output: "页面结构差异已提取完成。",
        },
      } as AgentEvent,
    });

    expect(projection?.entry?.title).toBe("处理中 · 页面截图");
    expect(projection?.entry?.detail).toContain("页面结构差异已提取完成。");
    expect(projection?.forgetToolId).toBe("tool-1");
    expect(projection?.refreshPreview).toBe(true);
  });

  it("runtime_status 队列态应投影为稍后开始并回填队列元数据", () => {
    const projection = projectRuntimeStreamEvent({
      sessionId: "child-1",
      session: createSessionSnapshot(),
      event: {
        type: "runtime_status",
        status: {
          title: "等待可用并发",
          detail: "当前 provider 并发已满，稍后继续。",
          checkpoints: ["保留当前上下文"],
          metadata: {
            team_phase: "queued",
            team_parallel_budget: 2,
            team_active_count: 1,
            team_queued_count: 1,
            provider_concurrency_group: "openai",
            provider_parallel_budget: 1,
            queue_reason: "provider_busy",
            retryable_overload: true,
          },
        },
      } as AgentEvent,
    });

    expect(projection?.entry?.statusLabel).toBe("稍后开始");
    expect(projection?.entry?.detail).toContain("当前 provider 并发已满");
    expect(projection?.liveRuntimePatch).toMatchObject({
      runtimeStatus: "queued",
      teamPhase: "queued",
      teamParallelBudget: 2,
      teamActiveCount: 1,
      teamQueuedCount: 1,
      providerConcurrencyGroup: "openai",
      providerParallelBudget: 1,
      queueReason: "provider_busy",
      retryableOverload: true,
    });
  });

  it("内部路由型 runtime_status 不应投影为用户可见 activity", () => {
    const projection = projectRuntimeStreamEvent({
      sessionId: "child-1",
      session: createSessionSnapshot({
        runtimeStatus: "running",
        latestTurnStatus: "running",
      }),
      event: {
        type: "runtime_status",
        status: {
          title: "直接回答优先",
          detail: "当前请求无需默认升级为搜索或任务。",
          checkpoints: ["默认保持直接回答"],
        },
      } as AgentEvent,
    });

    expect(projection?.entry).toBeNull();
    expect(projection?.liveRuntimePatch).toBeUndefined();
  });

  it("queue 与 turn 生命周期提示应使用子任务口径", () => {
    const queuedProjection = projectRuntimeStreamEvent({
      sessionId: "child-1",
      session: createSessionSnapshot(),
      event: {
        type: "queue_added",
      } as AgentEvent,
    });

    const startedProjection = projectRuntimeStreamEvent({
      sessionId: "child-1",
      session: createSessionSnapshot(),
      event: {
        type: "queue_started",
      } as AgentEvent,
    });

    const turnProjection = projectRuntimeStreamEvent({
      sessionId: "child-1",
      session: createSessionSnapshot({
        runtimeStatus: "running",
        latestTurnStatus: "running",
      }),
      event: {
        type: "turn_started",
      } as AgentEvent,
    });

    expect(queuedProjection?.entry?.detail).toContain("这项子任务会在前一项完成后继续处理");
    expect(startedProjection?.entry?.detail).toContain("这项子任务已经开始处理当前任务");
    expect(turnProjection?.entry?.detail).toContain("这项子任务正在推进当前内容");
  });
});
