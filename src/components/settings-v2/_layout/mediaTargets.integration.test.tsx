import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  METHOD_CONFIG_BATCH_WRITE,
  METHOD_CONFIG_READ,
  type ConfigBatchWriteParams,
} from "@limecloud/app-server-client";
import { changeLimeLocale, getLimeI18n } from "@/i18n/createI18n";
import { useAppNavigation } from "@/hooks/useAppNavigation";
import {
  invalidateAppConfigCache,
  updateConfig,
  type Config,
} from "@/lib/api/appConfig";
import { SettingsTabs } from "@/types/settings";
import type { SettingsPageParams } from "@/types/page";
import { SettingsPage } from ".";
import { resolveSettingsSection } from "../sections";
import { searchSettings } from "../settingsSearch";
import { useSettingsCategory } from "../hooks/useSettingsCategory";

const api = vi.hoisted(() => ({
  request: vi.fn(),
}));
// 只替换 transport，保留 current gateway / diff / 串行配置 owner。
vi.mock("@/lib/api/appServer", () => ({
  AppServerClient: class {
    request = api.request;
  },
}));
vi.mock("../agent/image-gen", () => ({ ImageGenSettings: () => null }));
vi.mock("../agent/video-gen", () => ({ VideoGenSettings: () => null }));
vi.mock("../agent/voice", () => ({ VoiceSettings: () => null }));
vi.mock("@/components/input-kit", () => ({
  ModelSelector: () => <span>Model preference</span>,
}));
vi.mock("../system/shared/ClipboardPermissionGuideCard", () => ({
  ClipboardPermissionGuideCard: () => null,
}));
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
function Harness({ initialTab }: { initialTab: SettingsTabs }) {
  navigation = useAppNavigation();
  groups = useSettingsCategory();
  const { handleNavigate } = navigation;
  useLayoutEffect(
    () => handleNavigate("settings", { tab: initialTab }),
    [handleNavigate, initialTab],
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

// 不从索引导入期望；每项来自 current 页面上的常驻静态字段。
const targets = [
  [
    SettingsTabs.MediaServices,
    "media-service-responsive-chat",
    "mediaServices.sections.responsiveChat.title",
  ],
  [
    SettingsTabs.MediaServices,
    "media-service-topic",
    "mediaServices.sections.topic.title",
  ],
  [
    SettingsTabs.MediaServices,
    "media-service-generation-topic",
    "mediaServices.sections.generationTopic.title",
  ],
  [
    SettingsTabs.MediaServices,
    "media-service-translation",
    "mediaServices.sections.translation.title",
  ],
  [
    SettingsTabs.MediaServices,
    "media-service-history-compress",
    "mediaServices.sections.historyCompress.title",
  ],
  [
    SettingsTabs.MediaServices,
    "media-service-agent-meta",
    "mediaServices.sections.agentMeta.title",
  ],
  [
    SettingsTabs.MediaServices,
    "media-service-input-completion",
    "mediaServices.sections.inputCompletion.title",
  ],
  [
    SettingsTabs.MediaServices,
    "media-service-prompt-rewrite",
    "mediaServices.sections.promptRewrite.title",
  ],
  [
    SettingsTabs.MediaServices,
    "media-service-resource-prompt-rewrite",
    "mediaServices.sections.resourcePromptRewrite.title",
  ],
  [
    SettingsTabs.MediaServices,
    "media-image-count",
    "mediaServices.imageSettings.count.label",
  ],
] as const;
const topicKey = "mediaServices.sections.topic.title";
const countKey = "mediaServices.imageSettings.count.label";
const t = (key: string) =>
  getLimeI18n().getFixedT(
    getLimeI18n().resolvedLanguage ?? "en-US",
    "settings",
  )(`settings.${key}`);
let root: Root;
let container: HTMLDivElement;
let persisted: Config;
let writes: ConfigBatchWriteParams[];
const target = (id: string) =>
  [
    ...container.querySelectorAll<HTMLElement>("[data-settings-search-target]"),
  ].find((node) => node.dataset.settingsSearchTarget === id);
const testId = (id: string) => {
  const node = container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (!node) throw new Error(`Missing ${id}`);
  return node;
};
const searchInput = () => testId("settings-sidebar-search") as HTMLInputElement;
const prompt = () => container.querySelector("textarea")!;
const count = () =>
  container.querySelector<HTMLInputElement>('input[type="number"]')!;
const dialog = () =>
  document.querySelector('[data-testid="settings-unsaved-changes-dialog"]');
const params = () => navigation.requestedPageParams as SettingsPageParams;
const requestKey = () => {
  const key = params().searchFocus?.requestKey;
  if (typeof key !== "number") throw new Error("Missing numeric requestKey");
  return key;
};
const click = async (node: HTMLElement) => act(async () => node.click());
async function edit(
  node: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      node instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
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
async function confirm(action: "keepEditing" | "discard") {
  const button = [...document.querySelectorAll("button")].find(
    (node) => node.textContent === t(`unsavedChanges.${action}`),
  );
  if (!button) throw new Error(`Missing ${action}`);
  await click(button);
}
const mount = async (initialTab = SettingsTabs.MediaServices) =>
  act(async () => root.render(<Harness initialTab={initialTab} />));
const noWrites = () => {
  expect(writes).toEqual([]);
};
const focused = (id: string) => {
  const node = target(id);
  expect(node).toBeDefined();
  expect(document.activeElement).toBe(node);
  expect(node?.dataset.settingsSearchActive).toBe("true");
  expect(node?.closest("[hidden]")).toBeNull();
  expect(node?.matches("input, textarea, select, button")).toBe(false);
  return node!;
};

beforeEach(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.resetAllMocks();
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.__LIME_OEM_CLOUD__ = { enabled: false };
  await changeLimeLocale("en-US");
  invalidateAppConfigCache();
  writes = [];
  persisted = {
    default_provider: "openai",
    language: "en-US",
    workspace_preferences: {
      schema_version: 2,
      service_models: {
        topic: {
          preferredProviderId: "openai",
          preferredModelId: "fixture-custom-model-name",
        },
        resource_prompt_rewrite: {
          enabled: true,
          customPrompt: "fixture-private-prompt",
        },
      },
    },
    image_gen: { default_count: 2 },
    crash_reporting: {
      enabled: false,
      dsn: "https://secret.invalid/42",
      environment: "production",
      sample_rate: 1,
      send_pii: false,
    },
  } as Config;
  let version = 1;
  api.request.mockImplementation(
    async (method: string, value: ConfigBatchWriteParams) => {
      if (method === METHOD_CONFIG_READ)
        return {
          result: {
            config: structuredClone(persisted),
            origins: {},
            layers: [
              {
                name: {
                  type: "user",
                  file: "/tmp/settings-search/config.yaml",
                  profile: null,
                },
                version: String(version),
                config: structuredClone(persisted),
              },
            ],
          },
        };
      expect(method).toBe(METHOD_CONFIG_BATCH_WRITE);
      writes.push(structuredClone(value));
      expect(value.expectedVersion).toBe(String(version));
      for (const edit of value.edits)
        Object.assign(persisted, { [edit.keyPath]: edit.value });
      version++;
      return {
        result: {
          status: "ok",
          version: String(version),
          filePath: "/tmp/settings-search/config.yaml",
          overriddenMetadata: null,
        },
      };
    },
  );
  await Promise.all([
    resolveSettingsSection(SettingsTabs.MediaServices).preload(),
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
    await updateConfig((config) => config);
  });
  container.remove();
  delete window.__LIME_OEM_CLOUD__;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await changeLimeLocale("zh-CN");
});

it.each(
  ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"].flatMap((locale) =>
    targets.map(([section, id, key]) => [locale, section, id, key] as const),
  ),
)(
  "%s / %s / %s locates the real static non-editable shell",
  async (locale, section, id, key) => {
    await changeLimeLocale(locale);
    await mount();
    await search(key);
    expect(params()).toMatchObject({
      tab: section,
      searchFocus: { targetId: id },
    });
    const node = focused(id);
    expect(container.querySelector("textarea")).not.toBe(
      document.activeElement,
    );
    noWrites();
  },
);

it("guards same-section target replacement and increments requestKey on repeated searches", async () => {
  await mount();
  await search(topicKey);
  const firstKey = requestKey();
  await edit(prompt(), "unblurred same-section draft");
  const editor = prompt();
  await search(countKey);
  expect(dialog()).not.toBeNull();
  expect(params().searchFocus?.targetId).toBe("media-service-topic");
  await confirm("keepEditing");
  expect(prompt()).toBe(editor);
  await search(countKey);
  await confirm("discard");
  focused("media-image-count");
  expect(prompt()).not.toBe(editor);
  expect(prompt().value).toBe("fixture-private-prompt");
  const secondKey = requestKey();
  expect(secondKey).toBeGreaterThan(firstKey);
  await search(countKey);
  expect(requestKey()).toBeGreaterThan(secondKey);
  focused("media-image-count");
  noWrites();
});

it("does not open a prompt editor while searching its service card", async () => {
  delete persisted.workspace_preferences!.service_models!
    .resource_prompt_rewrite!.customPrompt;
  await mount();
  await search("mediaServices.sections.resourcePromptRewrite.title");
  focused("media-service-resource-prompt-rewrite");
  expect(container.querySelector("textarea")).toBeNull();
  noWrites();
});
