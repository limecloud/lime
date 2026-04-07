import React from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LayoutMode } from "@/lib/workspace/workflowTypes";
import { LayoutTransition } from "./LayoutTransition";
import { emitCompactRightPanelOpen } from "@/lib/compactRightPanelEvents";
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

function LayoutHarness({
  mode,
  forceOpenChatPanel = false,
}: {
  mode: LayoutMode;
  forceOpenChatPanel?: boolean;
}) {
  return (
    <div style={{ width: "1200px", height: "720px" }}>
      <LayoutTransition
        mode={mode}
        chatContent={<div data-testid="layout-chat-content">chat</div>}
        canvasContent={<div data-testid="layout-canvas-content">canvas</div>}
        forceOpenChatPanel={forceOpenChatPanel}
      />
    </div>
  );
}

function EmptyCanvasLayoutHarness({ mode }: { mode: LayoutMode }) {
  return (
    <div style={{ width: "1200px", height: "720px" }}>
      <LayoutTransition
        mode={mode}
        chatContent={<div data-testid="layout-chat-content">chat</div>}
        canvasContent={null}
      />
    </div>
  );
}

function PlainChatLayoutHarness({ mode }: { mode: LayoutMode }) {
  return (
    <div style={{ width: "1200px", height: "720px" }}>
      <LayoutTransition
        mode={mode}
        chatContent={<div data-testid="layout-chat-content">chat</div>}
        canvasContent={null}
        chatPanelChrome="plain"
      />
    </div>
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

    const styles = Array.from(document.head.querySelectorAll("style"))
      .map((node) => node.textContent || "")
      .join("\n");

    const hasGapRule = Array.from(root?.classList ?? []).some((className) =>
      new RegExp(`\\.${escapeRegExp(className)}\\{[^}]*gap:12px;`).test(styles),
    );

    expect(hasGapRule).toBe(true);
    expect(root?.getAttribute("data-layout-axis")).toBe("horizontal");
  });

  it("小屏 chat-canvas 模式应改为右侧聊天抽屉，而不是上下堆叠", () => {
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

    expect(root?.getAttribute("data-layout-axis")).toBe("horizontal");
    expect(root?.getAttribute("data-chat-panel-placement")).toBe(
      "overlay-right",
    );
    expect(
      container.querySelector('[data-testid="layout-chat-overlay-trigger"]'),
    ).not.toBeNull();
    expect(
      container
        .querySelector<HTMLElement>('[data-testid="layout-chat-panel"]')
        ?.getAttribute("data-overlay-state"),
    ).toBe("closed");

    clickElement(
      container.querySelector('button[aria-label="展开右侧聊天区"]'),
    );

    expect(
      container
        .querySelector<HTMLElement>('[data-testid="layout-chat-panel"]')
        ?.getAttribute("data-overlay-state"),
    ).toBe("open");
    expect(
      container.querySelector('[data-testid="layout-chat-content"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="layout-chat-drawer-header"]')
        ?.textContent,
    ).toContain("右侧聊天区");
    expect(
      container.querySelector('[data-testid="layout-chat-drawer-header"]')
        ?.textContent,
    ).toContain("调度记录");
    expect(
      container.querySelector('[data-testid="layout-canvas-content"]'),
    ).not.toBeNull();

    clickElement(
      container.querySelector('button[aria-label="收起右侧聊天区"]'),
    );
    expect(
      container
        .querySelector<HTMLElement>('[data-testid="layout-chat-panel"]')
        ?.getAttribute("data-overlay-state"),
    ).toBe("closed");
  });

  it("小屏聊天抽屉打开后，收到工作台抽屉打开事件应自动收起", async () => {
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

    clickElement(
      container.querySelector('button[aria-label="展开右侧聊天区"]'),
    );
    expect(
      container
        .querySelector<HTMLElement>('[data-testid="layout-chat-panel"]')
        ?.getAttribute("data-overlay-state"),
    ).toBe("open");

    await act(async () => {
      emitCompactRightPanelOpen({ source: "workbench" });
      await Promise.resolve();
    });

    expect(
      container
        .querySelector<HTMLElement>('[data-testid="layout-chat-panel"]')
        ?.getAttribute("data-overlay-state"),
    ).toBe("closed");
  });

  it("紧凑抽屉态存在待处理 A2UI 时应自动展开聊天区", async () => {
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
      { mode: "chat-canvas", forceOpenChatPanel: true },
      mountedRoots,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container
        .querySelector<HTMLElement>('[data-testid="layout-chat-panel"]')
        ?.getAttribute("data-overlay-state"),
    ).toBe("open");
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

  it("plain 聊天壳模式不应再渲染额外面板背景层", () => {
    const { container } = mountHarness(
      PlainChatLayoutHarness,
      { mode: "chat" },
      mountedRoots,
    );

    expect(
      container.querySelector('[data-testid="layout-chat-panel-plain"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="layout-chat-panel-inner"]'),
    ).toBeNull();
  });
});
