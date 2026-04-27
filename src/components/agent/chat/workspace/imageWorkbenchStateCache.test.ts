import { beforeEach, describe, expect, it } from "vitest";
import {
  createInitialSessionImageWorkbenchState,
  type SessionImageWorkbenchState,
} from "./imageWorkbenchHelpers";
import {
  buildSessionImageWorkbenchStateFromMessages,
  isSessionImageWorkbenchStateMeaningful,
  loadSessionImageWorkbenchCachedState,
  saveSessionImageWorkbenchCachedState,
} from "./imageWorkbenchStateCache";
import type { Message } from "../types";

function createImageWorkbenchState(
  taskId: string,
  createdAt: number,
): SessionImageWorkbenchState {
  return {
    ...createInitialSessionImageWorkbenchState(),
    tasks: [
      {
        sessionId: taskId,
        id: taskId,
        mode: "generate",
        status: "complete",
        prompt: `三国人物插画 ${taskId}`,
        rawText: `@配图 生成 三国人物插画 ${taskId}`,
        expectedCount: 1,
        outputIds: [`${taskId}:output:1`],
        createdAt,
        hookImageIds: [`${taskId}:hook:1`],
        applyTarget: null,
        taskFilePath: `.lime/tasks/image_generate/${taskId}.json`,
        artifactPath: `.lime/tasks/image_generate/${taskId}.json`,
      },
    ],
    outputs: [
      {
        id: `${taskId}:output:1`,
        taskId,
        hookImageId: `${taskId}:hook:1`,
        refId: `img-${taskId}`,
        url: `https://example.com/${taskId}.png`,
        prompt: `三国人物插画 ${taskId}`,
        createdAt,
        size: "1024x1024",
        parentOutputId: null,
        resourceSaved: false,
        applyTarget: null,
      },
    ],
    selectedOutputId: `${taskId}:output:1`,
  };
}

