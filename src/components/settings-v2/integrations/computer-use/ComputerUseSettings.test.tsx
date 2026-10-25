import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { SettingsTabs, SettingsGroupKey } from "@/types/settings";
import { settingsSections } from "../../sections";
import type { ComputerUseSettingsSnapshot } from "@/lib/api/computerUseSettings";
import { ComputerUseSettings } from ".";

const api = vi.hoisted(() => ({
  read: vi.fn(),
  toggle: vi.fn(),
  remove: vi.fn(),
  setup: vi.fn(),
  subscribe: vi.fn(),
}));
vi.mock("@/lib/api/computerUseSettings", () => ({
  getComputerUseSettings: api.read,
  setComputerUseEnabled: api.toggle,
  removeAllowedComputerApp: api.remove,
  setupComputerUseAdapter: api.setup,
}));
vi.mock("@/lib/api/appConfig", () => ({
  subscribeAppConfigChanged: api.subscribe,
}));
let root: Root;
let container: HTMLDivElement;
let snapshot: ComputerUseSettingsSnapshot;
const switches = () =>
  container.querySelectorAll<HTMLButtonElement>('[role="switch"]');
const click = (element: HTMLElement) => act(async () => element.click());
const button = (
  text: string,
  scope: Pick<HTMLElement, "querySelectorAll"> = document,
) =>
  Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find(
    (entry) => entry.textContent === text,
  )!;
const mount = () =>
  act(async () =>
    root.render(
      <StrictMode>
        <ComputerUseSettings />
      </StrictMode>,
    ),
  );

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  await changeLimeLocale("en-US");
  snapshot = {
    enabled: { native: false, chrome: false, office: false },
    managed: { native: false, chrome: false, office: false },
    allowedApps: [],
    status: {
      epoch: 1,
      grants: [],
      adapters: [
        { adapter: "native", readiness: "disabled", epoch: 1 },
        { adapter: "chrome", readiness: "not_installed", epoch: 1 },
        { adapter: "office", readiness: "not_installed", epoch: 1 },
      ],
    },
  };
  api.read.mockImplementation(async () => structuredClone(snapshot));
  api.subscribe.mockReturnValue(() => {});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("registers Computer use between Plugins and Browser in the integrations group", () => {
  const entries = settingsSections.filter(
    (section) => section.group === SettingsGroupKey.Integrations,
  );
  expect(entries.map((section) => section.key)).toEqual([
    SettingsTabs.Plugins,
    SettingsTabs.ComputerUse,
    SettingsTabs.Browser,
  ]);
});

it("shows all three controls and does not advertise missing Chrome or Office as enabled", async () => {
  await mount();
  expect(container.textContent).toContain("Any app");
  expect(container.textContent).toContain("Google Chrome");
  expect(container.textContent).toContain("WPS Office");
  expect(container.textContent).toContain("Always-allowed apps");
  expect(container.textContent).toContain("None yet");
  expect(switches()).toHaveLength(3);
  expect(switches()[0].disabled).toBe(false);
  expect(switches()[1].disabled).toBe(false);
  expect(switches()[2].disabled).toBe(false);
  expect(switches()[1].getAttribute("aria-checked")).toBe("false");
  await click(
    container.querySelector<HTMLButtonElement>(
      '[aria-label="Manage Google Chrome"]',
    )!,
  );
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "Not installed",
  );
  await click(button("Close"));
});

it("waits for a successful save and status read before showing native control enabled", async () => {
  api.toggle.mockImplementation(async () => {
    snapshot.enabled.native = true;
  });
  await mount();
  await click(switches()[0]);
  expect(api.toggle).toHaveBeenCalledWith(true, false, "native");
  expect(switches()[0].getAttribute("aria-checked")).toBe("true");
  expect(api.setup).not.toHaveBeenCalled();
});

it("retains the last confirmed value on save failure, and retry reloads it", async () => {
  api.toggle.mockRejectedValue(new Error("CAS conflict"));
  await mount();
  await click(switches()[0]);
  expect(switches()[0].getAttribute("aria-checked")).toBe("false");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Unable to save",
  );
  snapshot.enabled.native = true;
  await click(button("Retry"));
  expect(switches()[0].getAttribute("aria-checked")).toBe("true");
});

it("disables native control when managed or when status cannot be read", async () => {
  snapshot.managed.native = true;
  await mount();
  expect(switches()[0].disabled).toBe(true);
  expect(container.textContent).toContain("Managed by your administrator");
  api.read.mockRejectedValue(new Error("disconnected"));
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(switches()[0].disabled).toBe(true);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Unable to load",
  );
});

