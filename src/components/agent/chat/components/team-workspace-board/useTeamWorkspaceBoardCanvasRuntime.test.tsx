import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamWorkspaceRuntimeFormationState } from "../../teamWorkspaceRuntime";
import { useTeamWorkspaceBoardCanvasRuntime } from "./useTeamWorkspaceBoardCanvasRuntime";

type HookProps = Parameters<typeof useTeamWorkspaceBoardCanvasRuntime>[0];

const { mockUseTeamWorkspaceCanvasController } = vi.hoisted(() => ({
  mockUseTeamWorkspaceCanvasController: vi.fn(),
}));

vi.mock("./useTeamWorkspaceCanvasController", () => ({
  useTeamWorkspaceCanvasController: mockUseTeamWorkspaceCanvasController,
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function createFormationState(
  overrides?: Partial<TeamWorkspaceRuntimeFormationState>,
): TeamWorkspaceRuntimeFormationState {
  return {
    requestId: overrides?.requestId ?? "dispatch-1",
    status: overrides?.status ?? "forming",
    label: overrides?.label ?? null,
    summary: overrides?.summary ?? null,
    members: overrides?.members ?? [],
    blueprint: overrides?.blueprint ?? null,
    errorMessage: overrides?.errorMessage ?? null,
    updatedAt: overrides?.updatedAt ?? 1,
  };
}

function createControllerState(
  overrides?: Partial<
    ReturnType<typeof useTeamWorkspaceBoardCanvasRuntime> &
      Record<string, unknown>
  >,
) {
  return {
    canvasBounds: {
      height: 720,
      width: 1080,
    },
    canvasLaneLayouts: {},
    canvasViewportRef: { current: null },
    handleAutoArrangeCanvas: vi.fn(),
    handleCanvasWheel: vi.fn(),
    handleFitCanvasView: vi.fn(),
    handleResetCanvasView: vi.fn(),
    handleSelectCanvasLane: vi.fn(),
    handleStartCanvasLaneDrag: vi.fn(),
    handleStartCanvasLaneResize: vi.fn(),
    handleStartCanvasPan: vi.fn(),
    handleZoomIn: vi.fn(),
    handleZoomOut: vi.fn(),
    isCanvasPanModifierActive: false,
    viewport: { x: 0, y: 0, zoom: 1.15 },
    zoom: 1.15,
    ...overrides,
  };
}

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let latestValue: ReturnType<typeof useTeamWorkspaceBoardCanvasRuntime> | null =
    null;

  const defaultProps: HookProps = {
    activityTimelineEntryLimit: 4,
    canvasStorageScopeId: "scope-default",
    canvasViewportFallbackHeight: 560,
    embedded: false,
    expandedSessionId: null,
    focusSession: vi.fn(),
    hasRealTeamGraph: false,
    hasRuntimeFormation: false,
    hasSelectedTeamPlan: false,
    liveActivityBySessionId: {},
    memberCanvasSessions: [],
    plannedRoles: [],
    previewBySessionId: {},
    teamDispatchPreviewState: null,
  };

  function Probe(currentProps: HookProps) {
    latestValue = useTeamWorkspaceBoardCanvasRuntime(currentProps);
    return null;
  }

  const render = async (nextProps?: Partial<HookProps>) => {
    await act(async () => {
      root.render(<Probe {...defaultProps} {...props} {...nextProps} />);
      await Promise.resolve();
    });
  };

  mountedRoots.push({ root, container });

  return {
    getValue: () => {
      if (!latestValue) {
        throw new Error("hook 尚未初始化");
      }
      return latestValue;
    },
    render,
  };
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mockUseTeamWorkspaceCanvasController.mockReturnValue(createControllerState());
});

afterEach(async () => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      continue;
    }

    await act(async () => {
      mounted.root.unmount();
      await Promise.resolve();
    });
    mounted.container.remove();
  }

  vi.clearAllMocks();
});

