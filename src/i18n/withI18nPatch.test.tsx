import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupMountedRoots,
  flushEffects,
  mountHarness,
  setupReactActEnvironment,
  type MountedRoot,
} from "@/components/workspace/hooks/testUtils";
import { changeLimeLocale } from "@/i18n/createI18n";
import "@/i18n/config";

const { mockGetConfig, mockHasDesktopHostInvokeCapability } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockHasDesktopHostInvokeCapability: vi.fn(),
}));

vi.mock("@/lib/api/appConfig", () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
}));

vi.mock("@/lib/desktop-runtime", () => ({
  hasDesktopHostInvokeCapability: (...args: unknown[]) =>
    mockHasDesktopHostInvokeCapability(...args),
}));

import { withI18nPatch } from "./withI18nPatch";

const mountedRoots: MountedRoot[] = [];

function DemoComponent() {
  return <div>应用已就绪</div>;
}

describe("withI18nPatch", () => {
  beforeEach(async () => {
    setupReactActEnvironment();
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/");
    await changeLimeLocale("zh-CN");
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", ((
      callback: (time: number) => void,
    ) =>
      window.setTimeout(() => callback(0), 0)) as typeof requestAnimationFrame);
    mockHasDesktopHostInvokeCapability.mockReturnValue(true);
  });

  afterEach(() => {
    cleanupMountedRoots(mountedRoots);
    window.history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("配置读取超时后回退默认语言并继续渲染", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    mockGetConfig.mockImplementation(
      () => new Promise(() => undefined) as Promise<unknown>,
    );

    const PatchedComponent = withI18nPatch(DemoComponent);
    const mounted = mountHarness(PatchedComponent, {}, mountedRoots);

    await flushEffects(2);
    expect(mounted.container.textContent).toContain("正在启动 Lime");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
    });
    await flushEffects(4);

    try {
      expect(mounted.container.textContent).toContain("应用已就绪");
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it("已有 Electron 原生启动页时不再显示 i18n 文字启动页", async () => {
    mockGetConfig.mockImplementation(
      () => new Promise(() => undefined) as Promise<unknown>,
    );
    mockHasDesktopHostInvokeCapability.mockReturnValue(true);
    window.history.replaceState(null, "", "/?nativeStartup=1");

    const PatchedComponent = withI18nPatch(DemoComponent);
    const mounted = mountHarness(PatchedComponent, {}, mountedRoots);

    await flushEffects(2);

    expect(mounted.container.textContent).toContain("应用已就绪");
    expect(mounted.container.textContent).not.toContain("正在启动 Lime");
    expect(mounted.container.textContent).not.toContain("正在准备界面语言配置");
  });
});
