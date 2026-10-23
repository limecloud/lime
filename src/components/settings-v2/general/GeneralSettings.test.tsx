import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";

const api = vi.hoisted(() => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
  getTargets: vi.fn(),
  setTarget: vi.fn(),
  setPluginEnabled: vi.fn(),
  unsubscribe: vi.fn(),
  setLanguage: vi.fn(),
}));
vi.mock("@/lib/api/appConfig", () => ({
  getConfig: api.getConfig,
  updateConfig: api.updateConfig,
  subscribeAppConfigChanged: () => api.unsubscribe,
}));
vi.mock("@/lib/api/openIn", () => ({
  openIn: {
    getTargets: api.getTargets,
    setGlobalPreferredTarget: api.setTarget,
  },
}));
vi.mock("@/lib/api/pluginCatalog", () => ({
  setPluginEnabled: api.setPluginEnabled,
}));
vi.mock("@/i18n/legacy-patch/I18nPatchProvider", () => ({
  useI18nPatch: () => ({ setLanguage: api.setLanguage }),
}));
vi.mock("@/lib/api/project", () => ({
  getDefaultProject: async () => ({ rootPath: "/workspace" }),
}));
import { GeneralSettings } from "./GeneralSettings";

let root: Root;
let container: HTMLDivElement;
let config: Record<string, unknown>;
async function settle() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}
async function mount() {
  act(() => root.render(<GeneralSettings />));
  await settle();
}
beforeEach(async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  await changeLimeLocale("zh-CN");
  config = {
    language: "zh-CN",
    plugins: { _default: { enabled: true } },
    workspace_preferences: { agent_response_language: "ja-JP" },
  };
  api.getConfig.mockImplementation(async () => config);
  api.updateConfig.mockImplementation(
    async (update: (current: object) => object) => {
      config = update(config) as typeof config;
      return config;
    },
  );
  api.getTargets.mockResolvedValue({
    discovery: "ready",
    preferredTarget: "systemDefault",
    targets: [
      {
        id: "systemDefault",
        target: "systemDefault",
        kind: "builtin",
        label: "系统默认",
        available: true,
      },
      {
        id: "app:/Applications/Editor.app",
        target: "systemDefault",
        kind: "native",
        label: "Editor",
        appPath: "/Applications/Editor.app",
        available: true,
      },
      {
        id: "app:missing",
        target: "systemDefault",
        label: "Missing",
        available: false,
      },
    ],
  });
  api.setTarget.mockResolvedValue(undefined);
  api.setPluginEnabled.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
  await changeLimeLocale("zh-CN");
});

describe("GeneralSettings", () => {
  it("语言修改应只更新 language，保留当前其他配置", async () => {
    await mount();
    const select = container.querySelector<HTMLSelectElement>(
      '[data-settings-search-target="general-language"] select',
    )!;
    act(() => {
      select.value = "en-US";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(config.language).toBe("en-US");
    expect(config.workspace_preferences).toEqual({
      agent_response_language: "ja-JP",
    });
    expect(api.setLanguage).toHaveBeenCalled();
  });

  it("文件打开位置应通过真实宿主接口保存所选应用，排除不可用应用", async () => {
    await mount();
    const select = container.querySelector<HTMLSelectElement>(
      '[data-settings-search-target="general-file-target"] select',
    )!;
    expect(
      [...select.options].some((option) => option.textContent === "Missing"),
    ).toBe(false);
    act(() => {
      select.value = "app:/Applications/Editor.app";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(api.setTarget).toHaveBeenCalledWith({
      target: "systemDefault",
      appPath: "/Applications/Editor.app",
      path: "/workspace",
    });
    expect(api.getTargets).toHaveBeenCalledTimes(2);
    expect(api.getTargets).toHaveBeenCalledWith({
      path: "/workspace",
      deferEnrichment: true,
    });
  });

  it("原生应用发现不可用时，仍可保存宿主提供的系统内建打开方式", async () => {
    api.getTargets.mockResolvedValue({
      discovery: "unsupported",
      preferredTarget: null,
      targets: [
        {
          id: "systemDefault",
          target: "systemDefault",
          kind: "builtin",
          label: "Default application",
          available: true,
        },
        {
          id: "fileManager",
          target: "fileManager",
          kind: "builtin",
          label: "Explorer",
          available: true,
        },
      ],
    });
    await mount();
    const select = container.querySelector<HTMLSelectElement>(
      '[data-settings-search-target="general-file-target"] select',
    )!;
    expect(select.disabled).toBe(false);
    expect(select.selectedOptions[0].textContent).not.toBe(
      "Default application",
    );
    act(() => {
      select.value = "fileManager";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(api.setTarget).toHaveBeenCalledWith({
      target: "fileManager",
      appPath: undefined,
      path: "/workspace",
    });
  });

  it("插件保存失败应保留原状态并提供可见错误", async () => {
    api.setPluginEnabled.mockRejectedValueOnce(new Error("write failed"));
    await mount();
    const toggle =
      container.querySelector<HTMLButtonElement>('[role="switch"]')!;
    act(() => toggle.click());
    await settle();
    expect(api.setPluginEnabled).toHaveBeenCalledWith({
      pluginId: "_default",
      enabled: false,
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("保存期间应阻止其他写入，读取失败时允许重试", async () => {
    api.getTargets.mockRejectedValueOnce(new Error("unavailable"));
    await mount();
    expect(
      container
        .querySelector(
          '[data-settings-search-target="general-file-target"] select',
        )
        ?.hasAttribute("disabled"),
    ).toBe(true);
    const retry = container.querySelector<HTMLButtonElement>(
      '[role="alert"] button',
    )!;
    act(() => retry.click());
    await settle();
    expect(
      container
        .querySelector(
          '[data-settings-search-target="general-file-target"] select',
        )
        ?.hasAttribute("disabled"),
    ).toBe(false);
    let release!: () => void;
    api.setPluginEnabled.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    act(() =>
      container.querySelector<HTMLButtonElement>('[role="switch"]')!.click(),
    );
    await settle();
    expect(
      [...container.querySelectorAll("select")].every(
        (select) => select.disabled,
      ),
    ).toBe(true);
    release();
    await settle();
  });
});
