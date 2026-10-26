import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import {
  DESKTOP_PERMISSION_IDS,
  type DesktopPermissionsSnapshot,
} from "@/lib/api/desktopPermissionsTypes";
import { openPermissionsSetup } from "@/lib/permissionsSetup";

const api = vi.hoisted(() => ({
  read: vi.fn(),
  request: vi.fn(),
  settings: vi.fn(),
  complete: vi.fn(),
  targets: vi.fn(),
  notify: vi.fn(),
}));
vi.mock("@/lib/desktop-runtime", () => ({
  hasDesktopHostInvokeCapability: () => true,
}));
vi.mock("@/lib/api/desktopPermissions", () => ({
  readDesktopPermissions: api.read,
  requestDesktopPermission: api.request,
  openDesktopPermissionSettings: api.settings,
  completeDesktopPermissionsSetup: api.complete,
  readAutomationTargets: api.targets,
}));
vi.mock("@/lib/api/desktopNotification", () => ({
  showDesktopNotification: api.notify,
}));
import { PermissionsSetup } from "./PermissionsSetup";

let root: Root, container: HTMLDivElement, snapshot: DesktopPermissionsSnapshot;
async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}
function button(label: string) {
  const value = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((item) => item.textContent?.trim() === label);
  expect(value, `missing button: ${label}`).toBeTruthy();
  return value!;
}
async function click(label: string) {
  act(() => button(label).click());
  await settle();
}
async function mount() {
  act(() => root.render(<PermissionsSetup />));
  await settle();
}
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await changeLimeLocale("zh-CN");
  snapshot = {
    platform: "darwin",
    setupComplete: false,
    applicationPath: "/Applications/Lime.app",
    nativeApplicationId: "native.test",
    selectedDirectory: null,
    permissions: DESKTOP_PERMISSION_IDS.map((id) => ({
      id,
      state: "unknown",
      canRequest: [
        "secureStorage",
        "automation",
        "camera",
        "microphone",
        "files",
      ].includes(id),
      canOpenSettings: id !== "secureStorage",
    })),
  };
  api.read.mockImplementation(async () => structuredClone(snapshot));
  api.request.mockResolvedValue(snapshot);
  api.complete.mockResolvedValue(undefined);
  api.settings.mockResolvedValue(undefined);
  api.targets.mockResolvedValue([{ bundleId: "app.test", name: "Test App" }]);
  api.notify.mockResolvedValue({ status: "sent" });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
