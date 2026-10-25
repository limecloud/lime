import { acceptedSubmission } from "../hooks/agentSendResult.testFixtures";
import type { RuntimeSubmissionResult } from "../hooks/agentSendResult";
import { createElement, useEffect, useRef, useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { recordAgentUiPerformanceMetric } from "@/lib/agentUiPerformanceMetrics";
import type { TaskCenterDraftSendRequest } from "../homePendingPreview";
import {
  useTaskCenterHomePendingPreviewRuntime,
  useTaskCenterDraftSendDispatchRuntime,
  useTaskCenterEmptyStateSendRuntime,
} from "./useTaskCenterDraftSendRuntime";

vi.mock("@/lib/agentUiPerformanceMetrics", () => ({
  recordAgentUiPerformanceMetric: vi.fn(),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];
type DraftSendRuntimeHandle = {
  restoreInput: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
};
type HomePendingPreviewSnapshot = ReturnType<
  typeof useTaskCenterHomePendingPreviewRuntime
>;

function createDraftSendRequest(
  overrides: Partial<TaskCenterDraftSendRequest> = {},
): TaskCenterDraftSendRequest {
  return {
    id: "draft-send-test",
    sessionId: null,
    text: "真实 E2E 目标",
    images: [],
    submittedAt: Date.now(),
    source: "empty-state",
    ...overrides,
  };
}

function mountDraftSendRuntime({
  displayMessagesLength,
  messagesLength = 0,
  currentSessionId,
  request = createDraftSendRequest(),
  sendResult = acceptedSubmission(),
  onSnapshot,
  onSessionAccepted,
  rerenderAfterMount = false,
}: {
  displayMessagesLength: number;
  messagesLength?: number;
  currentSessionId?: string | null;
  request?: TaskCenterDraftSendRequest | null;
  sendResult?: RuntimeSubmissionResult;
  rerenderAfterMount?: boolean;
  onSessionAccepted?: (sessionId: string) => void;
  onSnapshot: (snapshot: {
    taskCenterDraftSendRequest: TaskCenterDraftSendRequest | null;
    homePendingPreviewRequest: TaskCenterDraftSendRequest | null;
  }) => void;
}): DraftSendRuntimeHandle {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const restoreInput = vi.fn();
  const send = vi.fn(async () => sendResult);

  function Harness() {
    const [renderTick, setRenderTick] = useState(0);
    const [taskCenterDraftSendRequest, setTaskCenterDraftSendRequest] =
      useState<TaskCenterDraftSendRequest | null>(request);
    const [homePendingPreviewRequest, setHomePendingPreviewRequest] =
      useState<TaskCenterDraftSendRequest | null>(request);
    const sendRef = useRef(send);

    useEffect(() => {
      if (rerenderAfterMount && renderTick === 0) {
        setRenderTick(1);
      }
    }, [renderTick]);

    useTaskCenterDraftSendDispatchRuntime({
      taskCenterDraftSendRequest,
      setTaskCenterDraftSendRequest,
      setHomePendingPreviewRequest,
      messagesLength,
      displayMessagesLength,
      currentSessionId,
      onSessionAccepted,
      restoreInput,
      sendRef,
      workspaceId: rerenderAfterMount
        ? `workspace-test-${renderTick}`
        : "workspace-test",
    });

    useEffect(() => {
      onSnapshot({
        taskCenterDraftSendRequest,
        homePendingPreviewRequest,
      });
    }, [homePendingPreviewRequest, taskCenterDraftSendRequest]);

    return null;
  }

  act(() => {
    root.render(createElement(Harness));
  });
  mountedRoots.push({ root, container });

  return {
    restoreInput,
    send,
  };
}

function mountHomePendingPreviewRuntime({
  request,
  displayMessagesLength,
  onSnapshot,
}: {
  request: TaskCenterDraftSendRequest | null;
  displayMessagesLength: number;
  onSnapshot: (snapshot: HomePendingPreviewSnapshot) => void;
}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  function Harness() {
    const snapshot = useTaskCenterHomePendingPreviewRuntime({
      homePendingPreviewRequest: request,
      displayMessagesLength,
      executionStrategy: "react",
      workspaceId: "workspace-test",
    });

    useEffect(() => {
      onSnapshot(snapshot);
    }, [snapshot]);

    return null;
  }

  act(() => {
    root.render(createElement(Harness));
  });
  mountedRoots.push({ root, container });
}

function mountEmptyStateSendRuntime({
  activeSessionId = null,
  activeSessionIdAfterSend,
  agentEntry = "conversation",
  displayMessagesLength = 0,
  turnsLength = 0,
  threadItemsLength = 0,
  hasDisplayMessages = false,
  input = "默认输入",
  sessionId = null,
  sendResult = acceptedSubmission(),
  taskCenterDraftSendRequest = null,
  onSessionAccepted = vi.fn(),
}: {
  activeSessionId?: string | null;
  activeSessionIdAfterSend?: string | null;
  agentEntry?: string;
  displayMessagesLength?: number;
  turnsLength?: number;
  threadItemsLength?: number;
  hasDisplayMessages?: boolean;
  input?: string;
  sessionId?: string | null;
  sendResult?: RuntimeSubmissionResult;
  taskCenterDraftSendRequest?: TaskCenterDraftSendRequest | null;
  onSessionAccepted?: ReturnType<typeof vi.fn>;
} = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const setInput = vi.fn();
  const clearMessages = vi.fn();
  const activeSessionIdRef = { current: activeSessionId };
  const handleSend = vi.fn(async () => {
    if (activeSessionIdAfterSend !== undefined) {
      activeSessionIdRef.current = activeSessionIdAfterSend;
    }
    return sendResult.kind === "runtime-accepted" && activeSessionIdAfterSend
      ? acceptedSubmission(activeSessionIdAfterSend)
      : sendResult;
  });
  const setTaskCenterDraftSendRequest = vi.fn();
  const setHomePendingPreviewRequest = vi.fn();
  let sendHandler: ReturnType<
    typeof useTaskCenterEmptyStateSendRuntime
  > | null = null;

  function Harness() {
    sendHandler = useTaskCenterEmptyStateSendRuntime({
      agentEntry,
      input,
      setInput,
      activeSessionIdRef,
      clearMessages,
      displayMessagesLength,
      turnsLength,
      threadItemsLength,
      hasDisplayMessages,
      handleSend,
      sessionId,
      taskCenterWorkspaceId: "workspace-test",
      setTaskCenterDraftSendRequest,
      taskCenterDraftSendRequest,
      setHomePendingPreviewRequest,
      onSessionAccepted,
    });
    return null;
  }

  act(() => {
    root.render(createElement(Harness));
  });
  mountedRoots.push({ root, container });

  return {
    clearMessages,
    handleSend,
    onSessionAccepted,
    setHomePendingPreviewRequest,
    setInput,
    setTaskCenterDraftSendRequest,
    send: (payload?: Parameters<NonNullable<typeof sendHandler>>[0]) => {
      if (!sendHandler) {
        throw new Error("send handler 尚未初始化");
      }
      return sendHandler(payload);
    },
  };
}

afterEach(() => {
  mountedRoots.splice(0).forEach(({ root, container }) => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });
  vi.clearAllMocks();
});

async function flushAfterNextPaint() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      if (
        typeof window !== "undefined" &&
        typeof window.requestAnimationFrame === "function"
      ) {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => resolve());
        });
        return;
      }
      window.setTimeout(resolve, 0);
    });
    await Promise.resolve();
  });
}

