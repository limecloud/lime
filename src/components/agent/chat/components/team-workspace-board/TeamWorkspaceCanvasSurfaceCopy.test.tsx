import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamWorkspaceCanvasStage } from "./TeamWorkspaceCanvasStage";
import { TeamWorkspaceCanvasToolbar } from "./TeamWorkspaceCanvasToolbar";
import { TeamWorkspaceCanvasViewButtons } from "./TeamWorkspaceTeamOverviewControls";

function renderIntoDocument(element: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  return {
    container,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("TeamWorkspaceCanvasSurfaceCopy", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("应使用任务视图口径展示任务布局提示", () => {
    const { container, unmount } = renderIntoDocument(
      <TeamWorkspaceCanvasStage
        canvasBoundsHeight={640}
        canvasBoundsWidth={960}
        canvasStageHeight="640px"
        canvasStageHint="当前任务会按状态持续刷新。"
        expandedSessionId={null}
        isCanvasPanModifierActive={false}
        laneLayouts={{}}
        lanes={[]}
        onCanvasWheel={vi.fn()}
        onSelectLane={vi.fn()}
        onStartCanvasLaneDrag={vi.fn()}
        onStartCanvasLaneResize={vi.fn()}
        onStartCanvasPan={vi.fn()}
        selectedSessionId={null}
        viewport={{ x: 0, y: 0, zoom: 1 }}
        viewportRef={{ current: null }}
      />,
    );

    try {
      expect(container.textContent).toContain("任务视图");
      expect(container.textContent).toContain("拖拽调整任务布局");
      expect(container.textContent).toContain("暂无任务视图");
      expect(container.textContent).not.toContain("暂无任务画布");
    } finally {
      unmount();
    }
  });

  it("工具栏应使用任务视图与聚焦任务口径", () => {
    const { container, unmount } = renderIntoDocument(
      <TeamWorkspaceCanvasToolbar
        laneCount={3}
        onAutoArrangeCanvas={vi.fn()}
        onFitCanvasView={vi.fn()}
        onResetCanvasView={vi.fn()}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        zoom={1.15}
      />,
    );

    try {
      expect(container.textContent).toContain("任务视图");
      expect(container.textContent).toContain("3 个任务面板");
      expect(container.textContent).toContain("聚焦任务");
      expect(container.textContent).not.toContain("自由画布");
      expect(container.textContent).not.toContain("适应视图");
    } finally {
      unmount();
    }
  });

  it("紧凑控制条也应使用聚焦任务口径", () => {
    const { container, unmount } = renderIntoDocument(
      <TeamWorkspaceCanvasViewButtons
        onAutoArrangeCanvas={vi.fn()}
        onFitCanvasView={vi.fn()}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
      />,
    );

    try {
      expect(container.textContent).toContain("整理布局");
      expect(container.textContent).toContain("聚焦任务");
      expect(container.textContent).not.toContain("适应视图");
    } finally {
      unmount();
    }
  });
});
