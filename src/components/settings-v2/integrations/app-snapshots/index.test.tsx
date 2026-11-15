import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { resetAppSnapshotPreferencesForTest } from "@/lib/appSnapshotPreferences";
import { AppSnapshotsSettings } from ".";

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  resetAppSnapshotPreferencesForTest();
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
  it("展示快捷键、目标位置与两个开关", () => {
    const text = container.textContent ?? "";
    expect(text).toContain("快捷键");
    expect(text).toContain("同时按下两个 ⌘ 键");
    expect(text).toContain("⌘ + ⌘");
    expect(text).toContain("播放音效");
    expect(text).toContain("应用快照目标位置");
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(2);
  });

  it("切换快捷键与音效开关会持久化", async () => {
    const [hotkey, sound] = [
      ...container.querySelectorAll<HTMLButtonElement>('[role="switch"]'),
    ];
    await act(async () => hotkey.click());
    await act(async () => sound.click());
    expect(
      JSON.parse(
        localStorage.getItem("lime.app-snapshots.preferences.v1") ?? "{}",
      ),
    ).toMatchObject({ hotkeyEnabled: true, soundEnabled: false });
  });
});
