import React, { useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listDirectory,
  readFilePreview,
  type FilePreview,
} from "@/lib/api/fileBrowser";
import { safeListen } from "@/lib/dev-bridge";
import type { Message } from "../types";
import {
  createInitialSessionImageWorkbenchState,
  type SessionImageWorkbenchState,
} from "./imageWorkbenchHelpers";
import { useWorkspaceImageTaskPreviewRuntime } from "./useWorkspaceImageTaskPreviewRuntime";
import type { DirectoryListing } from "@/lib/api/fileBrowser";

vi.mock("@/lib/dev-bridge", () => ({
  safeListen: vi.fn(),
}));

vi.mock("@/lib/api/fileBrowser", () => ({
  listDirectory: vi.fn(),
  readFilePreview: vi.fn(),
}));

type HookProps = Parameters<typeof useWorkspaceImageTaskPreviewRuntime>[0];
type RuntimeHarnessProps = Omit<
  HookProps,
  "setChatMessages" | "updateCurrentImageWorkbenchState"
>;
type CreationTaskListener = Parameters<typeof safeListen>[1];

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];

function createDeferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createFilePreviewResult(
  path: string,
  content: Record<string, unknown>,
): FilePreview {
  const serialized = JSON.stringify(content);
  return {
    path,
    content: serialized,
    isBinary: false,
    size: serialized.length,
    error: null,
  };
}

function createDirectoryListingResult(
  path: string,
  entries: DirectoryListing["entries"],
): DirectoryListing {
  return {
    path,
    parentPath: null,
    entries,
    error: null,
  };
}

