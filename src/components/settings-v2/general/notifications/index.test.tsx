import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { resetNotificationPreferencesForTest } from "@/lib/notificationPreferences";
import { NotificationsSettings } from ".";

const api = vi.hoisted(() => ({
  read: vi.fn(),
  open: vi.fn(),
  pickDirectory: vi.fn(),
}));
vi.mock("@/lib/api/desktopPermissions", () => ({
  readDesktopPermissions: api.read,
  openDesktopPermissionSettings: api.open,
  requestDesktopPermission: vi.fn(),
}));
vi.mock("@/lib/api/filePicker", () => ({
  pickFilesFromDialog: api.pickDirectory,
}));

let root: Root;
let container: HTMLDivElement;

async function mount() {
  await act(async () => root.render(<NotificationsSettings />));
  await act(async () => Promise.resolve());
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  resetNotificationPreferencesForTest();
  api.read.mockResolvedValue({
    permissions: [{ id: "notifications", state: "granted" }],
  });
  await changeLimeLocale("zh-CN");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await mount();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("NotificationsSettings", () => {
  it("系统权限关闭时禁用选项并可打开系统设置", async () => {
    api.read.mockResolvedValue({
      permissions: [{ id: "notifications", state: "denied" }],
    });
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount();
    const system = container.querySelector<HTMLElement>(
      '[data-settings-search-target="general-system-notifications"]',
    )!;
    expect(system.textContent).toContain("通知已关闭");
    const turn = container.querySelector<HTMLButtonElement>(
      '[data-settings-search-target="general-turn-notifications"] button',
    )!;
    expect(turn.disabled).toBe(true);
    await act(async () => system.querySelector("button")!.click());
    expect(api.open).toHaveBeenCalledWith("notifications");
  });

  it("权限开启时提供 Codex 提示音", async () => {
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-settings-search-target="general-notification-sound"] button',
    )!;
    expect(trigger.textContent).toContain("默认");
    await act(async () =>
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
    );
    const options = [
      ...document.querySelectorAll<HTMLElement>("[role=menuitemradio]"),
    ].map((item) => item.textContent?.trim());
    expect(options).toEqual([
      "默认",
      "经典",
      "无",
      "Basso",
      "Glass",
      "Ping",
      "Pop",
      "Purr",
      "Tink",
      "自定义提示音…",
    ]);
  });
});
