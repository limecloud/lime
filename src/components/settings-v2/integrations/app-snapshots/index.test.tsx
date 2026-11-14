import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { resetAppSnapshotPreferencesForTest } from "@/lib/appSnapshotPreferences";
import { AppSnapshotsSettings } from ".";

const api = vi.hoisted(() => ({
  read: vi.fn(),
  request: vi.fn(),
  open: vi.fn(),
}));
vi.mock("@/lib/api/desktopPermissions", () => ({
  readDesktopPermissions: api.read,
  requestDesktopPermission: api.request,
  openDesktopPermissionSettings: api.open,
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  resetAppSnapshotPreferencesForTest();
  api.read.mockResolvedValue({
    permissions: [{ id: "screenCapture", state: "granted" }],
  });
  await changeLimeLocale("zh-CN");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<AppSnapshotsSettings />));
  await act(async () => Promise.resolve());
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("AppSnapshotsSettings", () => {
  it("展示双 ⌘ 快捷键与音效开关", async () => {
    const text = container.textContent ?? "";
    expect(text).toContain("快捷键");
    expect(text).toContain("同时按下两个 ⌘ 键");
    expect(text).toContain("⌘ + ⌘");
    expect(text).toContain("播放音效");
    expect(text).toContain("应用快照目标位置");
    expect(text).toContain("Lime 没有 Mini，应用快照会添加到当前聊天");
    const toggle =
      container.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(
      JSON.parse(
        localStorage.getItem("lime.app-snapshots.preferences.v1") ?? "{}",
      ),
    ).toMatchObject({ soundEnabled: false });
  });
});
