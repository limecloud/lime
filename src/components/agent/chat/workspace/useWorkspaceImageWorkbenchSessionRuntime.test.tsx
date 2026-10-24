import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../types";
import {
  createInitialSessionImageWorkbenchState,
  type SessionImageWorkbenchState,
} from "./imageWorkbenchHelpers";
import {
  loadSessionImageWorkbenchCachedState,
  saveSessionImageWorkbenchCachedState,
} from "./imageWorkbenchStateCache";
import {
  useWorkspaceImageWorkbenchSessionRuntime,
  type WorkspaceImageWorkbenchSessionRuntimeState,
} from "./useWorkspaceImageWorkbenchSessionRuntime";

vi.mock("@/lib/utils/scheduleMinimumDelayIdleTask", () => ({
  scheduleMinimumDelayIdleTask: (task: () => void) => {
    task();
    return () => undefined;
  },
}));

type HookProps = Parameters<typeof useWorkspaceImageWorkbenchSessionRuntime>[0];

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];

function createImageWorkbenchState(
  taskId: string,
  createdAt = Date.parse("2026-06-18T00:00:00.000Z"),
): SessionImageWorkbenchState {
  return {
    ...createInitialSessionImageWorkbenchState(),
    active: true,
    tasks: [
      {
        sessionId: taskId,
        id: taskId,
        mode: "generate",
        status: "complete",
        prompt: `生成图片 ${taskId}`,
        rawText: `@配图 生成图片 ${taskId}`,
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
        prompt: `生成图片 ${taskId}`,
        createdAt,
        size: "1024x1024",
        parentOutputId: null,
        applyTarget: null,
      },
    ],
    selectedTaskId: taskId,
    selectedOutputId: `${taskId}:output:1`,
    nextOutputIndex: 2,
  };
}

function createImagePreviewMessage(taskId: string): Message {
  return {
    id: `message-${taskId}`,
    role: "assistant",
    content: "图片任务完成",
    timestamp: new Date("2026-06-18T00:00:00.000Z"),
    imageWorkbenchPreview: {
      taskId,
      mode: "generate",
      status: "complete",
      prompt: `生成图片 ${taskId}`,
      expectedImageCount: 1,
      imageUrl: `https://example.com/${taskId}.png`,
      size: "1024x1024",
      taskFilePath: `.lime/tasks/image_generate/${taskId}.json`,
      artifactPath: `.lime/tasks/image_generate/${taskId}.json`,
    },
  };
}

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latestValue: WorkspaceImageWorkbenchSessionRuntimeState | null = null;

  const defaultProps: HookProps = {
    contentId: "content-1",
    messages: [],
    projectId: "project-1",
    sessionId: null,
  };

  function Probe(currentProps: HookProps) {
    latestValue = useWorkspaceImageWorkbenchSessionRuntime(currentProps);
    return null;
  }

  const render = async (nextProps?: Partial<HookProps>) => {
    await act(async () => {
      root.render(<Probe {...defaultProps} {...props} {...nextProps} />);
      await Promise.resolve();
    });
  };

  mountedRoots.push({ container, root });

  return {
    render,
    getValue: () => {
      if (!latestValue) {
        throw new Error("hook 尚未初始化");
      }
      return latestValue;
    },
  };
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
  localStorage.clear();
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
  sessionStorage.clear();
  localStorage.clear();
});

describe("useWorkspaceImageWorkbenchSessionRuntime", () => {
  it("无真实 sessionId 时应使用本地 session key 并维护当前状态", async () => {
    const { render, getValue } = renderHook();

    await render();
    const localSessionKey = getValue().imageWorkbenchSessionKey;

    expect(localSessionKey).toMatch(/^__local_image_workbench__:/);
    expect(getValue().currentImageWorkbenchState.tasks).toHaveLength(0);

    act(() => {
      getValue().updateCurrentImageWorkbenchState(() =>
        createImageWorkbenchState("task-local"),
      );
    });

    expect(getValue().imageWorkbenchSessionKey).toBe(localSessionKey);
    expect(getValue().currentImageWorkbenchState.tasks[0]?.id).toBe(
      "task-local",
    );
  });

  it("有真实 sessionId 时应使用真实 session key 并写回缓存", async () => {
    const { render, getValue } = renderHook({
      sessionId: " session-real ",
    });

    await render();

    expect(getValue().imageWorkbenchSessionKey).toBe("session-real");

    act(() => {
      getValue().updateCurrentImageWorkbenchState(() =>
        createImageWorkbenchState("task-real"),
      );
    });
    await render();

    const cached = loadSessionImageWorkbenchCachedState(
      "project-1",
      "session-real",
      { contentId: "content-1", refreshAccess: false },
    );
    expect(cached?.state.tasks[0]?.id).toBe("task-real");
  });

  it("reset 本地 session scope 应切换 key 并清理旧本地状态", async () => {
    const { render, getValue } = renderHook();

    await render();
    const previousLocalSessionKey = getValue().imageWorkbenchSessionKey;
    act(() => {
      getValue().updateCurrentImageWorkbenchState(() =>
        createImageWorkbenchState("task-before-reset"),
      );
    });

    act(() => {
      getValue().resetLocalImageWorkbenchSessionScope();
    });

    expect(getValue().imageWorkbenchSessionKey).not.toBe(
      previousLocalSessionKey,
    );
    expect(getValue().imageWorkbenchSessionKey).toMatch(
      /^__local_image_workbench__:/,
    );
    expect(getValue().currentImageWorkbenchState.tasks).toHaveLength(0);
  });

  it("本地状态迁移到真实 sessionId 后应保留图片工作台状态", async () => {
    const { render, getValue } = renderHook();

    await render();
    const localSessionKey = getValue().imageWorkbenchSessionKey;
    act(() => {
      getValue().updateCurrentImageWorkbenchState(() =>
        createImageWorkbenchState("task-migrated"),
      );
    });

    await render({
      sessionId: "session-after-create",
    });

    expect(getValue().imageWorkbenchSessionKey).toBe("session-after-create");
    expect(getValue().currentImageWorkbenchState.tasks[0]?.id).toBe(
      "task-migrated",
    );

    await render({
      sessionId: null,
    });

    expect(getValue().imageWorkbenchSessionKey).toBe(localSessionKey);
    expect(getValue().currentImageWorkbenchState.tasks).toHaveLength(0);
  });

  it("应从缓存恢复状态，空内存状态保存时回退 messages 中的图片预览", async () => {
    saveSessionImageWorkbenchCachedState(
      "project-1",
      "session-cached",
      createImageWorkbenchState("task-cached"),
      { contentId: "content-1" },
    );

    const { render, getValue } = renderHook({
      messages: [createImagePreviewMessage("task-message")],
      sessionId: "session-cached",
    });

    await render();

    expect(getValue().currentImageWorkbenchState.tasks[0]?.id).toBe(
      "task-cached",
    );

    await render({
      sessionId: "session-message-cache",
    });

    const cached = loadSessionImageWorkbenchCachedState(
      "project-1",
      "session-message-cache",
      { contentId: "content-1", refreshAccess: false },
    );
    expect(cached?.state.tasks[0]?.id).toBe("task-message");
  });
});
