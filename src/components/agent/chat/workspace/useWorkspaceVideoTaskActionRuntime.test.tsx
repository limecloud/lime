import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emitVideoWorkbenchTaskAction } from "@/lib/videoWorkbenchEvents";
import type { Message, MessageVideoTaskPreview } from "../types";
import { useWorkspaceVideoTaskActionRuntime } from "./useWorkspaceVideoTaskActionRuntime";

const { mockCancelTask, mockCreateTask, mockGetTask, toast } = vi.hoisted(
  () => ({
    mockCancelTask: vi.fn(),
    mockCreateTask: vi.fn(),
    mockGetTask: vi.fn(),
    toast: {
      error: vi.fn(),
      success: vi.fn(),
    },
  }),
);

vi.mock("sonner", () => ({
  toast,
}));

vi.mock("@/lib/api/videoGeneration", () => ({
  videoGenerationApi: {
    getTask: mockGetTask,
    createTask: mockCreateTask,
    cancelTask: mockCancelTask,
  },
}));

type HookProps = Parameters<typeof useWorkspaceVideoTaskActionRuntime>[0];

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];

function buildFailedVideoPreview(): MessageVideoTaskPreview {
  return {
    kind: "video_generate",
    taskId: "task-video-old",
    taskType: "video_generate",
    prompt: "新品发布会短视频",
    status: "failed",
    durationSeconds: 15,
    aspectRatio: "16:9",
    resolution: "720p",
    projectId: "project-video-1",
    contentId: "content-video-1",
    providerId: "doubao",
    model: "seedance-1-5-pro-251215",
  };
}

function buildFailedVideoMessage(): Message {
  return {
    id: "msg-video-failed-1",
    role: "assistant",
    content: "视频任务失败。",
    timestamp: new Date(),
    taskPreview: buildFailedVideoPreview(),
  };
}

function buildRunningVideoPreview(): MessageVideoTaskPreview {
  return {
    ...buildFailedVideoPreview(),
    taskId: "task-video-running",
    status: "running",
    progress: 32,
    statusMessage: "视频任务正在生成中，工作区会继续同步最新状态。",
  };
}

function buildRunningVideoMessage(): Message {
  return {
    id: "msg-video-running-1",
    role: "assistant",
    content: "视频任务进行中。",
    timestamp: new Date(),
    taskPreview: buildRunningVideoPreview(),
  };
}

function renderHook(props: HookProps) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  function Probe(currentProps: HookProps) {
    useWorkspaceVideoTaskActionRuntime(currentProps);
    return null;
  }

  const render = async () => {
    await act(async () => {
      root.render(<Probe {...props} />);
      await Promise.resolve();
    });
  };

  mountedRoots.push({ container, root });
  return { render };
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mockCancelTask.mockReset();
  mockCreateTask.mockReset();
  mockGetTask.mockReset();
  toast.error.mockReset();
  toast.success.mockReset();
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
});

describe("useWorkspaceVideoTaskActionRuntime", () => {
  it("应响应聊天区视频任务卡的重试动作，并把消息卡切回新的运行任务", async () => {
    let messages: Message[] = [buildFailedVideoMessage()];
    const setChatMessages: HookProps["setChatMessages"] = (value) => {
      messages = typeof value === "function" ? value(messages) : value;
    };

    mockGetTask.mockResolvedValue({
      id: "task-video-old",
      projectId: "project-video-1",
      providerId: "doubao",
      model: "seedance-1-5-pro-251215",
      prompt: "新品发布会短视频",
      requestPayload: JSON.stringify({
        projectId: "project-video-1",
        providerId: "doubao",
        model: "seedance-1-5-pro-251215",
        prompt: "新品发布会短视频",
        aspectRatio: "16:9",
        resolution: "720p",
        duration: 15,
        imageUrl: "material://start",
        endImageUrl: "material://end",
      }),
      status: "error",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    mockCreateTask.mockResolvedValue({
      id: "task-video-new",
      projectId: "project-video-1",
      providerId: "doubao",
      model: "seedance-1-5-pro-251215",
      prompt: "新品发布会短视频",
      status: "pending",
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const harness = renderHook({
      projectId: "project-video-1",
      contentId: "content-video-1",
      setChatMessages,
    });

    await harness.render();
    await act(async () => {
      emitVideoWorkbenchTaskAction({
        action: "retry",
        taskId: "task-video-old",
        projectId: "project-video-1",
        contentId: "content-video-1",
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockGetTask).toHaveBeenCalledWith("task-video-old", {
      refreshStatus: false,
    });
    expect(mockCreateTask).toHaveBeenCalledWith({
      projectId: "project-video-1",
      providerId: "doubao",
      model: "seedance-1-5-pro-251215",
      prompt: "新品发布会短视频",
      aspectRatio: "16:9",
      resolution: "720p",
      duration: 15,
      imageUrl: "material://start",
      endImageUrl: "material://end",
    });
    expect(messages[0]?.taskPreview).toMatchObject({
      kind: "video_generate",
      taskId: "task-video-new",
      status: "running",
      phase: "queued",
      videoUrl: null,
      statusMessage: "视频任务已重新提交，工作区会继续同步最新状态。",
    });
    expect(toast.success).toHaveBeenCalledWith("已重新提交视频任务");
  });

  it("应响应聊天区视频任务卡的取消动作，并立即回写已取消状态", async () => {
    let messages: Message[] = [buildRunningVideoMessage()];
    const setChatMessages: HookProps["setChatMessages"] = (value) => {
      messages = typeof value === "function" ? value(messages) : value;
    };

    mockCancelTask.mockResolvedValue({
      id: "task-video-running",
      projectId: "project-video-1",
      providerId: "doubao",
      model: "seedance-1-5-pro-251215",
      prompt: "新品发布会短视频",
      status: "cancelled",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const harness = renderHook({
      projectId: "project-video-1",
      contentId: "content-video-1",
      setChatMessages,
    });

    await harness.render();
    await act(async () => {
      emitVideoWorkbenchTaskAction({
        action: "cancel",
        taskId: "task-video-running",
        projectId: "project-video-1",
        contentId: "content-video-1",
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockCancelTask).toHaveBeenCalledWith("task-video-running");
    expect(messages[0]?.taskPreview).toMatchObject({
      kind: "video_generate",
      taskId: "task-video-running",
      status: "cancelled",
      phase: null,
      statusMessage: "视频任务已取消，当前不会继续生成新的结果。",
    });
    expect(toast.success).toHaveBeenCalledWith("已提交取消请求");
  });
});
