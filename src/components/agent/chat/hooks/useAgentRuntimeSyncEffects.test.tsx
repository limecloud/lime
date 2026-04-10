import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadTurn } from "../types";
import { useAgentRuntimeSyncEffects } from "./useAgentRuntimeSyncEffects";

const mockIsDevBridgeAvailable = vi.hoisted(() => vi.fn(() => false));
const mockHasDevBridgeEventListenerCapability = vi.hoisted(() =>
  vi.fn(() => false),
);
const mockHasTauriEventListenerCapability = vi.hoisted(() => vi.fn(() => true));
const mockSafeListen = vi.hoisted(() => vi.fn(async () => () => {}));

vi.mock("@/lib/dev-bridge", () => ({
  hasDevBridgeEventListenerCapability: mockHasDevBridgeEventListenerCapability,
  isDevBridgeAvailable: mockIsDevBridgeAvailable,
  safeListen: mockSafeListen,
}));

vi.mock("@/lib/tauri-runtime", () => ({
  hasTauriEventListenerCapability: mockHasTauriEventListenerCapability,
}));

type HookProps = Parameters<typeof useAgentRuntimeSyncEffects>[0];

interface HookHarness {
  render: (nextProps?: Partial<HookProps>) => Promise<void>;
  unmount: () => void;
}

const mountedRoots: Array<{
  container: HTMLDivElement;
  root: ReturnType<typeof createRoot>;
}> = [];

function createThreadTurn(
  overrides?: Partial<AgentThreadTurn>,
): AgentThreadTurn {
  return {
    id: "turn-1",
    thread_id: "thread-1",
    prompt_text: "继续执行",
    status: "completed",
    started_at: "2026-03-29T00:00:00.000Z",
    created_at: "2026-03-29T00:00:00.000Z",
    updated_at: "2026-03-29T00:00:00.000Z",
    ...overrides,
  };
}

