import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Topic } from "../hooks/agentChatShared";
import type { TaskCenterWorkspaceTabMap } from "../utils/taskCenterTabs";
import { useTaskCenterTopicNavigationRuntime } from "./useTaskCenterTopicNavigationRuntime";

type Runtime = ReturnType<typeof useTaskCenterTopicNavigationRuntime>;

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function mountRuntime(
  overrides: {
    getComposerDraftNavigationEpoch?: () => number;
    onStartNewConversation?: import("@/lib/workspace/navigation").StartNewConversation;
    clearTaskCenterEmbeddedHomeSession?: (topicId: string) => void;
    setTaskCenterOpenTabMap?: Dispatch<
      SetStateAction<TaskCenterWorkspaceTabMap>
    >;
    switchTopic?: (topicId: string, options?: unknown) => Promise<unknown>;
    upsertTaskCenterOpenTab?: (
      topicId: string,
      workspaceIdOverride?: string | null,
    ) => void;
  } = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const runtimeRef: { current: Runtime | null } = { current: null };
  const topicById = new Map<string, Topic>([
    [
      "topic-next",
      {
        id: "topic-next",
        title: "历史会话",
        createdAt: new Date("2026-06-17T00:00:00.000Z"),
        updatedAt: new Date("2026-06-17T00:00:00.000Z"),
        workspaceId: "workspace-test",
        workingDir: null,
        messagesCount: 1,
        executionStrategy: "react",
        status: "done",
        lastPreview: "历史会话",
        hasUnread: false,
        tag: null,
        sourceSessionId: "topic-next",
      },
    ],
  ]);

  function Harness() {
    const activeSessionIdRef = useRef<string | null>("topic-current");
    const taskCenterHomeSurfaceActiveRef = useRef(true);
    const taskCenterOpenTabIdsRef = useRef(["topic-current"]);
    const [, setTaskCenterDetachedTopicId] = useState<string | null>(null);
    const [, setTaskCenterLocalSessionOverride] = useState<{
      sessionId: string;
      routeSessionId: string | null;
    } | null>(null);
    const [, setTaskCenterOpenTabMapState] =
      useState<TaskCenterWorkspaceTabMap>({});
    const setTaskCenterOpenTabMap =
      overrides.setTaskCenterOpenTabMap ?? setTaskCenterOpenTabMapState;
    const [, setTaskCenterTransitionTopicId] = useState<string | null>(null);

    runtimeRef.current = useTaskCenterTopicNavigationRuntime({
      activeSessionIdRef,
      onStartNewConversation: overrides.onStartNewConversation,
      getComposerDraftNavigationEpoch:
        overrides.getComposerDraftNavigationEpoch,
      agentEntry: "conversation",
      clearEntryPendingA2UI: vi.fn(),
      clearTaskCenterEmbeddedHomeSession:
        overrides.clearTaskCenterEmbeddedHomeSession ?? vi.fn(),
      messagesLength: 0,
      replaceTaskCenterOpenTabs: vi.fn(),
      resetLocalImageWorkbenchSessionScope: vi.fn(),
      sessionId: "topic-current",
      setTaskCenterDetachedTopicId,
      setTaskCenterLocalSessionOverride,
      setTaskCenterOpenTabMap,
      setTaskCenterTransitionTopicId,
      switchTopic:
        overrides.switchTopic ?? vi.fn(async () => "success" as const),
      taskCenterDetachedTopicId: null,
      taskCenterHomeSurfaceActiveRef,
      taskCenterOpenTabIdsRef,
      taskCenterTransitionTopicId: null,
      taskCenterWorkspaceId: "workspace-test",
      topicById,
      upsertTaskCenterOpenTab: overrides.upsertTaskCenterOpenTab ?? vi.fn(),
      markTaskCenterLocalSessionOverride: vi.fn(),
    });
    return null;
  }

  act(() => {
    root.render(<Harness />);
  });
  mountedRoots.push({ root, container });

  if (!runtimeRef.current) {
    throw new Error("runtime did not mount");
  }
  return runtimeRef.current;
}

afterEach(() => {
  vi.useRealTimers();
  mountedRoots.splice(0).forEach(({ root, container }) => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });
  vi.unstubAllGlobals();
});

