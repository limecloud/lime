import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { LayoutMode } from "../../types";
import { useLayoutTransition } from "./useLayoutTransition";
import {
  cleanupMountedRoots,
  mountHarness,
  setupReactActEnvironment,
  type MountedRoot,
} from "../../../workspace/hooks/testUtils";

setupReactActEnvironment();

function HookHarness({ mode }: { mode: LayoutMode }) {
  const { transitionState, isCanvasVisible, getTransitionStyles } =
    useLayoutTransition(mode);
  const canvasStyles = getTransitionStyles("canvas");
  const chatStyles = getTransitionStyles("chat");

  return (
    <div
      data-testid="layout-transition-hook"
      data-transition-state={transitionState}
      data-canvas-visible={String(isCanvasVisible)}
      data-canvas-transform={String(canvasStyles.transform)}
      data-canvas-opacity={String(canvasStyles.opacity)}
      data-chat-width={String(chatStyles.width)}
    />
  );
}

describe("useLayoutTransition", () => {
  const mountedRoots: MountedRoot[] = [];

  afterEach(() => {
    cleanupMountedRoots(mountedRoots);
  });

  it("首屏直接进入 canvas 模式时应立即展示画布", () => {
    const { container } = mountHarness(
      HookHarness,
      { mode: "canvas" },
      mountedRoots,
    );

    const root = container.querySelector(
      '[data-testid="layout-transition-hook"]',
    );

    expect(root?.getAttribute("data-transition-state")).toBe("entered");
    expect(root?.getAttribute("data-canvas-visible")).toBe("true");
    expect(root?.getAttribute("data-canvas-transform")).toBe("translateX(0)");
    expect(root?.getAttribute("data-canvas-opacity")).toBe("1");
  });

  it("首屏直接进入 chat-canvas 模式时也应立即展示画布", () => {
    const { container } = mountHarness(
      HookHarness,
      { mode: "chat-canvas" },
      mountedRoots,
    );

    const root = container.querySelector(
      '[data-testid="layout-transition-hook"]',
    );

    expect(root?.getAttribute("data-transition-state")).toBe("entered");
    expect(root?.getAttribute("data-canvas-visible")).toBe("true");
    expect(root?.getAttribute("data-canvas-transform")).toBe("translateX(0)");
    expect(root?.getAttribute("data-canvas-opacity")).toBe("1");
    expect(root?.getAttribute("data-chat-width")).toBe(
      "min(100%, clamp(480px, 40%, 600px))",
    );
  });
});
