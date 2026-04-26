import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../types";

const { mockLogAgentDebug } = vi.hoisted(() => ({
  mockLogAgentDebug: vi.fn(),
}));

vi.mock("@/lib/agentDebug", () => ({
  logAgentDebug: mockLogAgentDebug,
}));

import { useAgentTopicSnapshot } from "./useAgentTopicSnapshot";

type HookProps = Parameters<typeof useAgentTopicSnapshot>[0];

interface HookHarness {
  render: (nextProps?: Partial<HookProps>) => Promise<void>;
  unmount: () => void;
}

const mountedRoots: Array<{
  container: HTMLDivElement;
  root: ReturnType<typeof createRoot>;
}> = [];

function createMessage(overrides?: Partial<Message>): Message {
  return {
    id: "msg-1",
    role: "assistant",
    content: "已完成当前整理。",
    timestamp: new Date("2026-03-29T00:00:00.000Z"),
    ...overrides,
  };
}

async function mountHook(props?: Partial<HookProps>): Promise<HookHarness> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultProps: HookProps = {
    sessionId: "session-1",
    hasActiveTopic: true,
    suppressInactiveTopicWarning: false,
    messages: [createMessage()],
    isSending: false,
    pendingActionCount: 0,
    queuedTurnCount: 0,
    threadStatus: null,
    workspaceId: "ws-1",
    workspacePathMissing: false,
    topicsCount: 1,
    updateTopicSnapshot: vi.fn(),
  };

  function TestComponent(currentProps: HookProps) {
    useAgentTopicSnapshot(currentProps);
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

describe("useAgentTopicSnapshot", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
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
    mockLogAgentDebug.mockClear();
    vi.useRealTimers();
  });

  it("存在活动话题时应推送 live snapshot", async () => {
    const updateTopicSnapshot = vi.fn();
    const harness = await mountHook({
      updateTopicSnapshot,
    });

    try {
      expect(updateTopicSnapshot).toHaveBeenCalledTimes(1);
      expect(updateTopicSnapshot).toHaveBeenCalledWith(
        "session-1",
        expect.objectContaining({
          messagesCount: 1,
          status: "done",
          lastPreview: "已完成当前整理。",
        }),
      );
    } finally {
      harness.unmount();
    }
  });

  it("相同 snapshot 重渲染时应跳过重复更新", async () => {
    const updateTopicSnapshot = vi.fn();
    const harness = await mountHook({
      updateTopicSnapshot,
    });

    try {
      expect(updateTopicSnapshot).toHaveBeenCalledTimes(1);

      await harness.render({
        messages: [createMessage()],
      });

      expect(updateTopicSnapshot).toHaveBeenCalledTimes(1);
    } finally {
      harness.unmount();
    }
  });

  it("失去活动话题后应重置去重键，并在恢复后重新更新", async () => {
    const updateTopicSnapshot = vi.fn();
    const harness = await mountHook({
      updateTopicSnapshot,
    });

    try {
      expect(updateTopicSnapshot).toHaveBeenCalledTimes(1);

      await harness.render({
        hasActiveTopic: false,
      });
      expect(updateTopicSnapshot).toHaveBeenCalledTimes(1);

      await harness.render({
        hasActiveTopic: true,
        messages: [createMessage()],
      });

      expect(updateTopicSnapshot).toHaveBeenCalledTimes(2);
    } finally {
      harness.unmount();
    }
  });

  it("发送中仅正文预览变化时，应节流合并 topic snapshot 更新", async () => {
    const updateTopicSnapshot = vi.fn();
    const harness = await mountHook({
      updateTopicSnapshot,
      isSending: true,
    });

    try {
      expect(updateTopicSnapshot).toHaveBeenCalledTimes(1);

      await harness.render({
        isSending: true,
        messages: [
          createMessage({
            content: "已完成当前整理，并继续补充更多背景。",
          }),
        ],
      });
      await harness.render({
        isSending: true,
        messages: [
          createMessage({
            content: "已完成当前整理，并继续补充更多背景与结论。",
          }),
        ],
      });

      expect(updateTopicSnapshot).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(650);
      });

      expect(updateTopicSnapshot).toHaveBeenCalledTimes(2);
      expect(updateTopicSnapshot).toHaveBeenLastCalledWith(
        "session-1",
        expect.objectContaining({
          lastPreview: "已完成当前整理，并继续补充更多背景与结论。",
          status: "running",
        }),
      );
    } finally {
      harness.unmount();
    }
  });

  it("线程仍在运行时，应维持 running snapshot", async () => {
    const updateTopicSnapshot = vi.fn();
    const harness = await mountHook({
      updateTopicSnapshot,
      isSending: false,
      threadStatus: "running",
      messages: [
        createMessage({
          content: "",
          toolCalls: [
            {
              id: "tool-1",
              name: "WebSearch",
              arguments: '{"query":"AI agent trends"}',
              status: "running",
              startTime: new Date("2026-04-22T10:59:16.000Z"),
            },
          ],
        }),
      ],
    });

    try {
      expect(updateTopicSnapshot).toHaveBeenCalledWith(
        "session-1",
        expect.objectContaining({
          status: "running",
        }),
      );
    } finally {
      harness.unmount();
    }
  });

  it("detached 会话缺少活动话题时不应继续输出 warning", async () => {
    const updateTopicSnapshot = vi.fn();
    const harness = await mountHook({
      hasActiveTopic: false,
      suppressInactiveTopicWarning: true,
      topicsCount: 8,
      updateTopicSnapshot,
    });

    try {
      expect(updateTopicSnapshot).not.toHaveBeenCalled();
      expect(mockLogAgentDebug).not.toHaveBeenCalled();
    } finally {
      harness.unmount();
    }
  });
});
