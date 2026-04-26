import { describe, expect, it } from "vitest";
import type { Topic } from "../hooks/agentChatShared";
import {
  areTaskCenterTabIdsEqual,
  buildDefaultTaskCenterTabIds,
  isTaskCenterTopicSwitchPending,
  normalizeTaskCenterWorkspaceTabMap,
  reconcileTaskCenterTabIds,
  replaceTaskCenterTabIdsForWorkspace,
  resolveTaskCenterFallbackTopicId,
  shouldHideTaskCenterTabsForDetachedSession,
  resolveTaskCenterPreviewTopicId,
  resolveTaskCenterVisibleTabIds,
  resolveTaskCenterTabIdsForWorkspace,
  shouldResumeTaskSession,
  updateTaskCenterTabIdsForWorkspace,
} from "./taskCenterTabs";

function createTopic(
  id: string,
  overrides?: Partial<Topic>,
): Topic {
  return {
    id,
    title: id,
    createdAt: new Date("2026-04-20T00:00:00.000Z"),
    updatedAt: new Date("2026-04-20T00:00:00.000Z"),
    messagesCount: 1,
    executionStrategy: "auto",
    status: "done",
    statusReason: "default",
    lastPreview: `${id} preview`,
    isPinned: false,
    hasUnread: false,
    sourceSessionId: id,
    ...overrides,
  };
}