describe("useTaskCenterHomePendingPreviewRuntime", () => {
  it("真实会话未 ready 前即使存在临时消息投影也应保留 pending preview", () => {
    const snapshots: HomePendingPreviewSnapshot[] = [];
    const request = createDraftSendRequest({
      sessionId: null,
      sessionReady: false,
      text: "你好",
    });

    mountHomePendingPreviewRuntime({
      request,
      displayMessagesLength: 1,
      onSnapshot: (snapshot) => snapshots.push(snapshot),
    });

    expect(snapshots.at(-1)?.isHomePendingPreviewActive).toBe(true);
    expect(snapshots.at(-1)?.homePendingPreviewMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "你好" }),
        expect.objectContaining({ role: "assistant", isThinking: true }),
      ]),
    );
  });

  it("真实会话消息接管后应退出 pending preview", () => {
    const snapshots: HomePendingPreviewSnapshot[] = [];
    const request = createDraftSendRequest({
      sessionId: "sess-ready-with-message",
      sessionReady: true,
      text: "你好",
    });

    mountHomePendingPreviewRuntime({
      request,
      displayMessagesLength: 1,
      onSnapshot: (snapshot) => snapshots.push(snapshot),
    });

    expect(snapshots.at(-1)?.isHomePendingPreviewActive).toBe(false);
    expect(snapshots.at(-1)?.homePendingPreviewMessages).toEqual([]);
  });

  it("真实会话 ready 但消息尚未投影时仍应保留 pending preview", () => {
    const snapshots: HomePendingPreviewSnapshot[] = [];
    const request = createDraftSendRequest({
      sessionId: "sess-ready-before-message",
      sessionReady: true,
      text: "整理今天的国际新闻",
    });

    mountHomePendingPreviewRuntime({
      request,
      displayMessagesLength: 0,
      onSnapshot: (snapshot) => snapshots.push(snapshot),
    });

    expect(snapshots.at(-1)?.isHomePendingPreviewActive).toBe(true);
    expect(snapshots.at(-1)?.homePendingPreviewMessages[0]).toMatchObject({
      role: "user",
      content: "整理今天的国际新闻",
    });
  });
});

