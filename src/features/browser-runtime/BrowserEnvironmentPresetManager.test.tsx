import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserEnvironmentPresetManager } from "./BrowserEnvironmentPresetManager";

const {
  mockListBrowserEnvironmentPresets,
  mockSaveBrowserEnvironmentPreset,
  mockArchiveBrowserEnvironmentPreset,
  mockRestoreBrowserEnvironmentPreset,
} = vi.hoisted(() => ({
  mockListBrowserEnvironmentPresets: vi.fn(),
  mockSaveBrowserEnvironmentPreset: vi.fn(),
  mockArchiveBrowserEnvironmentPreset: vi.fn(),
  mockRestoreBrowserEnvironmentPreset: vi.fn(),
}));

vi.mock("./api", () => ({
  browserRuntimeApi: {
    listBrowserEnvironmentPresets: mockListBrowserEnvironmentPresets,
    saveBrowserEnvironmentPreset: mockSaveBrowserEnvironmentPreset,
    archiveBrowserEnvironmentPreset: mockArchiveBrowserEnvironmentPreset,
    restoreBrowserEnvironmentPreset: mockRestoreBrowserEnvironmentPreset,
  },
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mockListBrowserEnvironmentPresets.mockResolvedValue([
    {
      id: "env-1",
      name: "美区桌面",
      description: "美国住宅代理 + 桌面视口",
      proxy_server: "http://127.0.0.1:7890",
      timezone_id: "America/Los_Angeles",
      locale: "en-US",
      accept_language: "en-US,en;q=0.9",
      geolocation_lat: 37.7749,
      geolocation_lng: -122.4194,
      geolocation_accuracy_m: 100,
      user_agent: "Mozilla/5.0",
      platform: "MacIntel",
      viewport_width: 1440,
      viewport_height: 900,
      device_scale_factor: 2,
      created_at: "2026-03-15T00:00:00Z",
      updated_at: "2026-03-15T00:00:00Z",
      last_used_at: null,
      archived_at: null,
    },
  ]);
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.clearAllMocks();
});

async function renderManager(props?: {
  onPresetsChanged?: (presets: Array<{ id: string; name: string }>) => void;
  onSelectedPresetChange?: (presetId: string) => void;
  selectedPresetId?: string;
}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });
  await act(async () => {
    root.render(<BrowserEnvironmentPresetManager {...props} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

describe("BrowserEnvironmentPresetManager", () => {
  it("应渲染环境预设列表并同步可用预设", async () => {
    const onPresetsChanged = vi.fn();
    const container = await renderManager({ onPresetsChanged });

    expect(container.textContent).toContain("环境预设");
    expect(container.textContent).toContain("美区桌面");
    expect(container.textContent).toContain("America/Los_Angeles");
    expect(onPresetsChanged).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "env-1",
        name: "美区桌面",
      }),
    ]);
  });

  it("切换资料启动环境时应回调工作台", async () => {
    const onSelectedPresetChange = vi.fn();
    const container = await renderManager({
      onSelectedPresetChange,
      selectedPresetId: "",
    });

    const select = container.querySelector(
      "select",
    ) as HTMLSelectElement | null;
    expect(select).not.toBeNull();

    await act(async () => {
      if (select) {
        select.value = "env-1";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    expect(onSelectedPresetChange).toHaveBeenCalledWith("env-1");
  });
});
