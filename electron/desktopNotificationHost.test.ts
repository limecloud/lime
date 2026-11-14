import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  notificationCtorMock,
  notificationIsSupportedMock,
  notificationOptions,
  notificationShowMock,
} = vi.hoisted(() => {
  const notificationOptions: unknown[] = [];
  const notificationShowMock = vi.fn();
  const notificationCtorMock = vi.fn(function (options: unknown) {
    notificationOptions.push(options);
    return {
      show: notificationShowMock,
    };
  });
  const notificationIsSupportedMock = vi.fn(() => true);
  return {
    notificationCtorMock,
    notificationIsSupportedMock,
    notificationOptions,
    notificationShowMock,
  };
});

vi.mock("./electronRuntime", () => ({
  Notification: Object.assign(notificationCtorMock, {
    isSupported: notificationIsSupportedMock,
  }),
}));

import { showDesktopNotification } from "./desktopNotificationHost";

describe("showDesktopNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationCtorMock.mockImplementation(function (options: unknown) {
      notificationOptions.push(options);
      return {
        show: notificationShowMock,
      };
    });
    notificationIsSupportedMock.mockReturnValue(true);
    notificationOptions.length = 0;
  });

  it("通过 Electron 原生 Notification 发送 summary-only 桌面通知", () => {
    expect(
      showDesktopNotification({
        request: {
          body: " Lime local output · +520 ms ",
          silent: true,
          tag: "claw-trace-regression-alert-123",
          title: " Regression alert: Critical ",
        },
      }),
    ).toEqual({ status: "sent" });

    expect(notificationIsSupportedMock).toHaveBeenCalledOnce();
    expect(notificationCtorMock).toHaveBeenCalledOnce();
    expect(notificationOptions).toEqual([
      {
        body: "Lime local output · +520 ms",
        id: "claw-trace-regression-alert-123",
        silent: true,
        title: "Regression alert: Critical",
      },
    ]);
    expect(notificationShowMock).toHaveBeenCalledOnce();
  });

  it("把受支持的提示音传给 Electron Notification", () => {
    expect(
      showDesktopNotification({
        request: {
          body: "任务已完成",
          sound: "Ping",
          title: "Lime",
        },
      }),
    ).toEqual({ status: "sent" });
    expect(notificationOptions).toEqual([
      { body: "任务已完成", silent: false, sound: "Ping", title: "Lime" },
    ]);
  });

  it("拒绝不支持的提示音且不构造通知", () => {
    expect(() =>
      showDesktopNotification({
        request: {
          body: "任务已完成",
          sound: "../../evil",
          title: "Lime",
        },
      }),
    ).toThrow("不支持的提示音");
    expect(notificationCtorMock).not.toHaveBeenCalled();
  });

  it("桌面通知不支持时返回 unsupported 且不构造通知", () => {
    notificationIsSupportedMock.mockReturnValueOnce(false);

    expect(
      showDesktopNotification({
        request: {
          body: "Lime local output · +520 ms",
          tag: "claw-trace-regression-alert-123",
          title: "Regression alert: Warning",
        },
      }),
    ).toEqual({
      reason: "electron_notification_unsupported",
      status: "unsupported",
    });

    expect(notificationCtorMock).not.toHaveBeenCalled();
    expect(notificationShowMock).not.toHaveBeenCalled();
  });

  it("拒绝 raw trace 和未声明字段", () => {
    expect(() =>
      showDesktopNotification({
        request: {
          body: "summary",
          raw_trace_jsonl: "{}",
          title: "alert",
        },
      }),
    ).toThrow("桌面通知请求包含不支持字段: raw_trace_jsonl");

    expect(notificationCtorMock).not.toHaveBeenCalled();
  });

  it("通知构造或 show 失败时返回 failed", () => {
    notificationCtorMock.mockImplementationOnce(function () {
      throw new Error("notification blocked");
    });

    expect(
      showDesktopNotification({
        request: {
          body: "summary",
          tag: "claw-trace-regression-alert-123",
          title: "alert",
        },
      }),
    ).toEqual({
      reason: "notification blocked",
      status: "failed",
    });
  });
});