function renderHook(props?: Partial<RuntimeHarnessProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latestValue:
    | {
        messages: Message[];
        imageWorkbenchState: SessionImageWorkbenchState;
      }
    | null = null;

  const defaultProps: RuntimeHarnessProps = {
    sessionId: "session-image-1",
    projectId: "project-image-1",
    contentId: "content-image-1",
    projectRootPath: "/workspace/project-image-1",
    canvasState: null,
  };

  function Probe(currentProps: RuntimeHarnessProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [imageWorkbenchState, setImageWorkbenchState] =
      useState<SessionImageWorkbenchState>(
        createInitialSessionImageWorkbenchState(),
      );

    latestValue = {
      messages,
      imageWorkbenchState,
    };

    useWorkspaceImageTaskPreviewRuntime({
      ...currentProps,
      setChatMessages: setMessages,
      updateCurrentImageWorkbenchState: setImageWorkbenchState,
    });

    return null;
  }

  const render = async (nextProps?: Partial<RuntimeHarnessProps>) => {
    await act(async () => {
      root.render(<Probe {...defaultProps} {...props} {...nextProps} />);
      await Promise.resolve();
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

describe("useWorkspaceImageTaskPreviewRuntime", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(safeListen).mockResolvedValue(vi.fn());
    vi.mocked(listDirectory).mockResolvedValue(
      createDirectoryListingResult("/workspace/project-image-1/.lime/tasks", []),
    );
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

  it("应先插入运行中占位卡，再根据 task file 回填图片与工作台状态", async () => {
    let listener: CreationTaskListener | null = null;
    vi.mocked(safeListen).mockImplementationOnce(async (event, handler) => {
      expect(event).toBe("lime://creation_task_submitted");
      listener = handler;
      return vi.fn();
    });

    const taskPath =
      "/workspace/project-image-1/.lime/tasks/image/image_generate/task-image-1.json";
    const firstPreview = createDeferred<FilePreview>();
    vi.mocked(readFilePreview).mockImplementationOnce(() => firstPreview.promise);
    vi.mocked(readFilePreview).mockResolvedValueOnce(
      createFilePreviewResult(taskPath, {
        task_id: "task-image-1",
        task_type: "image_generate",
        task_family: "image",
        status: "completed",
        normalized_status: "succeeded",
        created_at: "2026-04-04T10:00:00Z",
        current_attempt_id: "attempt-1",
        payload: {
          prompt: "[img:未来感实验室里的青柠主视觉]",
          count: 1,
          size: "1024x1024",
        },
        result: {
          images: [{ url: "https://example.com/generated-lime.png" }],
        },
        attempts: [
          {
            attempt_id: "attempt-1",
            provider: "fal",
            model: "flux-pro",
            result_snapshot: {
              images: [{ url: "https://example.com/generated-lime.png" }],
            },
          },
        ],
      }),
    );

    const { render, getValue } = renderHook();
    await render();

    await act(async () => {
      listener?.({
        payload: {
          task_id: "task-image-1",
          task_type: "image_generate",
          task_family: "image",
          status: "pending_submit",
          path: ".lime/tasks/image/image_generate/task-image-1.json",
        },
      });
      await Promise.resolve();
    });

    expect(readFilePreview).toHaveBeenCalledWith(taskPath, 256 * 1024);
    expect(getValue().messages).toEqual([
      expect.objectContaining({
        id: "image-workbench:task-image-1:assistant",
        content: "图片任务已创建，正在准备执行。",
        isThinking: true,
        imageWorkbenchPreview: expect.objectContaining({
          taskId: "task-image-1",
          status: "running",
          projectId: "project-image-1",
          contentId: "content-image-1",
        }),
      }),
    ]);
    expect(getValue().imageWorkbenchState.active).toBe(false);
    expect(getValue().imageWorkbenchState.tasks).toEqual([
      expect.objectContaining({
        id: "task-image-1",
        status: "queued",
      }),
    ]);
    expect(getValue().imageWorkbenchState.outputs).toEqual([]);

    firstPreview.resolve(
      createFilePreviewResult(taskPath, {
        task_id: "task-image-1",
        task_type: "image_generate",
        task_family: "image",
        status: "running",
        normalized_status: "running",
        created_at: "2026-04-04T10:00:00Z",
        current_attempt_id: "attempt-1",
        payload: {
          prompt: "[img:未来感实验室里的青柠主视觉]",
          count: 1,
          size: "1024x1024",
        },
        progress: {
          message: "正在绘制第一版构图",
        },
        attempts: [
          {
            attempt_id: "attempt-1",
            provider: "fal",
            model: "flux-pro",
          },
        ],
      }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getValue().messages).toEqual([
      expect.objectContaining({
        content: "图片任务正在生成中。",
        imageWorkbenchPreview: expect.objectContaining({
          taskId: "task-image-1",
          status: "running",
          prompt: "未来感实验室里的青柠主视觉",
          imageCount: 1,
          size: "1024x1024",
        }),
        runtimeStatus: expect.objectContaining({
          detail: "正在绘制第一版构图",
        }),
      }),
    ]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
      await Promise.resolve();
    });

    expect(getValue().messages).toEqual([
      expect.objectContaining({
        content: "图片任务已完成，共生成 1 张。",
        isThinking: false,
        imageWorkbenchPreview: expect.objectContaining({
          taskId: "task-image-1",
          status: "complete",
          prompt: "未来感实验室里的青柠主视觉",
          imageUrl: "https://example.com/generated-lime.png",
          imageCount: 1,
          size: "1024x1024",
        }),
      }),
    ]);
    expect(getValue().imageWorkbenchState.tasks).toEqual([
      expect.objectContaining({
        id: "task-image-1",
        status: "complete",
        outputIds: ["task-image-1:output:1"],
      }),
    ]);
    expect(getValue().imageWorkbenchState.outputs).toEqual([
      expect.objectContaining({
        id: "task-image-1:output:1",
        taskId: "task-image-1",
        url: "https://example.com/generated-lime.png",
        prompt: "未来感实验室里的青柠主视觉",
        providerName: "fal",
        modelName: "flux-pro",
        size: "1024x1024",
      }),
    ]);
  });

  it("应在进入会话时从 task file 恢复最近的图片任务", async () => {
    vi.mocked(listDirectory)
      .mockResolvedValueOnce(
        createDirectoryListingResult("/workspace/project-image-1/.lime/tasks", [
          {
            name: "image_generate",
            path: "/workspace/project-image-1/.lime/tasks/image_generate",
            isDir: true,
            size: 0,
            modifiedAt: Date.now(),
          },
        ]),
      )
      .mockResolvedValueOnce(
        createDirectoryListingResult(
          "/workspace/project-image-1/.lime/tasks/image_generate",
          [
            {
              name: "task-image-restored.json",
              path: "/workspace/project-image-1/.lime/tasks/image_generate/task-image-restored.json",
              isDir: false,
              size: 512,
              modifiedAt: Date.now(),
            },
          ],
        ),
      );
    vi.mocked(readFilePreview).mockResolvedValueOnce(
      createFilePreviewResult(
        "/workspace/project-image-1/.lime/tasks/image_generate/task-image-restored.json",
        {
          task_id: "task-image-restored",
          task_type: "image_generate",
          task_family: "image",
          status: "completed",
          normalized_status: "succeeded",
          created_at: new Date().toISOString(),
          payload: {
            prompt: "[img:恢复出来的青柠主视觉]",
            count: 1,
            size: "1024x1024",
          },
          result: {
            images: [{ url: "https://example.com/restored-lime.png" }],
          },
          attempts: [
            {
              attempt_id: "attempt-restore-1",
              provider: "fal",
              model: "flux-pro",
              result_snapshot: {
                images: [{ url: "https://example.com/restored-lime.png" }],
              },
            },
          ],
        },
      ),
    );

    const { render, getValue } = renderHook();
    await render();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(listDirectory).toHaveBeenCalledWith(
      "/workspace/project-image-1/.lime/tasks",
    );
    expect(readFilePreview).toHaveBeenCalledWith(
      "/workspace/project-image-1/.lime/tasks/image_generate/task-image-restored.json",
      256 * 1024,
    );
    expect(getValue().messages).toEqual([
      expect.objectContaining({
        id: "image-workbench:task-image-restored:assistant",
        content: "图片任务已完成，共生成 1 张。",
        imageWorkbenchPreview: expect.objectContaining({
          taskId: "task-image-restored",
          status: "complete",
          imageUrl: "https://example.com/restored-lime.png",
        }),
      }),
    ]);
    expect(getValue().imageWorkbenchState.tasks).toEqual([
      expect.objectContaining({
        id: "task-image-restored",
        status: "complete",
      }),
    ]);
  });
});
