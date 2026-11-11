import {
  existsSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  removeWindowsNotificationShortcut,
  resolveWindowsSquirrelStartupPlan,
} from "./windowsSquirrelStartup";

const EXECUTABLE =
  "C:\\Users\\runner\\AppData\\Local\\lime\\app-1.2.3\\Lime.exe";
const APP_DATA = "C:\\Users\\runner\\AppData\\Roaming";
const APP_USER_MODEL_ID = "com.limecloud.lime";
const NOTIFICATION_SHORTCUT =
  "C:\\Users\\runner\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Lime.lnk";

function notificationShortcutFixture(
  shortcut: { target: string; args: string; appUserModelId?: string } = {
    target: EXECUTABLE,
    args: "",
    appUserModelId: APP_USER_MODEL_ID,
  },
) {
  const readShortcutLink = vi.fn(() => shortcut);
  const shortcutExists = vi.fn(() => true);
  const unlinkShortcut = vi.fn();
  const onError = vi.fn();
  const remove = () =>
    removeWindowsNotificationShortcut({
      appDataPath: APP_DATA,
      execPath: EXECUTABLE,
      appUserModelId: APP_USER_MODEL_ID,
      readShortcutLink,
      shortcutExists,
      unlinkShortcut,
      onError,
    });
  return { readShortcutLink, shortcutExists, unlinkShortcut, onError, remove };
}

