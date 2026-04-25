import { describe, expect, it, vi } from "vitest";
import { buildWorkspaceNavbarProps } from "./chatSurfaceProps";

function createNavbarParams(
  overrides: Partial<Parameters<typeof buildWorkspaceNavbarProps>[0]> = {},
): Parameters<typeof buildWorkspaceNavbarProps>[0] {
  return {
    visible: true,
    isRunning: false,
    chrome: "workspace-compact",
    navbarContextVariant: "task-center",
    onToggleHistory: vi.fn(),
    showHistoryToggle: true,
    showCanvasToggle: false,
    isCanvasOpen: false,
    projectId: null,
    showHarnessToggle: false,
    harnessPanelVisible: false,
    harnessPendingCount: 0,
    harnessAttentionLevel: "idle",
    ...overrides,
  };
}

describe("buildWorkspaceNavbarProps", () => {
  it("任务中心空态应切到专用 task-center 顶栏", () => {
    const props = buildWorkspaceNavbarProps(createNavbarParams());

    expect(props?.contextVariant).toBe("task-center");
    expect(props?.entryContextLabel).toBeUndefined();
    expect(props?.entryContextHint).toBeUndefined();
  });

  it("任务中心显式收起入口上下文时应回退默认顶栏语义", () => {
    const props = buildWorkspaceNavbarProps(
      createNavbarParams({
        collapseChrome: true,
        collapseEntryContext: true,
      }),
    );

    expect(props?.collapseChrome).toBe(true);
    expect(props?.contextVariant).toBe("default");
    expect(props?.entryContextLabel).toBeUndefined();
    expect(props?.entryContextHint).toBeUndefined();
  });
});
