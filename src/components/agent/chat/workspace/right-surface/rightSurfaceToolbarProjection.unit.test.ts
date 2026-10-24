import { describe, expect, it } from "vitest";
import { createWorkspaceRightSurfaceOpenIntent } from "./rightSurfaceIntentQueue";
import { buildRightSurfaceState } from "./rightSurfaceState";
import { buildWorkspaceRightSurfaceLauncherProjections } from "./rightSurfaceToolbarProjection";

describe("rightSurfaceToolbarProjection", () => {
  it("应从统一 state 生成 launcher active 状态", () => {
    const projections = buildWorkspaceRightSurfaceLauncherProjections({
      surfaceState: buildRightSurfaceState("expertInfo", "user"),
      pendingIntents: [],
    });

    expect(
      projections.find((projection) => projection.kind === "expertInfo"),
    ).toMatchObject({
      active: true,
      pendingCount: 0,
      disabled: false,
      collapseTarget: "topToolbar",
    });
    expect(
      projections.find((projection) => projection.kind === "workbench"),
    ).toMatchObject({ active: false });
  });

  it("应把 pending intent 聚合成对应 surface 的 badge 数量", () => {
    const projections = buildWorkspaceRightSurfaceLauncherProjections({
      surfaceState: buildRightSurfaceState("expertInfo", "user"),
      pendingIntents: [
        createWorkspaceRightSurfaceOpenIntent({
          id: "skill:files",
          kind: "files",
          origin: "skill",
          priority: "background",
          createdAt: 100,
        }),
        createWorkspaceRightSurfaceOpenIntent({
          id: "mcp:files",
          kind: "files",
          origin: "mcpTool",
          priority: "background",
          createdAt: 110,
        }),
        createWorkspaceRightSurfaceOpenIntent({
          id: "skill:harness",
          kind: "harness",
          origin: "skill",
          priority: "background",
          createdAt: 120,
        }),
        createWorkspaceRightSurfaceOpenIntent({
          id: "runtime:browser",
          kind: "browser",
          origin: "runtime",
          priority: "background",
          createdAt: 130,
        }),
      ],
    });

    expect(
      projections.find((projection) => projection.kind === "files"),
    ).toMatchObject({ pendingCount: 2 });
    expect(
      projections.find((projection) => projection.kind === "harness"),
    ).toMatchObject({ pendingCount: 1 });
    expect(
      projections.find((projection) => projection.kind === "browser"),
    ).toMatchObject({ pendingCount: 1 });
  });

  it("应按 availableSurfaces 标记不可用 launcher", () => {
    const projections = buildWorkspaceRightSurfaceLauncherProjections({
      surfaceState: buildRightSurfaceState(null, "user"),
      pendingIntents: [],
      availableSurfaces: new Set(["workbench", "expertInfo"]),
    });

    expect(
      projections.find((projection) => projection.kind === "expertInfo"),
    ).toMatchObject({ disabled: false });
    expect(
      projections.find((projection) => projection.kind === "shell"),
    ).toMatchObject({ disabled: true });
    expect(
      projections.find((projection) => projection.kind === "browser"),
    ).toMatchObject({ disabled: true });
  });
});
