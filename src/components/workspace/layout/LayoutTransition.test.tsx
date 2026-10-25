import { AppShell, AppShellHeader } from "@/components/app-shell/AppShell";
import React from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LayoutMode } from "@/lib/workspace/workflowTypes";
import { LayoutTransition } from "./LayoutTransition";
import { RightSurfaceTabStrip } from "@/components/agent/chat/workspace/right-surface/RightSurfaceTabStrip";
import {
  cleanupMountedRoots,
  clickElement,
  mountHarness,
  setupReactActEnvironment,
  type MountedRoot,
} from "../hooks/testUtils";

setupReactActEnvironment();

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dispatchPointerLikeEvent(
  element: HTMLElement,
  type: string,
  options: { clientX: number; pointerId: number; button?: number },
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: options.clientX },
    pointerId: { value: options.pointerId },
    button: { value: options.button ?? 0 },
  });
  element.dispatchEvent(event);
}

function LayoutHarness({
  mode,
  forceOpenChatPanel = false,
}: {
  mode: LayoutMode;
  forceOpenChatPanel?: boolean;
}) {
  return (
    <AppShell>
      <AppShellHeader />
      <div style={{ width: "1200px", height: "720px" }}>
        <LayoutTransition
          mode={mode}
          chatContent={<div data-testid="layout-chat-content">chat</div>}
          canvasContent={<div data-testid="layout-canvas-content">canvas</div>}
          forceOpenChatPanel={forceOpenChatPanel}
        />
      </div>
    </AppShell>
  );
}

function EmptyCanvasLayoutHarness({ mode }: { mode: LayoutMode }) {
  return (
    <AppShell>
      <AppShellHeader />
      <div style={{ width: "1200px", height: "720px" }}>
        <LayoutTransition
          mode={mode}
          chatContent={<div data-testid="layout-chat-content">chat</div>}
          canvasContent={null}
        />
      </div>
    </AppShell>
  );
}

