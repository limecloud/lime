import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { cancelSubAgentTasks, executeSubAgentTasks } from "./subAgentScheduler";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("subAgentScheduler API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应透传执行任务请求", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      success: true,
      results: [],
      totalDurationMs: 0,
      successfulCount: 0,
      failedCount: 0,
      skippedCount: 0,
      totalTokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    });

    await expect(
      executeSubAgentTasks(
        [{ id: "task-1", taskType: "code", prompt: "检查入口" }],
        { maxConcurrency: 2 },
        "session-1",
      ),
    ).resolves.toEqual(expect.objectContaining({ success: true }));

    expect(invoke).toHaveBeenCalledWith("execute_subagent_tasks", {
      tasks: [{ id: "task-1", taskType: "code", prompt: "检查入口" }],
      config: { maxConcurrency: 2 },
      sessionId: "session-1",
    });
  });

  it("应代理取消任务", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await expect(cancelSubAgentTasks()).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("cancel_subagent_tasks");
  });
});
