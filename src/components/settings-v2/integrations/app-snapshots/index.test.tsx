import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { AppNavigationContext } from "@/contexts/AppNavigationContext";
import { resetAppSnapshotPreferencesForTest } from "@/lib/appSnapshotPreferences";
import {
  getPendingAppSnapshot,
  resetPendingAppSnapshotForTest,
} from "@/lib/pendingAppSnapshot";
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

const snapshotApi = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/api/appSnapshots", () => ({
  listAppSnapshotWindows: snapshotApi.list,
}));

const toastApi = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastApi }));

const navigate = vi.hoisted(() => vi.fn());

const windows = [
  {
    id: "window-1",
    name: "Editor",
    thumbnail: "data:image/png;base64,ZmFrZQ==",
  },
  {
    id: "window-2",
    name: "Browser",
    thumbnail: "data:image/png;base64,b3RoZXI=",
  },
];

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  resetAppSnapshotPreferencesForTest();
  resetPendingAppSnapshotForTest();
  api.read.mockResolvedValue({
    permissions: [
      { id: "screenCapture", state: "granted" },
      { id: "accessibility", state: "granted" },
    ],
  });
  snapshotApi.list.mockResolvedValue(windows);
  await changeLimeLocale("zh-CN");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <AppNavigationContext.Provider value={navigate}>
        <AppSnapshotsSettings />
      </AppNavigationContext.Provider>,
    ),
  );
  await act(async () => Promise.resolve());
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  resetPendingAppSnapshotForTest();
});

async function loadWindows() {
  const refresh = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "刷新窗口",
  );
  expect(refresh).toBeDefined();
  await act(async () => {
    refresh?.click();
    await Promise.resolve();
  });
}

function addToChatButtons() {
  return Array.from(container.querySelectorAll("button")).filter(
    (button) => button.textContent === "添加到聊天",
  );
}

describe("AppSnapshotsSettings", () => {
  it("展示双 ⌘ 快捷键与音效开关", async () => {
    const text = container.textContent ?? "";
    expect(text).toContain("快捷键");
    expect(text).toContain("同时按下两个 ⌘ 键");
    expect(text).toContain("⌘ + ⌘");
    expect(text).toContain("播放音效");
    expect(text).toContain("辅助功能");
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

  it("每个窗口都能把快照加入聊天并导航到新聊天", async () => {
    await loadWindows();
    const buttons = addToChatButtons();
    expect(buttons).toHaveLength(2);

    await act(async () => {
      buttons[0]?.click();
      await Promise.resolve();
    });

    expect(snapshotApi.list).toHaveBeenCalledOnce();
    expect(getPendingAppSnapshot()).toEqual({
      dataUrl: "data:image/png;base64,ZmFrZQ==",
      windowName: "Editor",
    });
    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({ agentEntry: "new-task" }),
    );
    expect(toastApi.success).toHaveBeenCalledWith("已添加，正在打开新聊天");
  });

  it("不同窗口写入各自的快照", async () => {
    await loadWindows();
    const buttons = addToChatButtons();

    await act(async () => {
      buttons[1]?.click();
      await Promise.resolve();
    });

    expect(getPendingAppSnapshot()).toEqual({
      dataUrl: "data:image/png;base64,b3RoZXI=",
      windowName: "Browser",
    });
    expect(navigate).toHaveBeenCalledOnce();
  });
});
