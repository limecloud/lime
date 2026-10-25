import { act, useLayoutEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { useAppNavigation } from "@/hooks/useAppNavigation";
import { SettingsTabs } from "@/types/settings";
import type {
  SettingsPageParams,
  SettingsSearchFocusContext,
} from "@/types/page";
import { SettingsPage } from ".";
import { useSettingsSearchTarget } from "./useSettingsSearchTarget";

vi.mock("../general/GeneralSettings", () => ({ GeneralSettings: () => null }));
vi.mock("../sections", async () => {
  const { SettingsTabs, SettingsGroupKey } = await import("@/types/settings");
  const sections = [
    {
      key: SettingsTabs.Memory,
      group: SettingsGroupKey.Personal,
      labelKey: "settings.desktop.personalization",
      render: () => (
        <div data-settings-search-target="memory-instructions" tabIndex={-1}>
          Lime instructions
        </div>
      ),
    },
    {
      key: SettingsTabs.LocalEnvironments,
      group: SettingsGroupKey.Coding,
      labelKey: "settings.localEnvironments.title",
      render: () => (
        <div
          data-settings-search-target="local-environments-projects"
          tabIndex={-1}
        >
          Local environments
        </div>
      ),
    },
    {
      key: SettingsTabs.About,
      group: SettingsGroupKey.Coding,
      labelKey: "settings.about.title",
      render: () => <p>About panel</p>,
    },
  ].map((section) => ({ ...section, icon: () => null, preload: () => null }));
  return {
    settingsSections: sections,
    isSettingsSection: () => true,
    resolveSettingsSection: (tab?: SettingsTabs) =>
      sections.find((section) => section.key === tab) ?? sections[2],
  };
});
vi.mock("./SettingsNavigation", async () => {
  const { SettingsSidebar } = await import("./SettingsSidebar");
  return {
    SettingsNavigation: (props: Parameters<typeof SettingsSidebar>[0]) => (
      <SettingsSidebar {...props} />
    ),
  };
});

let navigation: ReturnType<typeof useAppNavigation>;
function Harness() {
  navigation = useAppNavigation();
  const { handleNavigate } = navigation;
  useLayoutEffect(
    () => handleNavigate("settings", { tab: SettingsTabs.Memory }),
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
    node.focus();
    Object.getOwnPropertyDescriptor(
      node instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function search(query: string) {
  await edit(input(), query);
  await act(async () =>
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
}
async function mount() {
  await act(async () => root.render(<Harness />));
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.sessionStorage.clear();
  window.__LIME_OEM_CLOUD__ = { enabled: false };
  await changeLimeLocale("en-US");
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

describe("settings search through canonical navigation", () => {
  it("focuses instructions and gives repeated requests a new canonical identity", async () => {
    await mount();
    await search("instructions");
    expect(document.activeElement).toBe(target("memory-instructions"));
    expect(target("memory-instructions")?.dataset.settingsSearchActive).toBe(
      "true",
    );
    const first = (navigation.requestedPageParams as SettingsPageParams)
      .searchFocus;
    await search("instructions");
    expect(
      (navigation.requestedPageParams as SettingsPageParams).searchFocus
        ?.requestKey,
    ).toBeGreaterThan(first!.requestKey!);
    expect(document.activeElement).toBe(target("memory-instructions"));
    expect(container.querySelector("textarea")).toBeNull();
  });
});

let updateTarget!: (value: boolean) => void;
let updateFocus!: (value: SettingsSearchFocusContext | undefined) => void;
function TargetHarness() {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [focus, setFocus] = useState<SettingsSearchFocusContext | undefined>({
    targetId: "memory-instructions",
    requestKey: 1,
  });
  updateTarget = setVisible;
  updateFocus = setFocus;
  useSettingsSearchTarget(ref, SettingsTabs.Memory, focus);
  return (
    <main ref={ref}>
      {visible ? (
        <div data-settings-search-target="memory-instructions" tabIndex={-1}>
          Lime instructions
        </div>
      ) : null}
    </main>
  );
}
it("waits for late targets and refocuses repeated requests", async () => {
  await act(async () => root.render(<TargetHarness />));
  expect(target("memory-instructions")).toBeNull();
  await act(async () => updateTarget(true));
  expect(document.activeElement).toBe(target("memory-instructions"));
  const elsewhere = document.createElement("button");
  container.appendChild(elsewhere);
  elsewhere.focus();
  await act(async () =>
    updateFocus({ targetId: "memory-instructions", requestKey: 2 }),
  );
  expect(document.activeElement).toBe(target("memory-instructions"));
});

it.each([
  "missing",
  "local-environments-projects",
  'memory-instructions"] input, *',
  "profile-bio",
])(
  "rejects unknown, cross-section or selector-shaped target %s",
  async (targetId) => {
    await act(async () => root.render(<TargetHarness />));
    await act(async () => updateFocus({ targetId, requestKey: 2 }));
    await act(async () => updateTarget(true));
    expect(container.querySelector("[data-settings-search-active]")).toBeNull();
  },
);
it("disconnects a waiting observer on unmount", async () => {
  const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
  await act(async () => root.render(<TargetHarness />));
  await act(async () => root.render(null));
  expect(disconnect).toHaveBeenCalled();
  const stray = document.createElement("div");
  stray.dataset.settingsSearchTarget = "memory-instructions";
  stray.tabIndex = -1;
  container.appendChild(stray);
  await act(async () => {
    await Promise.resolve();
  });
  expect(stray.hasAttribute("data-settings-search-active")).toBe(false);
});

it("scrolls only the settings content owner when a late target becomes available", async () => {
  await act(async () => root.render(<TargetHarness />));
  const main = container.querySelector("main")!;
  const scroll = vi.fn();
  main.scrollTo = scroll;
  main.scrollTop = 20;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return { top: this === main ? 100 : 500 } as DOMRect;
    },
  );
  await act(async () => updateTarget(true));
  expect(scroll).toHaveBeenCalledWith({ top: 396, behavior: "auto" });
  expect(document.activeElement).toBe(target("memory-instructions"));
  await act(async () => updateFocus(undefined));
  expect(
    target("memory-instructions")?.hasAttribute("data-settings-search-active"),
  ).toBe(false);
});
