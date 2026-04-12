import { describe, expect, it } from "vitest";
import type { TeamWorkspaceCanvasLane } from "./canvasLaneSelectors";
import {
  buildAutoArrangedTeamWorkspaceCanvasItems,
  buildInitializedTeamWorkspaceCanvasItems,
  buildTeamWorkspaceCanvasLaneLayouts,
  resolveTeamWorkspaceCanvasAutoLayoutViewportWidth,
  resolveTeamWorkspaceCanvasFitViewport,
} from "./canvasLayoutSelectors";
import type { TeamWorkspaceCanvasItemLayout } from "../utils/teamWorkspaceCanvas";

function createLane(
  overrides: Partial<TeamWorkspaceCanvasLane>,
): TeamWorkspaceCanvasLane {
  return {
    id: overrides.id ?? "lane-1",
    persistKey: overrides.persistKey ?? "session:lane-1",
    fallbackPersistKeys: overrides.fallbackPersistKeys ?? [],
    kind: overrides.kind ?? "session",
    title: overrides.title ?? "成员",
    summary: overrides.summary ?? "负责当前工作。",
    badgeLabel: overrides.badgeLabel ?? "处理中",
    badgeClassName:
      overrides.badgeClassName ??
      "border border-sky-200 bg-sky-50 text-sky-700",
    dotClassName: overrides.dotClassName ?? "bg-sky-500",
    skillLabels: overrides.skillLabels ?? [],
    session:
      overrides.session === undefined
        ? {
            id: overrides.id ?? "lane-1",
            name: overrides.title ?? "成员",
          }
        : overrides.session,
    ...overrides,
  };
}

function createLayout(
  overrides: Partial<TeamWorkspaceCanvasItemLayout>,
): TeamWorkspaceCanvasItemLayout {
  return {
    x: overrides.x ?? 32,
    y: overrides.y ?? 48,
    width: overrides.width ?? 360,
    height: overrides.height ?? 280,
    zIndex: overrides.zIndex ?? 1,
  };
}

describe("canvasLayoutSelectors", () => {
  it("应根据嵌入态返回稳定的 auto layout 视口宽度", () => {
    expect(
      resolveTeamWorkspaceCanvasAutoLayoutViewportWidth({
        embedded: false,
        viewportWidth: 900,
      }),
    ).toBe(1080);
    expect(
      resolveTeamWorkspaceCanvasAutoLayoutViewportWidth({
        embedded: true,
        viewportWidth: 1100,
      }),
    ).toBe(1240);
  });

  it("应在初始化时复用 fallback lane 的坐标，并补齐缺失成员布局", () => {
    const items = buildInitializedTeamWorkspaceCanvasItems({
      lanes: [
        createLane({
          id: "child-1",
          persistKey: "session:child-1",
          fallbackPersistKeys: ["runtime:executor"],
        }),
        createLane({
          id: "executor",
          persistKey: "runtime:executor",
          kind: "runtime",
          session: undefined,
        }),
      ],
      existingItems: {
        "runtime:executor": createLayout({
          x: 180,
          y: 240,
          width: 320,
          height: 260,
          zIndex: 3,
        }),
      },
      viewportWidth: 1320,
    });

    expect(items).not.toBeNull();
    expect(items?.["session:child-1"]).toMatchObject({
      x: 180,
      y: 240,
      zIndex: 3,
    });
    expect(items?.["session:child-1"]?.width).toBeGreaterThan(320);
    expect(items?.["session:child-1"]?.height).toBeGreaterThan(260);
  });

  it("应在无历史布局时直接给 lane 生成 auto arrange 坐标", () => {
    const items = buildInitializedTeamWorkspaceCanvasItems({
      lanes: [
        createLane({
          id: "child-auto",
          persistKey: "session:child-auto",
        }),
      ],
      existingItems: {},
      viewportWidth: 1280,
    });

    expect(items).toEqual({
      "session:child-auto": expect.objectContaining({
        x: 360,
        y: 76,
        width: 560,
        height: 520,
        zIndex: 1,
      }),
    });
  });

  it("应只在当前展开会话上抬高 lane 高度", () => {
    const layouts = buildTeamWorkspaceCanvasLaneLayouts({
      lanes: [
        createLane({
          id: "child-expanded",
          persistKey: "session:child-expanded",
        }),
        createLane({
          id: "child-idle",
          persistKey: "session:child-idle",
        }),
      ],
      storedItems: {
        "session:child-expanded": createLayout({
          width: 420,
          height: 420,
        }),
        "session:child-idle": createLayout({
          x: 500,
          width: 420,
          height: 420,
          zIndex: 2,
        }),
      },
      viewportWidth: 1280,
      expandedSessionId: "child-expanded",
    });

    expect(layouts["session:child-expanded"]?.height).toBeGreaterThan(420);
    expect(layouts["session:child-idle"]?.height).toBe(420);
  });

  it("应按当前 viewport 与 zoom 重新计算 auto arrange 结果", () => {
    const items = buildAutoArrangedTeamWorkspaceCanvasItems({
      lanes: [
        createLane({
          id: "child-1",
          persistKey: "session:child-1",
        }),
        createLane({
          id: "runtime-reviewer",
          persistKey: "runtime:reviewer",
          kind: "runtime",
          session: undefined,
        }),
      ],
      currentItems: {
        "session:child-1": createLayout({
          x: 12,
          y: 18,
          width: 300,
          height: 220,
          zIndex: 8,
        }),
        "runtime:reviewer": createLayout({
          x: 48,
          y: 52,
          width: 300,
          height: 220,
          zIndex: 4,
        }),
      },
      viewportWidth: 1280,
      zoom: 0.75,
    });

    expect(items["session:child-1"]).toMatchObject({
      y: 76,
      zIndex: 1,
    });
    expect(items["runtime:reviewer"]).toMatchObject({
      y: 76,
      zIndex: 2,
    });
    expect(items["session:child-1"]?.x).not.toBe(12);
    expect(items["runtime:reviewer"]?.x).toBeGreaterThan(
      items["session:child-1"]?.x ?? 0,
    );
  });

  it("应根据 bounds 计算 fit view 视口", () => {
    const viewport = resolveTeamWorkspaceCanvasFitViewport({
      bounds: {
        minX: 100,
        minY: 40,
        maxX: 700,
        maxY: 440,
        width: 960,
        height: 720,
      },
      viewportWidth: 1000,
      viewportHeight: 700,
    });

    expect(viewport.zoom).toBeCloseTo(1.08, 5);
    expect(viewport.x).toBeCloseTo(132, 5);
    expect(viewport.y).toBeCloseTo(154.8, 5);
  });
});
