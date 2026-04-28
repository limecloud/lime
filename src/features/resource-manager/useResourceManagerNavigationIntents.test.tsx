import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RESOURCE_MANAGER_NAVIGATION_INTENT_CONSUMED_KEY,
  RESOURCE_MANAGER_NAVIGATION_INTENT_EVENT,
  RESOURCE_MANAGER_NAVIGATION_INTENT_KEY,
  type ResourceManagerNavigationIntent,
} from "./resourceManagerIntents";
import {
  focusMainWindowAfterResourceIntent,
  resolveResourceManagerNavigationDestination,
  useResourceManagerNavigationIntents,
} from "./useResourceManagerNavigationIntents";

const NOW = 1_777_400_000_000;

function createIntent(
  overrides: Partial<ResourceManagerNavigationIntent> = {},
): ResourceManagerNavigationIntent {
  return {
    id: "resource-intent-1",
    action: "open_project_resource",
    item: {
      id: "doc-1",
      kind: "markdown",
      title: "项目文稿",
    },
    sourceContext: {
      kind: "project_resource",
      projectId: "project-1",
      contentId: "doc-1",
      sourcePage: "resources",
      resourceFolderId: "folder-1",
      resourceCategory: "document",
    },
    createdAt: NOW,
    ...overrides,
  };
}

function Probe({
  onNavigate,
  onHandled = vi.fn(),
}: {
  onNavigate: ReturnType<typeof vi.fn>;
  onHandled?: ReturnType<typeof vi.fn>;
}) {
  useResourceManagerNavigationIntents({
    onNavigate,
    onHandled,
    now: () => NOW,
  });
  return null;
}

describe("useResourceManagerNavigationIntents", () => {
  let container: HTMLDivElement;
  let root: Root;
  let windowFocusSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    windowFocusSpy = vi.spyOn(window, "focus").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  async function renderProbe(onNavigate = vi.fn(), onHandled = vi.fn()) {
    await act(async () => {
      root.render(<Probe onNavigate={onNavigate} onHandled={onHandled} />);
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    return { onNavigate, onHandled };
  }

  it("应在主窗口启动时消费项目资料回跳 intent", async () => {
    const intent = createIntent();
    window.localStorage.setItem(
      RESOURCE_MANAGER_NAVIGATION_INTENT_KEY,
      JSON.stringify(intent),
    );

    const { onNavigate, onHandled } = await renderProbe();

    expect(onNavigate).toHaveBeenCalledWith(
      "resources",
      expect.objectContaining({
        projectId: "project-1",
        contentId: "doc-1",
        focusIntentId: "resource-intent-1",
        focusResourceTitle: "项目文稿",
        resourceFolderId: "folder-1",
        resourceCategory: "document",
      }),
    );
    expect(onHandled).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: expect.objectContaining({ id: "resource-intent-1" }),
      }),
    );
    expect(
      window.localStorage.getItem(RESOURCE_MANAGER_NAVIGATION_INTENT_CONSUMED_KEY),
    ).toBe("resource-intent-1");
  });

  it("应通过跨窗口 message 消费后续图片任务 intent", async () => {
    const { onNavigate } = await renderProbe();
    const intent = createIntent({
      id: "resource-intent-image-1",
      action: "continue_image_task",
      item: {
        id: "output-1",
        kind: "image",
        title: "封面图",
      },
      sourceContext: {
        kind: "image_task",
        projectId: "project-image-1",
        contentId: "content-image-1",
        taskId: "task-image-1",
        outputId: "output-1",
        threadId: "thread-image-1",
        sourcePage: "image-task-viewer",
      },
    });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: RESOURCE_MANAGER_NAVIGATION_INTENT_EVENT,
            payload: intent,
          },
        }),
      );
      await Promise.resolve();
    });

    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agentEntry: "claw",
        initialUserPrompt: expect.stringContaining("封面图"),
        projectId: "project-image-1",
        contentId: "content-image-1",
        initialSessionId: "thread-image-1",
        initialRequestMetadata: expect.objectContaining({
          resource_manager_intent: expect.objectContaining({
            action: "continue_image_task",
          }),
        }),
      }),
    );
    expect(windowFocusSpy).toHaveBeenCalledTimes(1);
  });

  it("不应重复消费已处理 intent", async () => {
    const { onNavigate } = await renderProbe();
    const intent = createIntent({ id: "resource-intent-repeat" });

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(RESOURCE_MANAGER_NAVIGATION_INTENT_EVENT, {
          detail: intent,
        }),
      );
      window.dispatchEvent(
        new CustomEvent(RESOURCE_MANAGER_NAVIGATION_INTENT_EVENT, {
          detail: intent,
        }),
      );
      await Promise.resolve();
    });

    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});

describe("resolveResourceManagerNavigationDestination", () => {
  it("应把 locate_chat 解析为 Agent 回跳", () => {
    const destination = resolveResourceManagerNavigationDestination(
      createIntent({
        action: "locate_chat",
        item: {
          id: "output-1",
          kind: "image",
          title: "任务图",
        },
        sourceContext: {
          kind: "image_task",
          taskId: "task-1",
          outputId: "output-1",
          threadId: "thread-1",
        },
      }),
    );

    expect(destination).toEqual(
      expect.objectContaining({
        page: "agent",
        params: expect.objectContaining({
          agentEntry: "claw",
          initialSessionId: "thread-1",
          entryBannerMessage: expect.stringContaining("任务图"),
        }),
      }),
    );
  });

  it("应优先用 Tauri 窗口 API 唤起主窗口", async () => {
    const show = vi.fn().mockResolvedValue(undefined);
    const unminimize = vi.fn().mockResolvedValue(undefined);
    const setFocus = vi.fn().mockResolvedValue(undefined);
    const browserFocus = vi.fn();

    await focusMainWindowAfterResourceIntent({
      currentWindow: {
        show,
        unminimize,
        setFocus,
      },
      browserWindow: {
        focus: browserFocus,
      },
    });

    expect(show).toHaveBeenCalledTimes(1);
    expect(unminimize).toHaveBeenCalledTimes(1);
    expect(setFocus).toHaveBeenCalledTimes(1);
    expect(browserFocus).not.toHaveBeenCalled();
  });
});
