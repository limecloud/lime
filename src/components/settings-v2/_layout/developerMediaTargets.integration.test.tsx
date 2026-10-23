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
  getExperimentalConfig: vi.fn(),
  saveExperimentalConfig: vi.fn(),
  applyCrashReportingSettings: vi.fn(),
}));
// 只替换 transport，保留 current gateway / diff / 串行配置 owner。
vi.mock("@/lib/api/appServer", () => ({
  AppServerClient: class {
    request = api.request;
  },
}));
vi.mock("@/lib/api/experimentalFeatures", () => ({
  getExperimentalConfig: api.getExperimentalConfig,
  saveExperimentalConfig: api.saveExperimentalConfig,
  DEFAULT_EXPERIMENTAL_FEATURES: { webmcp: { enabled: false } },
}));
vi.mock("@/lib/crashReporting", () => ({
  applyCrashReportingSettings: api.applyCrashReportingSettings,
}));
vi.mock("../agent/image-gen", () => ({ ImageGenSettings: () => null }));
vi.mock("../agent/video-gen", () => ({ VideoGenSettings: () => null }));
vi.mock("../agent/voice", () => ({ VoiceSettings: () => null }));
vi.mock("@/components/input-kit", () => ({
  ModelSelector: () => <span>Model preference</span>,
}));
vi.mock("../system/developer", () => ({
  DeveloperSettings: () => <p>Developer tools</p>,
}));
vi.mock("../system/developer/preload", () => ({
  preloadDeveloperDefaultSections: async () => undefined,
}));
vi.mock("../system/experimental/UpdateCheckSettings", () => ({
  UpdateCheckSettings: () => null,
}));
vi.mock("../system/shared/WorkspaceRepairHistoryCard", () => ({
  WorkspaceRepairHistoryCard: () => null,
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
    SettingsTabs.Developer,
    "experimental-crash-reporting",
    "experimental.crashReporting.title",
  ],
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
const crashKey = "experimental.crashReporting.title";
const topicKey = "mediaServices.sections.topic.title";
const countKey = "mediaServices.imageSettings.count.label";
const t = (key: string) =>
  getLimeI18n().getFixedT(
    getLimeI18n().resolvedLanguage ?? "en-US",
    "settings",
  )(`settings.${key}`);
const experimentalConfig = { webmcp: { enabled: false } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let root: Root;
let container: HTMLDivElement;
let persisted: Config;
let writes: ConfigBatchWriteParams[];
let gates: ReturnType<typeof deferred<typeof experimentalConfig>>[];
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
const dsn = () =>
  container.querySelector<HTMLInputElement>("#experimental-crash-dsn")!;
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
const holdExperimental = () => {
  const gate = deferred<typeof experimentalConfig>();
  gates.push(gate);
  api.getExperimentalConfig.mockReturnValueOnce(gate.promise);
  return gate;
};
const noWrites = () => {
  expect(writes).toEqual([]);
  expect(api.saveExperimentalConfig).not.toHaveBeenCalled();
  expect(api.applyCrashReportingSettings).not.toHaveBeenCalled();
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
  gates = [];
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
  api.getExperimentalConfig.mockResolvedValue(experimentalConfig);
  api.saveExperimentalConfig.mockResolvedValue(undefined);
  api.applyCrashReportingSettings.mockResolvedValue(undefined);
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
    resolveSettingsSection(SettingsTabs.Developer).preload(),
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => {
    for (const gate of gates) gate.resolve(experimentalConfig);
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
    if (section === SettingsTabs.Developer) {
      expect(
        testId("developer-lab-tab-experimental").getAttribute("aria-selected"),
      ).toBe("true");
      expect(node.querySelector("details")?.open).toBe(false);
      expect(document.activeElement).not.toBe(dsn());
    } else {
      expect(container.querySelector("textarea")).not.toBe(
        document.activeElement,
      );
    }
    noWrites();
  },
);

it.each(["prompt", "count"])(
  "protects the Media %s when searching Developer, and discards only after confirmation",
  async (field) => {
    await mount();
    const node = field === "prompt" ? prompt() : count();
    const value = field === "prompt" ? "unfinished private prompt" : "";
    await edit(node, value);
    node.focus();
    if (node instanceof HTMLTextAreaElement) node.setSelectionRange(2, 7);
    const originalParams = params();
    await search(crashKey);
    expect(dialog()).not.toBeNull();
    expect(params()).toEqual(originalParams);
    expect(target("experimental-crash-reporting")).toBeUndefined();
    await confirm("keepEditing");
    expect(field === "prompt" ? prompt() : count()).toBe(node);
    expect(node.value).toBe(value);
    if (node instanceof HTMLTextAreaElement)
      expect([node.selectionStart, node.selectionEnd]).toEqual([2, 7]);
    await search(crashKey);
    await confirm("discard");
    focused("experimental-crash-reporting");
    expect(
      persisted.workspace_preferences?.service_models?.resource_prompt_rewrite
        ?.customPrompt,
    ).toBe("fixture-private-prompt");
    noWrites();
  },
);

it.each([topicKey, crashKey])(
  "keeps an Experimental draft and hidden local tab until abandoning search to %s",
  async (key) => {
    await mount(SettingsTabs.Experimental);
    const node = dsn();
    node.closest("details")!.open = true;
    await edit(node, "unsaved credential fixture");
    node.focus();
    node.setSelectionRange(3, 8);
    await click(testId("developer-lab-tab-developer"));
    expect(
      testId("developer-lab-tab-developer").getAttribute("aria-selected"),
    ).toBe("true");
    expect(node.closest("[hidden]")).not.toBeNull();
    const originalParams = params();
    await search(key);
    expect(dialog()).not.toBeNull();
    expect(params()).toEqual(originalParams);
    await confirm("keepEditing");
    expect(dsn()).toBe(node);
    expect(node.value).toBe("unsaved credential fixture");
    expect([node.selectionStart, node.selectionEnd]).toEqual([3, 8]);
    expect(node.closest("[hidden]")).not.toBeNull();
    await search(key);
    await confirm("discard");
    focused(
      key === crashKey ? "experimental-crash-reporting" : "media-service-topic",
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

it("waits for a lazy Experimental target without opening its details or reading credential values into search", async () => {
  const gate = holdExperimental();
  await mount();
  await search(crashKey);
  expect(target("experimental-crash-reporting")).toBeUndefined();
  await act(async () => gate.resolve(experimentalConfig));
  const node = focused("experimental-crash-reporting");
  expect(node.querySelector("details")?.open).toBe(false);
  expect(node.textContent).not.toContain("https://secret.invalid/42");
  for (const query of [
    "https://secret.invalid/42",
    "fixture-private-prompt",
    "fixture-custom-model-name",
  ])
    expect(
      searchSettings(
        query,
        groups,
        getLimeI18n().getFixedT("en-US", "settings"),
        true,
      ),
    ).toEqual([]);
  noWrites();
});

it("cancels a pending target observer when a later search leaves Developer", async () => {
  const gate = holdExperimental();
  await mount();
  await search(crashKey);
  expect(target("experimental-crash-reporting")).toBeUndefined();
  await search(topicKey);
  const node = focused("media-service-topic");
  await act(async () => gate.resolve(experimentalConfig));
  expect(document.activeElement).toBe(node);
  expect(target("experimental-crash-reporting")).toBeUndefined();
  noWrites();
});

it.each([
  "missing",
  "experimental",
  'experimental-crash-reporting"] input, *',
  "media-service-topic",
])(
  "rejects a forged Developer target %s even with an injected path",
  async (targetId) => {
    await mount();
    await act(async () =>
      navigation.handleNavigate("settings", {
        tab: SettingsTabs.Developer,
        searchPath: "experimental",
        searchFocus: { targetId, requestKey: 91 },
      }),
    );
    expect(
      testId("developer-lab-tab-developer").getAttribute("aria-selected"),
    ).toBe("true");
    expect(target("experimental-crash-reporting")).toBeUndefined();
    expect(container.querySelector("[data-settings-search-active]")).toBeNull();
    noWrites();
  },
);

it("does not open a prompt editor while searching its service card", async () => {
  delete persisted.workspace_preferences!.service_models!
    .resource_prompt_rewrite!.customPrompt;
  await mount();
  await search("mediaServices.sections.resourcePromptRewrite.title");
  focused("media-service-resource-prompt-rewrite");
  expect(container.querySelector("textarea")).toBeNull();
  noWrites();
});

it("derives the Developer local tab from the whitelist despite a conflicting injected path", async () => {
  await mount();
  await act(async () =>
    navigation.handleNavigate("settings", {
      tab: SettingsTabs.Developer,
      searchPath: "developer",
      searchFocus: { targetId: "experimental-crash-reporting", requestKey: 93 },
    }),
  );
  const node = focused("experimental-crash-reporting");
  expect(
    testId("developer-lab-tab-experimental").getAttribute("aria-selected"),
  ).toBe("true");
  expect(node.querySelector("details")?.open).toBe(false);
  noWrites();
});
