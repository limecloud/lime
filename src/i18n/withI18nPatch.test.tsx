import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupMountedRoots,
  flushEffects,
  mountHarness,
  setupReactActEnvironment,
  type MountedRoot,
} from "@/components/workspace/hooks/testUtils";

const { mockGetConfig, mockHasTauriInvokeCapability } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockHasTauriInvokeCapability: vi.fn(),
}));

vi.mock("@/lib/api/appConfig", () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
}));

vi.mock("@/lib/tauri-runtime", () => ({
  hasTauriInvokeCapability: (...args: unknown[]) =>
    mockHasTauriInvokeCapability(...args),
}));

import { withI18nPatch } from "./withI18nPatch";

const mountedRoots: MountedRoot[] = [];

function DemoComponent() {
  return <div>应用已就绪</div>;
}

describe("withI18nPatch", () => {
  beforeEach(() => {
    setupReactActEnvironment();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", ((
      callback: (time: number) => void,
    ) =>
      window.setTimeout(() => callback(0), 0)) as typeof requestAnimationFrame);
    mockHasTauriInvokeCapability.mockReturnValue(true);
  });

  afterEach(() => {
    cleanupMountedRoots(mountedRoots);
    vi.unstubAllGlobals();
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
});
