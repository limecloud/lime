import React, { act, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WorkspaceMainArea } from "./WorkspaceMainArea";
import { AppShell, AppShellHeader } from "@/components/app-shell/AppShell";
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
    <AppShell>
      <AppShellHeader />
      <div style={{ width: "1200px", height: "720px" }}>
        <WorkspaceMainArea
          compactChrome={false}
          rightSurfaceOpen={false}
          contentSyncNoticeNode={null}
          shellBottomInset="0px"
          layoutMode="chat-canvas"
          forceCanvasMode={false}
          chatContent={<div data-testid="workspace-chat-content">chat</div>}
          canvasContent={
            <div data-testid="workspace-canvas-content">canvas</div>
          }
          generalWorkbenchDialog={null}
          showFloatingInputOverlay={false}
          hasPendingA2UIForm={false}
          inputbarNode={<div data-testid="workspace-inputbar">inputbar</div>}
          {...props}
        />
      </div>
    </AppShell>
  );
}

describe("WorkspaceMainArea", () => {
  const mountedRoots: MountedRoot[] = [];
  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;

  it("折叠只隐藏既有右侧内容，重新展开复用同一DOM", () => {
    const content = (
      <input data-testid="retained-file-state" defaultValue="unsaved" />
    );
    const props = {
      layoutMode: "chat" as const,
      rightSurfaceContent: content,
      rightSurfaceOpen: true,
    };
    const view = mountHarness(WorkspaceMainAreaHarness, props, mountedRoots);
    const input = view.container.querySelector<HTMLInputElement>(
      '[data-testid="retained-file-state"]',
    )!;
    input.value = "still unsaved";
    view.rerender({ ...props, rightSurfaceOpen: false });
    expect(
      view.container.querySelector('[data-testid="retained-file-state"]'),
    ).toBe(input);
    expect(input.closest("[hidden]")).not.toBeNull();
    expect(
      view.container
        .querySelector('[data-testid="layout-canvas-panel"]')
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
    view.rerender(props);
    expect(
      view.container.querySelector('[data-testid="retained-file-state"]'),
    ).toBe(input);
    expect(input.closest("[hidden]")).toBeNull();
    expect(input.value).toBe("still unsaved");
  });

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

  it("浮层输入区应跟随底部工具 inset 上移，避免被 Shell 面板遮挡", () => {
    const { container } = mountHarness(
      WorkspaceMainAreaHarness,
      {
        showFloatingInputOverlay: true,
        shellBottomInset: "calc(0px + 228px)",
      },
      mountedRoots,
    );

    const inputbar = container.querySelector<HTMLElement>(
      '[data-testid="workspace-inputbar"]',
    );
    const overlay = container.querySelector<HTMLElement>(
      '[data-testid="general-workbench-input-overlay"]',
    );

    expect(overlay).not.toBeNull();
    expect(overlay?.dataset.bottomInset).toBe("calc(0px + 228px)");
    expect(overlay?.contains(inputbar)).toBe(true);
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

  it("展开工作台时应把对话放在画布前面", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1440,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 900,
    });

    const { container } = mountHarness(
      WorkspaceMainAreaHarness,
      {
        layoutMode: "chat-canvas",
      },
      mountedRoots,
    );

    const panelViewport = container.querySelector<HTMLElement>(
      '[data-testid="layout-panel-viewport"]',
    );
    const orderedPanels = Array.from(panelViewport?.children ?? [])
      .map((node) => node.getAttribute("data-testid"))
      .filter(Boolean);

    expect(orderedPanels).toContain("layout-chat-panel");
    expect(orderedPanels).toContain("layout-canvas-panel");
    expect(orderedPanels.indexOf("layout-chat-panel")).toBeLessThan(
      orderedPanels.indexOf("layout-canvas-panel"),
    );
    expect(orderedPanels).toContain("layout-chat-canvas-resize-handle");
    expect(
      container.querySelector('[data-testid="workspace-chat-content"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="workspace-canvas-content"]'),
    ).not.toBeNull();
  });

  it("Right Surface 内容应替换画布内容并打开右侧承载区", () => {
    const { container } = mountHarness(
      WorkspaceMainAreaHarness,
      {
        layoutMode: "chat",
        rightSurfaceOpen: true,
        rightSurfaceContent: (
          <div data-testid="workspace-right-surface">expert</div>
        ),
      },
      mountedRoots,
    );

    expect(
      container.querySelector<HTMLElement>(
        '[data-testid="layout-transition-root"]',
      )?.dataset.effectiveMode,
    ).toBe("chat-canvas");
    expect(
      container.querySelector('[data-testid="workspace-right-surface"]'),
    ).not.toBeNull();
    expect(
      container.querySelector<HTMLElement>(
        '[data-testid="layout-transition-root"]',
      )?.dataset.hasCanvas,
    ).toBe("true");
    expect(
      container.querySelector('[data-testid="workspace-canvas-content"]'),
    ).toBeNull();
    const viewport = container.querySelector<HTMLElement>('[data-testid="layout-transition-root"]')!;
    viewport.getBoundingClientRect = () => ({ left: 0, width: 1200, height: 720 }) as DOMRect;
    act(() => window.dispatchEvent(new Event("resize")));
    expect(
      container.querySelector<HTMLElement>('[data-testid="layout-chat-panel"]')
        ?.dataset.chatPanelWidth,
    ).toBe("880px");
    expect(
      container.querySelector<HTMLElement>('[data-testid="layout-chat-panel"]')
        ?.dataset.chatPanelMinWidth,
    ).toBe("320px");
    expect(
      container.querySelector('[data-testid="workspace-right-surface"]'),
    ).not.toBeNull();
  });

  it("Right Surface 显式默认宽度仍服从统一 320px 下限", () => {
    const { container } = mountHarness(
      WorkspaceMainAreaHarness,
      {
        layoutMode: "chat",
        rightSurfaceOpen: true,
        rightSurfaceContent: (
          <div data-testid="workspace-right-surface">trace</div>
        ),
        chatPanelWidth: "min(100%, 720px)",
      },
      mountedRoots,
    );

    const chatPanel = container.querySelector<HTMLElement>(
      '[data-testid="layout-chat-panel"]',
    );

    expect(chatPanel?.dataset.chatPanelWidth).toBe("min(100%, 720px)");
    expect(chatPanel?.dataset.chatPanelMinWidth).toBe("320px");
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

  it("统一工具栏进入窗口页头，工作区没有旧补位或重复顶栏", () => {
    const { container } = mountHarness(
      WorkspaceMainAreaHarness,
      {
        mainToolbar: (
          <button data-testid="thread-header-action">打开位置</button>
        ),
        mainTabLabel: "当前线程",
      },
      mountedRoots,
    );
    const header = container.querySelector("header")!;
    expect(
      header.querySelector('[data-testid="thread-header-action"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-testid="workspace-main-area"] [data-testid="thread-header-action"]',
      ),
    ).toBeNull();
    expect(
      header
        .querySelector("[data-app-shell-unified-tab-strip]")
        ?.getAttribute("data-mode"),
    ).toBe("split");
    expect(
      container.querySelector('[data-testid="task-center-chrome-shell"]'),
    ).toBeNull();
    expect(
      container.querySelector(
        '[data-testid="workspace-navbar-auto-hide-shell"]',
      ),
    ).toBeNull();
  });
});
