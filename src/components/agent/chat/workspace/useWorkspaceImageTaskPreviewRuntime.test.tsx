import React, { useEffect, useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listDirectory,
  readFilePreview,
  type FilePreview,
} from "@/lib/api/fileBrowser";
import {
  getMediaTaskArtifact,
  listMediaTaskArtifacts,
  type MediaTaskArtifactOutput,
} from "@/lib/api/mediaTasks";
import { safeListen } from "@/lib/dev-bridge";
import {
  hasTauriInvokeCapability,
  hasTauriRuntimeMarkers,
} from "@/lib/tauri-runtime";
import type { Message } from "../types";
import {
  createInitialSessionImageWorkbenchState,
  type SessionImageWorkbenchState,
} from "./imageWorkbenchHelpers";
import { useWorkspaceImageTaskPreviewRuntime } from "./useWorkspaceImageTaskPreviewRuntime";
import type { DirectoryListing } from "@/lib/api/fileBrowser";
import { createInitialDocumentState } from "@/lib/workspace/workbenchCanvas";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
  safeListen: vi.fn(),
}));

vi.mock("@/lib/api/fileBrowser", () => ({
  listDirectory: vi.fn(),
  readFilePreview: vi.fn(),
}));

vi.mock("@/lib/api/mediaTasks", () => ({
  getMediaTaskArtifact: vi.fn(),
  listMediaTaskArtifacts: vi.fn(),
}));

vi.mock("@/lib/tauri-runtime", () => ({
  hasTauriInvokeCapability: vi.fn(() => true),
  hasTauriRuntimeMarkers: vi.fn(() => true),
}));

type HookProps = Parameters<typeof useWorkspaceImageTaskPreviewRuntime>[0];
type RuntimeHarnessProps = Omit<
  HookProps,
  "setCanvasState" | "setChatMessages" | "updateCurrentImageWorkbenchState"
>;
type CreationTaskListener = Parameters<typeof safeListen>[1];

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];
const DEFAULT_SESSION_ID = "session-image-1";
const DEFAULT_PROJECT_ID = "project-image-1";
const DEFAULT_CONTENT_ID = "content-image-1";
const DEFAULT_PROJECT_ROOT_PATH = "/workspace/project-image-1";
const DEFAULT_TASK_CONTEXT = {
  session_id: DEFAULT_SESSION_ID,
  project_id: DEFAULT_PROJECT_ID,
  content_id: DEFAULT_CONTENT_ID,
};
const EMPTY_MODALITY_RUNTIME_CONTRACT_INDEX = {
  snapshot_count: 0,
  contract_keys: [],
  blocked_count: 0,
  routing_outcomes: [],
  model_registry_assessment_count: 0,
  snapshots: [],
};

function withDefaultTaskContext<T extends Record<string, unknown>>(record: T) {
  return {
    ...DEFAULT_TASK_CONTEXT,
    ...record,
  };
}

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

function createArtifactOutput(
  overrides: Partial<MediaTaskArtifactOutput> & {
    record: MediaTaskArtifactOutput["record"];
    task_id: string;
    task_type: string;
  },
): MediaTaskArtifactOutput {
  return {
    success: true,
    task_family: "image",
    status: "completed",
    normalized_status: "succeeded",
    path: `.lime/tasks/${overrides.task_type}/${overrides.task_id}.json`,
    absolute_path: `/workspace/project-image-1/.lime/tasks/${overrides.task_type}/${overrides.task_id}.json`,
    artifact_path: `.lime/tasks/${overrides.task_type}/${overrides.task_id}.json`,
    absolute_artifact_path: `/workspace/project-image-1/.lime/tasks/${overrides.task_type}/${overrides.task_id}.json`,
    reused_existing: false,
    ...overrides,
  };
}

