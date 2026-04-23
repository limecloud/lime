import React, { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoCanvas } from "./VideoCanvas";
import { createInitialVideoState, type VideoCanvasState } from "./types";
import {
  cleanupMountedRoots,
  flushEffects,
  mountHarness,
  setupReactActEnvironment,
  type MountedRoot,
} from "@/components/workspace/hooks/testUtils";

const { mockGetProviders } = vi.hoisted(() => ({
  mockGetProviders: vi.fn(),
}));

vi.mock("@/hooks/useGlobalMediaGenerationDefaults", () => ({
  useGlobalMediaGenerationDefaults: () => ({
    mediaDefaults: {
      video: {
        preferredProviderId: "openai",
        preferredModelId: "sora-2-pro",
      },
    },
    loading: false,
  }),
}));

vi.mock("@/lib/api/apiKeyProvider", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/apiKeyProvider")>();

  return {
    ...actual,
    apiKeyProviderApi: {
      ...actual.apiKeyProviderApi,
      getProviders: (...args: unknown[]) => mockGetProviders(...args),
    },
  };
});

vi.mock("./VideoSidebar", () => ({
  VideoSidebar: ({
    state,
    availableModels,
  }: {
    state: VideoCanvasState;
    availableModels: string[];
  }) => (
    <div data-testid="video-sidebar-state">
      {state.providerId}/{state.model}/{availableModels.join(",")}
    </div>
  ),
}));

vi.mock("./VideoWorkspace", () => ({
  VideoWorkspace: ({ state }: { state: VideoCanvasState }) => (
    <div data-testid="video-workspace-state">
      {state.providerId}/{state.model}
    </div>
  ),
}));

const mountedRoots: MountedRoot[] = [];

function ControlledVideoCanvas({
  onObservedStateChange,
}: {
  onObservedStateChange?: (state: VideoCanvasState) => void;
}) {
  const [state, setState] = useState<VideoCanvasState>(() =>
    createInitialVideoState("测试视频任务"),
  );

  return (
    <VideoCanvas
      state={state}
      projectId="project-video-1"
      onStateChange={(nextState) => {
        onObservedStateChange?.(nextState);
        setState(nextState);
      }}
    />
  );
}

describe("VideoCanvas 全局默认模型", () => {
  beforeEach(() => {
    setupReactActEnvironment();
    vi.clearAllMocks();
    mockGetProviders.mockResolvedValue([
      {
        id: "doubao",
        name: "豆包视频",
        enabled: true,
        api_key_count: 1,
        custom_models: ["seedance-1-5-pro-251215"],
      },
      {
        id: "openai",
        name: "OpenAI Video",
        enabled: true,
        api_key_count: 1,
        custom_models: ["sora-2", "sora-2-pro"],
      },
    ]);
  });

  afterEach(() => {
    cleanupMountedRoots(mountedRoots);
  });

  it("provider/model 为空时应优先采用 workspace_preferences.media_defaults.video", async () => {
    const observedStateChanges: VideoCanvasState[] = [];

    const mounted = mountHarness(
      ControlledVideoCanvas,
      {
        onObservedStateChange: (state: VideoCanvasState) => {
          observedStateChanges.push(state);
        },
      },
      mountedRoots,
    );

    await flushEffects(8);

    expect(mockGetProviders).toHaveBeenCalledTimes(1);
    expect(observedStateChanges[observedStateChanges.length - 1]).toMatchObject({
      providerId: "openai",
      model: "sora-2-pro",
    });
    expect(
      mounted.container.querySelector("[data-testid='video-sidebar-state']")
        ?.textContent,
    ).toContain("openai/sora-2-pro");
    expect(
      mounted.container.querySelector("[data-testid='video-workspace-state']")
        ?.textContent,
    ).toContain("openai/sora-2-pro");
  });
});
