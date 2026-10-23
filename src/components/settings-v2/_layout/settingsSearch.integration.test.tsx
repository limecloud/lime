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
import type { ConfigUpdater } from "@/lib/api/appConfig";
import { SettingsPage } from ".";
import { useSettingsSearchTarget } from "./useSettingsSearchTarget";

const api = vi.hoisted(() => ({ getConfig: vi.fn(), saveConfig: vi.fn() }));
vi.mock("@/lib/api/appConfig", () => ({
  ...api,
  updateConfig: async (update: ConfigUpdater) => {
    const config = update(await api.getConfig());
    await api.saveConfig(config);
    return config;
  },
}));
vi.mock("../general/GeneralSettings", () => ({ GeneralSettings: () => null }));
vi.mock("../sections", async () => {
  const { SettingsTabs, SettingsGroupKey } = await import("@/types/settings");
  const { ProfileSettings } = await import("../account/profile");
  const sections = [
    {
      key: SettingsTabs.Profile,
      group: SettingsGroupKey.Personal,
      labelKey: "settings.profile.title",
      render: () => <ProfileSettings />,
    },
    {
      key: SettingsTabs.Environment,
      group: SettingsGroupKey.Coding,
      labelKey: "settings.environment.title",
      render: () => (
        <div data-settings-search-target="environment-overrides" tabIndex={-1}>
          Variable overrides
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
    () => handleNavigate("settings", { tab: SettingsTabs.Profile }),
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
const dialog = () => document.querySelector('[role="alertdialog"]');
const button = (text: string) => {
  const node = [...document.querySelectorAll("button")].find(
    (node) => node.textContent === text,
  );
  if (!node) throw new Error(`Missing ${text}`);
  return node;
};
async function click(node: HTMLElement) {
  await act(async () => node.click());
}
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
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.sessionStorage.clear();
  window.__LIME_OEM_CLOUD__ = { enabled: false };
  api.getConfig.mockReset().mockResolvedValue({
    user_profile: { nickname: "Saved", bio: "Saved bio" },
  });
  api.saveConfig.mockReset().mockResolvedValue(undefined);
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

describe("settings search through the canonical navigation and real Profile draft", () => {
  it("focuses and highlights without editing; repeating the same target is a new canonical request", async () => {
    await mount();
    await search("bio");
    expect(document.activeElement).toBe(target("profile-bio"));
    expect(target("profile-bio")?.dataset.settingsSearchActive).toBe("true");
    expect(container.querySelector("textarea")).toBeNull();
    const first = (navigation.requestedPageParams as SettingsPageParams)
      .searchFocus;
    await search("bio");
    expect(
      (navigation.requestedPageParams as SettingsPageParams).searchFocus
        ?.requestKey,
    ).toBeGreaterThan(first!.requestKey!);
    expect(document.activeElement).toBe(target("profile-bio"));
    expect(api.saveConfig).not.toHaveBeenCalled();
  });
  it("keep retains the draft/canonical params; discard commits the last target without saving", async () => {
    await mount();
    await click(target("profile-displayName")!.querySelector("button")!);
    const name = container.querySelector<HTMLInputElement>(
      "#profile-field-displayName",
    )!;
    await edit(name, "Unsaved private name");
    const params = navigation.requestedPageParams;
    const requestId = navigation.navigationRequestId;
    await search("bio");
    expect(dialog()).not.toBeNull();
    expect(navigation.requestedPageParams).toBe(params);
    expect(navigation.navigationRequestId).toBe(requestId);
    expect(container.querySelector("[data-settings-search-active]")).toBeNull();
    await click(button("Keep editing"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(name.value).toBe("Unsaved private name");
    expect(document.activeElement).toBe(input());
    await search("overrides");
    // Multiple requests while guarded replace the pending destination, never canonical state.
    await act(async () =>
      navigation.handleNavigate("settings", {
        tab: SettingsTabs.Profile,
        searchFocus: { targetId: "profile-bio", requestKey: 50 },
      }),
    );
    expect(navigation.requestedPageParams).toBe(params);
    await click(button("Discard changes"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(dialog()).toBeNull();
    expect(navigation.requestedPageParams).toMatchObject({
      tab: SettingsTabs.Profile,
      searchFocus: { targetId: "profile-bio", requestKey: 50 },
    });
    expect(container.querySelector("#profile-field-displayName")).toBeNull();
    expect(target("profile-displayName")?.textContent).toContain("Saved");
    expect(document.activeElement).toBe(target("profile-bio"));
    expect(api.saveConfig).not.toHaveBeenCalled();
  });
  it("waits for asynchronously loaded Profile and cancels an abandoned destination", async () => {
    const load = deferred<{ user_profile: { bio: string } }>();
    api.getConfig.mockReturnValue(load.promise);
    await mount();
    await search("bio");
    expect(target("profile-bio")).toBeNull();
    await act(async () =>
      load.resolve({ user_profile: { bio: "Loaded later" } }),
    );
    expect(document.activeElement).toBe(target("profile-bio"));
    expect(target("profile-bio")?.textContent).toContain("Loaded later");
    const late = deferred<{ user_profile: { bio: string } }>();
    api.getConfig.mockReturnValue(late.promise);
    await search("bio");
    await search("overrides");
    const destination = target("environment-overrides");
    expect(document.activeElement).toBe(destination);
    await act(async () => late.resolve({ user_profile: { bio: "Abandoned" } }));
    expect(document.activeElement).toBe(destination);
    expect(target("profile-bio")).toBeNull();
  });
});

let updateTarget!: (value: boolean) => void;
let updateFocus!: (value: SettingsSearchFocusContext | undefined) => void;
function TargetHarness({ localProfile = true }: { localProfile?: boolean }) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [focus, setFocus] = useState<SettingsSearchFocusContext | undefined>({
    targetId: "profile-bio",
    requestKey: 1,
  });
  updateTarget = setVisible;
  updateFocus = setFocus;
  useSettingsSearchTarget(ref, SettingsTabs.Profile, focus, localProfile);
  return (
    <main ref={ref}>
      {visible ? (
        <div data-settings-search-target="profile-bio" tabIndex={-1}>
          Bio
        </div>
      ) : null}
    </main>
  );
}
it("does not allow unknown, cross-section or managed-profile target requests", async () => {
  await act(async () => root.render(<TargetHarness />));
  await act(async () =>
    updateFocus({ targetId: 'profile-bio"] input', requestKey: 2 }),
  );
  await act(async () => updateTarget(true));
  expect(container.querySelector("[data-settings-search-active]")).toBeNull();
  await act(async () =>
    updateFocus({ targetId: "environment-overrides", requestKey: 3 }),
  );
  expect(container.querySelector("[data-settings-search-active]")).toBeNull();
  await act(async () => root.render(<TargetHarness localProfile={false} />));
  await act(async () =>
    updateFocus({ targetId: "profile-bio", requestKey: 4 }),
  );
  expect(container.querySelector("[data-settings-search-active]")).toBeNull();
});
it("disconnects a waiting observer on unmount", async () => {
  const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
  await act(async () => root.render(<TargetHarness />));
  await act(async () => root.render(null));
  expect(disconnect).toHaveBeenCalled();
  const stray = document.createElement("div");
  stray.dataset.settingsSearchTarget = "profile-bio";
  stray.tabIndex = -1;
  container.appendChild(stray);
  await act(async () => {
    await Promise.resolve();
  });
  expect(stray.hasAttribute("data-settings-search-active")).toBe(false);
});

it("keeps narrow search mounted through dirty confirmation, then focuses the committed target", async () => {
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: true,
  } as MediaQueryList);
  await mount();
  await click(target("profile-displayName")!.querySelector("button")!);
  await edit(
    container.querySelector<HTMLInputElement>("#profile-field-displayName")!,
    "Narrow draft",
  );
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }),
    ),
  );
  const mobile = container.querySelector<HTMLInputElement>(
    '[data-testid="settings-sidebar-search"]',
  )!;
  expect(document.activeElement).toBe(mobile);
  await edit(mobile, "bio");
  await act(async () =>
    mobile.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  expect(dialog()).not.toBeNull();
  await act(async () =>
    button("Keep editing").dispatchEvent(
      new Event("pointerdown", { bubbles: true }),
    ),
  );
  await click(button("Keep editing"));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(mobile.isConnected).toBe(true);
  expect(document.activeElement).toBe(mobile);
  expect(
    container.querySelector<HTMLInputElement>("#profile-field-displayName")
      ?.value,
  ).toBe("Narrow draft");
  await act(async () =>
    mobile.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  await click(button("Discard changes"));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(mobile.isConnected).toBe(true);
  expect(document.activeElement).toBe(target("profile-bio"));
  expect(api.saveConfig).not.toHaveBeenCalled();
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
  expect(document.activeElement).toBe(target("profile-bio"));
  await act(async () => updateFocus(undefined));
  expect(
    target("profile-bio")?.hasAttribute("data-settings-search-active"),
  ).toBe(false);
});
