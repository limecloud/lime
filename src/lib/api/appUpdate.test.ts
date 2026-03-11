import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  checkForUpdates,
  closeUpdateWindow,
  dismissUpdateNotification,
  downloadUpdate,
  getUpdateCheckSettings,
  getUpdateNotificationMetrics,
  recordUpdateNotificationAction,
  remindUpdateLater,
  setUpdateCheckSettings,
  skipUpdateVersion,
  testUpdateWindow,
} from "./appUpdate";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("appUpdate API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应获取版本信息并下载更新", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({ current: "1.0.0", hasUpdate: false })
      .mockResolvedValueOnce({ success: true, message: "ok" })
      .mockResolvedValueOnce({
        enabled: true,
        check_interval_hours: 24,
        show_notification: true,
        last_check_timestamp: 0,
        skipped_version: null,
        remind_later_until: null,
      })
      .mockResolvedValueOnce({
        shown_count: 1,
        update_now_count: 1,
        remind_later_count: 0,
        skip_version_count: 0,
        dismiss_count: 0,
        update_now_rate: 100,
        remind_later_rate: 0,
        skip_version_rate: 0,
        dismiss_rate: 0,
      });

    await expect(checkForUpdates()).resolves.toEqual(
      expect.objectContaining({ current: "1.0.0" }),
    );
    await expect(downloadUpdate()).resolves.toEqual(
      expect.objectContaining({ success: true }),
    );
    await expect(getUpdateCheckSettings()).resolves.toEqual(
      expect.objectContaining({ enabled: true }),
    );
    await expect(getUpdateNotificationMetrics()).resolves.toEqual(
      expect.objectContaining({ shown_count: 1 }),
    );
  });

  it("应代理更新提醒动作", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(123)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(456)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await expect(closeUpdateWindow()).resolves.toBeUndefined();
    await expect(dismissUpdateNotification("1.2.3")).resolves.toBe(123);
    await expect(
      recordUpdateNotificationAction("update_now"),
    ).resolves.toBeUndefined();
    await expect(remindUpdateLater(24)).resolves.toBe(456);
    await expect(skipUpdateVersion("1.2.3")).resolves.toBeUndefined();
    await expect(
      setUpdateCheckSettings({
        enabled: true,
        check_interval_hours: 24,
        show_notification: true,
        last_check_timestamp: 0,
        skipped_version: null,
        remind_later_until: null,
      }),
    ).resolves.toBeUndefined();
    await expect(testUpdateWindow()).resolves.toBeUndefined();
  });
});
