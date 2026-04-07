import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentChatStateSnapshotDebug } from "./useAgentChatStateSnapshotDebug";

const mockLogAgentDebug = vi.hoisted(() => vi.fn());

vi.mock("@/lib/agentDebug", () => ({
  logAgentDebug: mockLogAgentDebug,
}));

type HookProps = Parameters<typeof useAgentChatStateSnapshotDebug>[0];

interface HookHarness {
  render: (nextProps?: Partial<HookProps>) => Promise<void>;
  unmount: () => void;
}

const mountedRoots: Array<{
  container: HTMLDivElement;
  root: ReturnType<typeof createRoot>;
}> = [];

async function mountHook(props?: Partial<HookProps>): Promise<HookHarness> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultProps: HookProps = {
    hasActiveTopic: true,
    isSending: false,
    messagesCount: 1,
    pendingActionsCount: 0,
    queuedTurnsCount: 0,
    sessionId: "session-1",
    threadTurnsCount: 1,
    topicsCount: 1,
    workspaceId: "ws-1",
    workspacePathMissing: null,
  };

  function TestComponent(currentProps: HookProps) {
    useAgentChatStateSnapshotDebug(currentProps);
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

describe("useAgentChatStateSnapshotDebug", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
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
    vi.clearAllMocks();
  });

  it("应记录当前聊天状态快照", async () => {
    const harness = await mountHook();

    try {
      expect(mockLogAgentDebug).toHaveBeenCalledTimes(1);
      expect(mockLogAgentDebug).toHaveBeenCalledWith(
        "useAgentChatStateSnapshotDebug",
        "stateSnapshot",
        expect.objectContaining({
          hasActiveTopic: true,
          isSending: false,
          messagesCount: 1,
          sessionId: "session-1",
        }),
        expect.objectContaining({
          throttleMs: 800,
        }),
      );
    } finally {
      harness.unmount();
    }
  });

  it("状态变化时应重新记录快照", async () => {
    const harness = await mountHook();

    try {
      expect(mockLogAgentDebug).toHaveBeenCalledTimes(1);

      await harness.render({
        isSending: true,
        queuedTurnsCount: 2,
      });

      expect(mockLogAgentDebug).toHaveBeenCalledTimes(2);
      expect(mockLogAgentDebug).toHaveBeenLastCalledWith(
        "useAgentChatStateSnapshotDebug",
        "stateSnapshot",
        expect.objectContaining({
          isSending: true,
          queuedTurnsCount: 2,
        }),
        expect.objectContaining({
          dedupeKey: expect.stringContaining('"queuedTurnsCount":2'),
        }),
      );
    } finally {
      harness.unmount();
    }
  });
});