describe("LayoutTransition", () => {
  const mountedRoots: MountedRoot[] = [];
  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;

  beforeEach(() => {
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

  it("共享页头在split/full/chat之间保持工具栏实例，隐藏pane不可交互并恢复编辑焦点", () => {
    function FocusHarness({ content = true }: { content?: boolean }) {
      return (
        <AppShell>
          <AppShellHeader />
          <LayoutTransition
            mode={content ? "chat-canvas" : "chat"}
            mainToolbar={
              <input aria-label="thread title" defaultValue="canonical title" />
            }
            mainTabLabel="canonical title"
            chatContent={
              <textarea aria-label="draft" defaultValue="retained draft" />
            }
            canvasContent={content ? <button>file content</button> : null}
          />
        </AppShell>
      );
    }
    const { container, rerender } = mountHarness(
      FocusHarness,
      { content: true },
      mountedRoots,
    );
    const title = container.querySelector<HTMLInputElement>(
      'input[aria-label="thread title"]',
    )!;
    const editor = container.querySelector<HTMLTextAreaElement>("textarea")!;
    editor.focus();
    act(() => {
      container
        .querySelector('[data-testid="layout-content-tab"]')!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(
      container
        .querySelector('[data-testid="layout-transition-root"]')
        ?.getAttribute("data-compact-primary-panel"),
    ).toBe("canvas");
    expect(container.querySelector('input[aria-label="thread title"]')).toBe(
      title,
    );
    expect(
      container
        .querySelector('[data-testid="layout-chat-panel"]')
        ?.hasAttribute("inert"),
    ).toBe(true);
    act(() => {
      const main = container.querySelector<HTMLButtonElement>(
        '[data-testid="layout-main-tab"]',
      )!;
      main.click();
    });
    expect(document.activeElement).toBe(editor);
    act(() => {
      const main = container.querySelector<HTMLButtonElement>(
        '[data-testid="layout-main-tab"]',
      )!;
      main.focus();
      main.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(
      container
        .querySelector('[data-testid="layout-transition-root"]')
        ?.getAttribute("data-layout-axis"),
    ).toBe("horizontal");
    expect(document.activeElement).toBe(editor);
    act(() => {
      window.innerWidth = 800;
      window.dispatchEvent(new Event("resize"));
    });
    expect(container.querySelector('input[aria-label="thread title"]')).toBe(
      title,
    );
    const content = container.querySelector<HTMLButtonElement>(
      '[data-testid="layout-content-tab"]',
    )!;
    const main = container.querySelector<HTMLButtonElement>(
      '[data-testid="layout-main-tab"]',
    )!;
    act(() => content.click());
    const chatPanel = container.querySelector(
      '[data-testid="layout-chat-panel"]',
    )!;
    expect(chatPanel.getAttribute("aria-hidden")).toBe("true");
    expect(chatPanel.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).not.toBe(editor);
    expect(
      container.querySelectorAll('[role="tab"][aria-selected="true"]'),
    ).toHaveLength(1);
    expect(main.getAttribute("aria-controls")).toBe(chatPanel.id);
    expect(chatPanel.getAttribute("aria-labelledby")).toBe(main.id);
    act(() => main.click());
    expect(chatPanel.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(editor);
    expect(editor.value).toBe("retained draft");
    act(() =>
      main.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      ),
    );
    expect(content.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(content);
    rerender({ content: false });
    expect(chatPanel.getAttribute("aria-hidden")).toBe("false");
    expect(document.activeElement).toBe(editor);
    expect(container.querySelector('input[aria-label="thread title"]')).toBe(
      title,
    );
  });

  it("chat-canvas 模式应为画布与对话保留分栏间距", () => {
    const { container } = mountHarness(
      LayoutHarness,
      { mode: "chat-canvas" },
      mountedRoots,
    );

    const root = container.querySelector<HTMLElement>(
      '[data-testid="layout-transition-root"]',
    );
    expect(root).not.toBeNull();

    const panelViewport = container.querySelector<HTMLElement>(
      '[data-testid="layout-panel-viewport"]',
    );
    const styles = Array.from(document.head.querySelectorAll("style"))
      .map((node) => node.textContent || "")
      .join("\n");

    const hasGapRule = Array.from(panelViewport?.classList ?? []).some(
      (className) =>
        new RegExp(`\\.${escapeRegExp(className)}\\{[^}]*gap:12px;`).test(
          styles,
        ),
    );

    expect(hasGapRule).toBe(true);
    expect(root?.getAttribute("data-layout-axis")).toBe("horizontal");
  });

  it("大屏 chat-canvas 模式应把对话列放在画布列之前", () => {
    const { container } = mountHarness(
      LayoutHarness,
      { mode: "chat-canvas" },
      mountedRoots,
    );

    const panelViewport = container.querySelector<HTMLElement>(
      '[data-testid="layout-panel-viewport"]',
    );
    const orderedPanels = Array.from(panelViewport?.children ?? [])
      .map((node) => node.getAttribute("data-testid"))
      .filter(Boolean);

    expect(orderedPanels).toEqual([
      "layout-chat-panel",
      "layout-chat-canvas-resize-handle",
      "layout-canvas-panel",
    ]);
    expect(
      container.querySelector('[data-testid="layout-chat-content"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="layout-canvas-content"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-testid="layout-chat-canvas-resize-handle"]',
      ),
    ).not.toBeNull();
  });

  it("分隔条按内容尺寸提供10px步进、Home/End边界与双击恢复，不重建pane", () => {
    const { container } = mountHarness(
      LayoutHarness,
      { mode: "chat-canvas" },
      mountedRoots,
    );
    const root = container.querySelector<HTMLElement>(
      '[data-testid="layout-transition-root"]',
    )!;
    const chat = container.querySelector<HTMLElement>(
      '[data-testid="layout-chat-panel"]',
    )!;
    const canvas = container.querySelector<HTMLElement>(
      '[data-testid="layout-canvas-panel"]',
    )!;
    const handle = container.querySelector<HTMLElement>('[role="separator"]')!;
    const initialWidth = chat.dataset.chatPanelWidth;
    const width = () =>
      chat.dataset.chatPanelWidth?.endsWith("px")
        ? Number.parseFloat(chat.dataset.chatPanelWidth)
        : 600;
    const box = (left: number, size: number) =>
      ({ left, right: left + size, width: size }) as DOMRect;
    root.getBoundingClientRect = () => box(100, 1200);
    chat.getBoundingClientRect = () => box(100, width());
    Object.defineProperty(chat, "offsetWidth", {
      configurable: true,
      get: width,
    });
    Object.defineProperty(canvas, "offsetLeft", {
      configurable: true,
      get: () => width() + 22,
    });
    canvas.getBoundingClientRect = () =>
      box(100 + width() + 22, 1200 - width() - 22);
    act(() => {
      window.dispatchEvent(new Event("resize"));
      handle.focus();
    });
    expect(handle.tabIndex).toBe(0);
    expect(handle.getAttribute("aria-valuemin")).toBe("320");
    expect(handle.getAttribute("aria-valuemax")).toBe("858");
    expect(handle.getAttribute("aria-valuenow")).toBe("578");
    const key = (name: string) => {
      const event = new KeyboardEvent("keydown", {
        key: name,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        handle.dispatchEvent(event);
      });
      return event.defaultPrevented;
    };
    expect(key("ArrowRight")).toBe(true);
    expect(chat.dataset.chatPanelWidth).toBe("610px");
    expect(handle.getAttribute("aria-valuenow")).toBe("568");
    expect(key("ArrowLeft")).toBe(true);
    expect(chat.dataset.chatPanelWidth).toBe("600px");
    key("Home");
    expect(chat.dataset.chatPanelWidth).toBe("858px");
    key("ArrowRight");
    expect(chat.dataset.chatPanelWidth).toBe("858px");
    key("End");
    expect(chat.dataset.chatPanelWidth).toBe("320px");
    key("ArrowLeft");
    expect(chat.dataset.chatPanelWidth).toBe("320px");
    expect(key("ArrowDown")).toBe(false);
    act(() => {
      handle.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      );
    });
    expect(chat.dataset.chatPanelWidth).toBe(initialWidth);
    expect(document.activeElement).toBe(handle);
    expect(container.querySelector('[data-testid="layout-chat-panel"]')).toBe(
      chat,
    );
    expect(container.querySelector('[data-testid="layout-canvas-panel"]')).toBe(
      canvas,
    );
  });

  it("大屏 chat-canvas 模式应支持拖动分隔线调整对话区宽度", async () => {
    const { container } = mountHarness(
      LayoutHarness,
      { mode: "chat-canvas" },
      mountedRoots,
    );

    const root = container.querySelector<HTMLElement>(
      '[data-testid="layout-transition-root"]',
    );
    const chatPanel = container.querySelector<HTMLElement>(
      '[data-testid="layout-chat-panel"]',
    );
    const handle = container.querySelector<HTMLElement>(
      '[data-testid="layout-chat-canvas-resize-handle"]',
    );

    expect(root).not.toBeNull();
    expect(chatPanel).not.toBeNull();
    expect(handle).not.toBeNull();

    root!.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 1200,
        bottom: 720,
        width: 1200,
        height: 720,
        x: 0,
        y: 0,
        toJSON: () => undefined,
      }) as DOMRect;
    handle!.setPointerCapture = () => undefined;
    handle!.releasePointerCapture = () => undefined;
    handle!.hasPointerCapture = () => true;
    chatPanel!.getBoundingClientRect = () => ({ width: 720 }) as DOMRect;

    await act(async () => {
      dispatchPointerLikeEvent(handle!, "pointerdown", {
        clientX: 700,
        pointerId: 3,
        button: 2,
      });
      expect(handle?.getAttribute("data-dragging")).toBe("false");
    });
    const initialWidth = chatPanel?.getAttribute("data-chat-panel-width");
    await act(async () => {
      dispatchPointerLikeEvent(handle!, "pointerdown", {
        clientX: 720,
        pointerId: 1,
      });
    });
    expect(chatPanel?.getAttribute("data-chat-panel-width")).toBe(initialWidth);
    await act(async () => {
      dispatchPointerLikeEvent(handle!, "pointermove", {
        clientX: 1000,
        pointerId: 2,
      });
      dispatchPointerLikeEvent(handle!, "pointerup", {
        clientX: 1000,
        pointerId: 2,
      });
    });
    expect(chatPanel?.getAttribute("data-chat-panel-width")).toBe(initialWidth);
    expect(handle?.getAttribute("data-dragging")).toBe("true");
    await act(async () => {
      dispatchPointerLikeEvent(handle!, "pointermove", {
        clientX: 760,
        pointerId: 1,
      });
      dispatchPointerLikeEvent(handle!, "pointerup", {
        clientX: 760,
        pointerId: 1,
      });
      await Promise.resolve();
    });

    expect(chatPanel?.getAttribute("data-chat-panel-width")).toBe("760px");
    expect(handle?.getAttribute("data-dragging")).toBe("false");
  });

  it("小屏 chat-canvas 模式仍应保持中右分栏比例一致", () => {
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

    const { container } = mountHarness(
      LayoutHarness,
      { mode: "chat-canvas" },
      mountedRoots,
    );

    const root = container.querySelector<HTMLElement>(
      '[data-testid="layout-transition-root"]',
    );
    const panelViewport = container.querySelector<HTMLElement>(
      '[data-testid="layout-panel-viewport"]',
    );
    const orderedPanels = Array.from(panelViewport?.children ?? [])
      .map((node) => node.getAttribute("data-testid"))
      .filter(Boolean);

    expect(root?.getAttribute("data-layout-axis")).toBe("horizontal");
    expect(root?.getAttribute("data-chat-panel-placement")).toBe("inline");
    expect(orderedPanels).toEqual([
      "layout-chat-panel",
      "layout-chat-canvas-resize-handle",
      "layout-canvas-panel",
    ]);
    expect(
      container
        .querySelector<HTMLElement>('[data-testid="layout-chat-panel"]')
        ?.getAttribute("data-overlay-state"),
    ).toBe("inline");
    expect(
      container.querySelector('[data-testid="layout-chat-content"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="layout-canvas-content"]'),
    ).not.toBeNull();
    expect(
      container
        .querySelector<HTMLElement>("[data-app-shell-unified-tab-strip]")
        ?.getAttribute("data-mode"),
    ).toBe("split");
    expect(
      container.querySelector(
        '[data-testid="layout-chat-canvas-resize-handle"]',
      ),
    ).not.toBeNull();
  });

  it("极窄 chat-canvas 模式应默认用完整聊天主面板并允许切换工作台", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 820,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 600,
    });

    const { container } = mountHarness(
      LayoutHarness,
      { mode: "chat-canvas" },
      mountedRoots,
    );

    const root = container.querySelector<HTMLElement>(
      '[data-testid="layout-transition-root"]',
    );

    expect(root?.getAttribute("data-layout-axis")).toBe("single");
    expect(root?.getAttribute("data-chat-panel-placement")).toBe(
      "single-panel",
    );
    expect(root?.getAttribute("data-compact-primary-panel")).toBe("chat");
    expect(
      container.querySelector("[data-app-shell-unified-tab-strip]"),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-testid="layout-chat-canvas-resize-handle"]',
      ),
    ).toBeNull();
    expect(
      container
        .querySelector<HTMLElement>('[data-testid="layout-chat-panel"]')
        ?.getAttribute("data-overlay-state"),
    ).toBe("single-active");
    expect(
      container.querySelector('[data-testid="layout-chat-content"]'),
    ).not.toBeNull();

    await act(async () => {
      clickElement(
        container.querySelector('[data-testid="layout-content-tab"]'),
      );
      await Promise.resolve();
    });

    expect(root?.getAttribute("data-compact-primary-panel")).toBe("canvas");
    expect(
      container
        .querySelector<HTMLElement>('[data-testid="layout-chat-panel"]')
        ?.getAttribute("data-overlay-state"),
    ).toBe("single-hidden");
    expect(
      container.querySelector('[data-testid="layout-canvas-content"]'),
    ).not.toBeNull();

    await act(async () => {
      clickElement(container.querySelector('[data-testid="layout-main-tab"]'));
      await Promise.resolve();
    });

    expect(root?.getAttribute("data-compact-primary-panel")).toBe("chat");
  });

  it("窄窗新动作应激活现役侧面板，返回聊天后普通重绘不抢焦点", () => {
    window.innerWidth = 900;
    function ActionsHarness({ activeTabId }: { activeTabId: string | null }) {
      return (
        <AppShell>
          <AppShellHeader />
          <LayoutTransition
            mode={activeTabId ? "chat-canvas" : "chat"}
            chatContent={<textarea defaultValue="retained action draft" />}
            canvasContent={<div>action output</div>}
            sidePanelTabStrip={
              activeTabId ? (
                <RightSurfaceTabStrip
                  definitions={[{ kind: "shell", render: () => null }]}
                  tabs={[{ kind: "shell", tabId: activeTabId }]}
                  activeTabId={activeTabId}
                  onNewTab={() => undefined}
                  onSelectTab={() => undefined}
                  onCloseTab={() => undefined}
                  previewTabId={null}
                  idPrefix="actions"
                />
              ) : undefined
            }
          />
        </AppShell>
      );
    }
    const { container, rerender } = mountHarness(
      ActionsHarness,
      { activeTabId: null as string | null },
      mountedRoots,
    );
    const draft = container.querySelector("textarea");
    const panel = container.querySelector(
      '[data-testid="layout-canvas-panel"]',
    );
    const layout = container.querySelector(
      '[data-testid="layout-transition-root"]',
    );

    rerender({ activeTabId: "first-action" });
    expect(layout?.getAttribute("data-compact-primary-panel")).toBe("canvas");
    expect(panel?.getAttribute("aria-hidden")).toBe("false");
    expect(panel?.hasAttribute("inert")).toBe(false);
    expect(
      container
        .querySelector('[data-testid="workspace-right-surface-tab-shell"]')
        ?.getAttribute("aria-selected"),
    ).toBe("true");

    act(() =>
      clickElement(container.querySelector('[data-testid="layout-main-tab"]')),
    );
    expect(layout?.getAttribute("data-compact-primary-panel")).toBe("chat");
    rerender({ activeTabId: "first-action" });
    expect(layout?.getAttribute("data-compact-primary-panel")).toBe("chat");
    expect(container.querySelector("textarea")).toBe(draft);
    expect(draft?.value).toBe("retained action draft");

    rerender({ activeTabId: "second-action" });
    expect(layout?.getAttribute("data-compact-primary-panel")).toBe("canvas");
    expect(panel?.getAttribute("aria-hidden")).toBe("false");
    expect(container.querySelector("textarea")).toBe(draft);
  });

  it("应按实际工作区容器宽度切换单面板，而不是只看窗口宽度", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1200,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 720,
    });

    const { container } = mountHarness(
      LayoutHarness,
      { mode: "chat-canvas" },
      mountedRoots,
    );

    const root = container.querySelector<HTMLElement>(
      '[data-testid="layout-transition-root"]',
    );
    expect(root?.getAttribute("data-layout-axis")).toBe("horizontal");

    root!.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 760,
        bottom: 720,
        width: 760,
        height: 720,
        x: 0,
        y: 0,
        toJSON: () => undefined,
      }) as DOMRect;

    await act(async () => {
      window.dispatchEvent(new Event("resize"));
      await Promise.resolve();
    });

    expect(root?.getAttribute("data-layout-axis")).toBe("single");
    expect(root?.getAttribute("data-compact-primary-panel")).toBe("chat");
  });

  it("紧凑单面板态存在待处理 A2UI 时应自动切回聊天区", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 820,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 600,
    });

    const { container, rerender } = mountHarness(
      LayoutHarness,
      { mode: "chat-canvas", forceOpenChatPanel: false },
      mountedRoots,
    );

    await act(async () => {
      clickElement(
        container.querySelector('[data-testid="layout-content-tab"]'),
      );
      await Promise.resolve();
    });
    expect(
      container
        .querySelector<HTMLElement>('[data-testid="layout-transition-root"]')
        ?.getAttribute("data-compact-primary-panel"),
    ).toBe("canvas");

    rerender({ mode: "chat-canvas", forceOpenChatPanel: true });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container
        .querySelector<HTMLElement>('[data-testid="layout-chat-panel"]')
        ?.getAttribute("data-overlay-state"),
    ).toBe("single-active");
    expect(
      container.querySelector('[data-testid="layout-chat-content"]'),
    ).not.toBeNull();
  });

  it("画布内容为空时应退回聊天布局，避免保留空白画布列", () => {
    const { container } = mountHarness(
      EmptyCanvasLayoutHarness,
      { mode: "chat-canvas" },
      mountedRoots,
    );

    const root = container.querySelector<HTMLElement>(
      '[data-testid="layout-transition-root"]',
    );

    expect(root?.getAttribute("data-effective-mode")).toBe("chat");
    expect(root?.getAttribute("data-has-canvas")).toBe("false");
    expect(
      container.querySelector('[data-testid="layout-chat-content"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="layout-canvas-content"]'),
    ).toBeNull();
  });
});