describe("useTaskCenterDraftSendDispatchRuntime", () => {
  it("仅临时展示投影出现时不应清理首页首发 pending preview", async () => {
    const onSessionAccepted = vi.fn();
    const snapshots: Array<{
      taskCenterDraftSendRequest: TaskCenterDraftSendRequest | null;
      homePendingPreviewRequest: TaskCenterDraftSendRequest | null;
    }> = [];
    const request = createDraftSendRequest({
      sessionId: "sess_ready",
    });

    await act(async () => {
      mountDraftSendRuntime({
        displayMessagesLength: 1,
        messagesLength: 0,
        request,
        onSessionAccepted,
        onSnapshot: (snapshot) => {
          snapshots.push(snapshot);
        },
      });
      await Promise.resolve();
    });
    await flushAfterNextPaint();

    const latest = snapshots.at(-1);
    expect(latest?.taskCenterDraftSendRequest).toBeNull();
    expect(latest?.homePendingPreviewRequest).toMatchObject({
      id: request.id,
      sessionId: "sess_ready",
      sessionReady: true,
    });
    expect(onSessionAccepted).toHaveBeenCalledWith("sess_ready", request);
  });

  it("真实会话已有消息时应清理 draft surface 请求", async () => {
    const onSessionAccepted = vi.fn();
    const snapshots: Array<{
      taskCenterDraftSendRequest: TaskCenterDraftSendRequest | null;
      homePendingPreviewRequest: TaskCenterDraftSendRequest | null;
    }> = [];

    await act(async () => {
      mountDraftSendRuntime({
        displayMessagesLength: 0,
        messagesLength: 1,
        request: createDraftSendRequest({
          sessionId: "sess_real_message",
        }),
        onSessionAccepted,
        onSnapshot: (snapshot) => {
          snapshots.push(snapshot);
        },
      });
      await Promise.resolve();
    });

    const latest = snapshots.at(-1);
    expect(latest?.taskCenterDraftSendRequest).toBeNull();
    expect(latest?.homePendingPreviewRequest).toBeNull();
    expect(onSessionAccepted).toHaveBeenCalledWith(
      "sess_real_message",
      expect.objectContaining({ sessionId: "sess_real_message" }),
    );
  });

  it("临时 draft-send id 没有真实 session 时应等待后续真实 session", async () => {
    const onSessionAccepted = vi.fn();
    const snapshots: Array<{
      taskCenterDraftSendRequest: TaskCenterDraftSendRequest | null;
      homePendingPreviewRequest: TaskCenterDraftSendRequest | null;
    }> = [];

    await act(async () => {
      mountDraftSendRuntime({
        displayMessagesLength: 1,
        messagesLength: 0,
        request: createDraftSendRequest({
          sessionId: null,
        }),
        onSessionAccepted,
        onSnapshot: (snapshot) => {
          snapshots.push(snapshot);
        },
      });
      await Promise.resolve();
    });

    expect(onSessionAccepted).not.toHaveBeenCalled();
    expect(snapshots.at(-1)?.taskCenterDraftSendRequest?.sessionId).toBeNull();
  });

  it("临时 draft-send id 不能借用当前活跃 session 推导接受身份", async () => {
    const onSessionAccepted = vi.fn();

    await act(async () => {
      mountDraftSendRuntime({
        displayMessagesLength: 1,
        messagesLength: 0,
        currentSessionId: "sess_ready_from_state",
        request: createDraftSendRequest({
          sessionId: null,
        }),
        onSessionAccepted,
        onSnapshot: () => {},
      });
      await Promise.resolve();
    });

    expect(onSessionAccepted).not.toHaveBeenCalled();
  });

  it("direct-dispatch 首发应由发起者完成 session 交接", async () => {
    const onSessionAccepted = vi.fn();
    const snapshots: Array<{
      taskCenterDraftSendRequest: TaskCenterDraftSendRequest | null;
      homePendingPreviewRequest: TaskCenterDraftSendRequest | null;
    }> = [];
    const request = createDraftSendRequest({
      sessionId: null,
      dispatchState: "dispatched",
      source: "empty-state",
      text: "@配图 画一张深圳夏天的图",
    });

    mountDraftSendRuntime({
      displayMessagesLength: 0,
      messagesLength: 0,
      currentSessionId: "sess_live_ready",
      request,
      onSessionAccepted,
      onSnapshot: (snapshot) => {
        snapshots.push(snapshot);
      },
    });

    await vi.waitFor(() => {
      const latest = snapshots.at(-1);
      expect(latest?.taskCenterDraftSendRequest).toMatchObject({
        id: request.id,
        sessionId: null,
        dispatchState: "dispatched",
      });
      expect(latest?.homePendingPreviewRequest).toMatchObject({
        id: request.id,
        sessionId: null,
        dispatchState: "dispatched",
      });
    });
    expect(onSessionAccepted).not.toHaveBeenCalled();
  });

  it("direct-dispatch 首条消息出现时也不得提前清理 pending owner", async () => {
    const onSessionAccepted = vi.fn();
    const request = createDraftSendRequest({
      sessionId: null,
      dispatchState: "dispatched",
      source: "task-center-empty-state",
    });
    const snapshots: Array<{
      taskCenterDraftSendRequest: TaskCenterDraftSendRequest | null;
      homePendingPreviewRequest: TaskCenterDraftSendRequest | null;
    }> = [];

    mountDraftSendRuntime({
      currentSessionId: "sess_live_message",
      displayMessagesLength: 2,
      messagesLength: 2,
      request,
      onSessionAccepted,
      onSnapshot: (snapshot) => snapshots.push(snapshot),
    });

    await vi.waitFor(() => {
      expect(snapshots.at(-1)?.taskCenterDraftSendRequest).toEqual(request);
      expect(snapshots.at(-1)?.homePendingPreviewRequest).toEqual(request);
    });
    expect(onSessionAccepted).not.toHaveBeenCalled();
  });

  it("首页首发发送返回 false 时应清理 pending preview", async () => {
    const snapshots: Array<{
      taskCenterDraftSendRequest: TaskCenterDraftSendRequest | null;
      homePendingPreviewRequest: TaskCenterDraftSendRequest | null;
    }> = [];

    const runtime = mountDraftSendRuntime({
      displayMessagesLength: 0,
      messagesLength: 0,
      sendResult: { kind: "rejected" },
      request: createDraftSendRequest({
        sessionId: "sess-image-no-project",
        text: "参考图生成一张小红书封面",
      }),
      onSnapshot: (snapshot) => {
        snapshots.push(snapshot);
      },
    });

    await flushAfterNextPaint();

    await vi.waitFor(() => {
      const latest = snapshots.at(-1);
      expect(latest?.taskCenterDraftSendRequest).toBeNull();
      expect(latest?.homePendingPreviewRequest).toBeNull();
    });
    expect(runtime.restoreInput).toHaveBeenCalledWith(
      "参考图生成一张小红书封面",
    );
  });
});

