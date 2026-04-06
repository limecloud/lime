import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../types";
import { useWorkspaceVideoTaskPreviewRuntime } from "./useWorkspaceVideoTaskPreviewRuntime";

const { mockGetTask } = vi.hoisted(() => ({
  mockGetTask: vi.fn(),
}));

vi.mock("@/lib/api/videoGeneration", () => ({
  videoGenerationApi: {
    getTask: mockGetTask,
  },
}));

type HookProps = Parameters<typeof useWorkspaceVideoTaskPreviewRuntime>[0];

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];

function buildVideoMessage(): Message {
  return {
    id: "msg-video-1",
    role: "assistant",
    content: "视频任务已提交",
    timestamp: new Date(),
    taskPreview: {
      kind: "video_generate",
      taskId: "task-video-1",
      taskType: "video_generate",
      prompt: "新品发布会短视频",
      status: "running",
      durationSeconds: 15,
      aspectRatio: "16:9",
      resolution: "720p",
      projectId: "project-video-1",
      contentId: "content-video-1",
    },
  };
}

function renderHook(props: HookProps) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  function Probe(currentProps: HookProps) {
    useWorkspaceVideoTaskPreviewRuntime(currentProps);
    return null;
  }

  const render = async (nextProps?: Partial<HookProps>) => {
    await act(async () => {
      root.render(<Probe {...props} {...nextProps} />);
      await Promise.resolve();
    });
  };

  mountedRoots.push({ container, root });
  return {
    render,
  };
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  mockGetTask.mockReset();
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
});

describe("useWorkspaceVideoTaskPreviewRuntime", () => {
  it("应轮询运行中的视频任务，并把结果回写到消息预览卡", async () => {
    let messages: Message[] = [buildVideoMessage()];
    const setChatMessages: HookProps["setChatMessages"] = (value) => {
      messages = typeof value === "function" ? value(messages) : value;
    };

    mockGetTask.mockResolvedValue({
      id: "task-video-1",
      projectId: "project-video-1",
      providerId: "doubao",
      model: "seedance-1-5-pro-251215",
      prompt: "新品发布会短视频",
      status: "success",
      progress: 100,
      resultUrl: "https://example.com/video.mp4",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const harness = renderHook({
      messages,
      setChatMessages,
    });

    await harness.render();
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockGetTask).toHaveBeenCalledWith("task-video-1", {
      refreshStatus: true,
    });
    expect(messages[0]?.taskPreview).toMatchObject({
      kind: "video_generate",
      taskId: "task-video-1",
      status: "complete",
      videoUrl: "https://example.com/video.mp4",
      providerId: "doubao",
      model: "seedance-1-5-pro-251215",
      progress: 100,
    });
  });

  it("没有运行中的视频任务时不应触发轮询", async () => {
    const setChatMessages: HookProps["setChatMessages"] = vi.fn();
    const harness = renderHook({
      messages: [
        {
          ...buildVideoMessage(),
          taskPreview: {
            ...buildVideoMessage().taskPreview!,
            status: "complete",
          },
        },
      ],
      setChatMessages,
    });

    await harness.render();
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(mockGetTask).not.toHaveBeenCalled();
  });
});
