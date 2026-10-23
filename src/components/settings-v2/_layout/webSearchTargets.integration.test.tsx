import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale, getLimeI18n } from "@/i18n/createI18n";
import { useAppNavigation } from "@/hooks/useAppNavigation";
import { SettingsTabs } from "@/types/settings";
import type { SettingsPageParams } from "@/types/page";
import { SettingsPage } from ".";
import { searchSettings } from "../settingsSearch";
import { useSettingsCategory } from "../hooks/useSettingsCategory";
import { resolveSettingsSection } from "../sections";

const api = vi.hoisted(() => ({ getConfig: vi.fn(), saveConfig: vi.fn() }));
vi.mock("@/lib/api/appConfig", () => api);
vi.mock("../general/GeneralSettings", () => ({ GeneralSettings: () => null }));
vi.mock("./SettingsNavigation", async () => {
  const { SettingsSidebar } = await import("./SettingsSidebar");
  return {
    SettingsNavigation: (props: Parameters<typeof SettingsSidebar>[0]) => (
      <SettingsSidebar {...props} />
    ),
  };
});

let navigation: ReturnType<typeof useAppNavigation>;
let groups: ReturnType<typeof useSettingsCategory>;
function Harness() {
  navigation = useAppNavigation();
  groups = useSettingsCategory();
  const { handleNavigate } = navigation;
  useLayoutEffect(
    () => handleNavigate("settings", { tab: SettingsTabs.WebSearch }),
    [handleNavigate],
  );
  return (
    <SettingsPage
      pageParams={navigation.requestedPageParams as SettingsPageParams}
      onNavigate={navigation.handleNavigate}
      onBack={navigation.returnFromSettings}
      navigationGuard={navigation.navigationGuard}
    />
  );
}

// 以现有表单与翻译消息验证可达性，不从被测索引生成期望值。
const targets = [
  ["search", "web-search-engine", "searchChain.engine"],
  ["search", "web-search-provider", "searchChain.provider"],
  ["search", "web-search-provider-priority", "searchChain.providerPriority"],
  ["providers", "web-search-tavily-key", "providers.tavily"],
  ["providers", "web-search-bing-key", "providers.bing"],
  ["providers", "web-search-google-key", "providers.googleApi"],
  ["providers", "web-search-google-engine-id", "providers.googleEngine"],
  ["mse", "web-search-mse-priority", "mse.priority"],
  ["mse", "web-search-mse-max-per-engine", "mse.maxPerEngine"],
  ["mse", "web-search-mse-max-total", "mse.maxTotal"],
  ["mse", "web-search-mse-timeout", "mse.timeout"],
  ["mse", "web-search-mse-custom-engine-name", "mse.customName"],
  ["mse", "web-search-mse-custom-engine-template", "mse.customTemplate"],
  ["images", "web-search-pexels-key", "images.pexels"],
  ["images", "web-search-pixabay-key", "images.pixabay"],
] as const;
const t = (key: string) =>
  getLimeI18n().getFixedT("en-US", "settings")(`settings.webSearch.${key}`);
let root: Root;
let container: HTMLDivElement;
const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const target = (id: string) =>
  container.querySelector<HTMLElement>(`[data-settings-search-target="${id}"]`);
const searchInput = () =>
  container.querySelector<HTMLInputElement>(
    '[data-testid="settings-sidebar-search"]',
  )!;
const activeTab = () =>
  container.querySelector('[role="tab"][aria-selected="true"]');