describe("imageWorkbenchStateCache", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("应保存并恢复同标签页图片工作台 tail 状态", () => {
    const nowMs = Date.parse("2026-04-24T00:00:00.000Z");
    const state = createImageWorkbenchState("task-image-cache-1", nowMs);

    saveSessionImageWorkbenchCachedState("ws-image-cache", "session-image", state, {
      nowMs,
      contentId: "content-1",
    });

    const restored = loadSessionImageWorkbenchCachedState(
      "ws-image-cache",
      "session-image",
      {
        nowMs: nowMs + 1000,
        contentId: "content-1",
      },
    );

    expect(restored).not.toBeNull();
    expect(restored?.cacheMetadata.storageKind).toBe("transient");
    expect(restored?.state.tasks[0]?.id).toBe("task-image-cache-1");
    expect(restored?.state.outputs[0]?.url).toBe(
      "https://example.com/task-image-cache-1.png",
    );
  });

  it("同标签页缓存丢失后应回退到持久化图片工作台状态", () => {
    const nowMs = Date.parse("2026-04-24T00:00:00.000Z");
    const state = createImageWorkbenchState("task-image-persisted-1", nowMs);

    saveSessionImageWorkbenchCachedState(
      "ws-image-persisted",
      "session-image",
      state,
      { nowMs },
    );
    sessionStorage.clear();

    const restored = loadSessionImageWorkbenchCachedState(
      "ws-image-persisted",
      "session-image",
      { nowMs: nowMs + 1000 },
    );

    expect(restored).not.toBeNull();
    expect(restored?.cacheMetadata.storageKind).toBe("persisted");
    expect(restored?.state.tasks[0]?.id).toBe("task-image-persisted-1");
  });

  it("超过 TTL 但仍在 grace 内时应作为 stale 返回", () => {
    const nowMs = Date.parse("2026-04-24T00:00:00.000Z");
    const state = createImageWorkbenchState("task-image-stale-1", nowMs);

    saveSessionImageWorkbenchCachedState("ws-image-stale", "session-image", state, {
      nowMs,
    });

    const restored = loadSessionImageWorkbenchCachedState(
      "ws-image-stale",
      "session-image",
      { nowMs: nowMs + 10 * 60 * 1000 + 1 },
    );

    expect(restored).not.toBeNull();
    expect(restored?.cacheMetadata.freshness).toBe("stale");
  });

  it("超过 TTL 和 grace 后应被懒清理", () => {
    const nowMs = Date.parse("2026-04-24T00:00:00.000Z");
    const state = createImageWorkbenchState("task-image-expired-1", nowMs);

    saveSessionImageWorkbenchCachedState(
      "ws-image-expired",
      "session-image",
      state,
      { nowMs },
    );

    const restored = loadSessionImageWorkbenchCachedState(
      "ws-image-expired",
      "session-image",
      { nowMs: nowMs + 32 * 60 * 1000 + 1 },
    );
    const snapshotMap = JSON.parse(
      sessionStorage.getItem("image_workbench_states_ws-image-expired") || "{}",
    ) as Record<string, unknown>;

    expect(restored).toBeNull();
    expect(snapshotMap["session-image"]).toBeUndefined();
  });

  it("应按 LRU 裁剪 transient 与 persisted 条目", () => {
    const nowMs = Date.parse("2026-04-24T00:00:00.000Z");

    for (let index = 0; index < 13; index += 1) {
      saveSessionImageWorkbenchCachedState(
        "ws-image-lru",
        `session-${index}`,
        createImageWorkbenchState(`task-${index}`, nowMs + index),
        { nowMs: nowMs + index },
      );
    }

    const transientMap = JSON.parse(
      sessionStorage.getItem("image_workbench_states_ws-image-lru") || "{}",
    ) as Record<string, unknown>;
    const persistedMap = JSON.parse(
      localStorage.getItem("image_workbench_states_persisted_ws-image-lru") ||
        "{}",
    ) as Record<string, unknown>;

    expect(Object.keys(transientMap)).toHaveLength(12);
    expect(transientMap["session-0"]).toBeUndefined();
    expect(Object.keys(persistedMap)).toHaveLength(8);
    expect(persistedMap["session-4"]).toBeUndefined();
    expect(persistedMap["session-12"]).toBeDefined();
  });

  it("空工作台状态不应写入缓存", () => {
    saveSessionImageWorkbenchCachedState(
      "ws-image-empty",
      "session-empty",
      createInitialSessionImageWorkbenchState(),
    );

    expect(
      isSessionImageWorkbenchStateMeaningful(
        loadSessionImageWorkbenchCachedState("ws-image-empty", "session-empty")
          ?.state,
      ),
    ).toBe(false);
  });

  it("纯读缓存未命中时不应创建空 storage 条目", () => {
    const restored = loadSessionImageWorkbenchCachedState(
      "ws-image-readonly-miss",
      "session-missing",
      { refreshAccess: false },
    );

    expect(restored).toBeNull();
    expect(
      sessionStorage.getItem("image_workbench_states_ws-image-readonly-miss"),
    ).toBeNull();
    expect(
      localStorage.getItem(
        "image_workbench_states_persisted_ws-image-readonly-miss",
      ),
    ).toBeNull();
  });

  it("纯读缓存命中时不应同步刷新 LRU", () => {
    const nowMs = Date.parse("2026-04-24T00:00:00.000Z");
    const state = createImageWorkbenchState("task-image-readonly-1", nowMs);

    saveSessionImageWorkbenchCachedState(
      "ws-image-readonly-hit",
      "session-image",
      state,
      { nowMs },
    );

    const restored = loadSessionImageWorkbenchCachedState(
      "ws-image-readonly-hit",
      "session-image",
      { nowMs: nowMs + 1000, refreshAccess: false },
    );
    const snapshotMap = JSON.parse(
      sessionStorage.getItem("image_workbench_states_ws-image-readonly-hit") ||
        "{}",
    ) as Record<string, { lastAccessedAt?: number }>;

    expect(restored?.cacheMetadata.lastAccessedAt).toBe(nowMs);
    expect(snapshotMap["session-image"]?.lastAccessedAt).toBe(nowMs);
  });

  it("应能从历史消息里的图片预览反推轻量工作台状态", () => {
    const message: Message = {
      id: "assistant-image-preview-1",
      role: "assistant",
      content: "图片任务已提交，正在同步任务状态。",
      timestamp: new Date("2026-04-24T00:00:00.000Z"),
      imageWorkbenchPreview: {
        taskId: "task-image-message-preview-1",
        prompt: "三国人物九宫格",
        mode: "generate",
        status: "running",
        imageUrl: null,
        previewImages: [],
        expectedImageCount: 9,
        layoutHint: "storyboard_3x3",
        taskFilePath:
          ".lime/tasks/image_generate/task-image-message-preview-1.json",
      },
    };

    const state = buildSessionImageWorkbenchStateFromMessages([message]);

    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]).toEqual(
      expect.objectContaining({
        id: "task-image-message-preview-1",
        status: "running",
        expectedCount: 9,
        layoutHint: "storyboard_3x3",
      }),
    );
    expect(isSessionImageWorkbenchStateMeaningful(state)).toBe(true);
  });
});
