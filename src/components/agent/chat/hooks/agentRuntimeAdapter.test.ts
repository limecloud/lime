import { beforeEach, describe, expect, it, vi } from "vitest";
import { listenAgentRuntimeEvent } from "@/lib/api/agentRuntimeEvents";
import {
  createAgentRuntimeAdapter,
  defaultAgentRuntimeAdapter,
} from "./agentRuntimeAdapter";

const { mockCreateAgentRuntimeClient, mockRuntimeClient } = vi.hoisted(() => {
  const mockRuntimeClient = {
    compactAgentRuntimeSession: vi.fn(),
    createAgentRuntimeSession: vi.fn(),
    deleteAgentRuntimeSession: vi.fn(),
    generateAgentRuntimeSessionTitle: vi.fn(),
    getAgentRuntimeSession: vi.fn(),
    getAgentRuntimeThreadRead: vi.fn(),
    initAsterAgent: vi.fn(),
    interruptAgentRuntimeTurn: vi.fn(),
    listAgentRuntimeSessions: vi.fn(),
    promoteAgentRuntimeQueuedTurn: vi.fn(),
    replayAgentRuntimeRequest: vi.fn(),
    removeAgentRuntimeQueuedTurn: vi.fn(),
    resumeAgentRuntimeThread: vi.fn(),
    respondAgentRuntimeAction: vi.fn(),
    submitAgentRuntimeTurn: vi.fn(),
    updateAgentRuntimeSession: vi.fn(),
  };

  return {
    mockCreateAgentRuntimeClient: vi.fn(() => mockRuntimeClient),
    mockRuntimeClient,
  };
});

vi.mock("@/lib/api/agentRuntimeEvents", () => ({
  listenAgentRuntimeEvent: vi.fn(),
}));

vi.mock("@/lib/api/agentRuntime", () => ({
  createAgentRuntimeClient: mockCreateAgentRuntimeClient,
}));

describe("defaultAgentRuntimeAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应通过 agentRuntimeEvents 代理 turn 与 team 事件监听", async () => {
    const unlisten = vi.fn();
    vi.mocked(listenAgentRuntimeEvent).mockResolvedValue(unlisten);

    const handler = vi.fn();

    await expect(
      defaultAgentRuntimeAdapter.listenToTurnEvents("turn-event", handler),
    ).resolves.toBe(unlisten);
    await expect(
      defaultAgentRuntimeAdapter.listenToTeamEvents("team-event", handler),
    ).resolves.toBe(unlisten);

    expect(listenAgentRuntimeEvent).toHaveBeenNthCalledWith(
      1,
      "turn-event",
      handler,
    );
    expect(listenAgentRuntimeEvent).toHaveBeenNthCalledWith(
      2,
      "team-event",
      handler,
    );
  });

  it("应允许注入自定义 runtime 事件监听器", async () => {
    const injectedListen = vi.fn().mockResolvedValue(vi.fn());
    const adapter = createAgentRuntimeAdapter({
      listenRuntimeEvent: injectedListen,
    });
    const handler = vi.fn();

    await adapter.listenToTurnEvents("turn-event-2", handler);
    await adapter.listenToTeamEvents("team-event-2", handler);

    expect(injectedListen).toHaveBeenNthCalledWith(1, "turn-event-2", handler);
    expect(injectedListen).toHaveBeenNthCalledWith(2, "team-event-2", handler);
  });

  it("应允许注入自定义 runtime client", async () => {
    const client = {
      ...mockRuntimeClient,
      createAgentRuntimeSession: vi.fn().mockResolvedValue("session-9"),
    };
    const adapter = createAgentRuntimeAdapter({
      client,
    });

    await expect(
      adapter.createSession("workspace-9", "新会话", "auto"),
    ).resolves.toBe("session-9");

    expect(client.createAgentRuntimeSession).toHaveBeenCalledWith(
      "workspace-9",
      "新会话",
      "auto",
    );
  });

  it("listSessions 应透传筛选参数给 runtime client", async () => {
    const client = {
      ...mockRuntimeClient,
      listAgentRuntimeSessions: vi.fn().mockResolvedValue([]),
    };
    const adapter = createAgentRuntimeAdapter({
      client,
    });

    await expect(
      adapter.listSessions({
        workspaceId: "workspace-9",
      }),
    ).resolves.toEqual([]);

    expect(client.listAgentRuntimeSessions).toHaveBeenCalledWith({
      workspaceId: "workspace-9",
    });
  });
});