describe("useTaskCenterEmptyStateSendRuntime", () => {
  it("已有首页首发 pending 请求时应拒绝重复发送", async () => {
    const runtime = mountEmptyStateSendRuntime({
      taskCenterDraftSendRequest: createDraftSendRequest({
        sessionId: "draft-a",
      }),
    });

    let result: unknown;
    act(() => {
      result = runtime.send({
        textOverride: "重复点击不应再次发送",
      });
    });

    expect(await result).toMatchObject({ kind: "rejected" });
    expect(runtime.setInput).not.toHaveBeenCalled();
    expect(runtime.setTaskCenterDraftSendRequest).not.toHaveBeenCalled();
    expect(runtime.setHomePendingPreviewRequest).not.toHaveBeenCalled();
    expect(runtime.handleSend).not.toHaveBeenCalled();
  });

  it("React 状态提交前的连续触发也应只创建一次首页首发请求", async () => {
    const runtime = mountEmptyStateSendRuntime({});

    let secondResult: unknown;
    act(() => {
      runtime.send({
        textOverride: "生成一版项目复盘",
      });
      secondResult = runtime.send({
        textOverride: "生成一版项目复盘",
      });
    });

    const secondCompletion = secondResult;
    expect(runtime.setTaskCenterDraftSendRequest).toHaveBeenCalledTimes(1);
    expect(runtime.setHomePendingPreviewRequest).toHaveBeenCalledTimes(1);
    expect(await secondCompletion).toMatchObject({ kind: "rejected" });
    await flushAfterNextPaint();
    expect(runtime.handleSend).toHaveBeenCalledTimes(1);
  });

  it("Task Center 首页无会话内容且没有 session 时应直接派发普通发送并保留 pending preview", async () => {
    const runtime = mountEmptyStateSendRuntime({
      hasDisplayMessages: false,
      sessionId: null,
    });

    act(() => {
      runtime.send({ textOverride: "继续拆分 workspace" });
    });

    expect(runtime.setTaskCenterDraftSendRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^draft-send-/),
        dispatchState: "dispatched",
        source: "empty-state",
        text: "继续拆分 workspace",
      }),
    );
    expect(runtime.setHomePendingPreviewRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^draft-send-/),
        dispatchState: "dispatched",
        source: "empty-state",
        text: "继续拆分 workspace",
      }),
    );
    expect(runtime.setInput).toHaveBeenCalledWith("");
    expect(runtime.setInput.mock.invocationCallOrder[0]).toBeLessThan(
      runtime.setTaskCenterDraftSendRequest.mock.invocationCallOrder[0],
    );
    expect(runtime.handleSend).not.toHaveBeenCalled();

    await flushAfterNextPaint();

    expect(runtime.handleSend).toHaveBeenCalledWith(
      [],
      undefined,
      undefined,
      "继续拆分 workspace",
      undefined,
      undefined,
      expect.objectContaining({
        skipSessionRestore: true,
        skipSessionStartHooks: true,
        skipWorkspaceCommandRouting: true,
        requestMetadata: expect.objectContaining({
          agentUiPerformanceTrace: expect.objectContaining({
            sessionId: null,
            source: "empty-state",
            workspaceId: "workspace-test",
          }),
        }),
      }),
    );
    expect(recordAgentUiPerformanceMetric).not.toHaveBeenCalledWith(
      "homeInput.pendingShellApplied",
      expect.anything(),
    );
    const initialTrackingRequest =
      runtime.setTaskCenterDraftSendRequest.mock.calls[0]?.[0];
    const clearTrackingRequest = runtime.setTaskCenterDraftSendRequest.mock
      .calls[1]?.[0] as
      | ((
          current: TaskCenterDraftSendRequest | null,
        ) => TaskCenterDraftSendRequest | null)
      | undefined;
    expect(
      clearTrackingRequest?.(
        initialTrackingRequest as TaskCenterDraftSendRequest,
      ),
    ).toBeNull();
    expect(runtime.setHomePendingPreviewRequest).toHaveBeenCalledTimes(2);
  });

  it("首页 direct dispatch 在同步 preview 提交后的 microtask 中启动，不等待下一帧", async () => {
    const runtime = mountEmptyStateSendRuntime({
      hasDisplayMessages: false,
      sessionId: null,
    });

    act(() => {
      runtime.send({ textOverride: "立即派发" });
    });

    expect(runtime.handleSend).not.toHaveBeenCalled();
    await act(async () => {
      await Promise.resolve();
    });

    expect(runtime.handleSend).toHaveBeenCalledTimes(1);
  });

  it("Task Center 首页首发成功后拿到真实 session 时应立即接管前台会话", async () => {
    const onSessionAccepted = vi.fn();
    const runtime = mountEmptyStateSendRuntime({
      activeSessionIdAfterSend: "sess_ready_after_direct_send",
      hasDisplayMessages: false,
      onSessionAccepted,
      sessionId: null,
    });

    act(() => {
      runtime.send({ textOverride: "你好" });
    });
    await flushAfterNextPaint();

    expect(onSessionAccepted).toHaveBeenCalledWith(
      "sess_ready_after_direct_send",
      expect.objectContaining({}),
    );
    const bindHomePreview =
      runtime.setHomePendingPreviewRequest.mock.calls.find(
        ([arg]) => typeof arg === "function",
      )?.[0] as
        | ((
            current: TaskCenterDraftSendRequest | null,
          ) => TaskCenterDraftSendRequest | null)
        | undefined;
    const initialPreview =
      runtime.setHomePendingPreviewRequest.mock.calls[0]?.[0];
    expect(
      bindHomePreview?.(initialPreview as TaskCenterDraftSendRequest),
    ).toMatchObject({
      sessionId: "sess_ready_after_direct_send",
      sessionReady: true,
      text: "你好",
    });
  });

  it("Task Center 首页已有 session 时应直接进入普通发送流并保留 pending preview", async () => {
    const runtime = mountEmptyStateSendRuntime({
      hasDisplayMessages: false,
      sessionId: "sess_existing",
    });

    act(() => {
      runtime.send({ textOverride: "继续拆分 workspace" });
    });

    expect(runtime.setTaskCenterDraftSendRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess_existing",
        dispatchState: "dispatched",
        source: "empty-state",
        text: "继续拆分 workspace",
      }),
    );
    expect(runtime.setHomePendingPreviewRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess_existing",
        dispatchState: "dispatched",
        source: "empty-state",
        text: "继续拆分 workspace",
      }),
    );
    expect(runtime.setInput).toHaveBeenCalledWith("");
    expect(runtime.setInput.mock.invocationCallOrder[0]).toBeLessThan(
      runtime.setTaskCenterDraftSendRequest.mock.invocationCallOrder[0],
    );
    expect(runtime.handleSend).not.toHaveBeenCalled();

    await flushAfterNextPaint();

    expect(runtime.handleSend).toHaveBeenCalledWith(
      [],
      undefined,
      undefined,
      "继续拆分 workspace",
      undefined,
      undefined,
      expect.objectContaining({
        skipSessionRestore: true,
        skipSessionStartHooks: true,
        skipWorkspaceCommandRouting: true,
        requestMetadata: expect.objectContaining({
          agentUiPerformanceTrace: expect.objectContaining({
            sessionId: "sess_existing",
            source: "empty-state",
            workspaceId: "workspace-test",
          }),
        }),
      }),
    );
    expect(recordAgentUiPerformanceMetric).toHaveBeenCalledWith(
      "homeInput.sendDispatch.done",
      expect.objectContaining({
        result: "runtime-accepted",
        sessionId: "sess_existing",
        source: "empty-state",
        workspaceId: "workspace-test",
      }),
    );
    const initialTrackingRequest =
      runtime.setTaskCenterDraftSendRequest.mock.calls[0]?.[0];
    const clearTrackingRequest = runtime.setTaskCenterDraftSendRequest.mock
      .calls[1]?.[0] as
      | ((
          current: TaskCenterDraftSendRequest | null,
        ) => TaskCenterDraftSendRequest | null)
      | undefined;
    expect(
      clearTrackingRequest?.(
        initialTrackingRequest as TaskCenterDraftSendRequest,
      ),
    ).toBeNull();
    expect(runtime.setHomePendingPreviewRequest).toHaveBeenCalledTimes(1);
  });

  it("Task Center 首页已有 session 普通发送派发失败时应恢复输入并清理 pending preview", async () => {
    const runtime = mountEmptyStateSendRuntime({
      hasDisplayMessages: false,
      input: "失败后保留文本",
      sendResult: { kind: "rejected" },
      sessionId: "sess_existing",
    });

    act(() => {
      runtime.send();
    });
    await flushAfterNextPaint();

    const initialPreview =
      runtime.setHomePendingPreviewRequest.mock.calls[0]?.[0];
    const clearPreview = runtime.setHomePendingPreviewRequest.mock
      .calls[1]?.[0] as
      | ((
          current: TaskCenterDraftSendRequest | null,
        ) => TaskCenterDraftSendRequest | null)
      | undefined;
    const initialTrackingRequest =
      runtime.setTaskCenterDraftSendRequest.mock.calls[0]?.[0];
    const clearTrackingRequest = runtime.setTaskCenterDraftSendRequest.mock
      .calls[1]?.[0] as
      | ((
          current: TaskCenterDraftSendRequest | null,
        ) => TaskCenterDraftSendRequest | null)
      | undefined;

    expect(runtime.setInput).toHaveBeenLastCalledWith("失败后保留文本");
    expect(
      clearTrackingRequest?.(
        initialTrackingRequest as TaskCenterDraftSendRequest,
      ),
    ).toBeNull();
    expect(
      clearPreview?.(initialPreview as TaskCenterDraftSendRequest),
    ).toBeNull();
  });

  it("非 Task Center 首屏发送应直接回落到 handleSend", () => {
    const runtime = mountEmptyStateSendRuntime({
      agentEntry: "agent",
      hasDisplayMessages: true,
      sessionId: "session-a",
    });
    const image = {
      data: "data:image/png;base64,AA==",
      mediaType: "image/png",
    };
    const sendOptions = { displayContent: "展示文本" };

    act(() => {
      runtime.send({
        images: [image],
        textOverride: "普通发送",
        sendOptions,
      });
    });

    expect(runtime.setTaskCenterDraftSendRequest).not.toHaveBeenCalled();
    expect(runtime.setHomePendingPreviewRequest).not.toHaveBeenCalled();
    expect(runtime.handleSend).toHaveBeenCalledWith(
      [image],
      undefined,
      undefined,
      "普通发送",
      undefined,
      undefined,
      expect.objectContaining(sendOptions),
    );
    expect(recordAgentUiPerformanceMetric).toHaveBeenCalledWith(
      "homeInput.submit",
      expect.objectContaining({
        inputLength: 4,
        sessionId: "session-a",
        source: "empty-state",
        workspaceId: "workspace-test",
      }),
    );
  });
});
