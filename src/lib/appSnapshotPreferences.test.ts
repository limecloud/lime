import { beforeEach, describe, expect, it } from "vitest";
import {
  getAppSnapshotPreferences,
  resetAppSnapshotPreferencesForTest,
  setAppSnapshotPreferences,
} from "./appSnapshotPreferences";

describe("appSnapshotPreferences", () => {
  beforeEach(() => resetAppSnapshotPreferencesForTest());

  it("默认播放音效并持久化关闭状态", () => {
    expect(getAppSnapshotPreferences()).toEqual({ soundEnabled: true });
    setAppSnapshotPreferences({ soundEnabled: false });
    expect(getAppSnapshotPreferences().soundEnabled).toBe(false);
    expect(
      JSON.parse(
        localStorage.getItem("lime.app-snapshots.preferences.v1") ?? "{}",
      ),
    ).toMatchObject({ soundEnabled: false });
  });
});
