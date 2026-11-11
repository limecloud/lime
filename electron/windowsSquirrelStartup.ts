import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";

/** Electron's notification registration creates this link outside Squirrel's product folder. */
export function removeWindowsNotificationShortcut({
  appDataPath,
  execPath,
  appUserModelId,
  readShortcutLink,
  shortcutExists = existsSync,
  unlinkShortcut = unlinkSync,
  onError,
}: {
  appDataPath: string;
  execPath: string;
  appUserModelId: string;
  readShortcutLink(shortcutPath: string): {
    target: string;
    args?: string;
    appUserModelId?: string;
  };
  shortcutExists?(shortcutPath: string): boolean;
  unlinkShortcut?(shortcutPath: string): void;
  onError(error: unknown): void;
}): boolean {
  const shortcutPath = path.win32.join(
    appDataPath,
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Lime.lnk",
  );
  try {
    if (!shortcutExists(shortcutPath)) return false;
    const shortcut = readShortcutLink(shortcutPath);
    const installRoot = path.win32.resolve(path.win32.dirname(execPath), "..");
    const target = path.win32.resolve(shortcut.target);
    const targetDirectory = path.win32.dirname(target);
    const samePath = (left: string, right: string) =>
      left.toLowerCase() === right.toLowerCase();
    const ownedTarget =
      path.win32.isAbsolute(shortcut.target) &&
      path.win32.basename(target).toLowerCase() === "lime.exe" &&
      (samePath(targetDirectory, installRoot) ||
        (samePath(path.win32.dirname(targetDirectory), installRoot) &&
          /^app-.+$/i.test(path.win32.basename(targetDirectory))));
    if (
      shortcut.appUserModelId !== appUserModelId ||
      shortcut.args !== "" ||
      !ownedTarget
    ) {
      onError(
        new Error(
          "Preserving notification shortcut with a different application identity, arguments, or installation",
        ),
      );
      return false;
    }
    unlinkShortcut(shortcutPath);
    return true;
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") onError(error);
    return false;
  }
}

export type WindowsSquirrelStartupPlan =
  | {
      action: "run-update";
      args: ["--createShortcut" | "--removeShortcut", string];
      updateExecutable: string;
    }
  | { action: "quit" };

export function resolveWindowsSquirrelStartupPlan({
  argv,
  execPath,
  platform,
}: {
  argv: string[];
  execPath: string;
  platform: string;
}): WindowsSquirrelStartupPlan | null {
  if (platform !== "win32") {
    return null;
  }

  const command = argv[1];
  const executableName = path.win32.basename(execPath);
  const updateExecutable = path.win32.resolve(
    path.win32.dirname(execPath),
    "..",
    "Update.exe",
  );

  if (command === "--squirrel-install" || command === "--squirrel-updated") {
    return {
      action: "run-update",
      args: ["--createShortcut", executableName],
      updateExecutable,
    };
  }
  if (command === "--squirrel-uninstall") {
    return {
      action: "run-update",
      args: ["--removeShortcut", executableName],
      updateExecutable,
    };
  }
  if (command === "--squirrel-obsolete") {
    return { action: "quit" };
  }

  return null;
}