it("blocks further changes when a write cannot be confirmed, until an explicit retry succeeds", async () => {
  await mount();
  api.toggle.mockImplementation(async () => {
    snapshot.enabled.native = true;
  });
  api.read.mockRejectedValue(new Error("readback disconnected"));
  await click(switches()[0]);
  expect(switches()[0].disabled).toBe(true);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Unable to confirm",
  );
  api.read.mockImplementation(async () => structuredClone(snapshot));
  await click(button("Retry"));
  expect(switches()[0].disabled).toBe(false);
  expect(switches()[0].getAttribute("aria-checked")).toBe("true");
});

it("requires confirmation to remove an app and keeps the row when saving fails", async () => {
  snapshot.allowedApps = [
    {
      id: "bundle:com.example.Editor",
      name: "com.example.Editor",
      field: "bundle",
      key: "com.example.Editor",
      platform: "macos",
      managed: false,
    },
  ];
  await mount();
  await click(button("Remove"));
  expect(api.remove).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
    "com.example.Editor",
  );
  await click(button("Cancel"));
  expect(api.remove).not.toHaveBeenCalled();
  await click(button("Remove"));
  api.remove.mockRejectedValueOnce(new Error("disk full"));
  await click(
    button("Remove", document.querySelector('[role="alertdialog"]')!),
  );
  expect(
    document.querySelector('[role="alertdialog"] [role="alert"]'),
  ).not.toBeNull();
  expect(container.textContent).toContain("com.example.Editor");
  api.remove.mockImplementation(async () => {
    snapshot.allowedApps = [];
  });
  await click(
    button("Remove", document.querySelector('[role="alertdialog"]')!),
  );
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(container.textContent).toContain("None yet");
});

it("offers system permission setup only after native use is enabled", async () => {
  snapshot.enabled.native = true;
  snapshot.status.adapters[0].readiness = "permission_required";
  await mount();
  await click(button("Set up"));
  expect(api.setup).toHaveBeenCalledOnce();
});

it("ignores a late request after unmount and serializes repeated toggle clicks", async () => {
  let resolveSave!: () => void;
  api.toggle.mockReturnValue(
    new Promise<void>((resolve) => {
      resolveSave = resolve;
    }),
  );
  await mount();
  await click(switches()[0]);
  expect(switches()[0].disabled).toBe(true);
  await click(switches()[0]);
  expect(api.toggle).toHaveBeenCalledOnce();
  await act(async () => root.render(null));
  await act(async () => resolveSave());
  expect(container.textContent).toBe("");
});

it.each([
  ["zh-CN", "电脑操控", "始终允许的应用"],
  ["zh-TW", "電腦操控", "一律允許的應用程式"],
  ["en-US", "Computer use", "Always-allowed apps"],
  ["ja-JP", "コンピューター操作", "常に許可するアプリ"],
  ["ko-KR", "컴퓨터 제어", "항상 허용된 앱"],
])(
  "%s translates the page and accessible control labels",
  async (locale, title, allowed) => {
    await changeLimeLocale(locale);
    await mount();
    expect(container.querySelector("h1")?.textContent).toBe(title);
    expect(container.textContent).toContain(allowed);
    expect(container.textContent).not.toContain("settings.computerUse.");
    for (const control of switches())
      expect(
        document.getElementById(control.getAttribute("aria-labelledby")!)
          ?.textContent,
      ).toBeTruthy();
  },
);

it("enables Chrome independently and requests consent only for the selected live tab", async () => {
  const target = {
    type: "chrome" as const,
    origin: "https://example.test",
    profileId: "profile-1",
    tabId: "7",
    url: "https://example.test/",
  };
  snapshot.status.adapters[1] = {
    adapter: "chrome",
    readiness: "ready",
    targets: [target],
    epoch: 1,
  };
  api.toggle.mockImplementation(async (_value, _expected, adapter) => {
    snapshot.enabled[adapter as "chrome"] = true;
  });
  await mount();
  await click(switches()[1]);
  expect(api.toggle).toHaveBeenCalledWith(true, false, "chrome");
  expect(switches()[0].getAttribute("aria-checked")).toBe("false");
  expect(switches()[2].getAttribute("aria-checked")).toBe("false");
  expect(api.setup).not.toHaveBeenCalled();
  await click(
    container.querySelector<HTMLButtonElement>(
      '[aria-label="Manage Google Chrome"]',
    )!,
  );
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    target.url,
  );
  await click(button("Approve this session"));
  expect(api.setup).toHaveBeenCalledWith("chrome", target);
});
