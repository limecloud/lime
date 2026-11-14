import { beforeEach, describe, expect, it } from "vitest";
import {
  getAppSnapshotPreferences,
  resetAppSnapshotPreferencesForTest,
  setAppSnapshotPreferences,
} from "./appSnapshotPreferences";

describe("appSnapshotPreferences", () => {
  beforeEach(() => resetAppSnapshotPreferencesForTest());

  it("默认播放音效、关闭快捷键并持久化音效关闭状态", () => {
    expect(getAppSnapshotPreferences()).toEqual({
      soundEnabled: true,
      hotkeyEnabled: false,
    });
    setAppSnapshotPreferences({ soundEnabled: false });
    expect(getAppSnapshotPreferences().soundEnabled).toBe(false);
    expect(
      JSON.parse(
        localStorage.getItem("lime.app-snapshots.preferences.v1") ?? "{}",
      ),
    ).toMatchObject({ soundEnabled: false });
  });

  it("开启快捷键时保留音效偏好并持久化", () => {
    setAppSnapshotPreferences({ soundEnabled: false });
    setAppSnapshotPreferences({ hotkeyEnabled: true });
    expect(getAppSnapshotPreferences()).toEqual({
      soundEnabled: false,
      hotkeyEnabled: true,
    });
    expect(
      JSON.parse(
        localStorage.getItem("lime.app-snapshots.preferences.v1") ?? "{}",
      ),
    ).toEqual({ soundEnabled: false, hotkeyEnabled: true });
  });
});
