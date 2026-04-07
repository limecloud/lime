import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoWorkspace } from "./VideoWorkspace";
import {
  cleanupMountedRoots,
  clickElement,
  flushEffects,
  mountHarness,
  setupReactActEnvironment,
  type MountedRoot,
} from "@/components/workspace/hooks/testUtils";
import {
  createInitialVideoState,
  type VideoCanvasState,
} from "@/components/workspace/video/types";

const { mockGetAll, mockListTasks } = vi.hoisted(() => ({
  mockGetAll: vi.fn(),
  mockListTasks: vi.fn(),
}));

vi.mock("@/lib/api/skills", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api/skills")>(
      "@/lib/api/skills",
    );

  return {
    ...actual,
    skillsApi: {
      ...actual.skillsApi,
      getAll: (...args: unknown[]) => mockGetAll(...args),
    },
  };
});

vi.mock("@/lib/api/videoGeneration", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api/videoGeneration")>(
      "@/lib/api/videoGeneration",
    );

  return {
    ...actual,
    videoGenerationApi: {
      ...actual.videoGenerationApi,
      listTasks: (...args: unknown[]) => mockListTasks(...args),
    },
  };
});

const mountedRoots: MountedRoot[] = [];

function buildInitialState(): VideoCanvasState {
  return {
    ...createInitialVideoState("旧任务视频"),
    providerId: "doubao",
    model: "seedance-1-5-pro-251215",
    status: "success",
    selectedTaskId: "task-old",
    videoUrl: "https://example.com/old.mp4",
  };
}

function ControlledVideoWorkspace({
  onObservedStateChange,
}: {
  onObservedStateChange?: (state: VideoCanvasState) => void;
}) {
  const [state, setState] = useState<VideoCanvasState>(() => buildInitialState());

  return (
    <VideoWorkspace
      projectId="project-video-1"
      state={state}
      onStateChange={(nextState) => {
        onObservedStateChange?.(nextState);
        setState(nextState);
      }}
    />
  );
}

describe("VideoWorkspace 任务聚焦", () => {
  beforeEach(() => {
    setupReactActEnvironment();
    vi.clearAllMocks();
    mockGetAll.mockResolvedValue([]);
    mockListTasks.mockResolvedValue([
      {
        id: "task-latest",
        projectId: "project-video-1",
        providerId: "doubao",
        model: "seedance-1-5-pro-251215",
        prompt: "最新任务视频",
        status: "success",
        progress: 100,
        resultUrl: "https://example.com/latest.mp4",
        requestPayload: JSON.stringify({
          aspectRatio: "16:9",
          resolution: "720p",
          duration: 6,
        }),
        createdAt: 2_000,
        updatedAt: 2_100,
      },
      {
        id: "task-old",
        projectId: "project-video-1",
        providerId: "doubao",
        model: "seedance-1-5-pro-251215",
        prompt: "旧任务视频",
        status: "success",
        progress: 100,
        resultUrl: "https://example.com/old.mp4",
        requestPayload: JSON.stringify({
          aspectRatio: "9:16",
          resolution: "1080p",
          duration: 12,
        }),
        createdAt: 1_000,
        updatedAt: 1_100,
      },
    ]);
  });

  afterEach(() => {
    cleanupMountedRoots(mountedRoots);
  });

  it("应优先保持聊天区传入的 selectedTaskId，不被最新任务自动抢焦点", async () => {
    const observedStateChanges: VideoCanvasState[] = [];

    const mounted = mountHarness(
      ControlledVideoWorkspace,
      {
        onObservedStateChange: (nextState: VideoCanvasState) => {
          observedStateChanges.push(nextState);
        },
      },
      mountedRoots,
    );

    await flushEffects(8);

    expect(mockGetAll).toHaveBeenCalledWith("lime");
    expect(mockListTasks).toHaveBeenCalledWith("project-video-1", {
      limit: 50,
    });

    const oldPreviewButton = mounted.container.querySelector(
      "[data-testid='video-task-preview-task-old']",
    );
    const latestPreviewButton = mounted.container.querySelector(
      "[data-testid='video-task-preview-task-latest']",
    );

    expect(oldPreviewButton?.textContent).toContain("当前预览");
    expect(latestPreviewButton?.textContent).toContain("切换预览");
    expect(observedStateChanges).toEqual([]);
    expect(
      mounted.container.querySelector("[data-testid='video-focused-task-prompt']")
        ?.textContent,
    ).toContain("旧任务视频");
    expect(
      mounted.container.querySelector("[data-testid='video-focused-task-spec']")
        ?.textContent,
    ).toContain("9:16 · 1080p · 12 秒");

    clickElement(latestPreviewButton);
    await flushEffects(2);

    expect(
      observedStateChanges[observedStateChanges.length - 1],
    ).toMatchObject({
      selectedTaskId: "task-latest",
      status: "success",
      videoUrl: "https://example.com/latest.mp4",
    });
    expect(latestPreviewButton?.textContent).toContain("当前预览");
    expect(
      mounted.container.querySelector("[data-testid='video-focused-task-prompt']")
        ?.textContent,
    ).toContain("最新任务视频");
    expect(
      mounted.container.querySelector("[data-testid='video-focused-task-spec']")
        ?.textContent,
    ).toContain("16:9 · 720p · 6 秒");
  });
});