describe("useTeamWorkspaceBoardCanvasRuntime", () => {
  it("应把真实成员任务进行时投影为 session lanes 并透传给 controller", async () => {
    const focusSession = vi.fn();
    const harness = renderHook({
      canvasStorageScopeId: "scope-team-board",
      canvasViewportFallbackHeight: 620,
      expandedSessionId: "child-1",
      focusSession,
      hasRealTeamGraph: true,
      hasRuntimeFormation: true,
      hasSelectedTeamPlan: true,
      liveActivityBySessionId: {
        "child-1": [
          {
            id: "live-1",
            title: "工具 检查",
            detail: "主线回归已补齐。",
            statusLabel: "完成",
            badgeClassName:
              "border border-emerald-200 bg-emerald-50 text-emerald-700",
          },
        ],
      },
      memberCanvasSessions: [
        {
          id: "child-1",
          name: "执行代理",
          runtimeStatus: "running",
          taskSummary: "补齐 task schedule 主线回归。",
          blueprintRoleId: "executor",
          blueprintRoleLabel: "执行",
          profileId: "code-executor",
          profileName: "代码执行员",
          roleKey: "executor",
          teamPresetId: "code-triage-team",
          latestTurnStatus: "running",
          queuedTurnCount: 1,
          teamParallelBudget: 2,
          teamActiveCount: 1,
          skills: [
            {
              id: "repo-exploration",
              name: "仓库探索",
            },
          ],
        },
      ],
      plannedRoles: [
        {
          id: "executor",
          label: "执行",
          summary: "负责落地主线改动。",
          profileId: "code-executor",
          roleKey: "executor",
        },
      ],
      previewBySessionId: {
        "child-1": {
          preview: "回复：旧内容",
          entries: [
            {
              id: "stored-1",
              title: "回复",
              detail: "历史里的旧进度。",
              statusLabel: "消息",
              badgeClassName:
                "border border-slate-200 bg-slate-50 text-slate-600",
            },
          ],
          status: "ready",
        },
      },
      teamDispatchPreviewState: createFormationState({
        requestId: "dispatch-runtime-1",
        status: "formed",
        members: [
          {
            id: "executor",
            label: "执行",
            summary: "负责落地主线改动。",
            profileId: "code-executor",
            roleKey: "executor",
            skillIds: [],
            status: "running",
            sessionId: "child-1",
          },
        ],
      }),
    });

    await harness.render();

    const controllerArgs =
      mockUseTeamWorkspaceCanvasController.mock.calls.at(-1)?.[0];

    expect(controllerArgs).toMatchObject({
      canvasStorageScopeId: "scope-team-board",
      canvasViewportFallbackHeight: 620,
      embedded: false,
      expandedSessionId: "child-1",
    });
    expect(controllerArgs?.onSelectSession).toBe(focusSession);
    expect(controllerArgs?.canvasLanes).toEqual(harness.getValue().canvasLanes);
    expect(harness.getValue().canvasLanes).toEqual([
      expect.objectContaining({
        id: "child-1",
        kind: "session",
        persistKey: "session:child-1",
        fallbackPersistKeys: ["runtime:executor", "planned:executor"],
        title: "执行代理",
        previewText: "工具 检查：主线回归已补齐。",
      }),
    ]);
    expect(harness.getValue().canvasStageHint).toBe(
      "当前任务会按状态持续刷新，焦点会优先落在正在处理的任务上；需要时可调整任务布局或缩放视图。",
    );
  });

  it("应在成员尚未接入时先把 runtime formation 投影为任务进行时预备 lane", async () => {
    const harness = renderHook({
      hasRealTeamGraph: false,
      hasRuntimeFormation: true,
      hasSelectedTeamPlan: false,
      plannedRoles: [
        {
          id: "writer",
          label: "写作",
          summary: "把主线结果整理成说明。",
          roleKey: "writer",
        },
      ],
      teamDispatchPreviewState: createFormationState({
        requestId: "dispatch-runtime-2",
        status: "formed",
        members: [
          {
            id: "writer",
            label: "写作",
            summary: "负责整理主线结果。",
            roleKey: "writer",
            skillIds: [],
            status: "running",
          },
        ],
      }),
    });

    await harness.render();

    expect(harness.getValue().canvasLanes).toEqual([
      expect.objectContaining({
        id: "writer",
        kind: "runtime",
        persistKey: "runtime:writer",
        fallbackPersistKeys: ["planned:writer"],
        title: "写作",
        previewText: "负责整理主线结果。",
      }),
    ]);
    expect(harness.getValue().canvasStageHint).toBe(
      "当前任务分工已经准备好，任务拆出后会依次开始处理。",
    );
  });

  it("应在仅有计划分工时生成 planned lane 并提示即将切换为任务进行时", async () => {
    const harness = renderHook({
      hasRealTeamGraph: false,
      hasRuntimeFormation: false,
      hasSelectedTeamPlan: true,
      plannedRoles: [
        {
          id: "reviewer",
          label: "复核",
          summary: "确认任务进行时语义没有跑偏。",
          roleKey: "reviewer",
        },
      ],
    });

    await harness.render();

    expect(harness.getValue().canvasLanes).toEqual([
      expect.objectContaining({
        id: "reviewer",
        kind: "planned",
        persistKey: "planned:reviewer",
        title: "复核",
        previewText: "确认任务进行时语义没有跑偏。",
      }),
    ]);
    expect(harness.getValue().canvasStageHint).toBe(
      "这里会先展示当前任务分工，任务拆出后会切换为独立的当前进展。",
    );
  });
});
