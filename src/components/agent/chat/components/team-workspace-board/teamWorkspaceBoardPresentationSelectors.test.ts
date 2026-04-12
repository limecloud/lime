import { describe, expect, it } from "vitest";
import {
  buildTeamWorkspaceBoardSurfaceClassNames,
  resolveTeamWorkspaceBoardCopyState,
} from "./teamWorkspaceBoardPresentationSelectors";

describe("teamWorkspaceBoardPresentationSelectors", () => {
  it("应为无真实成员画布的 schedule 状态返回稳定文案", () => {
    expect(
      resolveTeamWorkspaceBoardCopyState({
        detailExpanded: false,
        dispatchPreviewStatus: "forming",
        hasRuntimeSessions: false,
        isChildSession: false,
        isEmptyShellState: false,
        shellExpanded: false,
        visibleSessionsCount: 0,
      }),
    ).toMatchObject({
      detailToggleLabel: "查看细节",
      detailVisible: false,
      memberCanvasTitle: "任务视图",
    });

    expect(
      resolveTeamWorkspaceBoardCopyState({
        detailExpanded: false,
        dispatchPreviewStatus: "forming",
        hasRuntimeSessions: false,
        isChildSession: false,
        isEmptyShellState: false,
        shellExpanded: false,
        visibleSessionsCount: 0,
      }).memberCanvasSubtitle,
    ).toContain("正在准备当前任务分工");
    expect(
      resolveTeamWorkspaceBoardCopyState({
        detailExpanded: false,
        dispatchPreviewStatus: "failed",
        hasRuntimeSessions: false,
        isChildSession: false,
        isEmptyShellState: false,
        shellExpanded: false,
        visibleSessionsCount: 0,
      }).memberCanvasSubtitle,
    ).toContain("任务分工准备失败");
  });

  it("应为真实任务画布与嵌入态返回紧凑壳层样式", () => {
    const copyState = resolveTeamWorkspaceBoardCopyState({
      detailExpanded: false,
      dispatchPreviewStatus: null,
      hasRuntimeSessions: true,
      isChildSession: false,
      isEmptyShellState: false,
      shellExpanded: false,
      visibleSessionsCount: 3,
    });
    const classNames = buildTeamWorkspaceBoardSurfaceClassNames({
      className: "custom-shell",
      detailVisible: false,
      embedded: true,
      selectedSessionStatusCardClassName: "border-sky-200 bg-white",
      selectedSessionVisible: true,
      useCompactCanvasChrome: true,
    });

    expect(copyState.memberCanvasSubtitle).toContain("3 项任务已接入");
    expect(classNames.boardShellClassName).toContain("rounded-[24px]");
    expect(classNames.boardShellClassName).toContain("border-slate-200");
    expect(classNames.boardShellClassName).toContain("bg-white");
    expect(classNames.boardShellClassName).toContain("custom-shell");
    expect(classNames.boardHeaderClassName).toContain("sticky top-0");
    expect(classNames.canvasStageHeight).toBe("clamp(560px, 76vh, 980px)");
    expect(classNames.detailCardClassName).toContain("rounded-[20px]");
    expect(classNames.railCardClassName).toContain("space-y-3");
  });
});
