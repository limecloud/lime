import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import type { ConfigUpdater } from "@/lib/api/appConfig";
import { useAppNavigation } from "@/hooks/useAppNavigation";
import { SettingsTabs } from "@/types/settings";
import type { SettingsPageParams } from "@/types/page";
import { MemorySettings } from "../general/memory";
import { SettingsPage } from ".";

const api = vi.hoisted(() => ({
  getConfig: vi.fn(),
  saveConfig: vi.fn(),
  readInstructions: vi.fn(),
  writeInstructions: vi.fn(),
}));
vi.mock("@/lib/api/appConfig", () => ({
  ...api,
  subscribeAppConfigChanged: () => () => {},
  updateConfig: async (update: ConfigUpdater) => {
    const config = update(await api.getConfig());
    await api.saveConfig(config);
    return config;
  },
}));
vi.mock("@/lib/api/instructions", () => ({
  readInstructions: api.readInstructions,
  writeInstructions: api.writeInstructions,
}));
vi.mock("@/lib/api/memoryStore", () => ({ resetMemory: vi.fn() }));
vi.mock("../general/GeneralSettings", () => ({ GeneralSettings: () => null }));
vi.mock("../sections", () => ({
  isSettingsSection: () => true,
  resolveSettingsSection: (tab?: SettingsTabs) => ({
    key: tab ?? SettingsTabs.General,
    preload: () => null,
    render: () =>
      tab === SettingsTabs.Memory ? <MemorySettings /> : <p>Other section</p>,
  }),
}));
vi.mock("./SettingsNavigation", () => ({
  SettingsNavigation: ({
    onBack,
    onTabChange,
  }: {
    onBack: () => void;
    onTabChange: (tab: SettingsTabs) => void;
  }) => (
    <nav>
      <button onClick={() => onTabChange(SettingsTabs.About)}>Section</button>
      <button onClick={onBack}>Back</button>
    </nav>
  ),
}));

let navigation: ReturnType<typeof useAppNavigation>;
function Harness() {
  navigation = useAppNavigation();
  const { handleNavigate } = navigation;
  useLayoutEffect(
    () => handleNavigate("settings", { tab: SettingsTabs.Memory }),
    [handleNavigate],
  );
  return (
    <>
      <button onClick={() => navigation.handleNavigate("agent")}>Home</button>
      <button onClick={() => navigation.handleNavigate("resources")}>
        Root
      </button>
      <button
        onClick={() => navigation.startNewConversation({ freshDraft: true })}
      >
        New
      </button>
      {navigation.requestedPage === "settings" ? (
        <SettingsPage
          pageParams={navigation.requestedPageParams as SettingsPageParams}
          onNavigate={navigation.handleNavigate}
          onBack={navigation.returnFromSettings}
          navigationGuard={navigation.navigationGuard}
        />
      ) : (
        <p data-testid="destination">{navigation.requestedPage}</p>
      )}
    </>
  );
}

let root: Root;
let container: HTMLDivElement;
const dialog = () =>
  document.querySelector('[data-testid="settings-unsaved-changes-dialog"]');
const button = (text: string) => {
  const result = [...document.querySelectorAll("button")].find(
    (node) => node.textContent === text,
  );
  if (!result) throw new Error(`Missing button ${text}`);
  return result;
};
async function click(element: HTMLElement) {
  await act(async () => element.click());
}
async function mount() {
  await act(async () => root.render(<Harness />));
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.sessionStorage.clear();
  api.getConfig.mockReset().mockResolvedValue({ memory: { enabled: true } });
  api.saveConfig.mockReset().mockResolvedValue(undefined);
  api.readInstructions
    .mockReset()
    .mockResolvedValue({
      path: "/fixture/AGENTS.md",
      contents: "original",
      revision: "v1",
      hasOverride: false,
    });
  api.writeInstructions
    .mockReset()
    .mockImplementation(async (contents) => ({
      path: "/fixture/AGENTS.md",
      contents,
      revision: "v2",
      hasOverride: false,
    }));
  await changeLimeLocale("en-US");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

async function edit(value: string) {
  const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function openEditor() {
  await mount();
  await click(container.querySelector('[aria-label="Edit instructions"]')!);
  await edit("draft instructions");
}
describe("Settings unsaved navigation with instructions", () => {
  it.each(["Section", "Back", "Home", "Root", "New"])(
    "%s preserves navigation until discard",
    async (target) => {
      await openEditor();
      const requestId = navigation.navigationRequestId;
      const params = navigation.requestedPageParams;
      const restore = sessionStorage.getItem("lime.appNavigation.restore.v1");
      await click(button(target));
      expect(dialog()).not.toBeNull();
      expect(navigation.requestedPageParams).toBe(params);
      expect(navigation.navigationRequestId).toBe(requestId);
      expect(sessionStorage.getItem("lime.appNavigation.restore.v1")).toBe(
        restore,
      );
      await click(button("Keep editing"));
      expect(container.querySelector("textarea")?.value).toBe(
        "draft instructions",
      );
      await click(button(target));
      await click(button("Discard changes"));
      expect(navigation.navigationRequestId).toBeGreaterThan(requestId);
      expect(api.writeInstructions).not.toHaveBeenCalled();
    },
  );
  it("failed save retains dirty navigation; retry allows leaving", async () => {
    api.writeInstructions.mockRejectedValueOnce(new Error("conflict"));
    await openEditor();
    await click(button("Save"));
    await click(button("Section"));
    expect(dialog()).not.toBeNull();
    await click(button("Keep editing"));
    await click(button("Save"));
    await click(button("Section"));
    expect(dialog()).toBeNull();
    expect(navigation.requestedPageParams).toEqual({ tab: SettingsTabs.About });
    expect(api.writeInstructions).toHaveBeenCalledTimes(2);
  });
  it("pending writes block discard and preserve newer edits", async () => {
    let resolve!: (value: object) => void;
    api.writeInstructions.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await openEditor();
    await click(button("Save"));
    await edit("newer draft");
    await click(button("Home"));
    expect(button("Discard changes").disabled).toBe(true);
    await act(async () =>
      navigation.navigationGuard.discardPendingNavigation(),
    );
    expect(navigation.requestedPage).toBe("settings");
    await click(button("Keep editing"));
    await act(async () =>
      resolve({
        path: "/fixture/AGENTS.md",
        contents: "draft instructions",
        revision: "v2",
        hasOverride: false,
      }),
    );
    expect(container.querySelector("textarea")?.value).toBe("newer draft");
    await click(button("Home"));
    expect(dialog()).not.toBeNull();
  });
  it.each(["en-US", "zh-CN", "zh-TW", "ja-JP", "ko-KR"])(
    "%s protects edits and restores focus on Escape",
    async (locale) => {
      await changeLimeLocale(locale);
      await mount();
      await click(
        container.querySelector(
          '[data-settings-search-target="memory-instructions"] button',
        )!,
      );
      await edit("draft");
      const textarea = container.querySelector("textarea")!;
      textarea.focus();
      await act(async () => navigation.handleNavigate("resources"));
      expect(dialog()).not.toBeNull();
      expect(dialog()?.textContent).not.toContain("settings.unsavedChanges.");
      await act(async () =>
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
      );
      await act(async () => {
        await new Promise((done) => setTimeout(done, 0));
      });
      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(textarea);
      expect(textarea.value).toBe("draft");
      expect(api.writeInstructions).not.toHaveBeenCalled();
    },
  );
});
