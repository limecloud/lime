import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSafeInvoke } = vi.hoisted(() => ({
  mockSafeInvoke: vi.fn(),
}));

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: mockSafeInvoke,
}));

import {
  getPluginsForSurface,
  getPluginsWithUI,
  invalidatePluginUICache,
  notifyPluginUIChanged,
  type PluginUIInfo,
} from "./pluginUI";

const BASE_PLUGINS: PluginUIInfo[] = [
  {
    pluginId: "plugin.sidebar",
    name: "Sidebar Plugin",
    description: "show in sidebar",
    icon: "PanelLeftOpen",
    surfaces: ["sidebar", "tools"],
  },
  {
    pluginId: "plugin.tools",
    name: "Tools Plugin",
    description: "show in tools",
    icon: "Wrench",
    surfaces: ["tools"],
  },
];

describe("pluginUI API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidatePluginUICache();
    window.localStorage.clear();
  });

  afterEach(() => {
    invalidatePluginUICache();
    window.localStorage.clear();
  });

  it("应缓存插件目录并复用同一轮请求", async () => {
    mockSafeInvoke.mockResolvedValueOnce(BASE_PLUGINS);

    const [first, second] = await Promise.all([
      getPluginsWithUI(),
      getPluginsWithUI(),
    ]);

    expect(mockSafeInvoke).toHaveBeenCalledTimes(1);
    expect(first).toEqual(BASE_PLUGINS);
    expect(second).toEqual(BASE_PLUGINS);
    expect(first).not.toBe(second);
  });

  it("getPluginsForSurface 应按 surface 过滤结果", async () => {
    mockSafeInvoke.mockResolvedValueOnce(BASE_PLUGINS);

    await expect(getPluginsForSurface("sidebar")).resolves.toEqual([
      BASE_PLUGINS[0],
    ]);
  });

  it("forceRefresh 应绕过缓存重新请求", async () => {
    mockSafeInvoke.mockResolvedValueOnce(BASE_PLUGINS).mockResolvedValueOnce([
      {
        ...BASE_PLUGINS[0],
        name: "Sidebar Plugin v2",
      },
    ]);

    await expect(getPluginsWithUI()).resolves.toEqual(BASE_PLUGINS);
    await expect(getPluginsWithUI({ forceRefresh: true })).resolves.toEqual([
      {
        ...BASE_PLUGINS[0],
        name: "Sidebar Plugin v2",
      },
    ]);

    expect(mockSafeInvoke).toHaveBeenCalledTimes(2);
  });

  it("notifyPluginUIChanged 应清空缓存并广播变更", async () => {
    mockSafeInvoke.mockResolvedValueOnce(BASE_PLUGINS).mockResolvedValueOnce([
      {
        ...BASE_PLUGINS[0],
        name: "Sidebar Plugin refreshed",
      },
    ]);

    const changedListener = vi.fn();
    window.addEventListener("plugin-changed", changedListener);

    try {
      await getPluginsWithUI();
      notifyPluginUIChanged();

      await expect(getPluginsWithUI()).resolves.toEqual([
        {
          ...BASE_PLUGINS[0],
          name: "Sidebar Plugin refreshed",
        },
      ]);

      expect(changedListener).toHaveBeenCalledTimes(1);
      expect(window.localStorage.getItem("plugin-changed")).toBeTruthy();
      expect(mockSafeInvoke).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener("plugin-changed", changedListener);
    }
  });
});