function renderHook(
  props?: Partial<RuntimeHarnessProps>,
  options?: {
    initialMessages?: Message[];
    initialImageWorkbenchState?: SessionImageWorkbenchState;
    deriveImageWorkbenchState?: (
      state: SessionImageWorkbenchState,
    ) => SessionImageWorkbenchState;
    onSetChatMessagesDispatch?: () => void;
  },
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latestValue: {
    messages: Message[];
    imageWorkbenchState: SessionImageWorkbenchState;
    canvasState: RuntimeHarnessProps["canvasState"];
  } | null = null;

  const defaultProps: RuntimeHarnessProps = {
    sessionId: DEFAULT_SESSION_ID,
    projectId: DEFAULT_PROJECT_ID,
    contentId: DEFAULT_CONTENT_ID,
    projectRootPath: DEFAULT_PROJECT_ROOT_PATH,
    currentImageWorkbenchState: createInitialSessionImageWorkbenchState(),
    canvasState: null,
  };

  function Probe(currentProps: RuntimeHarnessProps) {
    const [messages, setMessages] = useState<Message[]>(
      () => options?.initialMessages || [],
    );
    const [canvasState, setCanvasState] = useState(currentProps.canvasState);
    const [imageWorkbenchState, setImageWorkbenchState] =
      useState<SessionImageWorkbenchState>(
        options?.initialImageWorkbenchState ||
          createInitialSessionImageWorkbenchState(),
      );

    useEffect(() => {
      setCanvasState(currentProps.canvasState);
    }, [currentProps.canvasState]);

    const setChatMessages = React.useCallback<typeof setMessages>((next) => {
      options?.onSetChatMessagesDispatch?.();
      setMessages(next);
    }, []);
    const effectiveImageWorkbenchState =
      options?.deriveImageWorkbenchState?.(imageWorkbenchState) ||
      imageWorkbenchState;

    latestValue = {
      messages,
      canvasState,
      imageWorkbenchState: effectiveImageWorkbenchState,
    };

    useWorkspaceImageTaskPreviewRuntime({
      ...currentProps,
      messages,
      currentImageWorkbenchState: effectiveImageWorkbenchState,
      canvasState,
      setCanvasState,
      setChatMessages,
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

function getDocumentCanvasContent(
  canvasState: RuntimeHarnessProps["canvasState"],
): string {
  if (!canvasState || canvasState.type !== "document") {
    throw new Error("期望 document canvasState");
  }
  return canvasState.content;
}

describe("useWorkspaceImageTaskPreviewRuntime", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.mocked(hasTauriInvokeCapability).mockReturnValue(true);
    vi.mocked(hasTauriRuntimeMarkers).mockReturnValue(true);
    vi.mocked(safeListen).mockResolvedValue(vi.fn());
    vi.mocked(getMediaTaskArtifact).mockRejectedValue(
      new Error("task artifact unavailable"),
    );
    vi.mocked(listMediaTaskArtifacts).mockRejectedValue(
      new Error("task artifact list unavailable"),
    );
    vi.mocked(listDirectory).mockResolvedValue(
      createDirectoryListingResult(
        "/workspace/project-image-1/.lime/tasks",
        [],
      ),
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
    vi.resetAllMocks();
  });

  it("图片工作台状态引用变化但内容无变化时，不应触发空消息更新", async () => {
    let messageDispatchCount = 0;
    const { render, getValue } = renderHook(
      {},
      {
        deriveImageWorkbenchState: (state) => ({
          ...state,
          tasks: [...state.tasks],
          outputs: [...state.outputs],
        }),
        onSetChatMessagesDispatch: () => {
          messageDispatchCount += 1;
        },
      },
    );

    await render();

    expect(getValue().messages).toEqual([]);
    expect(messageDispatchCount).toBe(0);
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
    vi.mocked(readFilePreview).mockImplementationOnce(
      () => firstPreview.promise,
    );
    vi.mocked(readFilePreview).mockResolvedValueOnce(
      createFilePreviewResult(
        taskPath,
        withDefaultTaskContext({
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
      ),
    );

    const { render, getValue } = renderHook();
    await render();

    await act(async () => {
      listener?.({
        payload: withDefaultTaskContext({
          task_id: "task-image-1",
          task_type: "image_generate",
          task_family: "image",
          status: "pending_submit",
          path: ".lime/tasks/image/image_generate/task-image-1.json",
        }),
      });
      await Promise.resolve();
    });

    expect(readFilePreview).toHaveBeenCalledWith(taskPath, 256 * 1024);
    expect(getValue().messages).toEqual([
      expect.objectContaining({
        id: "image-workbench:task-image-1:assistant",
        content: "图片任务已进入队列，正在等待执行。",
        isThinking: true,
        toolCalls: [
          expect.objectContaining({
            name: "limeCreateImageGenerationTask",
            status: "running",
          }),
        ],
        contentParts: expect.arrayContaining([
          expect.objectContaining({
            type: "text",
          }),
          expect.objectContaining({
            type: "tool_use",
            toolCall: expect.objectContaining({
              name: "limeCreateImageGenerationTask",
            }),
          }),
        ]),
        imageWorkbenchPreview: expect.objectContaining({
          taskId: "task-image-1",
          status: "running",
          projectId: "project-image-1",
          contentId: "content-image-1",
          statusMessage: "任务已提交，正在排队处理。",
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
      createFilePreviewResult(
        taskPath,
        withDefaultTaskContext({
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
      ),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getValue().messages).toEqual([
      expect.objectContaining({
        content: "图片任务正在生成中。",
        toolCalls: [
          expect.objectContaining({
            name: "limeCreateImageGenerationTask",
            status: "running",
          }),
        ],
        imageWorkbenchPreview: expect.objectContaining({
          taskId: "task-image-1",
          status: "running",
          prompt: "未来感实验室里的青柠主视觉",
          imageCount: 1,
          size: "1024x1024",
          phase: "running",
          statusMessage: "正在绘制第一版构图",
          attemptCount: 1,
        }),
        runtimeStatus: expect.objectContaining({
          detail: "正在绘制第一版构图",
        }),
      }),
    ]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
      await Promise.resolve();
    });

    expect(getValue().messages).toEqual([
      expect.objectContaining({
        content: "图片任务已完成，共生成 1 张。",
        isThinking: false,
        toolCalls: [
          expect.objectContaining({
            name: "limeCreateImageGenerationTask",
            status: "completed",
          }),
        ],
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

  it("task file 预览被截断时，应回退到媒体任务接口继续回填图片结果", async () => {
    let listener: CreationTaskListener | null = null;
    vi.mocked(safeListen).mockImplementationOnce(async (_event, handler) => {
      listener = handler;
      return vi.fn();
    });

    const taskId = "task-image-large-preview-1";
    const dataUrl = `data:image/png;base64,${"A".repeat(4096)}`;
    vi.mocked(readFilePreview).mockResolvedValueOnce({
      path: `/workspace/project-image-1/.lime/tasks/image_generate/${taskId}.json`,
      content:
        '{"task_id":"task-image-large-preview-1","result":{"images":[{"url":"data:image/png;base64,AAAA',
      isBinary: false,
      size: 512 * 1024,
      error: null,
    });
    vi.mocked(getMediaTaskArtifact).mockResolvedValueOnce(
      createArtifactOutput({
        task_id: taskId,
        task_type: "image_generate",
        current_attempt_id: "attempt-large-preview-1",
        record: withDefaultTaskContext({
          task_id: taskId,
          task_type: "image_generate",
          task_family: "image",
          status: "completed",
          normalized_status: "succeeded",
          created_at: "2026-04-04T11:00:00Z",
          current_attempt_id: "attempt-large-preview-1",
          payload: {
            prompt: "[img:高保真青柠品牌主视觉]",
            count: 1,
            size: "1024x1024",
          },
          result: {
            images: [{ url: dataUrl }],
          },
          attempts: [
            {
              attempt_id: "attempt-large-preview-1",
              provider: "fal",
              model: "flux-pro",
              result_snapshot: {
                images: [{ url: dataUrl }],
              },
            },
          ],
        }),
      }),
    );

    const { render, getValue } = renderHook();
    await render();

    await act(async () => {
      listener?.({
        payload: withDefaultTaskContext({
          task_id: taskId,
          task_type: "image_generate",
          task_family: "image",
          status: "completed",
          path: `.lime/tasks/image_generate/${taskId}.json`,
        }),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getMediaTaskArtifact).toHaveBeenCalledWith({
      projectRootPath: DEFAULT_PROJECT_ROOT_PATH,
      taskRef: `/workspace/project-image-1/.lime/tasks/image_generate/${taskId}.json`,
    });
    expect(getValue().messages).toEqual([
      expect.objectContaining({
        id: `image-workbench:${taskId}:assistant`,
        imageWorkbenchPreview: expect.objectContaining({
          taskId,
          status: "complete",
          imageUrl: dataUrl,
          prompt: "高保真青柠品牌主视觉",
        }),
      }),
    ]);
    expect(getValue().imageWorkbenchState.outputs).toEqual([
      expect.objectContaining({
        taskId,
        url: dataUrl,
      }),
    ]);
  });

  it("task file 仍是等待队列时，应立即优先采用媒体任务接口返回的完整结果", async () => {
    let listener: CreationTaskListener | null = null;
    vi.mocked(safeListen).mockImplementationOnce(async (_event, handler) => {
      listener = handler;
      return vi.fn();
    });

    const taskId = "task-image-prefer-artifact-api-1";
    const taskPath = `/workspace/project-image-1/.lime/tasks/image_generate/${taskId}.json`;
    vi.mocked(readFilePreview).mockResolvedValueOnce(
      createFilePreviewResult(
        taskPath,
        withDefaultTaskContext({
          task_id: taskId,
          task_type: "image_generate",
          task_family: "image",
          status: "queued",
          normalized_status: "queued",
          created_at: "2026-04-04T10:30:00Z",
          payload: {
            prompt: "[img:珠江夜景主视觉]",
            count: 1,
            size: "1024x1024",
          },
          progress: {
            phase: "queued",
            message: "任务已进入队列",
          },
        }),
      ),
    );
    vi.mocked(getMediaTaskArtifact).mockResolvedValueOnce(
      createArtifactOutput({
        task_id: taskId,
        task_type: "image_generate",
        current_attempt_id: "attempt-prefer-artifact-api-1",
        record: withDefaultTaskContext({
          task_id: taskId,
          task_type: "image_generate",
          task_family: "image",
          status: "completed",
          normalized_status: "succeeded",
          created_at: "2026-04-04T10:30:01Z",
          current_attempt_id: "attempt-prefer-artifact-api-1",
          payload: {
            prompt: "[img:珠江夜景主视觉]",
            count: 1,
            size: "1024x1024",
          },
          result: {
            images: [{ url: "https://example.com/prefer-artifact-api.png" }],
          },
          attempts: [
            {
              attempt_id: "attempt-prefer-artifact-api-1",
              provider: "fal",
              model: "flux-pro",
              result_snapshot: {
                images: [
                  { url: "https://example.com/prefer-artifact-api.png" },
                ],
              },
            },
          ],
        }),
      }),
    );

    const { render, getValue } = renderHook();
    await render();

    await act(async () => {
      listener?.({
        payload: withDefaultTaskContext({
          task_id: taskId,
          task_type: "image_generate",
          task_family: "image",
          status: "queued",
          path: `.lime/tasks/image_generate/${taskId}.json`,
        }),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(readFilePreview).toHaveBeenCalledWith(taskPath, 256 * 1024);
    expect(getMediaTaskArtifact).toHaveBeenCalledWith({
      projectRootPath: DEFAULT_PROJECT_ROOT_PATH,
      taskRef: taskPath,
    });
    expect(getValue().messages).toEqual([
      expect.objectContaining({
        id: `image-workbench:${taskId}:assistant`,
        imageWorkbenchPreview: expect.objectContaining({
          taskId,
          status: "complete",
          imageUrl: "https://example.com/prefer-artifact-api.png",
          prompt: "珠江夜景主视觉",
        }),
      }),
    ]);
  });

  it("已存在同 taskId 的 skill 消息时，应把 task 预览合并回原消息而不是再插一条伪造消息", async () => {
    let listener: CreationTaskListener | null = null;
    vi.mocked(safeListen).mockImplementationOnce(async (event, handler) => {
      expect(event).toBe("lime://creation_task_submitted");
      listener = handler;
      return vi.fn();
    });

    const taskPath =
      "/workspace/project-image-1/.lime/tasks/image_generate/task-image-skill-1.json";
    vi.mocked(readFilePreview).mockResolvedValue(
      createFilePreviewResult(
        taskPath,
        withDefaultTaskContext({
          task_id: "task-image-skill-1",
          task_type: "image_generate",
          task_family: "image",
          status: "completed",
          normalized_status: "succeeded",
          created_at: "2026-04-04T10:00:00Z",
          payload: {
            prompt: "[img:春日咖啡馆插画]",
            count: 2,
            size: "1024x1024",
          },
          result: {
            images: [{ url: "https://example.com/skill-preview.png" }],
          },
        }),
      ),
    );

    const { render, getValue } = renderHook(
      {},
      {
        initialMessages: [
          {
            id: "assistant-skill-image-1",
            role: "assistant",
            content: "任务类型：image_generate\n任务 ID：task-image-skill-1",
            timestamp: new Date("2026-04-04T10:00:00Z"),
            toolCalls: [
              {
                id: "tool-image-1",
                name: "Bash",
                arguments: JSON.stringify({
                  command:
                    "lime media image generate --prompt '春日咖啡馆插画' --json",
                }),
                status: "completed",
                result: {
                  success: true,
                  output: "任务已提交",
                  metadata: {
                    task_id: "task-image-skill-1",
                    task_type: "image_generate",
                    task_family: "image",
                    status: "pending_submit",
                  },
                },
                startTime: new Date("2026-04-04T10:00:00Z"),
                endTime: new Date("2026-04-04T10:00:01Z"),
              },
            ],
            imageWorkbenchPreview: {
              taskId: "task-image-skill-1",
              prompt: "春日咖啡馆插画",
              status: "running",
              phase: "queued",
            },
          },
        ],
      },
    );
    await render();

    await act(async () => {
      listener?.({
        payload: withDefaultTaskContext({
          task_id: "task-image-skill-1",
          task_type: "image_generate",
          task_family: "image",
          status: "pending_submit",
          path: ".lime/tasks/image_generate/task-image-skill-1.json",
        }),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getValue().messages).toHaveLength(1);
    expect(getValue().messages[0]).toMatchObject({
      id: "assistant-skill-image-1",
      content: "任务类型：image_generate\n任务 ID：task-image-skill-1",
      toolCalls: [
        expect.objectContaining({
          name: "Bash",
          status: "completed",
        }),
      ],
      imageWorkbenchPreview: expect.objectContaining({
        taskId: "task-image-skill-1",
        status: "complete",
        imageUrl: "https://example.com/skill-preview.png",
      }),
    });
  });

  it("同 taskId 的状态占位消息应被终态快照幂等覆盖，而不是一直停留在排队文案", async () => {
    let listener: CreationTaskListener | null = null;
    vi.mocked(safeListen).mockImplementationOnce(async (_event, handler) => {
      listener = handler;
      return vi.fn();
    });

    const taskPath =
      "/workspace/project-image-1/.lime/tasks/image_generate/task-image-status-only-1.json";
    vi.mocked(readFilePreview).mockResolvedValue(
      createFilePreviewResult(
        taskPath,
        withDefaultTaskContext({
          task_id: "task-image-status-only-1",
          task_type: "image_generate",
          task_family: "image",
          status: "completed",
          normalized_status: "succeeded",
          created_at: "2026-04-04T10:20:00Z",
          payload: {
            prompt: "[img:三国主要人物聚合图]",
            count: 1,
            size: "1024x1024",
          },
          progress: {
            phase: "succeeded",
            message: "图片任务已完成，共生成 1 张。",
          },
          result: {
            images: [{ url: "https://example.com/three-kingdoms-collage.png" }],
          },
        }),
      ),
    );

    const { render, getValue } = renderHook(
      {},
      {
        initialMessages: [
          {
            id: "assistant-image-status-only-1",
            role: "assistant",
            content:
              "图片生成任务已成功提交，正在排队处理中。\n状态: 排队中 (pending_submit)",
            timestamp: new Date("2026-04-04T10:20:00Z"),
            isThinking: true,
            runtimeStatus: {
              phase: "routing",
              title: "图片任务进行中",
              detail: "任务已提交，正在排队处理。",
              checkpoints: ["创建任务文件", "轮询任务状态"],
            },
            imageWorkbenchPreview: {
              taskId: "task-image-status-only-1",
              prompt: "三国主要人物聚合图",
              status: "running",
              phase: "queued",
              statusMessage: "任务已提交，正在排队处理。",
            },
          },
        ],
      },
    );
    await render();

    await act(async () => {
      listener?.({
        payload: withDefaultTaskContext({
          task_id: "task-image-status-only-1",
          task_type: "image_generate",
          task_family: "image",
          status: "pending_submit",
          path: ".lime/tasks/image_generate/task-image-status-only-1.json",
        }),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getValue().messages).toEqual([
      expect.objectContaining({
        id: "assistant-image-status-only-1",
        content: "图片任务已完成，共生成 1 张。",
        isThinking: false,
        runtimeStatus: undefined,
        toolCalls: [
          expect.objectContaining({
            name: "limeCreateImageGenerationTask",
            status: "completed",
          }),
        ],
        imageWorkbenchPreview: expect.objectContaining({
          taskId: "task-image-status-only-1",
          status: "complete",
          phase: "succeeded",
          statusMessage: null,
          imageUrl: "https://example.com/three-kingdoms-collage.png",
        }),
      }),
    ]);
  });

  it("同 taskId 的重复图片任务卡应折叠回第一张消息，而不是越刷越多", async () => {
    let listener: CreationTaskListener | null = null;
    vi.mocked(safeListen).mockImplementationOnce(async (_event, handler) => {
      listener = handler;
      return vi.fn();
    });

    const taskId = "task-image-duplicate-collapse-1";
    const taskPath = `/workspace/project-image-1/.lime/tasks/image_generate/${taskId}.json`;
    vi.mocked(readFilePreview).mockResolvedValue(
      createFilePreviewResult(
        taskPath,
        withDefaultTaskContext({
          task_id: taskId,
          task_type: "image_generate",
          task_family: "image",
          status: "completed",
          normalized_status: "succeeded",
          created_at: "2026-04-04T10:25:00Z",
          payload: {
            prompt: "[img:mock image task]",
            count: 9,
            layout_hint: "storyboard_3x3",
            size: "1024x1024",
          },
          result: {
            images: [{ url: "https://example.com/mock-image-task-1.png" }],
          },
        }),
      ),
    );

    const duplicatedMessages: Message[] = Array.from(
      { length: 4 },
      (_, index) => ({
        id: `assistant-image-duplicate-${index + 1}`,
        role: "assistant",
        content:
          "我先按你的描述整理画面主题、尺寸和出图数量，并创建异步图片任务：mock image task",
        timestamp: new Date(`2026-04-04T10:25:0${index}Z`),
        isThinking: true,
        imageWorkbenchPreview: {
          taskId,
          prompt: "mock image task",
          status: "running",
          expectedImageCount: 9,
          imageCount: 9,
          layoutHint: "storyboard_3x3",
          phase: "queued",
          statusMessage: "任务已提交，正在排队处理。",
        },
      }),
    );

    const { render, getValue } = renderHook(
      {},
      {
        initialMessages: duplicatedMessages,
      },
    );
    await render();

    await act(async () => {
      listener?.({
        payload: withDefaultTaskContext({
          task_id: taskId,
          task_type: "image_generate",
          task_family: "image",
          status: "pending_submit",
          path: `.lime/tasks/image_generate/${taskId}.json`,
        }),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getValue().messages).toHaveLength(1);
    expect(getValue().messages[0]).toMatchObject({
      id: "assistant-image-duplicate-1",
      imageWorkbenchPreview: expect.objectContaining({
        taskId,
        status: "complete",
        imageUrl: "https://example.com/mock-image-task-1.png",
        expectedImageCount: 9,
      }),
    });
  });

  it("同 task file 但 taskId 漂移的 mock 图片任务卡也应折叠成一条", async () => {
    const taskFilePath =
      "/workspace/project-image-1/.lime/tasks/image_generate/task-image-mock-1.json";
    const artifactPath = ".lime/tasks/image_generate/task-image-mock-1.json";

    const duplicatedMessages: Message[] = [
      {
        id: "assistant-image-path-duplicate-1",
        role: "assistant",
        content:
          "我先按你的描述整理画面主题、尺寸和出图数量，并创建异步图片任务：mock image task",
        timestamp: new Date("2026-04-04T10:26:00Z"),
        isThinking: true,
        imageWorkbenchPreview: {
          taskId: "task-image-mock-1",
          prompt: "mock image task",
          status: "running",
          taskFilePath,
          artifactPath,
          expectedImageCount: 9,
          imageCount: 9,
          layoutHint: "storyboard_3x3",
          phase: "queued",
          statusMessage: "任务已提交，正在排队处理。",
        },
      },
      {
        id: "assistant-image-path-duplicate-2",
        role: "assistant",
        content:
          "我先按你的描述整理画面主题、尺寸和出图数量，并创建异步图片任务：mock image task",
        timestamp: new Date("2026-04-04T10:26:03Z"),
        isThinking: true,
        imageWorkbenchPreview: {
          taskId:
            "workspace-project-image-1--lime-tasks-image_generate-task-image-mock-1-json",
          prompt: "mock image task",
          status: "running",
          taskFilePath,
          artifactPath,
          expectedImageCount: 9,
          imageCount: 9,
          layoutHint: "storyboard_3x3",
          phase: "queued",
          statusMessage: "任务已提交，正在排队处理。",
        },
      },
    ];

    const { render, getValue } = renderHook(
      {},
      {
        initialMessages: duplicatedMessages,
      },
    );
    await render();

    await vi.waitFor(() => {
      expect(getValue().messages).toHaveLength(1);
    });

    expect(getValue().messages[0]).toMatchObject({
      id: "assistant-image-path-duplicate-1",
      imageWorkbenchPreview: expect.objectContaining({
        taskId:
          "workspace-project-image-1--lime-tasks-image_generate-task-image-mock-1-json",
        taskFilePath,
        artifactPath,
        expectedImageCount: 9,
      }),
    });
  });

  it("失败的 task file 应透传重试语义与结构化错误文案", async () => {
    let listener: CreationTaskListener | null = null;
    vi.mocked(safeListen).mockImplementationOnce(async (_event, handler) => {
      listener = handler;
      return vi.fn();
    });

    vi.mocked(readFilePreview).mockResolvedValueOnce(
      createFilePreviewResult(
        "/workspace/project-image-1/.lime/tasks/image_generate/task-image-failed-1.json",
        withDefaultTaskContext({
          task_id: "task-image-failed-1",
          task_type: "image_generate",
          task_family: "image",
          status: "failed",
          normalized_status: "failed",
          created_at: "2026-04-04T10:30:00Z",
          payload: {
            prompt: "青柠品牌 KV",
            count: 1,
            size: "1024x1024",
          },
          progress: {
            phase: "failed",
            message: "FAL 请求参数无效，请先调整配置。",
          },
          last_error: {
            code: "invalid_request",
            message: "FAL 请求参数无效，请先调整配置。",
            retryable: false,
          },
          attempts: [
            {
              attempt_id: "attempt-failed-1",
              status: "failed",
            },
          ],
        }),
      ),
    );

    const { render, getValue } = renderHook();
    await render();

    await act(async () => {
      listener?.({
        payload: withDefaultTaskContext({
          task_id: "task-image-failed-1",
          task_type: "image_generate",
          task_family: "image",
          status: "failed",
          path: ".lime/tasks/image_generate/task-image-failed-1.json",
        }),
      });
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(getValue().messages).toEqual([
        expect.objectContaining({
          id: "image-workbench:task-image-failed-1:assistant",
          content: "图片任务失败：FAL 请求参数无效，请先调整配置。",
          isThinking: false,
          imageWorkbenchPreview: expect.objectContaining({
            taskId: "task-image-failed-1",
            status: "failed",
            statusMessage: "FAL 请求参数无效，请先调整配置。",
            retryable: false,
            attemptCount: 1,
          }),
        }),
      ]);
    });
  });

  it("修图 task file 应把来源图引用映射到预览与工作台状态", async () => {
    let listener: CreationTaskListener | null = null;
    vi.mocked(safeListen).mockImplementationOnce(async (_event, handler) => {
      listener = handler;
      return vi.fn();
    });

    const taskPath =
      "/workspace/project-image-1/.lime/tasks/image_generate/task-image-edit-source-1.json";
    vi.mocked(readFilePreview).mockResolvedValueOnce(
      createFilePreviewResult(
        taskPath,
        withDefaultTaskContext({
          task_id: "task-image-edit-source-1",
          task_type: "image_generate",
          task_family: "image",
          status: "completed",
          normalized_status: "succeeded",
          created_at: "2026-04-04T11:00:00Z",
          payload: {
            prompt: "把主视觉里的青柠改成玻璃质感",
            mode: "edit",
            count: 1,
            size: "1024x1024",
            target_output_id: "output-source-1",
            target_output_ref_id: "img-source-1",
            reference_images: [
              "https://example.com/source-a.png",
              "https://example.com/source-b.png",
            ],
            target_output_summary: {
              prompt: "原始青柠主视觉",
              url: "https://example.com/source-summary.png",
            },
          },
          result: {
            images: [{ url: "https://example.com/edited-lime.png" }],
          },
          attempts: [
            {
              attempt_id: "attempt-edit-source-1",
              provider: "fal",
              model: "flux-kontext-max",
              result_snapshot: {
                images: [{ url: "https://example.com/edited-lime.png" }],
              },
            },
          ],
        }),
      ),
    );

    const { render, getValue } = renderHook();
    await render();

    await act(async () => {
      listener?.({
        payload: withDefaultTaskContext({
          task_id: "task-image-edit-source-1",
          task_type: "image_generate",
          task_family: "image",
          status: "completed",
          mode: "edit",
          path: ".lime/tasks/image_generate/task-image-edit-source-1.json",
        }),
      });
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(getValue().messages).toEqual([
        expect.objectContaining({
          id: "image-workbench:task-image-edit-source-1:assistant",
          content: "图片编辑任务已完成，共生成 1 张。",
          imageWorkbenchPreview: expect.objectContaining({
            taskId: "task-image-edit-source-1",
            mode: "edit",
            status: "complete",
            imageUrl: "https://example.com/edited-lime.png",
            sourceImageUrl: "https://example.com/source-summary.png",
            sourceImagePrompt: "原始青柠主视觉",
            sourceImageRef: "img-source-1",
            sourceImageCount: 2,
          }),
        }),
      ]);
    });

    expect(getValue().imageWorkbenchState.tasks).toEqual([
      expect.objectContaining({
        id: "task-image-edit-source-1",
        mode: "edit",
        status: "complete",
        targetOutputId: "output-source-1",
        targetOutputRefId: "img-source-1",
        sourceImageUrl: "https://example.com/source-summary.png",
        sourceImagePrompt: "原始青柠主视觉",
        sourceImageRef: "img-source-1",
        sourceImageCount: 2,
      }),
    ]);
    expect(getValue().imageWorkbenchState.outputs).toEqual([
      expect.objectContaining({
        id: "task-image-edit-source-1:output:1",
        taskId: "task-image-edit-source-1",
        url: "https://example.com/edited-lime.png",
        parentOutputId: "output-source-1",
      }),
    ]);
  });

  it("应优先通过媒体任务接口恢复最近的图片任务，避免大 task file 截断", async () => {
    const taskId = "task-image-restored-api";
    vi.mocked(listMediaTaskArtifacts).mockResolvedValueOnce({
      success: true,
      workspace_root: DEFAULT_PROJECT_ROOT_PATH,
      artifact_root: `${DEFAULT_PROJECT_ROOT_PATH}/.lime/tasks`,
      filters: {
        task_family: "image",
        limit: 32,
      },
      total: 1,
      modality_runtime_contracts: EMPTY_MODALITY_RUNTIME_CONTRACT_INDEX,
      tasks: [
        createArtifactOutput({
          task_id: taskId,
          task_type: "image_generate",
          record: withDefaultTaskContext({
            task_id: taskId,
            task_type: "image_generate",
            task_family: "image",
            status: "completed",
            normalized_status: "succeeded",
            created_at: "2026-04-04T10:00:00Z",
            payload: {
              prompt: "[img:通过 API 恢复的青柠主视觉]",
              count: 1,
              size: "1024x1024",
            },
            result: {
              images: [{ url: "https://example.com/restored-api-lime.png" }],
            },
          }),
        }),
      ],
    });

    const { render, getValue } = renderHook();
    await render();

    await vi.waitFor(() => {
      expect(getValue().messages).toEqual([
        expect.objectContaining({
          id: `image-workbench:${taskId}:assistant`,
          imageWorkbenchPreview: expect.objectContaining({
            taskId,
            imageUrl: "https://example.com/restored-api-lime.png",
            prompt: "通过 API 恢复的青柠主视觉",
          }),
        }),
      ]);
    });

    expect(listMediaTaskArtifacts).toHaveBeenCalledWith({
      projectRootPath: DEFAULT_PROJECT_ROOT_PATH,
      taskFamily: "image",
      limit: 32,
    });
    expect(listDirectory).not.toHaveBeenCalled();
    expect(readFilePreview).not.toHaveBeenCalled();
  });

  it("历史消息已带 taskId 时，应直接按 taskId 走媒体任务接口恢复图片结果", async () => {
    const taskId = "task-image-history-direct-1";
    vi.mocked(hasTauriInvokeCapability).mockReturnValue(false);
    vi.mocked(hasTauriRuntimeMarkers).mockReturnValue(false);
    vi.mocked(getMediaTaskArtifact).mockResolvedValueOnce(
      createArtifactOutput({
        task_id: taskId,
        task_type: "image_generate",
        record: withDefaultTaskContext({
          task_id: taskId,
          task_type: "image_generate",
          task_family: "image",
          status: "completed",
          normalized_status: "succeeded",
          created_at: "2026-04-04T12:00:00Z",
          payload: {
            prompt: "[img:历史直恢广州春日主视觉]",
            count: 1,
            size: "1024x1024",
          },
          result: {
            images: [{ url: "https://example.com/history-direct-restore.png" }],
          },
        }),
      }),
    );

    const { render, getValue } = renderHook(
      {},
      {
        initialMessages: [
          {
            id: `image-workbench:${taskId}:assistant`,
            role: "assistant",
            content: "图片任务已提交，正在同步任务状态。",
            timestamp: new Date("2026-04-04T12:00:00Z"),
            imageWorkbenchPreview: {
              taskId,
              prompt: "历史直恢广州春日主视觉",
              status: "running",
              phase: "queued",
            },
          },
        ],
      },
    );
    await render();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getMediaTaskArtifact).toHaveBeenCalledWith({
      projectRootPath: DEFAULT_PROJECT_ROOT_PATH,
      taskRef: taskId,
    });
    expect(listMediaTaskArtifacts).not.toHaveBeenCalled();
    expect(getValue().messages).toEqual([
      expect.objectContaining({
        id: `image-workbench:${taskId}:assistant`,
        imageWorkbenchPreview: expect.objectContaining({
          taskId,
          status: "complete",
          imageUrl: "https://example.com/history-direct-restore.png",
          prompt: "历史直恢广州春日主视觉",
        }),
      }),
    ]);
  });

  it("应从 task artifact 恢复多模态合同路由阻止状态", async () => {
    const taskId = "task-image-contract-blocked-1";
    vi.mocked(hasTauriInvokeCapability).mockReturnValue(false);
    vi.mocked(hasTauriRuntimeMarkers).mockReturnValue(false);
    vi.mocked(getMediaTaskArtifact).mockResolvedValueOnce(
      createArtifactOutput({
        task_id: taskId,
        task_type: "image_generate",
        status: "failed",
        normalized_status: "failed",
        record: withDefaultTaskContext({
          task_id: taskId,
          task_type: "image_generate",
          task_family: "image",
          status: "failed",
          normalized_status: "failed",
          created_at: "2026-04-04T12:05:00Z",
          payload: {
            prompt: "[img:合同阻止的青柠主视觉]",
            count: 1,
            size: "1024x1024",
            modality_contract_key: "image_generation",
            routing_slot: "image_task",
            required_capabilities: ["image_generation"],
            provider_id: "openai",
            model: "gpt-5.2",
            model_capability_assessment: {
              model_id: "gpt-5.2",
              provider_id: "openai",
              source: "model_registry",
              supports_image_generation: false,
              reason: "output_modalities_missing_image",
            },
          },
          last_error: {
            code: "image_generation_model_capability_gap",
            message: "model registry 显示当前模型不具备图片生成能力。",
            retryable: false,
          },
        }),
      }),
    );

    const { render, getValue } = renderHook(
      {},
      {
        initialMessages: [
          {
            id: `image-workbench:${taskId}:assistant`,
            role: "assistant",
            content: "图片任务已提交，正在同步任务状态。",
            timestamp: new Date("2026-04-04T12:05:00Z"),
            imageWorkbenchPreview: {
              taskId,
              prompt: "合同阻止的青柠主视觉",
              status: "running",
              phase: "queued",
            },
          },
        ],
      },
    );
    await render();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getMediaTaskArtifact).toHaveBeenCalledWith({
      projectRootPath: DEFAULT_PROJECT_ROOT_PATH,
      taskRef: taskId,
    });
    expect(getValue().imageWorkbenchState.tasks).toEqual([
      expect.objectContaining({
        id: taskId,
        status: "error",
        runtimeContract: expect.objectContaining({
          contractKey: "image_generation",
          routingSlot: "image_task",
          providerId: "openai",
          model: "gpt-5.2",
          routingEvent: "routing_not_possible",
          routingOutcome: "blocked",
          failureCode: "image_generation_model_capability_gap",
          modelCapabilityAssessmentSource: "model_registry",
          modelSupportsImageGeneration: false,
        }),
      }),
    ]);
    expect(getValue().messages).toEqual([
      expect.objectContaining({
        imageWorkbenchPreview: expect.objectContaining({
          taskId,
          status: "failed",
          runtimeContract: expect.objectContaining({
            routingOutcome: "blocked",
            failureCode: "image_generation_model_capability_gap",
            modelCapabilityAssessmentSource: "model_registry",
          }),
        }),
      }),
    ]);
  });

  it("历史消息里的陈旧非终态图片任务不应恢复为轮询任务", async () => {
    vi.setSystemTime(new Date("2026-04-27T00:00:00Z"));
    const taskId = "task-image-history-stale-pending-1";
    vi.mocked(hasTauriInvokeCapability).mockReturnValue(false);
    vi.mocked(hasTauriRuntimeMarkers).mockReturnValue(false);
    vi.mocked(getMediaTaskArtifact).mockResolvedValueOnce(
      createArtifactOutput({
        task_id: taskId,
        task_type: "image_generate",
        status: "pending",
        normalized_status: "pending",
        record: withDefaultTaskContext({
          task_id: taskId,
          task_type: "image_generate",
          task_family: "image",
          status: "pending_submit",
          normalized_status: "pending",
          created_at: "2026-04-23T21:14:06Z",
          payload: {
            prompt: "[img:陈旧未完成图片任务]",
            count: 1,
          },
        }),
      }),
    );

    const { render, getValue } = renderHook(
      {},
      {
        initialMessages: [
          {
            id: `image-workbench:${taskId}:assistant`,
            role: "assistant",
            content: "图片任务已提交，正在同步任务状态。",
            timestamp: new Date("2026-04-23T21:14:06Z"),
            imageWorkbenchPreview: {
              taskId,
              prompt: "陈旧未完成图片任务",
              status: "running",
              phase: "queued",
            },
          },
        ],
      },
    );
    await render();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getMediaTaskArtifact).toHaveBeenCalledTimes(1);
    expect(getValue().messages).toEqual([
      expect.objectContaining({
        id: `image-workbench:${taskId}:assistant`,
        content: "图片任务已提交，正在同步任务状态。",
        imageWorkbenchPreview: expect.objectContaining({
          taskId,
          status: "running",
        }),
      }),
    ]);
    expect(getValue().imageWorkbenchState.tasks).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4500);
      await Promise.resolve();
    });

    expect(readFilePreview).not.toHaveBeenCalled();
    expect(getMediaTaskArtifact).toHaveBeenCalledTimes(1);
  });

  it("历史消息带绝对 task file 时，应优先按 task file 恢复跨根目录图片结果", async () => {
    const taskId = "task-image-history-absolute-1";
    const taskFilePath =
      "/Users/youmin/.lime/tasks/image_generate/task-image-history-absolute-1.json";
    const artifactPath =
      ".lime/tasks/image_generate/task-image-history-absolute-1.json";
    vi.mocked(hasTauriInvokeCapability).mockReturnValue(false);
    vi.mocked(hasTauriRuntimeMarkers).mockReturnValue(false);
    vi.mocked(getMediaTaskArtifact).mockResolvedValueOnce(
      createArtifactOutput({
        task_id: taskId,
        task_type: "image_generate",
        absolute_path: taskFilePath,
        artifact_path: artifactPath,
        absolute_artifact_path: taskFilePath,
        record: withDefaultTaskContext({
          task_id: taskId,
          task_type: "image_generate",
          task_family: "image",
          status: "completed",
          normalized_status: "succeeded",
          created_at: "2026-04-04T12:00:00Z",
          payload: {
            prompt: "[img:跨根目录恢复的三国群像]",
            count: 1,
            size: "1024x1024",
          },
          result: {
            images: [{ url: "https://example.com/history-absolute.png" }],
          },
        }),
      }),
    );

    const { render, getValue } = renderHook(
      {},
      {
        initialMessages: [
          {
            id: `image-workbench:${taskId}:assistant`,
            role: "assistant",
            content: "图片任务已提交，正在同步任务状态。",
            timestamp: new Date("2026-04-04T12:00:00Z"),
            imageWorkbenchPreview: {
              taskId,
              prompt: "跨根目录恢复的三国群像",
              status: "running",
              phase: "queued",
              taskFilePath,
              artifactPath,
            },
          },
        ],
      },
    );
    await render();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getMediaTaskArtifact).toHaveBeenCalledWith({
      projectRootPath: "/Users/youmin",
      taskRef: taskFilePath,
    });
    expect(getValue().messages).toEqual([
      expect.objectContaining({
        id: `image-workbench:${taskId}:assistant`,
        imageWorkbenchPreview: expect.objectContaining({
          taskId,
          status: "complete",
          imageUrl: "https://example.com/history-absolute.png",
          taskFilePath,
          artifactPath,
        }),
      }),
    ]);
  });

  it("收到工作区外绝对 task file 事件时，应继续按绝对路径轮询 artifact API", async () => {
    const taskId = "task-image-external-live-1";
    const taskFilePath =
      "/Users/youmin/.lime/tasks/image_generate/task-image-external-live-1.json";
    const artifactPath =
      ".lime/tasks/image_generate/task-image-external-live-1.json";
    let listener: CreationTaskListener | null = null;
    vi.mocked(safeListen).mockImplementationOnce(async (event, handler) => {
      expect(event).toBe("lime://creation_task_submitted");
      listener = handler;
      return vi.fn();
    });
    vi.mocked(readFilePreview).mockRejectedValueOnce(
      new Error("task file temporarily unavailable"),
    );
    vi.mocked(getMediaTaskArtifact).mockResolvedValueOnce(
      createArtifactOutput({
        task_id: taskId,
        task_type: "image_generate",
        absolute_path: taskFilePath,
        artifact_path: artifactPath,
        absolute_artifact_path: taskFilePath,
        record: withDefaultTaskContext({
          task_id: taskId,
          task_type: "image_generate",
          task_family: "image",
          status: "completed",
          normalized_status: "succeeded",
          created_at: "2026-04-04T12:30:00Z",
          payload: {
            prompt: "[img:工作区外完成的三国主视觉]",
            count: 1,
            size: "1024x1024",
          },
          result: {
            images: [{ url: "https://example.com/external-live.png" }],
          },
        }),
      }),
    );

    const { render, getValue } = renderHook();
    await render();

    await act(async () => {
      listener?.({
        payload: withDefaultTaskContext({
          task_id: taskId,
          task_type: "image_generate",
          task_family: "image",
          status: "running",
          path: artifactPath,
          absolute_path: taskFilePath,
          prompt: "工作区外完成的三国主视觉",
        }),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(getMediaTaskArtifact).toHaveBeenCalledWith({
        projectRootPath: "/Users/youmin",
        taskRef: taskFilePath,
      });
    });

    await vi.waitFor(() => {
      expect(getValue().messages).toEqual([
        expect.objectContaining({
          id: `image-workbench:${taskId}:assistant`,
          imageWorkbenchPreview: expect.objectContaining({
            taskId,
            status: "complete",
            imageUrl: "https://example.com/external-live.png",
            taskFilePath,
            artifactPath,
          }),
        }),
      ]);
    });
  });

  it("浏览器开发模式下不应触发工作区级图片任务全量恢复", async () => {
    vi.mocked(hasTauriInvokeCapability).mockReturnValue(false);
    vi.mocked(hasTauriRuntimeMarkers).mockReturnValue(false);

    const { render, getValue } = renderHook();
    await render();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(listMediaTaskArtifacts).not.toHaveBeenCalled();
    expect(listDirectory).not.toHaveBeenCalled();
    expect(readFilePreview).not.toHaveBeenCalled();
    expect(getValue().messages).toEqual([]);
    expect(getValue().imageWorkbenchState.tasks).toEqual([]);
  });

  it("浏览器开发模式下事件丢失时，应按当前会话补捞最近的图片任务卡", async () => {
    vi.setSystemTime(new Date("2026-04-04T11:06:00Z"));
    vi.mocked(hasTauriInvokeCapability).mockReturnValue(false);
    vi.mocked(hasTauriRuntimeMarkers).mockReturnValue(false);
    vi.mocked(listMediaTaskArtifacts).mockResolvedValueOnce({
      success: true,
      workspace_root: DEFAULT_PROJECT_ROOT_PATH,
      artifact_root: `${DEFAULT_PROJECT_ROOT_PATH}/.lime/tasks`,
      filters: {
        task_family: "image",
        limit: 8,
      },
      total: 1,
      modality_runtime_contracts: EMPTY_MODALITY_RUNTIME_CONTRACT_INDEX,
      tasks: [
        createArtifactOutput({
          task_id: "task-image-browser-recover-1",
          task_type: "image_generate",
          record: withDefaultTaskContext({
            task_id: "task-image-browser-recover-1",
            task_type: "image_generate",
            task_family: "image",
            status: "running",
            normalized_status: "running",
            created_at: "2026-04-04T11:05:00Z",
            payload: {
              prompt: "三国主要人物群像，电影感",
              count: 9,
              layout_hint: "storyboard_3x3",
              size: "1024x1024",
            },
            progress: {
              phase: "running",
              message: "图片生成中，已返回 3/9 张。",
            },
            result: {
              requested_count: 9,
              received_count: 3,
              images: [
                { url: "https://example.com/browser-recover-1.png" },
                { url: "https://example.com/browser-recover-2.png" },
                { url: "https://example.com/browser-recover-3.png" },
              ],
            },
          }),
        }),
      ],
    });

    const { render, getValue } = renderHook(
      {},
      {
        initialMessages: [
          {
            id: "user-image-browser-recover-1",
            role: "user",
            content: "@分镜 生成 三国主要人物群像，3x3 分镜，电影感，出 9 张",
            timestamp: new Date("2026-04-04T11:05:00Z"),
          },
          {
            id: "assistant-image-browser-recover-1",
            role: "assistant",
            content:
              "我先按你的描述整理画面主题、尺寸和出图数量，并创建异步图片任务：三国主要人物群像，电影感",
            timestamp: new Date("2026-04-04T11:05:03Z"),
            isThinking: true,
            toolCalls: [
              {
                id: "tool-image-browser-recover-1",
                name: "image_generate",
                status: "running",
                startTime: new Date("2026-04-04T11:05:03Z"),
              },
            ],
            contentParts: [
              {
                type: "tool_use",
                toolCall: {
                  id: "tool-image-browser-recover-1",
                  name: "image_generate",
                  status: "running",
                  startTime: new Date("2026-04-04T11:05:03Z"),
                },
              },
            ],
          },
        ],
      },
    );
    await render();

    await vi.waitFor(() => {
      expect(listMediaTaskArtifacts).toHaveBeenCalledWith({
        projectRootPath: DEFAULT_PROJECT_ROOT_PATH,
        taskFamily: "image",
        limit: 8,
      });
    });

    await vi.waitFor(() => {
      expect(getValue().messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            imageWorkbenchPreview: expect.objectContaining({
              taskId: "task-image-browser-recover-1",
              status: "running",
              imageCount: 3,
              expectedImageCount: 9,
              layoutHint: "storyboard_3x3",
            }),
          }),
        ]),
      );
    });
  });

  it("同一历史会话已缓存图片工作台结果时，应直接回填聊天卡而不是继续显示等待队列", async () => {
    const taskId = "task-image-history-cached-1";
    const cachedState = {
      ...createInitialSessionImageWorkbenchState(),
      tasks: [
        {
          sessionId: taskId,
          id: taskId,
          mode: "generate" as const,
          status: "complete" as const,
          prompt: "已缓存的广州主视觉",
          rawText: "已缓存的广州主视觉",
          expectedCount: 1,
          outputIds: [`${taskId}:output:1`],
          createdAt: Date.now(),
          hookImageIds: [`${taskId}:hook:1`],
          applyTarget: null,
        },
      ],
      outputs: [
        {
          id: `${taskId}:output:1`,
          taskId,
          hookImageId: `${taskId}:hook:1`,
          refId: `img-${taskId}`,
          url: "https://example.com/history-cached.png",
          prompt: "已缓存的广州主视觉",
          createdAt: Date.now(),
          size: "1024x1024",
          parentOutputId: null,
          resourceSaved: false,
          applyTarget: null,
        },
      ],
      selectedOutputId: `${taskId}:output:1`,
    };

    const { render, getValue } = renderHook(
      {},
      {
        initialMessages: [
          {
            id: `image-workbench:${taskId}:assistant`,
            role: "assistant",
            content: "图片任务已提交，正在同步任务状态。",
            timestamp: new Date("2026-04-04T12:10:00Z"),
            isThinking: true,
            imageWorkbenchPreview: {
              taskId,
              prompt: "已缓存的广州主视觉",
              status: "running",
              phase: "queued",
            },
          },
        ],
        initialImageWorkbenchState: cachedState,
      },
    );
    await render();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getValue().messages).toEqual([
      expect.objectContaining({
        id: `image-workbench:${taskId}:assistant`,
        content: "图片任务已完成，共生成 1 张。",
        isThinking: false,
        runtimeStatus: undefined,
        imageWorkbenchPreview: expect.objectContaining({
          taskId,
          status: "complete",
          imageUrl: "https://example.com/history-cached.png",
          size: "1024x1024",
          phase: "succeeded",
          statusMessage: null,
        }),
      }),
    ]);
  });

  it("进入会话时只有缓存工作台状态也应立即补出图片预览卡", async () => {
    const taskId = "task-image-history-state-only-1";
    const cachedState = {
      ...createInitialSessionImageWorkbenchState(),
      tasks: [
        {
          sessionId: taskId,
          id: taskId,
          mode: "generate" as const,
          status: "complete" as const,
          prompt: "三国人物插画",
          rawText: "@配图 生成 三国人物插画",
          expectedCount: 1,
          outputIds: [`${taskId}:output:1`],
          createdAt: Date.now(),
          hookImageIds: [`${taskId}:hook:1`],
          applyTarget: null,
        },
      ],
      outputs: [
        {
          id: `${taskId}:output:1`,
          taskId,
          hookImageId: `${taskId}:hook:1`,
          refId: `img-${taskId}`,
          url: "https://example.com/three-kingdoms-state-only.png",
          prompt: "三国人物插画",
          createdAt: Date.now(),
          size: "1024x1024",
          parentOutputId: null,
          resourceSaved: false,
          applyTarget: null,
        },
      ],
      selectedOutputId: `${taskId}:output:1`,
    };

    const { render, getValue } = renderHook(
      {},
      {
        initialImageWorkbenchState: cachedState,
      },
    );
    await render();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getValue().messages).toEqual([
      expect.objectContaining({
        id: `image-workbench:${taskId}:assistant`,
        content: "图片任务已完成，共生成 1 张。",
        isThinking: false,
        imageWorkbenchPreview: expect.objectContaining({
          taskId,
          status: "complete",
          imageUrl: "https://example.com/three-kingdoms-state-only.png",
          previewImages: ["https://example.com/three-kingdoms-state-only.png"],
        }),
      }),
    ]);
    expect(getValue().imageWorkbenchState.tasks[0]?.id).toBe(taskId);
  });

  it("历史消息是富文本提交模板时，也应被已缓存终态整卡替换", async () => {
    const taskId = "task-image-history-rich-1";
    const cachedState = {
      ...createInitialSessionImageWorkbenchState(),
      tasks: [
        {
          sessionId: taskId,
          id: taskId,
          mode: "generate" as const,
          status: "complete" as const,
          prompt: "三国主要人物聚合图",
          rawText: "@配图 生成 三国主要人物聚合图",
          expectedCount: 1,
          outputIds: [`${taskId}:output:1`],
          createdAt: Date.now(),
          hookImageIds: [`${taskId}:hook:1`],
          applyTarget: null,
        },
      ],
      outputs: [
        {
          id: `${taskId}:output:1`,
          taskId,
          hookImageId: `${taskId}:hook:1`,
          refId: `img-${taskId}`,
          url: "https://example.com/three-kingdoms-rich.png",
          prompt: "三国主要人物聚合图",
          createdAt: Date.now(),
          size: "1024x1024",
          parentOutputId: null,
          resourceSaved: false,
          applyTarget: null,
        },
      ],
      selectedOutputId: `${taskId}:output:1`,
    };

    const { render, getValue } = renderHook(
      {},
      {
        initialMessages: [
          {
            id: "assistant-rich-image-history-1",
            role: "assistant",
            content:
              "图片生成任务已成功提交！\n任务详情：\n任务ID：task-image-history-rich-1\n状态：pending_submit（等待进入队列）\n模型：cogview-3-flash\n尺寸：1024x1024\n提示词：三国主要人物聚合图\n下一步流程：\n任务将进入生成队列\n系统会自动轮询生成进度\n当前状态：任务已创建，正在等待 AI 模型处理。",
            timestamp: new Date("2026-04-04T12:11:00Z"),
            isThinking: true,
            imageWorkbenchPreview: {
              taskId,
              prompt: "三国主要人物聚合图",
              status: "running",
              phase: "queued",
              statusMessage: "任务已提交，正在排队处理。",
            },
          },
        ],
        initialImageWorkbenchState: cachedState,
      },
    );
    await render();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getValue().messages).toEqual([
      expect.objectContaining({
        id: "assistant-rich-image-history-1",
        content: "图片任务已完成，共生成 1 张。",
        isThinking: false,
        runtimeStatus: undefined,
        toolCalls: [
          expect.objectContaining({
            name: "limeCreateImageGenerationTask",
            status: "completed",
          }),
        ],
        imageWorkbenchPreview: expect.objectContaining({
          taskId,
          status: "complete",
          imageUrl: "https://example.com/three-kingdoms-rich.png",
          phase: "succeeded",
          statusMessage: null,
        }),
      }),
    ]);
  });

  it("已缓存终态存在时，后续 pending 事件重写聊天卡后也应再次回填完成结果", async () => {
    const taskId = "task-image-history-reapply-1";
    let listener: CreationTaskListener | null = null;
    vi.mocked(safeListen).mockImplementationOnce(async (_event, handler) => {
      listener = handler;
      return vi.fn();
    });

    const cachedState = {
      ...createInitialSessionImageWorkbenchState(),
      tasks: [
        {
          sessionId: taskId,
          id: taskId,
          mode: "generate" as const,
          status: "complete" as const,
          prompt: "已缓存的三国群像",
          rawText: "@配图 生成 已缓存的三国群像",
          expectedCount: 1,
          outputIds: [`${taskId}:output:1`],
          createdAt: Date.now(),
          hookImageIds: [`${taskId}:hook:1`],
          applyTarget: null,
        },
      ],
      outputs: [
        {
          id: `${taskId}:output:1`,
          taskId,
          hookImageId: `${taskId}:hook:1`,
          refId: `img-${taskId}`,
          url: "https://example.com/three-kingdoms-reapply.png",
          prompt: "已缓存的三国群像",
          createdAt: Date.now(),
          size: "1024x1024",
          parentOutputId: null,
          resourceSaved: false,
          applyTarget: null,
        },
      ],
      selectedOutputId: `${taskId}:output:1`,
    };

    const { render, getValue } = renderHook(
      {},
      {
        initialImageWorkbenchState: cachedState,
      },
    );
    await render();

    await act(async () => {
      listener?.({
        payload: withDefaultTaskContext({
          task_id: taskId,
          task_type: "image_generate",
          task_family: "image",
          status: "pending_submit",
          path: `.lime/tasks/image_generate/${taskId}.json`,
          prompt: "已缓存的三国群像",
        }),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getValue().messages).toEqual([
      expect.objectContaining({
        id: `image-workbench:${taskId}:assistant`,
        content: "图片任务已完成，共生成 1 张。",
        isThinking: false,
        runtimeStatus: undefined,
        imageWorkbenchPreview: expect.objectContaining({
          taskId,
          status: "complete",
          imageUrl: "https://example.com/three-kingdoms-reapply.png",
          phase: "succeeded",
          statusMessage: null,
        }),
      }),
    ]);
  });

  it("已缓存的 3x3 分镜终态应保留多图预览与布局提示", async () => {
    const taskId = "task-image-storyboard-cache-1";
    const outputIds = Array.from(
      { length: 9 },
      (_, index) => `${taskId}:output:${index + 1}`,
    );
    const cachedState = {
      ...createInitialSessionImageWorkbenchState(),
      tasks: [
        {
          sessionId: taskId,
          id: taskId,
          mode: "generate" as const,
          status: "complete" as const,
          prompt: "三国主要人物九宫格分镜",
          rawText: "@分镜 生成 三国主要人物九宫格分镜",
          expectedCount: 9,
          outputIds,
          layoutHint: "storyboard_3x3",
          createdAt: Date.now(),
          hookImageIds: outputIds.map(
            (_outputId, index) => `${taskId}:hook:${index + 1}`,
          ),
          applyTarget: null,
        },
      ],
      outputs: outputIds.map((outputId, index) => ({
        id: outputId,
        taskId,
        hookImageId: `${taskId}:hook:${index + 1}`,
        refId: `img-${taskId}-${index + 1}`,
        url: `https://example.com/storyboard-cache-${index + 1}.png`,
        prompt: `分镜 ${index + 1}`,
        createdAt: Date.now() + index,
        size: "1024x1024",
        parentOutputId: null,
        resourceSaved: false,
        applyTarget: null,
      })),
      selectedOutputId: outputIds[0],
    };

    const { render, getValue } = renderHook(
      {},
      {
        initialMessages: [
          {
            id: "assistant-storyboard-image-history-1",
            role: "assistant",
            content:
              "图片生成任务已成功提交！\n任务详情：\n任务ID：task-image-storyboard-cache-1\n状态：pending_submit（等待进入队列）\n模型：gpt-image-2\n尺寸：1024x1024\n提示词：三国主要人物九宫格分镜\n下一步流程：\n任务将进入生成队列\n系统会自动轮询生成进度\n当前状态：任务已创建，正在等待 AI 模型处理。",
            timestamp: new Date("2026-04-04T12:12:00Z"),
            isThinking: true,
            imageWorkbenchPreview: {
              taskId,
              prompt: "三国主要人物九宫格分镜",
              status: "running",
              phase: "queued",
              statusMessage: "任务已提交，正在排队处理。",
            },
          },
        ],
        initialImageWorkbenchState: cachedState,
      },
    );
    await render();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getValue().messages).toEqual([
      expect.objectContaining({
        imageWorkbenchPreview: expect.objectContaining({
          taskId,
          status: "complete",
          layoutHint: "storyboard_3x3",
          imageUrl: "https://example.com/storyboard-cache-1.png",
          previewImages: Array.from(
            { length: 9 },
            (_, index) =>
              `https://example.com/storyboard-cache-${index + 1}.png`,
          ),
        }),
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
        withDefaultTaskContext({
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
        }),
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

  it("进入旧会话时不应从工作区恢复陈旧非终态图片任务", async () => {
    vi.setSystemTime(new Date("2026-04-27T00:00:00Z"));
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
              name: "task-image-stale-pending.json",
              path: "/workspace/project-image-1/.lime/tasks/image_generate/task-image-stale-pending.json",
              isDir: false,
              size: 512,
              modifiedAt: Date.now(),
            },
          ],
        ),
      );
    vi.mocked(readFilePreview).mockResolvedValueOnce(
      createFilePreviewResult(
        "/workspace/project-image-1/.lime/tasks/image_generate/task-image-stale-pending.json",
        withDefaultTaskContext({
          task_id: "task-image-stale-pending",
          task_type: "image_generate",
          task_family: "image",
          status: "pending_submit",
          normalized_status: "pending",
          created_at: "2026-04-23T21:14:06Z",
          payload: {
            prompt: "[img:旧会话里陈旧的排队图片任务]",
            count: 1,
          },
        }),
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
      "/workspace/project-image-1/.lime/tasks/image_generate/task-image-stale-pending.json",
      256 * 1024,
    );
    expect(getValue().messages).toEqual([]);
    expect(getValue().imageWorkbenchState.tasks).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4500);
      await Promise.resolve();
    });

    expect(readFilePreview).toHaveBeenCalledTimes(1);
    expect(getMediaTaskArtifact).not.toHaveBeenCalled();
  });

  it("空白新任务首页应允许关闭 task file 自动恢复", async () => {
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

    const { render, getValue } = renderHook({
      restoreFromWorkspace: false,
    });
    await render();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(listDirectory).not.toHaveBeenCalled();
    expect(readFilePreview).not.toHaveBeenCalled();
    expect(getValue().messages).toEqual([]);
    expect(getValue().imageWorkbenchState.tasks).toEqual([]);
  });

  it("存在本地图片 session 作用域时不应只凭 projectId 恢复旧任务", async () => {
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
              name: "task-image-project-only.json",
              path: "/workspace/project-image-1/.lime/tasks/image_generate/task-image-project-only.json",
              isDir: false,
              size: 512,
              modifiedAt: Date.now(),
            },
          ],
        ),
      );
    vi.mocked(readFilePreview).mockResolvedValueOnce(
      createFilePreviewResult(
        "/workspace/project-image-1/.lime/tasks/image_generate/task-image-project-only.json",
        {
          task_id: "task-image-project-only",
          task_type: "image_generate",
          task_family: "image",
          status: "cancelled",
          normalized_status: "cancelled",
          created_at: new Date().toISOString(),
          project_id: "project-image-1",
          payload: {
            prompt: "旧图片任务",
            project_id: "project-image-1",
          },
        },
      ),
    );

    const { render, getValue } = renderHook({
      sessionId: "local-image-session-new-task-1",
      contentId: null,
    });
    await render();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getValue().messages).toEqual([]);
    expect(getValue().imageWorkbenchState.tasks).toEqual([]);
  });

  it("存在本地图片 session 作用域时不应接收其他新任务页的图片事件", async () => {
    let listener: CreationTaskListener | null = null;
    vi.mocked(safeListen).mockImplementationOnce(async (_event, handler) => {
      listener = handler;
      return vi.fn();
    });

    const { render, getValue } = renderHook({
      sessionId: "local-image-session-new-task-1",
      contentId: null,
    });
    await render();

    await act(async () => {
      listener?.({
        payload: {
          task_id: "task-image-other-local-session",
          task_type: "image_generate",
          task_family: "image",
          status: "pending_submit",
          session_id: "local-image-session-new-task-2",
          project_id: "project-image-1",
          path: ".lime/tasks/image/task-image-other-local-session.json",
        },
      });
      await Promise.resolve();
    });

    expect(getValue().messages).toEqual([]);
    expect(getValue().imageWorkbenchState.tasks).toEqual([]);
  });

  it("恢复文稿 inline 图片任务时应优先使用 relationships.slot_id 原位替换", async () => {
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
              name: "task-image-inline-restored.json",
              path: "/workspace/project-image-1/.lime/tasks/image_generate/task-image-inline-restored.json",
              isDir: false,
              size: 512,
              modifiedAt: Date.now(),
            },
          ],
        ),
      );
    vi.mocked(readFilePreview).mockResolvedValueOnce(
      createFilePreviewResult(
        "/workspace/project-image-1/.lime/tasks/image_generate/task-image-inline-restored.json",
        {
          task_id: "task-image-inline-restored",
          task_type: "image_generate",
          task_family: "image",
          status: "completed",
          normalized_status: "succeeded",
          created_at: new Date().toISOString(),
          relationships: {
            slot_id: "document-slot-inline-restored",
          },
          payload: {
            prompt: "恢复正文配图",
            count: 1,
            size: "1024x1024",
            usage: "document-inline",
            session_id: "session-image-1",
            project_id: "project-image-1",
            content_id: "content-image-1",
          },
          result: {
            images: [{ url: "https://example.com/restored-inline-lime.png" }],
          },
          attempts: [
            {
              attempt_id: "attempt-inline-restored-1",
              result_snapshot: {
                images: [
                  { url: "https://example.com/restored-inline-lime.png" },
                ],
              },
            },
          ],
        },
      ),
    );

    const { render, getValue } = renderHook({
      canvasState: createInitialDocumentState(
        "# 标题\n\n![恢复正文配图](pending-image-task://legacy-inline-task?status=running&prompt=%E6%81%A2%E5%A4%8D%E6%AD%A3%E6%96%87%E9%85%8D%E5%9B%BE)\n<!-- lime:image-task-slot:document-slot-inline-restored -->\n",
      ),
    });
    await render();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getValue().canvasState?.type).toBe("document");
    expect(getDocumentCanvasContent(getValue().canvasState)).toContain(
      "https://example.com/restored-inline-lime.png",
    );
    expect(getDocumentCanvasContent(getValue().canvasState)).not.toContain(
      "pending-image-task://",
    );
  });

  it("恢复文稿 inline 图片任务时，在缺少占位 marker 的情况下应按 anchor_section_title 插入到目标小节", async () => {
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
              name: "task-image-inline-section.json",
              path: "/workspace/project-image-1/.lime/tasks/image_generate/task-image-inline-section.json",
              isDir: false,
              size: 512,
              modifiedAt: Date.now(),
            },
          ],
        ),
      );
    vi.mocked(readFilePreview).mockResolvedValueOnce(
      createFilePreviewResult(
        "/workspace/project-image-1/.lime/tasks/image_generate/task-image-inline-section.json",
        {
          task_id: "task-image-inline-section",
          task_type: "image_generate",
          task_family: "image",
          status: "completed",
          normalized_status: "succeeded",
          created_at: new Date().toISOString(),
          relationships: {
            slot_id: "document-slot-inline-section",
          },
          payload: {
            prompt: "为正文生成一张核心观点配图",
            count: 1,
            size: "1024x1024",
            usage: "document-inline",
            anchor_section_title: "核心观点",
            anchor_text: "这里是被选中的核心观点段落。",
            session_id: "session-image-1",
            project_id: "project-image-1",
            content_id: "content-image-1",
          },
          result: {
            images: [
              { url: "https://example.com/restored-inline-section.png" },
            ],
          },
          attempts: [
            {
              attempt_id: "attempt-inline-section-1",
              result_snapshot: {
                images: [
                  { url: "https://example.com/restored-inline-section.png" },
                ],
              },
            },
          ],
        },
      ),
    );

    const baseContent = `# 标题

## 开场
这里是开场。

## 核心观点
这里是被选中的核心观点段落。

这里是核心观点补充说明。

## 收尾
这里是结尾。`;
    const { render, getValue } = renderHook({
      canvasState: createInitialDocumentState(baseContent),
    });
    await render();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const nextContent = getDocumentCanvasContent(getValue().canvasState);
    const imageIndex = nextContent.indexOf(
      "https://example.com/restored-inline-section.png",
    );
    expect(imageIndex).toBeGreaterThan(
      nextContent.indexOf("这里是被选中的核心观点段落。"),
    );
    expect(imageIndex).toBeLessThan(
      nextContent.indexOf("这里是核心观点补充说明。"),
    );
  });

  it("应将 cancelled task file 映射为独立取消状态，而不是失败状态", async () => {
    let listener: CreationTaskListener | null = null;
    vi.mocked(safeListen).mockImplementationOnce(async (event, handler) => {
      expect(event).toBe("lime://creation_task_submitted");
      listener = handler;
      return vi.fn();
    });

    vi.mocked(readFilePreview).mockResolvedValueOnce(
      createFilePreviewResult(
        "/workspace/project-image-1/.lime/tasks/image_generate/task-image-cancelled-1.json",
        withDefaultTaskContext({
          task_id: "task-image-cancelled-1",
          task_type: "image_generate",
          task_family: "image",
          status: "cancelled",
          normalized_status: "cancelled",
          created_at: "2026-04-04T11:00:00Z",
          payload: {
            prompt: "一只坐在键盘前的青柠",
            count: 1,
            size: "1024x1024",
          },
        }),
      ),
    );

    const { render, getValue } = renderHook();
    await render();

    await act(async () => {
      listener?.({
        payload: withDefaultTaskContext({
          task_id: "task-image-cancelled-1",
          task_type: "image_generate",
          task_family: "image",
          status: "cancelled",
          path: ".lime/tasks/image_generate/task-image-cancelled-1.json",
        }),
      });
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(readFilePreview).toHaveBeenCalledWith(
        "/workspace/project-image-1/.lime/tasks/image_generate/task-image-cancelled-1.json",
        256 * 1024,
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getValue().messages).toEqual([
      expect.objectContaining({
        content: expect.stringContaining("图片任务已取消"),
        isThinking: false,
        imageWorkbenchPreview: expect.objectContaining({
          taskId: "task-image-cancelled-1",
          status: "cancelled",
        }),
        runtimeStatus: expect.objectContaining({
          phase: "cancelled",
          title: "图片任务已取消",
        }),
      }),
    ]);
    expect(getValue().imageWorkbenchState.tasks).toEqual([
      expect.objectContaining({
        id: "task-image-cancelled-1",
        status: "cancelled",
      }),
    ]);
  });

  it("取消后的同 prompt 新任务到达时，应追加新任务而不是复用旧取消卡", async () => {
    let listener: CreationTaskListener | null = null;
    vi.mocked(safeListen).mockImplementationOnce(async (event, handler) => {
      expect(event).toBe("lime://creation_task_submitted");
      listener = handler;
      return vi.fn();
    });

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
              name: "task-image-cancelled-1.json",
              path: "/workspace/project-image-1/.lime/tasks/image_generate/task-image-cancelled-1.json",
              isDir: false,
              size: 512,
              modifiedAt: Date.now(),
            },
          ],
        ),
      );
    vi.mocked(readFilePreview)
      .mockResolvedValueOnce(
        createFilePreviewResult(
          "/workspace/project-image-1/.lime/tasks/image_generate/task-image-cancelled-1.json",
          withDefaultTaskContext({
            task_id: "task-image-cancelled-1",
            task_type: "image_generate",
            task_family: "image",
            status: "cancelled",
            normalized_status: "cancelled",
            created_at: "2026-04-04T11:00:00Z",
            payload: {
              prompt: "青柠实验室主视觉",
              count: 1,
              size: "1024x1024",
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        createFilePreviewResult(
          "/workspace/project-image-1/.lime/tasks/image_generate/task-image-new-1.json",
          withDefaultTaskContext({
            task_id: "task-image-new-1",
            task_type: "image_generate",
            task_family: "image",
            status: "running",
            normalized_status: "running",
            created_at: "2026-04-04T11:10:00Z",
            payload: {
              prompt: "青柠实验室主视觉",
              count: 1,
              size: "1024x1024",
            },
            progress: {
              message: "正在绘制新一版构图",
            },
          }),
        ),
      );

    const { render, getValue } = renderHook();
    await render();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getValue().messages).toEqual([
      expect.objectContaining({
        id: "image-workbench:task-image-cancelled-1:assistant",
        content: "图片任务已取消。",
        imageWorkbenchPreview: expect.objectContaining({
          taskId: "task-image-cancelled-1",
          status: "cancelled",
        }),
      }),
    ]);

    await act(async () => {
      listener?.({
        payload: withDefaultTaskContext({
          task_id: "task-image-new-1",
          task_type: "image_generate",
          task_family: "image",
          status: "pending_submit",
          path: ".lime/tasks/image_generate/task-image-new-1.json",
          prompt: "青柠实验室主视觉",
          count: 1,
          size: "1024x1024",
        }),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getValue().messages).toEqual([
      expect.objectContaining({
        id: "image-workbench:task-image-cancelled-1:assistant",
        content: "图片任务已取消。",
        imageWorkbenchPreview: expect.objectContaining({
          taskId: "task-image-cancelled-1",
          status: "cancelled",
        }),
      }),
      expect.objectContaining({
        id: "image-workbench:task-image-new-1:assistant",
        content: "图片任务正在生成中。",
        isThinking: true,
        imageWorkbenchPreview: expect.objectContaining({
          taskId: "task-image-new-1",
          status: "running",
          prompt: "青柠实验室主视觉",
        }),
        runtimeStatus: expect.objectContaining({
          detail: "正在绘制新一版构图",
        }),
      }),
    ]);
    expect(getValue().imageWorkbenchState.tasks).toEqual([
      expect.objectContaining({
        id: "task-image-new-1",
        status: "running",
      }),
      expect.objectContaining({
        id: "task-image-cancelled-1",
        status: "cancelled",
      }),
    ]);
  });

  it("文稿 inline 图片任务应先写入占位块，再在成功后原位替换为真实图片", async () => {
    let listener: CreationTaskListener | null = null;
    vi.mocked(safeListen).mockImplementationOnce(async (_event, handler) => {
      listener = handler;
      return vi.fn();
    });

    const taskPath =
      "/workspace/project-image-1/.lime/tasks/image/image_generate/task-image-inline-1.json";
    const firstPreview = createDeferred<FilePreview>();
    vi.mocked(readFilePreview).mockImplementationOnce(
      () => firstPreview.promise,
    );
    vi.mocked(readFilePreview).mockResolvedValueOnce(
      createFilePreviewResult(
        taskPath,
        withDefaultTaskContext({
          task_id: "task-image-inline-1",
          task_type: "image_generate",
          task_family: "image",
          status: "completed",
          normalized_status: "succeeded",
          created_at: "2026-04-04T12:30:00Z",
          payload: {
            prompt: "为正文补一张未来感实验室插图",
            count: 1,
            size: "1024x1024",
            usage: "document-inline",
            anchor_section_title: "核心观点",
            anchor_text: "这里是被选中的核心观点段落。",
          },
          relationships: {
            slot_id: "document-slot-inline-1",
          },
          result: {
            images: [{ url: "https://example.com/generated-inline-lime.png" }],
          },
          attempts: [
            {
              attempt_id: "attempt-inline-1",
              result_snapshot: {
                images: [
                  { url: "https://example.com/generated-inline-lime.png" },
                ],
              },
            },
          ],
        }),
      ),
    );

    const { render, getValue } = renderHook({
      canvasState: createInitialDocumentState(`# 标题

## 开场
这里是开场。

## 核心观点
这里是被选中的核心观点段落。

这里是核心观点补充说明。

## 收尾
这里是结尾。`),
    });
    await render();

    await act(async () => {
      listener?.({
        payload: withDefaultTaskContext({
          task_id: "task-image-inline-1",
          task_type: "image_generate",
          task_family: "image",
          status: "pending_submit",
          path: ".lime/tasks/image/image_generate/task-image-inline-1.json",
          prompt: "为正文补一张未来感实验室插图",
          slot_id: "document-slot-inline-1",
          anchor_section_title: "核心观点",
          anchor_text: "这里是被选中的核心观点段落。",
        }),
      });
      await Promise.resolve();
    });

    expect(getValue().canvasState?.type).toBe("document");
    expect(getDocumentCanvasContent(getValue().canvasState)).toContain(
      "pending-image-task://",
    );
    expect(getDocumentCanvasContent(getValue().canvasState)).toContain(
      "lime:image-task-slot:document-slot-inline-1",
    );
    const pendingContent = getDocumentCanvasContent(getValue().canvasState);
    const placeholderIndex = pendingContent.indexOf("pending-image-task://");
    expect(placeholderIndex).toBeGreaterThan(
      pendingContent.indexOf("这里是被选中的核心观点段落。"),
    );
    expect(placeholderIndex).toBeLessThan(
      pendingContent.indexOf("这里是核心观点补充说明。"),
    );

    await act(async () => {
      firstPreview.resolve(
        createFilePreviewResult(
          taskPath,
          withDefaultTaskContext({
            task_id: "task-image-inline-1",
            task_type: "image_generate",
            task_family: "image",
            status: "completed",
            normalized_status: "succeeded",
            created_at: "2026-04-04T12:30:00Z",
            payload: {
              prompt: "为正文补一张未来感实验室插图",
              count: 1,
              size: "1024x1024",
              usage: "document-inline",
              anchor_section_title: "核心观点",
              anchor_text: "这里是被选中的核心观点段落。",
            },
            relationships: {
              slot_id: "document-slot-inline-1",
            },
            result: {
              images: [
                { url: "https://example.com/generated-inline-lime.png" },
              ],
            },
            attempts: [
              {
                attempt_id: "attempt-inline-1",
                result_snapshot: {
                  images: [
                    { url: "https://example.com/generated-inline-lime.png" },
                  ],
                },
              },
            ],
          }),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getDocumentCanvasContent(getValue().canvasState)).toContain(
      "https://example.com/generated-inline-lime.png",
    );
    const finalContent = getDocumentCanvasContent(getValue().canvasState);
    const imageIndex = finalContent.indexOf(
      "https://example.com/generated-inline-lime.png",
    );
    expect(imageIndex).toBeGreaterThan(
      finalContent.indexOf("这里是被选中的核心观点段落。"),
    );
    expect(imageIndex).toBeLessThan(
      finalContent.indexOf("这里是核心观点补充说明。"),
    );
    expect(getDocumentCanvasContent(getValue().canvasState)).not.toContain(
      "pending-image-task://",
    );
  });
});
