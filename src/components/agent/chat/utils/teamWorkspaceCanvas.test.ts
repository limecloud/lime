import { describe, expect, it } from "vitest";
import {
  canStartTeamWorkspaceCanvasPanGesture,
  isEditableTeamWorkspaceCanvasKeyboardTarget,
  TEAM_WORKSPACE_CANVAS_KEYBOARD_FAST_PAN_STEP,
  TEAM_WORKSPACE_CANVAS_KEYBOARD_PAN_STEP,
  TEAM_WORKSPACE_CANVAS_STAGE_HEIGHT,
} from "./teamWorkspaceCanvas";

describe("teamWorkspaceCanvas", () => {
  it("应暴露稳定的画布交互常量", () => {
    expect(TEAM_WORKSPACE_CANVAS_STAGE_HEIGHT).toBe("clamp(540px, 74vh, 920px)");
    expect(TEAM_WORKSPACE_CANVAS_KEYBOARD_PAN_STEP).toBe(72);
    expect(TEAM_WORKSPACE_CANVAS_KEYBOARD_FAST_PAN_STEP).toBe(216);
  });

  it("应判断何时允许开始画布平移", () => {
    const surface = document.createElement("div");
    surface.setAttribute("data-team-workspace-canvas-pan-surface", "true");
    const child = document.createElement("button");
    surface.appendChild(child);

    expect(
      canStartTeamWorkspaceCanvasPanGesture(child, surface, false),
    ).toBe(true);

    const blocked = document.createElement("div");
    blocked.setAttribute("data-team-workspace-canvas-pan-block", "true");
    surface.appendChild(blocked);

    expect(
      canStartTeamWorkspaceCanvasPanGesture(blocked, surface, false),
    ).toBe(false);
    expect(canStartTeamWorkspaceCanvasPanGesture(blocked, surface, true)).toBe(
      true,
    );
  });

  it("应识别可编辑键盘目标", () => {
    const input = document.createElement("input");
    expect(isEditableTeamWorkspaceCanvasKeyboardTarget(input)).toBe(true);

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    expect(isEditableTeamWorkspaceCanvasKeyboardTarget(editable)).toBe(true);

    const plain = document.createElement("button");
    expect(isEditableTeamWorkspaceCanvasKeyboardTarget(plain)).toBe(false);
  });
});
