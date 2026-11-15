import { describe, expect, it, vi } from "vitest";
import { readAgentRuntimeSessionRolloutPath } from "./sessionPath";

vi.mock("./sessionClient", () => ({
  getAgentRuntimeSession: vi.fn(),
}));

import { getAgentRuntimeSession } from "./sessionClient";

const getSession = vi.mocked(getAgentRuntimeSession);

describe("readAgentRuntimeSessionRolloutPath", () => {
  it("读取 session 对应 thread 的 rollout path", async () => {
    getSession.mockResolvedValue({ id: "s1", thread_id: "t1" } as never);
    const readThread = vi.fn().mockResolvedValue({
      result: { thread: { path: "/tmp/rollout.jsonl" } },
    });
    await expect(
      readAgentRuntimeSessionRolloutPath(" s1 ", { readThread }),
    ).resolves.toBe("/tmp/rollout.jsonl");
    expect(readThread).toHaveBeenCalledWith({ threadId: "t1" });
  });

  it("无 session/thread/path 时返回 null", async () => {
    getSession.mockResolvedValue({ id: "s1" } as never);
    const readThread = vi.fn();
    await expect(
      readAgentRuntimeSessionRolloutPath("s1", { readThread }),
    ).resolves.toBeNull();
    expect(readThread).not.toHaveBeenCalled();
  });
});
