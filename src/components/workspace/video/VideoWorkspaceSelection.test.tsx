import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoWorkspace } from "./VideoWorkspace";
import {
  cleanupMountedRoots,
  clickElement,
  findButtonByText,
  flushEffects,
  mountHarness,
  setupReactActEnvironment,
  type MountedRoot,
} from "@/components/workspace/hooks/testUtils";
import {
  createInitialVideoState,
  type VideoCanvasState,
} from "@/components/workspace/video/types";
import { changeLimeLocale } from "@/i18n/createI18n";

const {
  mockCreateTask,
  mockGetTask,
  mockListTasks,
  mockToastError,
  mockToastSuccess,
} = vi.hoisted(() => ({
  mockCreateTask: vi.fn(),
  mockGetTask: vi.fn(),
  mockListTasks: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mockToastError,
    success: mockToastSuccess,
  },
}));

vi.mock("@/lib/api/videoGeneration", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/videoGeneration")
  >("@/lib/api/videoGeneration");

  return {
    ...actual,
    videoGenerationApi: {
      ...actual.videoGenerationApi,
      createTask: (...args: unknown[]) => mockCreateTask(...args),
      getTask: (...args: unknown[]) => mockGetTask(...args),
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
  const [state, setState] = useState<VideoCanvasState>(() =>
    buildInitialState(),
  );

  return (
    <VideoWorkspace
      projectRootPath="/workspace"
      projectId="project-video-1"
      state={state}
      onStateChange={(nextState) => {
        onObservedStateChange?.(nextState);
        setState(nextState);
      }}
    />
  );
}

function ControlledGenerateVideoWorkspace({
  startImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN2QAAAAASUVORK5CYII=",
  endImage = "https://example.com/end-frame.png",
}: {
  startImage?: string;
  endImage?: string;
}) {
  const [state, setState] = useState<VideoCanvasState>(() => ({
    ...createInitialVideoState("A cinematic ocean shot"),
    providerId: "doubao",
    model: "seedance-1-5-pro-251215",
    startImage,
    endImage,
  }));

  return (
    <VideoWorkspace
      projectRootPath="/workspace"
      projectId="project-video-1"
      state={state}
      onStateChange={setState}
    />
  );
}

describe("VideoWorkspace 任务聚焦", () => {
  beforeEach(async () => {
    setupReactActEnvironment();
    await changeLimeLocale("zh-CN");
    vi.clearAllMocks();
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
    vi.restoreAllMocks();
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

    expect(mockListTasks).toHaveBeenCalledWith("project-video-1", {
      limit: 50,
      projectRootPath: "/workspace",
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
      mounted.container.querySelector(
        "[data-testid='video-focused-task-prompt']",
      )?.textContent,
    ).toContain("旧任务视频");
    expect(
      mounted.container.querySelector("[data-testid='video-focused-task-spec']")
        ?.textContent,
    ).toContain("9:16 · 1080p · 12 秒");

    clickElement(latestPreviewButton);
    await flushEffects(2);

    expect(observedStateChanges[observedStateChanges.length - 1]).toMatchObject(
      {
        selectedTaskId: "task-latest",
        status: "success",
        videoUrl: "https://example.com/latest.mp4",
      },
    );
    expect(latestPreviewButton?.textContent).toContain("当前预览");
    expect(
      mounted.container.querySelector(
        "[data-testid='video-focused-task-prompt']",
      )?.textContent,
    ).toContain("最新任务视频");
    expect(
      mounted.container.querySelector("[data-testid='video-focused-task-spec']")
        ?.textContent,
    ).toContain("16:9 · 720p · 6 秒");
  });

  it("英文界面应使用 workspace namespace 渲染最近任务标题与预览操作", async () => {
    await changeLimeLocale("en-US");

    const mounted = mountHarness(ControlledVideoWorkspace, {}, mountedRoots);

    await flushEffects(8);

    const oldPreviewButton = mounted.container.querySelector(
      "[data-testid='video-task-preview-task-old']",
    );
    const latestPreviewButton = mounted.container.querySelector(
      "[data-testid='video-task-preview-task-latest']",
    );

    expect(mounted.container.textContent).toContain("Recent tasks");
    expect(mounted.container.textContent).toContain("2 item(s)");
    expect(mounted.container.textContent).toContain(
      "Keep tuning prompts and tracking the latest result",
    );
    expect(mounted.container.textContent).toContain("Main preview");
    expect(mounted.container.textContent).toContain(
      "Viewing a previous result",
    );
    expect(mounted.container.textContent).toContain("Current task in focus");
    expect(mounted.container.textContent).toContain("Previous result");
    expect(mounted.container.textContent).toContain("Model route");
    expect(mounted.container.textContent).toContain("Generation spec");
    expect(mounted.container.textContent).toContain("9:16 · 1080p · 12 sec");
    expect(mounted.container.textContent).toContain("Status");
    expect(mounted.container.textContent).toContain("Completed");
    expect(mounted.container.textContent).not.toContain("Project Knowledge");
    expect(mounted.container.textContent).toContain("Result generated");
    expect(oldPreviewButton?.textContent).toContain("Current preview");
    expect(latestPreviewButton?.textContent).toContain("Switch preview");
  });

  it("英文生成操作直接向媒体任务发送首尾帧引用", async () => {
    await changeLimeLocale("en-US");
    mockListTasks.mockResolvedValue([]);
    const createdTask = {
      id: "task-created",
      projectId: "project-video-1",
      providerId: "doubao",
      model: "seedance-1-5-pro-251215",
      prompt: "A cinematic ocean shot",
      status: "pending",
      progress: 0,
      requestPayload: "{}",
      createdAt: 3_000,
      updatedAt: 3_000,
    };
    mockCreateTask.mockResolvedValue(createdTask);
    mockGetTask.mockResolvedValue({
      ...createdTask,
      status: "success",
      resultUrl: "https://example.com/generated.mp4",
      progress: 100,
    });

    const mounted = mountHarness(
      ControlledGenerateVideoWorkspace,
      {},
      mountedRoots,
    );

    await flushEffects(8);
    const generateButton = findButtonByText(
      mounted.container,
      "Generate video",
    );
    expect(generateButton).toBeInstanceOf(HTMLButtonElement);

    const consoleError = vi.spyOn(console, "error");
    clickElement(generateButton ?? null);
    await flushEffects(12);

    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrl:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN2QAAAAASUVORK5CYII=",
        endImageUrl: "https://example.com/end-frame.png",
        model: "seedance-1-5-pro-251215",
        projectId: "project-video-1",
        providerId: "doubao",
      }),
    );
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "Video task submitted; generating",
    );
    expect(mockGetTask).toHaveBeenCalledWith("task-created", {
      projectRootPath: "/workspace",
      refreshStatus: true,
    });
    expect(mounted.container.querySelector("video")?.getAttribute("src")).toBe(
      "https://example.com/generated.mp4",
    );
    expect(mounted.container.textContent).not.toContain("Project Knowledge");
    expect(consoleError).not.toHaveBeenCalled();
  });
  it("旧material引用不能作为视频参考图提交", async () => {
    mockListTasks.mockResolvedValue([]);
    const mounted = mountHarness(
      ControlledGenerateVideoWorkspace,
      { startImage: "material://retired-image" },
      mountedRoots,
    );
    await flushEffects(8);
    clickElement(findButtonByText(mounted.container, "生成视频"));
    await flushEffects(8);
    expect(mockCreateTask).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith(
      "参考图格式不支持，请重新上传图片",
    );
  });
});
