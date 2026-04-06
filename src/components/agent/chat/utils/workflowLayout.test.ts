import { describe, expect, it } from "vitest";
import {
  resolveWorkflowFloatingChromeInset,
  resolveWorkflowLayoutBottomSpacing,
} from "./workflowLayout";

describe("workflowLayout", () => {
  it("存在浮动输入区时应按运行态返回 chrome inset", () => {
    expect(
      resolveWorkflowFloatingChromeInset({
        showFloatingInputOverlay: true,
        hasCanvasContent: false,
        workflowRunState: "idle",
        gateStatus: "idle",
      }),
    ).toBe("88px");

    expect(
      resolveWorkflowFloatingChromeInset({
        showFloatingInputOverlay: true,
        hasCanvasContent: false,
        workflowRunState: "auto_running",
        gateStatus: "idle",
      }),
    ).toBe("168px");

    expect(
      resolveWorkflowFloatingChromeInset({
        showFloatingInputOverlay: true,
        hasCanvasContent: true,
        workflowRunState: "await_user_decision",
        gateStatus: "waiting",
      }),
    ).toBe("12px");
  });

  it("context workspace 启用时不应再与 shell 底部 inset 叠加占位", () => {
    expect(
      resolveWorkflowLayoutBottomSpacing({
        contextWorkspaceEnabled: true,
        showFloatingInputOverlay: true,
        hasCanvasContent: false,
        workflowRunState: "idle",
        gateStatus: "idle",
      }),
    ).toEqual({
      shellBottomInset: "0",
      messageViewportBottomPadding: "88px",
    });
  });

  it("非 context workspace 模式应继续由 shell 承担底部留白", () => {
    expect(
      resolveWorkflowLayoutBottomSpacing({
        contextWorkspaceEnabled: false,
        showFloatingInputOverlay: true,
        hasCanvasContent: false,
        workflowRunState: "idle",
        gateStatus: "idle",
      }),
    ).toEqual({
      shellBottomInset: "88px",
      messageViewportBottomPadding: "128px",
    });
  });
});
