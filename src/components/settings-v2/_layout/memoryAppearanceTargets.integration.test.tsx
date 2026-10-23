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
vi.mock("@/lib/api/appConfig", () => ({
  ...api,
  subscribeAppConfigChanged: () => () => undefined,
  updateConfig: async (update: (config: object) => object) => {
    const config = update(await api.getConfig());
    await api.saveConfig(config);
    return config;
  },
}));
vi.mock("@/i18n/legacy-patch/I18nPatchProvider", () => ({
  useI18nPatch: () => ({ setLanguage: vi.fn() }),
}));
vi.mock("@/lib/api/project", () => ({ getDefaultProject: async () => null }));
vi.mock("@/lib/api/soulStylePacks", () => ({
  listSoulStylePacks: async () => ({ packs: [] }),
}));
vi.mock("@/lib/api/memoryStore", () => ({
  resetMemory: async () => ({}),
  getMemoryStoreHealth: async () => ({ initialized: false }),
  listMemoryStoreReviewNotes: async () => ({ notes: [] }),
  listMemoryStore: async () => ({ entries: [] }),
}));
vi.mock("@/lib/api/openIn", () => ({
  openIn: {
    getTargets: async () => ({ discovery: "unavailable", targets: [] }),
  },
}));
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
    () => handleNavigate("settings", { tab: SettingsTabs.Appearance }),
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

// 期望来自可见字段，独立于被测索引。
const targets = [
  [
    SettingsTabs.General,
    "",
    "general-file-target",
    "desktop.defaultFileTarget",
  ],
  [SettingsTabs.General, "", "general-plugins", "desktop.plugins"],
  [SettingsTabs.Memory, "", "memory-enabled", "personalization.enabled"],
  [SettingsTabs.Memory, "", "memory-tools", "personalization.tools"],
  [SettingsTabs.Memory, "", "memory-delete", "personalization.delete"],
  [
    SettingsTabs.Memory,
    "",
    "memory-instructions",
    "personalization.instructions",
  ],
  [SettingsTabs.Appearance, "", "appearance-theme", "appearance.theme.title"],
  [
    SettingsTabs.Appearance,
    "",
    "appearance-skin",
    "appearance.colorScheme.title",
  ],
  [SettingsTabs.General, "", "general-language", "desktop.language"],
] as const;
const t = (key: string) =>
  getLimeI18n().getFixedT("en-US", "settings")(`settings.${key}`);
let root: Root;
let container: HTMLDivElement;
const target = (id: string) =>
  container.querySelector<HTMLElement>(`[data-settings-search-target="${id}"]`);
const input = () =>
  container.querySelector<HTMLInputElement>(
    '[data-testid="settings-sidebar-search"]',
  )!;
async function edit(
  node: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  await act(async () => {
    const prototype =
      node instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function search(key: string) {
  await edit(input(), t(key));
  await act(async () =>
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
}
const mount = async () => act(async () => root.render(<Harness />));
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.__LIME_OEM_CLOUD__ = { enabled: false };
  api.getConfig
    .mockReset()
    .mockResolvedValue({ language: "en-US", memory: { enabled: true } });
  api.saveConfig.mockReset().mockResolvedValue(undefined);
  await changeLimeLocale("en-US");
  await Promise.all([
    resolveSettingsSection(SettingsTabs.General).preload(),
    resolveSettingsSection(SettingsTabs.Memory).preload(),
    resolveSettingsSection(SettingsTabs.Appearance).preload(),
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.sessionStorage.clear();
  window.localStorage.clear();
  delete window.__LIME_OEM_CLOUD__;
  vi.restoreAllMocks();
});

it.each(targets)(
  "%s / %s / %s focuses the real non-editable field",
  async (section, tab, id, key) => {
    await mount();
    await search(key);
    expect(navigation.requestedPageParams).toMatchObject({
      tab: section,
      searchFocus: { targetId: id },
    });
    expect(tab).toBe("");
    expect(target(id)).not.toBeNull();
    expect(document.activeElement).toBe(target(id));
    expect(target(id)?.dataset.settingsSearchActive).toBe("true");
    expect(target(id)?.closest("[hidden]")).toBeNull();
    expect(target(id)?.matches("input, textarea, select, button")).toBe(false);
    expect(api.saveConfig).not.toHaveBeenCalled();
  },
);

it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
  "%s resolves all current static targets",
  async (locale) => {
    await changeLimeLocale(locale);
    await mount();
    const translate = getLimeI18n().getFixedT(locale, "settings");
    for (const [section, , targetId, key] of targets) {
      expect(translate(`settings.${key}`)).not.toBe(`settings.${key}`);
      expect(
        searchSettings(translate(`settings.${key}`), groups, translate, true),
      ).toContainEqual(expect.objectContaining({ section, targetId }));
    }
    expect(
      searchSettings("fixture private imported text", groups, translate, true),
    ).toEqual([]);
  },
);

it("rejects removed and forged targets without exposing obsolete panels", async () => {
  await mount();
  let requestKey = 200;
  for (const targetId of [
    "general-language",
    "memory-style",
    "memory-import",
    'memory-import"] textarea',
  ]) {
    await act(async () =>
      navigation.handleNavigate("settings", {
        tab: SettingsTabs.Memory,
        searchFocus: { targetId, requestKey: ++requestKey },
      }),
    );
    expect(target("memory-enabled")).not.toBeNull();
    expect(target("memory-import")).toBeNull();
    expect(container.querySelector("[data-settings-search-active]")).toBeNull();
  }
});
