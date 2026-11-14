/* eslint-disable no-redeclare */
/* global process */
import type { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import type * as Electron from "electron";

const requireElectron = createRequire(import.meta.url);
const electron = requireElectron("electron") as typeof Electron;

// macOS credentials use LocalCredentialEncryption. Chromium's unused async
// provider otherwise requests the "Lime Safe Storage" key during startup.
if (process.platform === "darwin") {
  const disabledFeatures = new Set(
    electron.app.commandLine
      .getSwitchValue("disable-features")
      .split(",")
      .filter(Boolean),
  );
  disabledFeatures.add("UseKeychainKeyProvider");
  electron.app.commandLine.appendSwitch(
    "disable-features",
    [...disabledFeatures].join(","),
  );
}

export const {
  app,
  autoUpdater,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  net,
  powerMonitor,
  powerSaveBlocker,
  screen,
  session,
  shell,
  systemPreferences,
  protocol,
  Tray,
  WebContentsView,
} = electron;

// Reading Electron's safeStorage getter initializes OS encryption at app ready.
// Keep it lazy so importing the host does not access the macOS keychain.
export const safeStorage = {
  isEncryptionAvailable: () => electron.safeStorage.isEncryptionAvailable(),
  encryptString: (plainText: string) =>
    electron.safeStorage.encryptString(plainText),
  decryptString: (encrypted: Buffer) =>
    electron.safeStorage.decryptString(encrypted),
};

export type BrowserWindow = Electron.BrowserWindow;
export type Menu = Electron.Menu;
export type Rectangle = Electron.Rectangle;
export type Tray = Electron.Tray;
export type WebContentsView = Electron.WebContentsView;

export type {
  IpcMainInvokeEvent,
  MenuItemConstructorOptions,
  NotificationConstructorOptions,
  OpenDialogOptions,
  SaveDialogOptions,
} from "electron";