const click = async (node: HTMLElement) => act(async () => node.click());
async function edit(node: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function search(key: string) {
  await edit(searchInput(), t(key));
  await act(async () => {
    searchInput().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
}
async function confirm(key: "keepEditing" | "discard") {
  const text = getLimeI18n().getFixedT(
    "en-US",
    "settings",
  )(`settings.unsavedChanges.${key}`);
  const button = [...document.querySelectorAll("button")].find(
    (node) => node.textContent === text,
  );
  if (!button) throw new Error(`Missing ${key}`);
  await click(button);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
const mount = async () => act(async () => root.render(<Harness />));
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.sessionStorage.clear();
  window.__LIME_OEM_CLOUD__ = { enabled: false };
  api.getConfig.mockReset().mockResolvedValue({
    web_search: { provider: "duckduckgo_instant", engine: "google" },
  });
  api.saveConfig.mockReset().mockResolvedValue(undefined);
  await changeLimeLocale("en-US");
  await resolveSettingsSection(SettingsTabs.WebSearch).preload();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.sessionStorage.clear();
  delete window.__LIME_OEM_CLOUD__;
  vi.restoreAllMocks();
});

it.each(targets)(
  "%s / %s opens and focuses the real field",
  async (tab, id, key) => {
    await mount();
    await search(`${key}.label`);
    expect(
      activeTab()?.getAttribute("data-testid"),
      `committed target ${id}`,
    ).toBe(`web-search-tab-${tab}`);
    expect(document.activeElement).toBe(target(id));
    expect(target(id)?.dataset.settingsSearchActive).toBe("true");
    expect(target(id)?.contains(field(id))).toBe(true);
    expect(document.activeElement).not.toBe(field(id));
    if (id.endsWith("-key")) expect(field(id).type).toBe("password");
    expect(api.saveConfig).not.toHaveBeenCalled();
  },
);

it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
  "%s searches all 15 static labels without inspecting configuration values",
  async (locale) => {
    await changeLimeLocale(locale);
    await mount();
    const translate = getLimeI18n().getFixedT(locale, "settings");
    for (const [, id, key] of targets) {
      expect(
        searchSettings(
          translate(`settings.webSearch.${key}.label`),
          groups,
          translate,
          true,
        ),
      ).toContainEqual(
        expect.objectContaining({
          section: SettingsTabs.WebSearch,
          targetId: id,
        }),
      );
    }
    expect(
      searchSettings("fixture-private-secret", groups, translate, true),
    ).toEqual([]);
  },
);

it("keeps a credential draft and local tab until discard commits a hidden target; repeat reopens it", async () => {
  await mount();
  await search("providers.tavily.label");
  await edit(field("web-search-tavily-key"), "fixture-private-secret");
  const params = navigation.requestedPageParams;
  const restore = sessionStorage.getItem("lime.appNavigation.restore.v1");
  await search("mse.timeout.label");
  expect(navigation.requestedPageParams).toBe(params);
  expect(sessionStorage.getItem("lime.appNavigation.restore.v1")).toBe(restore);
  expect(field("web-search-mse-timeout")).toBeNull();
  expect(activeTab()?.getAttribute("data-testid")).toBe(
    "web-search-tab-providers",
  );
  await confirm("keepEditing");
  expect(field("web-search-tavily-key").value).toBe("fixture-private-secret");
  expect(field("web-search-tavily-key").type).toBe("password");
  await search("mse.timeout.label");
  await confirm("discard");
  expect(document.activeElement).toBe(target("web-search-mse-timeout"));
  expect(field("web-search-tavily-key")).toBeNull();
  const first = (navigation.requestedPageParams as SettingsPageParams)
    .searchFocus;
  await click(
    container.querySelector<HTMLElement>(
      '[data-testid="web-search-tab-images"]',
    )!,
  );
  expect(field("web-search-mse-timeout")).toBeNull();
  await search("mse.timeout.label");
  expect(document.activeElement).toBe(target("web-search-mse-timeout"));
  expect(
    (navigation.requestedPageParams as SettingsPageParams).searchFocus
      ?.requestKey,
  ).toBeGreaterThan(first!.requestKey!);
  await search("providers.tavily.label");
  expect(field("web-search-tavily-key").value).toBe("");
  expect(field("web-search-tavily-key").type).toBe("password");
  expect(api.saveConfig).not.toHaveBeenCalled();
});

it("waits for target config and ignores a late result after another canonical search", async () => {
  let resolve!: (config: object) => void;
  api.getConfig.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await mount();
  await search("images.pixabay.label");
  expect(target("web-search-pixabay-key")).toBeNull();
  await act(async () => resolve({ web_search: {} }));
  expect(document.activeElement).toBe(target("web-search-pixabay-key"));
  let late!: (config: object) => void;
  api.getConfig.mockReturnValue(
    new Promise((done) => {
      late = done;
    }),
  );
  await search("providers.bing.label");
  await edit(
    searchInput(),
    getLimeI18n().getFixedT("en-US", "settings")("settings.desktop.general"),
  );
  await act(async () =>
    searchInput().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  await act(async () => late({ web_search: {} }));
  expect(target("web-search-bing-key")).toBeNull();
  expect(container.querySelector("[data-settings-search-active]")).toBeNull();
});

it("rejects forged and cross-section target paths", async () => {
  await mount();
  let requestKey = 100;
  for (const targetId of [
    "profile-bio",
    "images",
    'web-search-pixabay-key"] input',
  ]) {
    await act(async () =>
      navigation.handleNavigate("settings", {
        tab: SettingsTabs.WebSearch,
        searchFocus: { targetId, requestKey: ++requestKey },
      }),
    );
    expect(activeTab()?.getAttribute("data-testid")).toBe(
      "web-search-tab-search",
    );
    expect(container.querySelector("[data-settings-search-active]")).toBeNull();
  }
});
