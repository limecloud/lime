import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { notifyManager } from "@tanstack/react-query";
import { changeLimeLocale, getLimeI18n } from "@/i18n/createI18n";
import {
  openInQueryClient,
  openInTargetsQueryOptions,
} from "@/lib/openInTargets";

const api = vi.hoisted(() => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
  getTargets: vi.fn(),
  detectTarget: vi.fn(),
  loadTargetIcon: vi.fn(),
  setTarget: vi.fn(),
  setPluginEnabled: vi.fn(),
  unsubscribe: vi.fn(),
  setLanguage: vi.fn(),
  listener: null as (() => void) | null,
}));
vi.mock("@/lib/api/appConfig", () => ({
  getConfig: api.getConfig,
  updateConfig: api.updateConfig,
  subscribeAppConfigChanged: (listener: () => void) => {
    api.listener = listener;
    return api.unsubscribe;
  },
}));
vi.mock("@/lib/api/openIn", () => ({
  openIn: {
    getTargets: api.getTargets,
    detectTarget: api.detectTarget,
    loadTargetIcon: api.loadTargetIcon,
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
async function mount(expectedFileLabel = "系统默认") {
  act(() => root.render(<GeneralSettings />));
  await settle();
  await vi.waitFor(async () => {
    await settle();
    expect(api.getTargets).toHaveBeenCalled();
    expect(openInQueryClient.isFetching()).toBe(0);
    expect(
      fileTrigger().textContent === expectedFileLabel ||
        container.querySelector('[role="alert"]'),
    ).toBeTruthy();
  });
}
const fileTrigger = () =>
  container.querySelector<HTMLButtonElement>(
    '[data-settings-search-target="general-file-target"] button',
  )!;
const menuBarToggle = () =>
  container.querySelector<HTMLButtonElement>(
    '[data-settings-search-target="general-menu-bar"] [role="switch"]',
  );
const preventSleepToggle = () =>
  container.querySelector<HTMLButtonElement>(
    '[data-settings-search-target="general-prevent-sleep"] [role="switch"]',
  );
async function openFileMenu() {
  act(() =>
    fileTrigger().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await settle();
}
async function selectFileTarget(label: string) {
  await openFileMenu();
  const item = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
  ].find((node) => node.textContent === label)!;
  expect(item, `file target ${label}`).toBeTruthy();
  act(() => item.click());
  await settle();
}
const enterTrigger = () =>
  container.querySelector<HTMLButtonElement>(
    '[data-settings-search-target="general-enter-behavior"] button',
  )!;
async function selectEnterBehavior(index: number) {
  act(() =>
    enterTrigger().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await settle();
  const choices = document.querySelectorAll<HTMLDivElement>(
    '[role="menuitemradio"]',
  );
  expect(choices).toHaveLength(3);
  act(() => choices[index].click());
  await settle();
}
beforeEach(async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux");
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Linux");
  notifyManager.setNotifyFunction((callback) => act(callback));
  openInQueryClient.clear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
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
  api.setTarget.mockImplementation(async (params) => {
    const snapshot = await api.getTargets.getMockImplementation()!();
    api.getTargets.mockResolvedValue({
      ...snapshot,
      preferredTarget: params.appPath ? `app:${params.appPath}` : params.target,
    });
  });
  api.detectTarget.mockImplementation(async (params) => {
    const snapshot = await api.getTargets.getMockImplementation()!();
    return (
      snapshot.targets.find(
        (target: { target: string; appPath?: string }) =>
          target.target === params.target && target.appPath === params.appPath,
      ) ?? null
    );
  });
  api.loadTargetIcon.mockResolvedValue("data:image/png;base64,a");
  api.setPluginEnabled.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  openInQueryClient.clear();
  notifyManager.setNotifyFunction((callback) => callback());
  await changeLimeLocale("zh-CN");
});

describe("GeneralSettings", () => {
  it.each(["never", "keyboardOnly", "always"] as const)(
    "persists %s through the current config owner",
    async (mode) => {
      config.desktop = {
        "confirm-before-close": mode === "never" ? "always" : "never",
      };
      await mount();
      const trigger = container.querySelector<HTMLButtonElement>(
        '[data-settings-search-target="general-confirm-before-close"] button',
      )!;
      act(() =>
        trigger.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "ArrowDown",
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      await settle();
      const choices = document.querySelectorAll<HTMLElement>(
        '[role="menuitemradio"]',
      );
      expect(choices).toHaveLength(3);
      act(() =>
        choices[["never", "keyboardOnly", "always"].indexOf(mode)].click(),
      );
      await settle();
      expect(config.desktop).toEqual({ "confirm-before-close": mode });
      expect(config.workspace_preferences).toEqual({
        agent_response_language: "ja-JP",
      });
      expect(trigger.textContent).toBe(
        getLimeI18n().t(`settings.general.confirmBeforeClose.${mode}`, {
          ns: "settings",
        }),
      );
    },
  );

  it("failed close preference save keeps the acknowledged value and displays an error", async () => {
    api.updateConfig.mockRejectedValueOnce(new Error("save failed"));
    await mount();
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-settings-search-target="general-confirm-before-close"] button',
    )!;
    act(() =>
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    await settle();
    act(() =>
      document
        .querySelectorAll<HTMLElement>('[role="menuitemradio"]')[2]
        .click(),
    );
    await settle();
    expect(config.desktop).toBeUndefined();
    expect(trigger.textContent).toBe("仅关闭快捷键");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
  it.each([undefined, null, false, true])(
    "防休眠回读 %s，缺项不默认开启",
    async (enabled) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
      config.desktop = { preventSleepWhileRunning: enabled };
      await mount();
      expect(preventSleepToggle()?.getAttribute("aria-checked")).toBe(
        String(enabled === true),
      );
      expect(api.updateConfig).not.toHaveBeenCalled();
    },
  );

  it("Windows隐藏防休眠，Linux保留同一偏好", async () => {
    const platform = vi
      .spyOn(navigator, "platform", "get")
      .mockReturnValue("Win32");
    await mount();
    expect(preventSleepToggle()).toBeNull();
    platform.mockReturnValue("Linux");
    act(() => root.render(<GeneralSettings />));
    await settle();
    expect(preventSleepToggle()).not.toBeNull();
  });

  it("防休眠保存回执后更新，保存失败保留且可重试", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    config.desktop = {
      composerEnterBehavior: "cmdAlways",
      "mac-menu-bar-enabled": false,
    };
    await mount();
    api.updateConfig.mockRejectedValueOnce(new Error("write failed"));
    act(() => preventSleepToggle()!.click());
    await settle();
    expect(preventSleepToggle()?.getAttribute("aria-checked")).toBe("false");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    act(() => preventSleepToggle()!.click());
    await settle();
    expect(preventSleepToggle()?.getAttribute("aria-checked")).toBe("true");
    expect(config).toMatchObject({
      desktop: {
        preventSleepWhileRunning: true,
        composerEnterBehavior: "cmdAlways",
        "mac-menu-bar-enabled": false,
      },
    });
  });

  it("防休眠等待保存回执时保留已确认值并禁止重复写入", async () => {
    await mount();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    api.updateConfig.mockImplementationOnce(
      async (update: (current: object) => object) => {
        await pending;
        config = update(config) as typeof config;
        return config;
      },
    );
    act(() => preventSleepToggle()!.click());
    await settle();
    expect(preventSleepToggle()?.disabled).toBe(true);
    expect(preventSleepToggle()?.getAttribute("aria-checked")).toBe("false");
    act(() => preventSleepToggle()!.click());
    expect(api.updateConfig).toHaveBeenCalledTimes(1);
    release();
    await settle();
    expect(preventSleepToggle()?.disabled).toBe(false);
    expect(preventSleepToggle()?.getAttribute("aria-checked")).toBe("true");
  });

  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s 防休眠文案和可访问名称完整",
    async (locale) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
      await changeLimeLocale(locale);
      const t = getLimeI18n().getFixedT(locale, "settings");
      await mount(t("settings.desktop.systemDefault"));
      expect(
        container.querySelector("#general-prevent-sleep-label")?.textContent,
      ).toBe(t("settings.desktop.preventSleepWhileRunning"));
      expect(
        container.querySelector("#general-prevent-sleep-description")
          ?.textContent,
      ).toBe(t("settings.desktop.preventSleepWhileRunningDescription"));
      expect(preventSleepToggle()?.getAttribute("aria-labelledby")).toBe(
        "general-prevent-sleep-label",
      );
      expect(preventSleepToggle()?.getAttribute("aria-describedby")).toBe(
        "general-prevent-sleep-description",
      );
    },
  );
  it.each([undefined, null, true, false])(
    "macOS 菜单栏回读配置 %s",
    async (enabled) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
      config.desktop = { "mac-menu-bar-enabled": enabled };
      await mount();
      expect(menuBarToggle()?.getAttribute("aria-checked")).toBe(
        String(enabled !== false),
      );
      expect(menuBarToggle()?.getAttribute("aria-labelledby")).toBe(
        "general-menu-bar-label",
      );
      expect(menuBarToggle()?.getAttribute("aria-describedby")).toBe(
        "general-menu-bar-description",
      );
      expect(api.updateConfig).not.toHaveBeenCalled();
    },
  );

  it.each(["Win32", "Linux"])("%s 隐藏 macOS 菜单栏偏好", async (platform) => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
    await mount();
    expect(menuBarToggle()).toBeNull();
  });

  it("菜单栏只在保存回执后变化，并保留其他 Desktop 与多模型配置", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    config.desktop = { composerEnterBehavior: "cmdAlways" };
    config.default_provider = "fixture-provider";
    let release!: () => void;
    api.updateConfig.mockImplementationOnce(
      (update: (current: object) => object) =>
        new Promise((resolve) => {
          release = () => resolve((config = update(config) as typeof config));
        }),
    );
    await mount();
    act(() => menuBarToggle()!.click());
    await settle();
    expect(menuBarToggle()?.getAttribute("aria-checked")).toBe("true");
    expect(menuBarToggle()?.disabled).toBe(true);
    expect(enterTrigger().disabled).toBe(true);
    act(() => menuBarToggle()!.click());
    expect(api.updateConfig).toHaveBeenCalledTimes(1);
    await act(async () => release());
    await settle();
    expect(menuBarToggle()?.getAttribute("aria-checked")).toBe("false");
    expect(config).toMatchObject({
      desktop: {
        "mac-menu-bar-enabled": false,
        composerEnterBehavior: "cmdAlways",
      },
      default_provider: "fixture-provider",
    });
  });

  it("菜单栏保存失败保留已确认状态，允许再次保存", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    api.updateConfig.mockRejectedValueOnce(new Error("write failed"));
    await mount();
    act(() => menuBarToggle()!.click());
    await settle();
    expect(menuBarToggle()?.getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    act(() => menuBarToggle()!.click());
    await settle();
    expect(menuBarToggle()?.getAttribute("aria-checked")).toBe("false");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s 菜单栏文案与 Lime 品牌完整",
    async (locale) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
      await changeLimeLocale(locale);
      const t = getLimeI18n().getFixedT(locale, "settings");
      await mount(t("settings.desktop.systemDefault"));
      const label = container.querySelector(
        "#general-menu-bar-label",
      )?.textContent;
      expect(label).toBe(t("settings.desktop.macMenuBar"));
      expect(label).toContain("Lime");
      expect(
        container.querySelector("#general-menu-bar-description")?.textContent,
      ).toBe(t("settings.desktop.macMenuBarDescription"));
      expect(container.textContent).not.toContain("settings.desktop.");
    },
  );

  it("Enter 偏好只在保存回执后变化，并保留其他 Desktop 与多模型配置", async () => {
    config.desktop = { "open-link-in-target-preference": "external-browser" };
    config.default_provider = "fixture-provider";
    let release!: () => void;
    api.updateConfig.mockImplementationOnce(
      (update: (current: object) => object) =>
        new Promise((resolve) => {
          release = () => resolve((config = update(config) as typeof config));
        }),
    );
    await mount();
    expect(enterTrigger().textContent).toBe("Enter");
    await selectEnterBehavior(2);
    expect(enterTrigger().disabled).toBe(true);
    expect(enterTrigger().textContent).toBe("Enter");
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-settings-search-target="general-language"] button',
      )!.disabled,
    ).toBe(true);
    await act(async () => release());
    await settle();
    expect(enterTrigger().textContent).toContain("始终使用");
    expect(config.desktop).toEqual({
      "open-link-in-target-preference": "external-browser",
      composerEnterBehavior: "cmdAlways",
    });
    expect(config.default_provider).toBe("fixture-provider");
  });

  it("Enter 保存失败保留确认值，显示错误并允许重试", async () => {
    config.desktop = { composerEnterBehavior: "cmdIfMultiline" };
    api.updateConfig.mockRejectedValueOnce(new Error("write failed"));
    await mount();
    await selectEnterBehavior(2);
    expect(enterTrigger().textContent).toContain("多行提示");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(enterTrigger().disabled).toBe(false);
    await selectEnterBehavior(2);
    expect(enterTrigger().textContent).toContain("始终使用");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("保存前发出的旧读取不能覆盖新 Enter 偏好", async () => {
    await mount();
    let release!: (value: object) => void;
    const old = { ...config };
    api.getConfig.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    act(() => api.listener?.());
    await selectEnterBehavior(1);
    await act(async () => release(old));
    await settle();
    expect(enterTrigger().textContent).toContain("多行提示");
    expect(config.desktop).toEqual({ composerEnterBehavior: "cmdIfMultiline" });
  });

  it("语言修改应只更新 language，保留当前其他配置", async () => {
    await mount();
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-settings-search-target="general-language"] button',
    )!;
    act(() => trigger.click());
    await settle();
    const english = [
      ...document.querySelectorAll<HTMLElement>("[cmdk-item]"),
    ].find((node) => node.textContent === "English")!;
    act(() => english.click());
    await settle();
    expect(config.language).toBe("en-US");
    expect(config.workspace_preferences).toEqual({
      agent_response_language: "ja-JP",
    });
    expect(api.setLanguage).toHaveBeenCalled();
  });

  it("语言保存失败保留当前语言并显示错误，可重新选择自动检测", async () => {
    api.updateConfig.mockRejectedValueOnce(new Error("write failed"));
    await mount();
    const trigger = () =>
      container.querySelector<HTMLButtonElement>(
        '[data-settings-search-target="general-language"] button',
      )!;
    const choose = async (value: string) => {
      act(() => trigger().click());
      await settle();
      act(() =>
        document
          .querySelector<HTMLElement>(`[cmdk-item][data-value="${value}"]`)!
          .click(),
      );
      await settle();
    };
    await choose("en-US");
    expect(config.language).toBe("zh-CN");
    expect(trigger().textContent).toBe("简体中文");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(api.setLanguage).not.toHaveBeenCalled();
    await choose("auto");
    expect(config.language).toBe("auto");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("文件打开位置应通过真实宿主接口保存所选应用，排除不可用应用", async () => {
    await mount();
    await openFileMenu();
    expect(
      [...document.querySelectorAll('[role="menuitemradio"]')].some(
        (option) => option.textContent === "Missing",
      ),
    ).toBe(false);
    const editor = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    ].find((option) => option.textContent === "Editor")!;
    expect(editor.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,a",
    );
    act(() => editor.click());
    await settle();
    expect(api.setTarget).toHaveBeenCalledWith({
      target: "systemDefault",
      appPath: "/Applications/Editor.app",
      path: "/workspace",
    });
    await vi.waitFor(async () => {
      await settle();
      expect(fileTrigger().textContent).toBe("Editor");
    });
    expect(api.getTargets).toHaveBeenCalledTimes(2);
    expect(api.getTargets).toHaveBeenCalledWith({
      path: "/workspace",
      cwd: null,
      hostId: null,
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
    expect(fileTrigger().disabled).toBe(false);
    expect(fileTrigger().textContent).toBe("系统默认");
    await selectFileTarget("Explorer");
    expect(api.setTarget).toHaveBeenCalledWith({
      target: "fileManager",
      appPath: undefined,
      path: "/workspace",
    });
  });

  it("文件默认目标仅在宿主保存回执后变化，期间阻止其他写入并刷新共享文件菜单", async () => {
    await mount();
    const otherQuery = openInTargetsQueryOptions({
      path: "/workspace/file.ts",
    });
    openInQueryClient.setQueryData(
      otherQuery.queryKey,
      await api.getTargets.getMockImplementation()!(),
    );
    const persist = api.setTarget.getMockImplementation()!;
    let release!: () => Promise<void>;
    api.setTarget.mockImplementationOnce(
      (params) =>
        new Promise<void>((resolve) => {
          release = async () => {
            await persist(params);
            resolve();
          };
        }),
    );
    await selectFileTarget("Editor");
    expect(fileTrigger().textContent).toBe("系统默认");
    expect(fileTrigger().disabled).toBe(true);
    expect(enterTrigger().disabled).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-settings-search-target="general-language"] button',
      )!.disabled,
    ).toBe(true);
    expect(api.setTarget).toHaveBeenCalledTimes(1);
    expect(api.updateConfig).not.toHaveBeenCalled();
    await act(async () => release());
    await vi.waitFor(async () => {
      await settle();
      expect(fileTrigger().textContent).toBe("Editor");
      expect(fileTrigger().disabled).toBe(false);
    });
    expect(
      openInQueryClient.getQueryData(otherQuery.queryKey)?.preferredTarget,
    ).toBe("app:/Applications/Editor.app");
    expect(
      openInQueryClient.getQueryState(otherQuery.queryKey)?.isInvalidated,
    ).toBe(true);
  });

  it("文件目标保存失败保留原选择，显示错误且允许重新选择重试", async () => {
    api.setTarget.mockRejectedValueOnce(new Error("host write failed"));
    await mount();
    await selectFileTarget("Editor");
    expect(fileTrigger().textContent).toBe("系统默认");
    expect(fileTrigger().disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await selectFileTarget("Editor");
    await vi.waitFor(async () => {
      await settle();
      expect(fileTrigger().textContent).toBe("Editor");
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(api.setTarget).toHaveBeenCalledTimes(2);
  });

  it("已保存的应用在实际检测中失效时，显示可用的系统默认并移出菜单", async () => {
    const snapshot = await api.getTargets.getMockImplementation()!();
    api.getTargets.mockResolvedValue({
      ...snapshot,
      preferredTarget: "app:/Applications/Editor.app",
    });
    api.detectTarget.mockImplementation(async (params) =>
      params.appPath ? null : snapshot.targets[0],
    );
    await mount();
    expect(fileTrigger().textContent).toBe("系统默认");
    await openFileMenu();
    expect(
      [...document.querySelectorAll('[role="menuitemradio"]')].map(
        (node) => node.textContent,
      ),
    ).toEqual(["系统默认"]);
    expect(api.setTarget).not.toHaveBeenCalled();
  });

  it("文件菜单提供当前选中状态；Escape 不保存并恢复焦点", async () => {
    await mount();
    await openFileMenu();
    const checked = document.querySelector<HTMLElement>(
      '[role="menuitemradio"][aria-checked="true"]',
    )!;
    expect(checked.textContent).toBe("系统默认");
    act(() =>
      checked.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    await vi.waitFor(async () => {
      await settle();
      expect(document.querySelector('[role="menuitemradio"]')).toBeNull();
      expect(document.activeElement).toBe(fileTrigger());
    });
    expect(api.setTarget).not.toHaveBeenCalled();
  });

  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s 无可用文件应用时显示本地化空态并禁用菜单",
    async (locale) => {
      await changeLimeLocale(locale);
      api.getTargets.mockResolvedValue({
        discovery: "unavailable",
        preferredTarget: null,
        targets: [],
      });
      const t = getLimeI18n().getFixedT(locale, "settings");
      await mount(t("settings.desktop.noFileTargets"));
      expect(fileTrigger().disabled).toBe(true);
      expect(fileTrigger().textContent).toBe(
        t("settings.desktop.noFileTargets"),
      );
      expect(fileTrigger().getAttribute("aria-labelledby")).toBe(
        "general-file-target-label general-file-target-value",
      );
      expect(fileTrigger().getAttribute("aria-describedby")).toBe(
        "general-file-target-description",
      );
      expect(container.textContent).not.toContain("settings.desktop.");
      expect(api.setTarget).not.toHaveBeenCalled();
    },
  );

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
    expect(fileTrigger().disabled).toBe(true);
    const retry = container.querySelector<HTMLButtonElement>(
      '[role="alert"] button',
    )!;
    act(() => retry.click());
    await settle();
    await vi.waitFor(async () => {
      await settle();
      expect(fileTrigger().disabled).toBe(false);
    });
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
    expect(fileTrigger().disabled).toBe(true);
    await act(async () => release());
    await settle();
  });
});