describe("taskCenterTabs", () => {
  it("应优先把当前任务、固定任务与待继续任务放入默认标签", () => {
    const topics = [
      createTopic("done-recent", {
        updatedAt: new Date("2026-04-20T03:00:00.000Z"),
      }),
      createTopic("waiting", {
        status: "waiting",
        statusReason: "user_action",
        updatedAt: new Date("2026-04-20T02:00:00.000Z"),
      }),
      createTopic("pinned", {
        isPinned: true,
        updatedAt: new Date("2026-04-20T01:00:00.000Z"),
      }),
      createTopic("current", {
        status: "running",
        updatedAt: new Date("2026-04-20T04:00:00.000Z"),
      }),
    ];

    expect(buildDefaultTaskCenterTabIds(topics, "current")).toEqual([
      "current",
      "pinned",
      "waiting",
      "done-recent",
    ]);
  });

  it("reconcile 应过滤失效 id 并把当前任务前置", () => {
    const topics = [
      createTopic("topic-a"),
      createTopic("topic-b", { status: "running" }),
      createTopic("topic-c"),
    ];

    expect(
      reconcileTaskCenterTabIds({
        existingIds: ["topic-a", "missing", "topic-c"],
        topics,
        currentTopicId: "topic-b",
      }),
    ).toEqual(["topic-b", "topic-a", "topic-c"]);
  });

  it("reconcile 在没有历史标签时应回退到默认标签", () => {
    const topics = [
      createTopic("topic-a", { status: "waiting" }),
      createTopic("topic-b"),
    ];

    expect(
      reconcileTaskCenterTabIds({
        existingIds: [],
        topics,
        currentTopicId: null,
      }),
    ).toEqual(["topic-a", "topic-b"]);
  });

  it("应按 workspace 读取和更新标签列表", () => {
    const currentMap = {
      "workspace-a": ["topic-a", "topic-b"],
      "workspace-b": ["topic-c"],
    };

    expect(
      resolveTaskCenterTabIdsForWorkspace(currentMap, "workspace-a"),
    ).toEqual(["topic-a", "topic-b"]);

    expect(
      updateTaskCenterTabIdsForWorkspace(
        currentMap,
        "workspace-a",
        (currentIds) => ["topic-d", ...currentIds],
      ),
    ).toEqual({
      "workspace-a": ["topic-d", "topic-a", "topic-b"],
      "workspace-b": ["topic-c"],
    });
  });

  it("导航栏打开单个任务时，应覆盖当前 workspace 的旧多标签状态", () => {
    const currentMap = {
      "workspace-a": ["topic-a", "topic-b", "topic-c"],
      "workspace-b": ["topic-d"],
    };

    expect(
      replaceTaskCenterTabIdsForWorkspace(
        currentMap,
        "workspace-a",
        "topic-selected",
      ),
    ).toEqual({
      "workspace-a": ["topic-selected"],
      "workspace-b": ["topic-d"],
    });
  });

  it("应兼容旧的全局数组存储并迁移到当前 workspace", () => {
    expect(
      normalizeTaskCenterWorkspaceTabMap(
        ["topic-a", "title-gen-1", "topic-b"],
        {
          workspaceId: "workspace-a",
        },
      ),
    ).toEqual({
      "workspace-a": ["topic-a", "topic-b"],
    });

    expect(
      updateTaskCenterTabIdsForWorkspace(
        {
          __legacy__: ["topic-a", "topic-b"],
        },
        "workspace-b",
        (currentIds) => currentIds,
      ),
    ).toEqual({
      "workspace-b": ["topic-a", "topic-b"],
    });
  });

  it("应正确识别需要恢复 start hooks 的任务", () => {
    expect(
      shouldResumeTaskSession({
        status: "waiting",
        statusReason: "user_action",
      }),
    ).toBe(true);
    expect(
      shouldResumeTaskSession({
        status: "failed",
        statusReason: "workspace_error",
      }),
    ).toBe(true);
    expect(
      shouldResumeTaskSession({
        status: "done",
        statusReason: "default",
      }),
    ).toBe(false);
  });

  it("应正确比较标签 id 列表是否一致", () => {
    expect(areTaskCenterTabIdsEqual(["a", "b"], ["a", "b"])).toBe(true);
    expect(areTaskCenterTabIdsEqual(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("打开不在 open tabs 中的归档对话时，顶部只应展示当前对话", () => {
    const topics = [
      createTopic("topic-open-a"),
      createTopic("topic-open-b"),
      createTopic("topic-archived-preview", {
        updatedAt: new Date("2026-04-10T00:00:00.000Z"),
      }),
    ];

    expect(
      resolveTaskCenterVisibleTabIds({
        openTabIds: ["topic-open-a", "topic-open-b"],
        topics,
        currentTopicId: "topic-archived-preview",
      }),
    ).toEqual(["topic-archived-preview"]);
  });

  it("当前对话已在 open tabs 中时，应继续展示原有任务标签", () => {
    const topics = [
      createTopic("topic-open-a"),
      createTopic("topic-open-b"),
      createTopic("title-gen-1"),
    ];

    expect(
      resolveTaskCenterVisibleTabIds({
        openTabIds: ["topic-open-a", "title-gen-1", "topic-open-b"],
        topics,
        currentTopicId: "topic-open-b",
      }),
    ).toEqual(["topic-open-a", "topic-open-b"]);
  });

  it("当前会话不在任务列表时，只应在没有切换中任务时恢复 fallback", () => {
    const topics = [createTopic("topic-open-a"), createTopic("topic-open-b")];

    expect(
      resolveTaskCenterFallbackTopicId({
        sessionId: null,
        switchingTopicId: null,
        openTabIds: ["topic-open-a", "topic-open-b"],
        topics,
      }),
    ).toBe("topic-open-a");

    expect(
      resolveTaskCenterFallbackTopicId({
        sessionId: null,
        switchingTopicId: "topic-open-a",
        openTabIds: ["topic-open-a", "topic-open-b"],
        topics,
      }),
    ).toBeNull();
  });

  it("当前会话已在任务列表中时，不应触发 fallback 恢复", () => {
    const topics = [createTopic("topic-open-a"), createTopic("topic-open-b")];

    expect(
      resolveTaskCenterFallbackTopicId({
        sessionId: "topic-open-b",
        switchingTopicId: null,
        openTabIds: ["topic-open-a", "topic-open-b"],
        topics,
      }),
    ).toBeNull();
  });

  it("辅助运行时会话不应进入任务中心标签", () => {
    const topics = [
      createTopic("topic-open-a"),
      createTopic("title-gen-1"),
      createTopic("persona-gen-1"),
      createTopic("topic-open-b"),
    ];

    expect(
      reconcileTaskCenterTabIds({
        existingIds: ["topic-open-a", "title-gen-1", "persona-gen-1"],
        topics,
        currentTopicId: "persona-gen-1",
      }),
    ).toEqual(["topic-open-a"]);
  });

  it("切换归档会话时，应立即把目标会话作为预览焦点", () => {
    expect(
      resolveTaskCenterPreviewTopicId({
        sessionId: "topic-open-a",
        detachedTopicId: "topic-archived",
        switchingTopicId: "topic-archived",
      }),
    ).toBe("topic-archived");
  });

  it("归档会话完成切换后，应继续保持 detached 会话焦点", () => {
    expect(
      resolveTaskCenterPreviewTopicId({
        sessionId: "topic-archived",
        detachedTopicId: "topic-archived",
        switchingTopicId: null,
      }),
    ).toBe("topic-archived");
  });

  it("切换中的目标会话尚未成为当前会话时，应标记为待恢复态", () => {
    expect(
      isTaskCenterTopicSwitchPending({
        sessionId: "topic-open-a",
        switchingTopicId: "topic-archived",
      }),
    ).toBe(true);

    expect(
      isTaskCenterTopicSwitchPending({
        sessionId: "topic-archived",
        switchingTopicId: "topic-archived",
      }),
    ).toBe(false);
  });

  it("detached 会话处于当前预览时，应隐藏顶部任务标签", () => {
    expect(
      shouldHideTaskCenterTabsForDetachedSession({
        sessionId: "topic-archived",
        detachedTopicId: "topic-archived",
        openTabIds: ["topic-open-a", "topic-open-b"],
      }),
    ).toBe(true);
  });

  it("从导航栏直达且不在 open tabs 中的会话，应隐藏顶部任务标签", () => {
    expect(
      shouldHideTaskCenterTabsForDetachedSession({
        sessionId: "topic-archived",
        initialSessionId: "topic-archived",
        openTabIds: ["topic-open-a", "topic-open-b"],
      }),
    ).toBe(true);
  });

  it("当前会话已进入 open tabs 时，不应隐藏顶部任务标签", () => {
    expect(
      shouldHideTaskCenterTabsForDetachedSession({
        sessionId: "topic-open-b",
        initialSessionId: "topic-open-b",
        openTabIds: ["topic-open-a", "topic-open-b"],
      }),
    ).toBe(false);
  });
});