describe("Permission setup flow", () => {
  it("opens first run, requests only on click, and keeps denied access on the same step", async () => {
    await mount();
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    expect(api.request).not.toHaveBeenCalled();
    await click("下一步");
    expect(
      document.querySelector('[data-permission="secureStorage"]'),
    ).toBeTruthy();
    snapshot.permissions.find((entry) => entry.id === "secureStorage")!.state =
      "denied";
    await click("验证安全存储");
    expect(api.request).toHaveBeenCalledWith("secureStorage", undefined);
    expect(
      document
        .querySelector(
          '[data-permission="secureStorage"] [data-permission-state]',
        )
        ?.getAttribute("data-permission-state"),
    ).toBe("denied");
    expect(
      document
        .querySelector('[role="progressbar"]')
        ?.getAttribute("aria-valuenow"),
    ).toBe("2");
  });
  it("loads apps on demand and requests automation only for the selected app", async () => {
    await mount();
    await click("下一步");
    await click("下一步");
    expect(api.targets).toHaveBeenCalledTimes(1);
    const section = document.querySelector('[data-permission="automation"]')!;
    expect(
      [...section.querySelectorAll("button")].find(
        (entry) => entry.textContent === "开启权限",
      )?.disabled,
    ).toBe(true);
    await click("刷新列表");
    const select = section.querySelector("select")!;
    act(() => {
      select.value = "app.test";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    act(() =>
      [...section.querySelectorAll<HTMLButtonElement>("button")]
        .find((entry) => entry.textContent === "开启权限")!
        .click(),
    );
    await settle();
    expect(api.request).toHaveBeenCalledWith("automation", "app.test");
  });
  it("refreshes on return to the application and preserves unknown states", async () => {
    await mount();
    await click("下一步");
    snapshot.permissions.find((entry) => entry.id === "secureStorage")!.state =
      "granted";
    act(() => window.dispatchEvent(new Event("focus")));
    await settle();
    expect(
      document.querySelector(
        '[data-permission="secureStorage"] [data-permission-state]',
      )?.textContent,
    ).toContain("可用");
    expect(
      snapshot.permissions.find((entry) => entry.id === "notifications")!.state,
    ).toBe("unknown");
  });
  it("persists dismissal, can reopen from settings, and retains errors until retry", async () => {
    await mount();
    api.complete.mockRejectedValueOnce(new Error("disk"));
    await click("稍后设置");
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    expect(document.querySelector('[role="alert"]')).toBeTruthy();
    await click("稍后设置");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    act(() => openPermissionsSetup());
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  });
  it("updates OS consent without a focus event and stops rechecking after closing", async () => {
    vi.useFakeTimers();
    try {
      await mount();
      for (let index = 0; index < 4; index++) await click("下一步");
      const location = snapshot.permissions.find(
        (entry) => entry.id === "location",
      )!;
      location.state = "granted";
      await act(async () => vi.advanceTimersByTimeAsync(2000));
      expect(
        document.querySelector(
          '[data-permission="location"] [data-permission-state]',
        )?.textContent,
      ).toContain("可用");
      expect(button("下一步").disabled).toBe(false);
      await click("稍后设置");
      const reads = api.read.mock.calls.length;
      await act(async () => vi.advanceTimersByTimeAsync(4000));
      expect(api.read).toHaveBeenCalledTimes(reads);
    } finally {
      vi.useRealTimers();
    }
  });
  it("does not reopen automatically after completion but settings still opens it", async () => {
    snapshot.setupComplete = true;
    await mount();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    act(() => openPermissionsSetup());
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  });
  it("does not discard a user action while a background permission read is pending", async () => {
    await mount();
    await click("下一步");
    let release!: (value: DesktopPermissionsSnapshot) => void;
    api.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    act(() => window.dispatchEvent(new Event("focus")));
    await settle();
    await click("验证安全存储");
    expect(api.request).not.toHaveBeenCalled();
    await act(async () => release(structuredClone(snapshot)));
    await settle();
    expect(api.request).toHaveBeenCalledExactlyOnceWith(
      "secureStorage",
      undefined,
    );
  });
  it("never applies an old application's consent to a newly selected automation target", async () => {
    await mount();
    await click("下一步");
    await click("下一步");
    api.targets.mockResolvedValueOnce([
      { bundleId: "app.test", name: "Test App" },
      { bundleId: "app.second", name: "Second App" },
    ]);
    await click("刷新列表");
    const select = document.querySelector<HTMLSelectElement>(
      '[data-permission="automation"] select',
    )!;
    async function choose(value: string) {
      act(() => {
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await settle();
    }
    await choose("app.test");
    let release!: (value: DesktopPermissionsSnapshot) => void;
    api.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    act(() => window.dispatchEvent(new Event("focus")));
    await settle();
    await choose("app.second");
    const old = structuredClone(snapshot);
    old.permissions.find((entry) => entry.id === "automation")!.state =
      "granted";
    await act(async () => release(old));
    await settle();
    expect(select.value).toBe("app.second");
    expect(
      document
        .querySelector('[data-permission="automation"] [data-permission-state]')
        ?.getAttribute("data-permission-state"),
    ).toBe("unknown");
    expect(api.read).toHaveBeenLastCalledWith("app.second");
  });
  it("shows request failures on their own row and clears them when moving to another step", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await mount();
      await click("下一步");
      const cause = new Error("OS request failed");
      api.request.mockRejectedValueOnce(cause);
      api.read.mockRejectedValueOnce(new Error("read failed too"));
      await click("验证安全存储");
      expect(
        document.querySelector(
          '[data-permission="secureStorage"] [role="alert"]',
        )?.textContent,
      ).toContain("申请权限");
      expect(log).toHaveBeenCalledWith(
        "[PermissionsSetup]",
        "request",
        "secureStorage",
        cause,
      );
      await click("下一步");
      expect(document.querySelector('[role="alert"]')).toBeNull();
    } finally {
      log.mockRestore();
    }
  });
  it("shows an actionable Keychain recovery and retries the same storage verification", async () => {
    snapshot.permissions.find((entry) => entry.id === "secureStorage")!.state =
      "unavailable";
    await mount();
    await click("下一步");
    expect(
      document.querySelector('[data-permission="secureStorage"]')?.textContent,
    ).toContain("钥匙串");
    const granted = structuredClone(snapshot);
    granted.permissions.find((entry) => entry.id === "secureStorage")!.state =
      "granted";
    api.request.mockResolvedValueOnce(granted);
    await click("重新验证");
    expect(api.request).toHaveBeenCalledExactlyOnceWith(
      "secureStorage",
      undefined,
    );
    expect(
      document.querySelector('[data-permission="secureStorage"]')?.textContent,
    ).not.toContain("钥匙串");
    expect(
      document
        .querySelector(
          '[data-permission="secureStorage"] [data-permission-state]',
        )
        ?.getAttribute("data-permission-state"),
    ).toBe("granted");
  });
  it("keeps an OS dialog pending until its response and applies the returned permission snapshot without a second failing read", async () => {
    await mount();
    await click("下一步");
    let resolve!: (value: DesktopPermissionsSnapshot) => void;
    api.request.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    act(() => button("验证安全存储").click());
    await settle();
    expect(button("下一步").disabled).toBe(true);
    const updated = structuredClone(snapshot);
    updated.permissions.find((item) => item.id === "secureStorage")!.state =
      "granted";
    const readCount = api.read.mock.calls.length;
    await act(async () => resolve(updated));
    await settle();
    expect(
      document
        .querySelector(
          '[data-permission="secureStorage"] [data-permission-state]',
        )
        ?.getAttribute("data-permission-state"),
    ).toBe("granted");
    expect(api.read).toHaveBeenCalledTimes(readCount);
    expect(button("下一步").disabled).toBe(false);
  });
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const)(
    "renders all steps without raw translation keys in %s",
    async (locale) => {
      await changeLimeLocale(locale);
      snapshot.permissions.find((entry) => entry.id === "localNetwork")!.state =
        "onDemand";
      snapshot.permissions.find(
        (entry) => entry.id === "secureStorage",
      )!.state = "denied";
      await mount();
      for (let i = 0; i < 6; i++) {
        expect(
          document.querySelector('[data-testid="permissions-setup"]')
            ?.textContent,
        ).not.toContain("settings.permissionsSetup.");
        if (i < 5) {
          const footer = document.querySelector(
            '[data-testid="permissions-setup"] footer',
          )!;
          act(() =>
            footer
              .querySelector<HTMLButtonElement>("button:last-child")!
              .click(),
          );
          await settle();
        }
      }
      expect(
        document.querySelector('[data-permission="fullDiskAccess"]'),
      ).toBeTruthy();
    },
  );
});
