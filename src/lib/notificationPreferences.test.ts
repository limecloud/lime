import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getNotificationPreferences,
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
      sound: true,
    });
  });

  it("persists mode and sound and notifies subscribers", () => {
    const listener = vi.fn();
    const stop = subscribeNotificationPreferences(listener);
    setNotificationPreferences({ turnComplete: "always", sound: false });
    expect(getNotificationPreferences()).toEqual({
      turnComplete: "always",
      permissions: true,
      questions: true,
      sound: false,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });
});