describe("useTaskCenterTopicNavigationRuntime", () => {
  it("打开已有任务会话时应清理 embedded home 标记", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const clearTaskCenterEmbeddedHomeSession = vi.fn();
    const switchTopic = vi.fn(async () => "success" as const);
    const runtime = mountRuntime({
      clearTaskCenterEmbeddedHomeSession,
      switchTopic,
    });

    await act(async () => {
      await runtime.handleOpenTaskTopic("topic-next");
    });

    expect(clearTaskCenterEmbeddedHomeSession).toHaveBeenCalledWith(
      "topic-next",
    );
    expect(switchTopic).toHaveBeenCalledWith("topic-next", undefined, {
      onHydrated: expect.any(Function),
    });
  });

  it("switchTopic 成功返回 undefined 时不应回滚已打开会话", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const switchTopic = vi.fn(async () => undefined);
    const upsertTaskCenterOpenTab = vi.fn();
    const setTaskCenterOpenTabMap = vi.fn();
    const runtime = mountRuntime({
      switchTopic,
      upsertTaskCenterOpenTab,
      setTaskCenterOpenTabMap,
    });

    await act(async () => {
      await runtime.handleOpenTaskTopic("topic-next");
    });

    expect(switchTopic).toHaveBeenCalledWith("topic-next", undefined, {
      onHydrated: expect.any(Function),
    });
    expect(upsertTaskCenterOpenTab).toHaveBeenCalledWith(
      "topic-next",
      "workspace-test",
    );
    expect(setTaskCenterOpenTabMap).not.toHaveBeenCalled();
  });

  it("迟到普通 switch 成功不能清理新 Home 的 presentation", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let epoch = 0;
    let resolve!: (value: string) => void;
    const clearTaskCenterEmbeddedHomeSession = vi.fn();
    const upsertTaskCenterOpenTab = vi.fn();
    const runtime = mountRuntime({
      getComposerDraftNavigationEpoch: () => epoch,
      clearTaskCenterEmbeddedHomeSession,
      upsertTaskCenterOpenTab,
      switchTopic: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    let pending!: Promise<unknown>;
    act(() => {
      pending = runtime.handleOpenTaskTopic("topic-next");
    });
    epoch += 1;
    await act(async () => {
      resolve("success");
      await pending;
    });
    expect(await pending).toBe("superseded");
    expect(clearTaskCenterEmbeddedHomeSession).not.toHaveBeenCalled();
    expect(upsertTaskCenterOpenTab).toHaveBeenCalledTimes(1);
  });

  it("迟到失败不能回滚后来提交的 Home", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let epoch = 0;
    let reject!: (error: Error) => void;
    const setTaskCenterOpenTabMap = vi.fn();
    const runtime = mountRuntime({
      getComposerDraftNavigationEpoch: () => epoch,
      setTaskCenterOpenTabMap,
      switchTopic: () =>
        new Promise((_done, fail) => {
          reject = fail;
        }),
    });
    let pending!: Promise<unknown>;
    act(() => {
      pending = runtime.handleOpenTaskTopic("topic-next");
    });
    const observed = pending.catch((error: Error) => error.message);
    epoch += 1;
    await act(async () => {
      reject(new Error("late failure"));
      await observed;
    });
    expect(await observed).toBe("late failure");
    expect(setTaskCenterOpenTabMap).not.toHaveBeenCalled();
  });

  it("busy 会话切换只在重试成功后提交 canonical presentation", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    const switchTopic = vi
      .fn()
      .mockResolvedValueOnce("busy")
      .mockResolvedValueOnce("success");
    const clearTaskCenterEmbeddedHomeSession = vi.fn();
    const setTaskCenterOpenTabMap = vi.fn();
    const runtime = mountRuntime({
      switchTopic,
      clearTaskCenterEmbeddedHomeSession,
      setTaskCenterOpenTabMap,
    });
    await act(async () => {
      expect(await runtime.handleOpenTaskTopic("topic-next")).toBe("busy");
    });
    expect(clearTaskCenterEmbeddedHomeSession).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    expect(switchTopic).toHaveBeenCalledTimes(2);
    expect(clearTaskCenterEmbeddedHomeSession).toHaveBeenCalledExactlyOnceWith(
      "topic-next",
    );
    expect(setTaskCenterOpenTabMap).not.toHaveBeenCalled();
  });

  it("新 Home 在 busy 定时器触发前提交时不会重开旧会话", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    let epoch = 0;
    const switchTopic = vi.fn(async () => "busy");
    const clearTaskCenterEmbeddedHomeSession = vi.fn();
    const runtime = mountRuntime({
      switchTopic,
      clearTaskCenterEmbeddedHomeSession,
      getComposerDraftNavigationEpoch: () => epoch,
    });
    await act(async () => {
      await runtime.handleOpenTaskTopic("topic-next");
    });
    epoch += 1;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    expect(switchTopic).toHaveBeenCalledTimes(1);
    expect(clearTaskCenterEmbeddedHomeSession).not.toHaveBeenCalled();
  });

  it.each(["success", "error", "rejection"])(
    "busy 重试在途后新 Home 不能被迟到 %s 改写或回滚",
    async (outcome) => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      vi.useFakeTimers();
      let epoch = 0;
      let finish!: () => void;
      const switchTopic = vi
        .fn()
        .mockResolvedValueOnce("busy")
        .mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              finish = () =>
                outcome === "rejection"
                  ? reject(new Error("late retry"))
                  : resolve(outcome);
            }),
        );
      const clearTaskCenterEmbeddedHomeSession = vi.fn();
      const setTaskCenterOpenTabMap = vi.fn();
      const runtime = mountRuntime({
        switchTopic,
        clearTaskCenterEmbeddedHomeSession,
        setTaskCenterOpenTabMap,
        getComposerDraftNavigationEpoch: () => epoch,
      });
      await act(async () => {
        await runtime.handleOpenTaskTopic("topic-next");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120);
      });
      expect(switchTopic).toHaveBeenCalledTimes(2);
      epoch += 1;
      await act(async () => {
        finish();
        await Promise.resolve();
      });
      expect(clearTaskCenterEmbeddedHomeSession).not.toHaveBeenCalled();
      expect(setTaskCenterOpenTabMap).not.toHaveBeenCalled();
    },
  );

  it("关闭最后的 canonical 会话只发公开 Home(false) intent", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const onStartNewConversation = vi.fn();
    const runtime = mountRuntime({ onStartNewConversation });
    await act(async () => {
      await runtime.handleCloseTaskCenterTab("topic-current");
    });
    expect(onStartNewConversation).toHaveBeenCalledExactlyOnceWith({
      projectId: "workspace-test",
      freshDraft: false,
    });
  });
});
