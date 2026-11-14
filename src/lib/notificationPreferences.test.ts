import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getNotificationPreferences,
  notificationSoundRequest,
  resetNotificationPreferencesForTest,
  setNotificationPreferences,
  subscribeNotificationPreferences,
} from "./notificationPreferences";

describe("notificationPreferences", () => {
  beforeEach(() => resetNotificationPreferencesForTest());

  it("defaults to unfocused turn notifications with sound", () => {
    expect(getNotificationPreferences()).toEqual({
      turnComplete: "unfocused",
      permissions: true,
      questions: true,
      sound: "default",
    });
  });

  it("migrates legacy boolean sound preferences", async () => {
    window.localStorage.setItem(
      "lime.notifications.preferences.v1",
      JSON.stringify({
        turnComplete: "always",
        permissions: true,
        questions: true,
        sound: false,
      }),
    );
    vi.resetModules();
    const fresh = await import("./notificationPreferences");
    expect(fresh.getNotificationPreferences().sound).toBe("none");
  });

  it("custom 提示音由渲染端播放且系统通知静音", () => {
    setNotificationPreferences({ sound: "custom" });
    expect(getNotificationPreferences().sound).toBe("custom");
    expect(notificationSoundRequest("custom")).toEqual({ silent: true });
    expect(notificationSoundRequest("none")).toEqual({ silent: true });
    expect(notificationSoundRequest("default")).toEqual({});
    expect(notificationSoundRequest("Ping")).toEqual({ sound: "Ping" });
    expect(notificationSoundRequest("classic")).toEqual({ silent: true });
    setNotificationPreferences({ sound: "classic" });
    expect(getNotificationPreferences().sound).toBe("classic");
  });

  it("persists mode and sound and notifies subscribers", () => {
    const listener = vi.fn();
    const stop = subscribeNotificationPreferences(listener);
    setNotificationPreferences({ turnComplete: "always", sound: "Ping" });
    expect(getNotificationPreferences()).toEqual({
      turnComplete: "always",
      permissions: true,
      questions: true,
      sound: "Ping",
    });
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });
});
