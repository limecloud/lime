import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, lazy, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  hasNativeStartupScreen,
  NativeStartupWindowReady,
} from "./nativeStartupScreen";

const revealWindow = vi.hoisted(() => vi.fn());
vi.mock("./startupWindowReveal", () => ({
  revealStartupWindowWhenReady: revealWindow,
}));

const desktopRuntimeMock = vi.hoisted(() => ({
  hasDesktopHostInvokeCapability: vi.fn(() => false),
}));

vi.mock("@/lib/desktop-runtime", () => ({
  hasDesktopHostInvokeCapability:
    desktopRuntimeMock.hasDesktopHostInvokeCapability,
}));

describe("hasNativeStartupScreen", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    desktopRuntimeMock.hasDesktopHostInvokeCapability.mockReturnValue(true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    window.history.replaceState(null, "", "/");
  });

  it("Electron Desktop Host 可用且 URL 带标记时认为已有原生启动页接管", () => {
    desktopRuntimeMock.hasDesktopHostInvokeCapability.mockReturnValue(true);
    window.history.replaceState(null, "", "/?nativeStartup=1");

    expect(hasNativeStartupScreen()).toBe(true);
  });

  it("Electron Desktop Host 可用但没有 URL 标记时仍保留 React 启动画面", () => {
    desktopRuntimeMock.hasDesktopHostInvokeCapability.mockReturnValue(true);
    window.history.replaceState(null, "", "/");

    expect(hasNativeStartupScreen()).toBe(false);
  });

  it("浏览器模式保留 React 启动画面", () => {
    desktopRuntimeMock.hasDesktopHostInvokeCapability.mockReturnValue(false);
    window.history.replaceState(null, "", "/?nativeStartup=1");

    expect(hasNativeStartupScreen()).toBe(false);
  });

  it("初始页面挂起时保持隐藏，页面提交后才请求显示窗口", async () => {
    window.history.replaceState(null, "", "/?nativeStartup=1");
    let resolvePage!: (module: {
      default: () => ReturnType<typeof createElement>;
    }) => void;
    const Page = lazy(
      () =>
        new Promise<{ default: () => ReturnType<typeof createElement> }>(
          (resolve) => {
            resolvePage = resolve;
          },
        ),
    );

    await act(async () =>
      root.render(
        createElement(
          Suspense,
          { fallback: "loading" },
          createElement(Page),
          createElement(NativeStartupWindowReady),
        ),
      ),
    );
    expect(container.textContent).toBe("loading");
    expect(revealWindow).not.toHaveBeenCalled();

    await act(async () =>
      resolvePage({ default: () => createElement("main", null, "ready") }),
    );

    expect(container.textContent).toBe("ready");
    expect(revealWindow).toHaveBeenCalledOnce();
  });

  it("普通浏览器页面不会请求显示原生窗口", async () => {
    await act(async () => root.render(createElement(NativeStartupWindowReady)));
    expect(revealWindow).not.toHaveBeenCalled();
  });
});