describe("Windows notification shortcut uninstall", () => {
  it.each([
    EXECUTABLE,
    "C:\\Users\\runner\\AppData\\Local\\lime\\Lime.exe",
    "C:\\Users\\runner\\AppData\\Local\\lime\\app-1.0.0\\Lime.exe",
    "c:/users/runner/appdata/local/LIME/app-1.0.0/lime.EXE",
  ])("卸载当前安装拥有的通知快捷方式：%s", (target) => {
    const fixture = notificationShortcutFixture({
      target,
      args: "",
      appUserModelId: APP_USER_MODEL_ID,
    });

    expect(fixture.remove()).toBe(true);
    expect(fixture.readShortcutLink).toHaveBeenCalledExactlyOnceWith(
      NOTIFICATION_SHORTCUT,
    );
    expect(fixture.unlinkShortcut).toHaveBeenCalledExactlyOnceWith(
      NOTIFICATION_SHORTCUT,
    );
    expect(fixture.onError).not.toHaveBeenCalled();
  });

  it.each([
    "C:\\Users\\runner\\AppData\\Local\\lime-other\\app-1.2.3\\Lime.exe",
    "C:\\Users\\other\\AppData\\Local\\lime\\app-1.2.3\\Lime.exe",
    "C:\\Users\\runner\\AppData\\Local\\lime\\app-1.2.3\\Other.exe",
    "C:\\Users\\runner\\AppData\\Local\\lime\\app-1.2.3\\nested\\Lime.exe",
    "C:\\Users\\runner\\AppData\\Local\\lime\\other\\Lime.exe",
    "C:\\Users\\runner\\AppData\\Local\\lime\\app-1.2.3\\..\\..\\Lime.exe",
    "app-1.2.3\\Lime.exe",
  ])("保留异名或不属于当前安装的目标：%s", (target) => {
    const fixture = notificationShortcutFixture({
      target,
      args: "",
      appUserModelId: APP_USER_MODEL_ID,
    });

    expect(fixture.remove()).toBe(false);
    expect(fixture.unlinkShortcut).not.toHaveBeenCalled();
  });

  it.each([undefined, "com.other.app", "com.limecloud.lime.other"])(
    "保留 AUMID 不匹配的快捷方式：%s",
    (appUserModelId) => {
      const fixture = notificationShortcutFixture({
        target: EXECUTABLE,
        args: "",
        appUserModelId,
      });

      expect(fixture.remove()).toBe(false);
      expect(fixture.unlinkShortcut).not.toHaveBeenCalled();
    },
  );

  it("保留带参数的快捷方式并记录原因", () => {
    const fixture = notificationShortcutFixture({
      target: EXECUTABLE,
      args: "--profile=other",
      appUserModelId: APP_USER_MODEL_ID,
    });

    expect(fixture.remove()).toBe(false);
    expect(fixture.unlinkShortcut).not.toHaveBeenCalled();
    expect(fixture.onError).toHaveBeenCalledOnce();
  });

  it("缺失快捷方式时不读取或删除其他路径", () => {
    const fixture = notificationShortcutFixture();
    fixture.shortcutExists.mockReturnValue(false);

    expect(fixture.remove()).toBe(false);
    expect(fixture.readShortcutLink).not.toHaveBeenCalled();
    expect(fixture.unlinkShortcut).not.toHaveBeenCalled();
    expect(fixture.onError).not.toHaveBeenCalled();
  });

  it.each(["read", "unlink"])("忽略 %s 时并发消失的 ENOENT", (stage) => {
    const fixture = notificationShortcutFixture();
    const action =
      stage === "read" ? fixture.readShortcutLink : fixture.unlinkShortcut;
    action.mockImplementation(() => {
      throw Object.assign(new Error("missing shortcut"), { code: "ENOENT" });
    });

    expect(fixture.remove()).toBe(false);
    expect(fixture.onError).not.toHaveBeenCalled();
  });

  it.each(["read", "unlink"])(
    "记录 %s 失败并继续 Squirrel 生命周期",
    (stage) => {
      const fixture = notificationShortcutFixture();
      const action =
        stage === "read" ? fixture.readShortcutLink : fixture.unlinkShortcut;
      const error = new Error("shortcut unavailable");
      action.mockImplementation(() => {
        throw error;
      });

      expect(fixture.remove()).toBe(false);
      expect(fixture.onError).toHaveBeenCalledExactlyOnceWith(error);
    },
  );

  it("校验通过后实际移除链接文件，保留其他同目录文件", () => {
    const directory = mkdtempSync(
      path.join(os.tmpdir(), "lime-shortcut-uninstall-"),
    );
    const owned = path.join(directory, "Lime.lnk");
    const unrelated = path.join(directory, "Other.lnk");
    writeFileSync(owned, "notification shortcut");
    writeFileSync(unrelated, "unrelated shortcut");
    const fixture = notificationShortcutFixture();
    fixture.unlinkShortcut.mockImplementation((shortcutPath: string) => {
      expect(shortcutPath).toBe(NOTIFICATION_SHORTCUT);
      unlinkSync(owned);
    });
    try {
      expect(fixture.remove()).toBe(true);
      expect(existsSync(owned)).toBe(false);
      expect(existsSync(unrelated)).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("Windows Squirrel startup", () => {
  it.each(["--squirrel-install", "--squirrel-updated"])(
    "%s 使用 Squirrel 要求的独立 shortcut 参数",
    (command) => {
      expect(
        resolveWindowsSquirrelStartupPlan({
          argv: [EXECUTABLE, command],
          execPath: EXECUTABLE,
          platform: "win32",
        }),
      ).toEqual({
        action: "run-update",
        args: ["--createShortcut", "Lime.exe"],
        updateExecutable: "C:\\Users\\runner\\AppData\\Local\\lime\\Update.exe",
      });
    },
  );

  it("卸载事件移除 shortcut", () => {
    expect(
      resolveWindowsSquirrelStartupPlan({
        argv: [EXECUTABLE, "--squirrel-uninstall"],
        execPath: EXECUTABLE,
        platform: "win32",
      }),
    ).toMatchObject({
      action: "run-update",
      args: ["--removeShortcut", "Lime.exe"],
    });
  });

  it("obsolete 事件只退出，不启动 Update.exe", () => {
    expect(
      resolveWindowsSquirrelStartupPlan({
        argv: [EXECUTABLE, "--squirrel-obsolete"],
        execPath: EXECUTABLE,
        platform: "win32",
      }),
    ).toEqual({ action: "quit" });
  });

  it("非 Squirrel 启动和非 Windows 平台不接管正常启动", () => {
    expect(
      resolveWindowsSquirrelStartupPlan({
        argv: [EXECUTABLE],
        execPath: EXECUTABLE,
        platform: "win32",
      }),
    ).toBeNull();
    expect(
      resolveWindowsSquirrelStartupPlan({
        argv: [EXECUTABLE, "--squirrel-install"],
        execPath: EXECUTABLE,
        platform: "darwin",
      }),
    ).toBeNull();
  });
});