async function mountHook(props?: Partial<HookProps>): Promise<HookHarness> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultProps: HookProps = {
    runtime: {
      listenToTeamEvents: vi.fn(async () => () => {}),
    },
    sessionIdRef: { current: "session-1" },
    sessionId: "session-1",
    parentSessionId: null,
    isSending: false,
    threadReadStatus: null,
    queuedTurnCount: 0,
    threadTurns: [],
    refreshSessionDetail: vi.fn(async () => true),
  };

  function TestComponent(currentProps: HookProps) {
    useAgentRuntimeSyncEffects(currentProps);
    return null;
  }

  const render = async (nextProps?: Partial<HookProps>) => {
    const mergedProps = {
      ...defaultProps,
      ...props,
      ...nextProps,
    };
    await act(async () => {
      root.render(<TestComponent {...mergedProps} />);
      await Promise.resolve();
    });
  };

  await render();
  const mounted = { container, root };
  mountedRoots.push(mounted);

  return {
    render,
    unmount: () => {
      const index = mountedRoots.indexOf(mounted);
      if (index >= 0) {
        mountedRoots.splice(index, 1);
      }
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("useAgentRuntimeSyncEffects", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    mockIsDevBridgeAvailable.mockReturnValue(false);
    mockHasDevBridgeEventListenerCapability.mockReturnValue(false);
    mockHasTauriEventListenerCapability.mockReturnValue(true);
    mockSafeListen.mockResolvedValue(() => {});
  });

  afterEach(() => {
    while (mountedRoots.length > 0) {
      const mounted = mountedRoots.pop();
      if (!mounted) {
        break;
      }
      act(() => {
        mounted.root.unmount();
      });
      mounted.container.remove();
    }
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("发送结束后应刷新当前会话详情", async () => {
    const refreshSessionDetail = vi.fn(async () => true);
    const harness = await mountHook({
      isSending: true,
      refreshSessionDetail,
    });

    try {
      expect(refreshSessionDetail).not.toHaveBeenCalled();

      await harness.render({ isSending: false });

      expect(refreshSessionDetail).toHaveBeenCalledTimes(1);
      expect(refreshSessionDetail).toHaveBeenCalledWith("session-1");
    } finally {
      harness.unmount();
    }
  });

  it("恢复队列工作时应轮询刷新当前会话详情", async () => {
    const refreshSessionDetail = vi.fn(async () => true);
    const harness = await mountHook({
      queuedTurnCount: 1,
      refreshSessionDetail,
    });

    try {
      expect(refreshSessionDetail).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(1500);
        await Promise.resolve();
      });

      expect(refreshSessionDetail).toHaveBeenCalledTimes(1);
      expect(refreshSessionDetail).toHaveBeenCalledWith("session-1");

      await harness.render({
        queuedTurnCount: 0,
        threadTurns: [createThreadTurn({ status: "running" })],
      });
      await act(async () => {
        vi.advanceTimersByTime(1500);
        await Promise.resolve();
      });

      expect(refreshSessionDetail).toHaveBeenCalledTimes(2);
    } finally {
      harness.unmount();
    }
  });

  it("仅 thread_read 标记为 running 时也应继续轮询刷新", async () => {
    const refreshSessionDetail = vi.fn(async () => true);
    const harness = await mountHook({
      threadReadStatus: "running",
      refreshSessionDetail,
    });

    try {
      expect(refreshSessionDetail).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(1500);
        await Promise.resolve();
      });

      expect(refreshSessionDetail).toHaveBeenCalledTimes(1);
      expect(refreshSessionDetail).toHaveBeenCalledWith("session-1");
    } finally {
      harness.unmount();
    }
  });

  it("收到 subagent 状态事件后应刷新当前会话详情", async () => {
    const refreshSessionDetail = vi.fn(async () => true);
    const listeners = new Map<string, (event: { payload: unknown }) => void>();
    const runtime = {
      listenToTeamEvents: vi.fn(async (eventName, handler) => {
        listeners.set(
          eventName,
          handler as (event: { payload: unknown }) => void,
        );
        return () => {
          listeners.delete(eventName);
        };
      }),
    };
    const harness = await mountHook({
      runtime,
      parentSessionId: "parent-1",
      refreshSessionDetail,
    });

    try {
      expect(runtime.listenToTeamEvents).toHaveBeenCalledTimes(2);
      expect(listeners.has("agent_subagent_status:session-1")).toBe(true);
      expect(listeners.has("agent_subagent_status:parent-1")).toBe(true);

      await act(async () => {
        listeners.get("agent_subagent_status:parent-1")?.({
          payload: {
            type: "subagent_status_changed",
            session_id: "child-1",
            root_session_id: "session-1",
            status: "running",
          },
        });
        await Promise.resolve();
      });

      expect(refreshSessionDetail).toHaveBeenCalledTimes(1);
      expect(refreshSessionDetail).toHaveBeenCalledWith("session-1");
    } finally {
      harness.unmount();
    }
  });

  it("浏览器 DevBridge 发送中但无原生事件能力时，应轮询刷新当前会话详情", async () => {
    mockIsDevBridgeAvailable.mockReturnValue(true);
    mockHasTauriEventListenerCapability.mockReturnValue(false);
    mockHasDevBridgeEventListenerCapability.mockReturnValue(false);

    const refreshSessionDetail = vi.fn(async () => true);
    const harness = await mountHook({
      isSending: true,
      refreshSessionDetail,
    });

    try {
      expect(refreshSessionDetail).toHaveBeenCalledTimes(1);
      expect(refreshSessionDetail).toHaveBeenLastCalledWith("session-1");

      await act(async () => {
        vi.advanceTimersByTime(1000);
        await Promise.resolve();
      });

      expect(refreshSessionDetail).toHaveBeenCalledTimes(2);

      await harness.render({ isSending: false });
      await act(async () => {
        vi.advanceTimersByTime(1000);
        await Promise.resolve();
      });

      expect(refreshSessionDetail).toHaveBeenCalledTimes(3);
    } finally {
      harness.unmount();
    }
  });

  it("浏览器 DevBridge 已接通事件桥时，不应再轮询刷新当前会话详情", async () => {
    mockIsDevBridgeAvailable.mockReturnValue(true);
    mockHasTauriEventListenerCapability.mockReturnValue(false);
    mockHasDevBridgeEventListenerCapability.mockReturnValue(true);

    const refreshSessionDetail = vi.fn(async () => true);
    const harness = await mountHook({
      isSending: true,
      refreshSessionDetail,
    });

    try {
      expect(refreshSessionDetail).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(2000);
        await Promise.resolve();
      });

      expect(refreshSessionDetail).not.toHaveBeenCalled();

      await harness.render({ isSending: false });

      expect(refreshSessionDetail).toHaveBeenCalledTimes(1);
      expect(refreshSessionDetail).toHaveBeenCalledWith("session-1");
    } finally {
      harness.unmount();
    }
  });
});
