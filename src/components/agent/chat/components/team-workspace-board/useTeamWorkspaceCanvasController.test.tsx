import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamWorkspaceCanvasLane } from "../../team-workspace-runtime/canvasLaneSelectors";
import {
  getTeamWorkspaceCanvasStorageKey,
  TEAM_WORKSPACE_CANVAS_STORAGE_VERSION,
} from "../../utils/teamWorkspaceCanvas";
import { useTeamWorkspaceCanvasController } from "./useTeamWorkspaceCanvasController";

type HookProps = Parameters<typeof useTeamWorkspaceCanvasController>[0];

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function createSessionLane(id: string): TeamWorkspaceCanvasLane {
  return {
    id,
    persistKey: `session:${id}`,
    fallbackPersistKeys: [],
    kind: "session",
    title: `成员 ${id}`,
    summary: "负责推进当前协作任务。",
    badgeLabel: "运行中",
    badgeClassName: "border border-sky-200 bg-sky-50 text-sky-700",
    dotClassName: "bg-sky-500",
    skillLabels: [],
    session: {
      id,
      name: `成员 ${id}`,
      runtimeStatus: "running",
    },
  };
}

function seedCanvasLayout(
  scopeId: string,
  overrides?: Partial<{
    items: HookStoredItems;
    viewport: { x: number; y: number; zoom: number };
  }>,
) {
  window.localStorage.setItem(
    getTeamWorkspaceCanvasStorageKey(scopeId),
    JSON.stringify({
      version: TEAM_WORKSPACE_CANVAS_STORAGE_VERSION,
      updatedAt: 1_710_000_000,
      viewport: overrides?.viewport ?? {
        x: 56,
        y: 56,
        zoom: 1,
      },
      items: overrides?.items ?? {},
    }),
  );
}

type HookStoredItems = Record<
  string,
  { x: number; y: number; width: number; height: number; zIndex: number }
>;

async function flushHookEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let latestValue: ReturnType<typeof useTeamWorkspaceCanvasController> | null =
    null;

  const defaultProps: HookProps = {
    canvasLanes: [],
    canvasStorageScopeId: "scope-a",
    canvasViewportFallbackHeight: 560,
    embedded: false,
    expandedSessionId: null,
    onSelectSession: vi.fn(),
  };

  function Probe(currentProps: HookProps) {
    latestValue = useTeamWorkspaceCanvasController(currentProps);
    return null;
  }

  const render = async (nextProps?: Partial<HookProps>) => {
    await act(async () => {
      root.render(<Probe {...defaultProps} {...props} {...nextProps} />);
      await Promise.resolve();
    });
    await flushHookEffects();
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
  window.localStorage.clear();
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

  window.localStorage.clear();
});

describe("useTeamWorkspaceCanvasController", () => {
  it("切换 storage scope 时应重新加载对应的画布视口", async () => {
    seedCanvasLayout("scope-a", {
      viewport: {
        x: 120,
        y: 148,
        zoom: 1.22,
      },
    });
    seedCanvasLayout("scope-b", {
      viewport: {
        x: 24,
        y: 36,
        zoom: 0.84,
      },
    });

    const harness = renderHook();

    await harness.render({
      canvasStorageScopeId: "scope-a",
    });
    expect(harness.getValue().viewport).toMatchObject({
      x: 120,
      y: 148,
      zoom: 1.22,
    });

    await harness.render({
      canvasStorageScopeId: "scope-b",
    });
    expect(harness.getValue().viewport).toMatchObject({
      x: 24,
      y: 36,
      zoom: 0.84,
    });
  });

  it("选择成员 lane 时应回调选中会话并把当前 lane 置顶", async () => {
    const onSelectSession = vi.fn();
    const lanes = [createSessionLane("child-1"), createSessionLane("child-2")];
    seedCanvasLayout("scope-select", {
      items: {
        "session:child-1": {
          x: 320,
          y: 180,
          width: 360,
          height: 420,
          zIndex: 1,
        },
        "session:child-2": {
          x: 760,
          y: 220,
          width: 360,
          height: 420,
          zIndex: 2,
        },
      },
    });

    const harness = renderHook({
      canvasLanes: lanes,
      canvasStorageScopeId: "scope-select",
      onSelectSession,
    });

    await harness.render();

    expect(
      harness.getValue().canvasLaneLayouts["session:child-1"]?.zIndex,
    ).toBe(1);
    expect(
      harness.getValue().canvasLaneLayouts["session:child-2"]?.zIndex,
    ).toBe(2);

    act(() => {
      harness.getValue().handleSelectCanvasLane(lanes[0]);
    });

    expect(onSelectSession).toHaveBeenCalledWith("child-1");
    expect(
      harness.getValue().canvasLaneLayouts["session:child-1"]?.zIndex,
    ).toBeGreaterThan(
      harness.getValue().canvasLaneLayouts["session:child-2"]?.zIndex ?? 0,
    );
  });
});
