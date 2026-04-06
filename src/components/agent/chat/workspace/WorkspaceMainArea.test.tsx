import React, { type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WorkspaceMainArea } from "./WorkspaceMainArea";
import {
  cleanupMountedRoots,
  mountHarness,
  setupReactActEnvironment,
  type MountedRoot,
} from "@/components/workspace/hooks/testUtils";

setupReactActEnvironment();

function WorkspaceMainAreaHarness(
  props: Partial<ComponentProps<typeof WorkspaceMainArea>>,
) {
  return (
    <div style={{ width: "1200px", height: "720px" }}>
      <WorkspaceMainArea
        compactChrome={false}
        navbarNode={null}
        contentSyncNoticeNode={null}
        shellBottomInset="0px"
        layoutMode="chat-canvas"
        forceCanvasMode={false}
        chatContent={<div data-testid="workspace-chat-content">chat</div>}
        canvasContent={<div data-testid="workspace-canvas-content">canvas</div>}
        generalWorkbenchDialog={null}
        generalWorkbenchHarnessDialog={null}
        showFloatingInputOverlay={false}
        hasPendingA2UIForm={false}
        inputbarNode={<div data-testid="workspace-inputbar">inputbar</div>}
        {...props}
      />
    </div>
  );
}

describe("WorkspaceMainArea", () => {
  const mountedRoots: MountedRoot[] = [];
  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;

  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1080,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 720,
    });
  });

  afterEach(() => {
    cleanupMountedRoots(mountedRoots);
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: originalInnerWidth,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: originalInnerHeight,
    });
  });

  it("待处理 A2UI 存在时即使输入区是浮层也应直接回到纯聊天态", () => {
    const { container } = mountHarness(
      WorkspaceMainAreaHarness,
      {
        showFloatingInputOverlay: true,
        hasPendingA2UIForm: true,
      },
      mountedRoots,
    );

    expect(
      container.querySelector<HTMLElement>(
        '[data-testid="layout-transition-root"]',
      )?.dataset.effectiveMode,
    ).toBe("chat");
    expect(
      container.querySelector<HTMLElement>('[data-testid="layout-chat-panel"]')
        ?.dataset.overlayState,
    ).toBe("inline");
    expect(
      container.querySelector('[data-testid="workspace-inputbar"]'),
    ).not.toBeNull();
  });

  it("没有浮层输入区时待处理 A2UI 也应保持纯聊天态", () => {
    const { container } = mountHarness(
      WorkspaceMainAreaHarness,
      {
        showFloatingInputOverlay: false,
        hasPendingA2UIForm: true,
      },
      mountedRoots,
    );

    expect(
      container.querySelector<HTMLElement>(
        '[data-testid="layout-transition-root"]',
      )?.dataset.effectiveMode,
    ).toBe("chat");
    expect(
      container.querySelector<HTMLElement>('[data-testid="layout-chat-panel"]')
        ?.dataset.overlayState,
    ).toBe("inline");
  });

  it("待处理 A2UI 存在时应屏蔽主题工作台的强制画布态", () => {
    const { container } = mountHarness(
      WorkspaceMainAreaHarness,
      {
        forceCanvasMode: true,
        hasPendingA2UIForm: true,
      },
      mountedRoots,
    );

    expect(
      container.querySelector<HTMLElement>(
        '[data-testid="layout-transition-root"]',
      )?.dataset.effectiveMode,
    ).toBe("chat");
  });
});
