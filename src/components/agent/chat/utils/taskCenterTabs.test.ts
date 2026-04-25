import { describe, expect, it } from "vitest";
import type { Topic } from "../hooks/agentChatShared";
import {
  areTaskCenterTabIdsEqual,
  buildDefaultTaskCenterTabIds,
  normalizeTaskCenterWorkspaceTabMap,
  reconcileTaskCenterTabIds,
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

  it("应兼容旧的全局数组存储并迁移到当前 workspace", () => {
    expect(
      normalizeTaskCenterWorkspaceTabMap(["topic-a", "topic-b"], {
        workspaceId: "workspace-a",
      }),
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
});
