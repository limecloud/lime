import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import {
  UPDATE_INSTALL_SESSION_EVENT,
  checkForUpdates,
  closeUpdateWindow,
  dismissUpdateNotification,
  downloadUpdate,
  getUpdateInstallSession,
  getUpdateCheckSettings,
  isUpdateInstallSessionActive,
  listenUpdateInstallSession,
  openUpdateWindow,
  recordUpdateNotificationAction,
  remindUpdateLater,
  skipUpdateVersion,
  startUpdateInstallSession,
} from "./appUpdate";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
  safeListen: vi.fn(),
}));

describe("appUpdate API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(safeListen).mockResolvedValue(vi.fn());
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
  });

  it("检查更新收到非版本信息时应 fail closed", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({ success: true });

    await expect(checkForUpdates()).rejects.toThrow(
      "check_for_updates did not return version info",
    );
  });

  it("自动检查更新应透传 automatic 标记", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      current: "1.0.0",
      hasUpdate: false,
    });

    await expect(checkForUpdates({ automatic: true })).resolves.toEqual(
      expect.objectContaining({ current: "1.0.0", hasUpdate: false }),
    );

    expect(safeInvoke).toHaveBeenCalledWith("check_for_updates", {
      automatic: true,
    });
  });

  it("下载更新收到非下载结果时应 fail closed", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({ success: true });

    await expect(downloadUpdate()).rejects.toThrow(
      "download_update did not return a download result",
    );
  });

  it("更新设置收到非设置对象时应 fail closed", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({ enabled: true });

    await expect(getUpdateCheckSettings()).rejects.toThrow(
      "get_update_check_settings did not return update check settings",
    );
  });

  it("检查更新遇到 Electron degraded diagnostic facade 时应 fail closed", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      diagnostic: {
        command: "check_for_updates",
        category: "electron-diagnostic-facade",
        source: "electron-host-diagnostic",
        status: "degraded",
      },
    });

    await expect(checkForUpdates()).rejects.toThrow(
      "check_for_updates 尚未接入真实 updater current 通道，收到 electron-host-diagnostic 诊断返回。",
    );
  });

  it("更新设置遇到 Electron empty diagnostic list 时应 fail closed", async () => {
    const diagnosticList: unknown[] = [];
    Object.defineProperty(diagnosticList, "__diagnostic", {
      value: {
        command: "get_update_check_settings",
        source: "electron-empty-diagnostic",
        status: "degraded",
      },
      enumerable: false,
    });

    vi.mocked(safeInvoke).mockResolvedValueOnce(diagnosticList);

    await expect(getUpdateCheckSettings()).rejects.toThrow(
      "get_update_check_settings 尚未接入真实 updater current 通道，收到 electron-empty-diagnostic 诊断返回。",
    );
  });

  it("更新窗口命令遇到 Electron degraded diagnostic facade 时应 fail closed", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      diagnostic: {
        command: "open_update_window",
        source: "electron-host-diagnostic",
        status: "degraded",
      },
    });

    await expect(openUpdateWindow()).rejects.toThrow(
      "open_update_window 尚未接入真实 updater current 通道，收到 electron-host-diagnostic 诊断返回。",
    );
  });

  it("应代理更新提醒动作", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(123)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(456)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await expect(closeUpdateWindow()).resolves.toBeUndefined();
    await expect(openUpdateWindow()).resolves.toBeUndefined();
    await expect(dismissUpdateNotification("1.2.3")).resolves.toBe(123);
    await expect(
      recordUpdateNotificationAction("update_now"),
    ).resolves.toBeUndefined();
    await expect(remindUpdateLater(24)).resolves.toBe(456);
    await expect(skipUpdateVersion("1.2.3")).resolves.toBeUndefined();
    expect(safeInvoke).toHaveBeenNthCalledWith(2, "open_update_window");
  });

  it("更新提醒数值命令收到非 number 时应 fail closed", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({ dismissed: true });

    await expect(dismissUpdateNotification("1.2.3")).rejects.toThrow(
      "dismiss_update_notification did not return a finite number",
    );
  });

  it("更新 side-effect 命令收到 mock-like payload 时应 fail closed", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ error: "failed" });

    await expect(openUpdateWindow()).rejects.toThrow(
      "open_update_window did not return void result",
    );
    await expect(recordUpdateNotificationAction("dismiss")).rejects.toThrow(
      "record_update_notification_action did not return void result",
    );
    await expect(skipUpdateVersion("1.2.3")).rejects.toThrow(
      "skip_update_version did not return void result",
    );
  });

  it("打开更新提醒窗口时应传递更新按钮锚点矩形", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce(null);

    await expect(
      openUpdateWindow({ x: 18.4, y: 816.2, width: 30.1, height: 30 }),
    ).resolves.toBeUndefined();

    expect(safeInvoke).toHaveBeenCalledWith("open_update_window", {
      anchorRect: { x: 18, y: 816, width: 30, height: 30 },
    });
  });

  it("应代理更新安装会话命令和事件", async () => {
    const session = {
      sessionId: "session-1",
      stage: "downloading",
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      downloadUrl: "https://example.com/release",
      downloadedBytes: 50,
      totalBytes: 100,
      percent: 0.5,
      message: "downloading",
      error: null,
      startedAt: 1,
      updatedAt: 2,
      completedAt: null,
      canCloseWindow: true,
      isActive: true,
    } as const;

    vi.mocked(safeInvoke)
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce({ ...session, stage: "idle", isActive: false });

    await expect(startUpdateInstallSession()).resolves.toEqual(session);
    await expect(getUpdateInstallSession()).resolves.toEqual(
      expect.objectContaining({ stage: "idle" }),
    );
    expect(safeInvoke).toHaveBeenNthCalledWith(
      1,
      "start_update_install_session",
    );
    expect(safeInvoke).toHaveBeenNthCalledWith(2, "get_update_install_session");
    expect(isUpdateInstallSessionActive(session)).toBe(true);
    expect(isUpdateInstallSessionActive({ ...session, stage: "failed" })).toBe(
      false,
    );

    const handler = vi.fn();
    await listenUpdateInstallSession(handler);
    expect(safeListen).toHaveBeenCalledWith(
      UPDATE_INSTALL_SESSION_EVENT,
      expect.any(Function),
    );

    const bridgeHandler = vi.mocked(safeListen).mock.calls.at(-1)?.[1];
    bridgeHandler?.({ payload: session });
    expect(handler).toHaveBeenCalledWith(session);
  });

  it("更新安装会话收到非 session 对象时应 fail closed", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      sessionId: "session-1",
      stage: "downloading",
    });

    await expect(startUpdateInstallSession()).rejects.toThrow(
      "start_update_install_session did not return an update install session",
    );
  });
});
