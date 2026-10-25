import { stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, shell } from "./electronRuntime";
import { FileTargetPreferences } from "./fileTargetPreferences";
import {
  discoverFileTargets,
  openMacFile,
  type NativeFileQuery,
  type FileTargetPlatform,
} from "./fileTargets";
import type { OpenInTarget, OpenInTargets } from "../src/lib/api/openInTypes";

type HostArgs = Record<string, unknown> | null | undefined;
type OpenFilePreviewWindowResult = {
  opened: true;
  reused: boolean;
  url: string;
  title: string;
};

// Keep macOS IconServices reads and image conversion in the same serial queue.
let fileIconQueue: Promise<void> = Promise.resolve();

export class FileShellHost {
  readonly #preferences: FileTargetPreferences;
  readonly #nativeQuery?: NativeFileQuery;
  readonly #platform: FileTargetPlatform;

  constructor(
    options: {
      appDataRoot?: string;
      nativeQuery?: NativeFileQuery;
      platform?: FileTargetPlatform;
    } = {},
  ) {
    this.#preferences = new FileTargetPreferences(
      options.appDataRoot ?? app.getPath("userData"),
    );
    this.#nativeQuery = options.nativeQuery;
    this.#platform = options.platform ?? process.platform;
  }

  async getTargets(args: HostArgs): Promise<OpenInTargets> {
    const request = readLocalRequest(args);
    const targetPath =
      readLocalPath(request, "path") ?? readLocalPath(request, "cwd");
    const cwd = readLocalPath(request, "cwd");
    const { targets, discovery } = await discoverFileTargets(
      targetPath,
      this.#platform,
      this.#nativeQuery,
    );
    if (request.deferEnrichment !== true) {
      await Promise.all(
        targets.map(async (target) => {
          if (target.appPath)
            target.icon = await this.getFileIconDataUrl({
              path: target.appPath,
            });
        }),
      );
    }
    const preferences = await this.#preferences.read();
    const preferred =
      (cwd ? preferences.perPath?.[cwd] : null) ?? preferences.global ?? null;
    return {
      targets,
      availableTargets: targets
        .filter((target) => target.available)
        .map((target) => target.id),
      preferredTarget: targets.some(
        (target) => target.id === preferred && target.available,
      )
        ? preferred
        : null,
      mode: "native",
      discovery,
    };
  }

  async detectTarget(args: HostArgs): Promise<OpenInTarget | null> {
    const request = readLocalRequest(args);
    const target = readRequiredString(request, "target");
    const appPath = readLocalPath(request, "appPath");
    if (target !== "systemDefault" && target !== "fileManager")
      throw new Error("Unsupported open-in target");
    if (appPath && target !== "systemDefault")
      throw new Error("Invalid native target");
    const snapshot = await this.getTargets({
      ...request,
      deferEnrichment: true,
    });
    return (
      snapshot.targets.find(
        (entry) =>
          entry.target === target &&
          (entry.appPath ?? null) === appPath &&
          entry.available,
      ) ?? null
    );
  }

  async loadTargetIcon(args: HostArgs): Promise<string | null> {
    const target = await this.detectTarget(args);
    return target?.appPath
      ? this.getFileIconDataUrl({ path: target.appPath })
      : null;
  }

  async open(args: HostArgs): Promise<Record<string, never>> {
    const request = readLocalRequest(args);
    const targetPath = readLocalPath(request, "path");
    if (!targetPath) throw new Error("Missing required string field: path");
    if (
      request.openMode != null &&
      request.openMode !== "file" &&
      request.openMode !== "workspace"
    )
      throw new Error("Invalid open mode");
    const preferencePath = readLocalPath(request, "persistPreferredTargetPath");
    const target = await this.detectTarget(request);
    if (!target) throw new Error("The requested application is unavailable");
    if (target.target === "fileManager") {
      await this.revealInFinder({ path: targetPath });
    } else if (this.#platform === "darwin") {
      await openMacFile(targetPath, target.appPath);
    } else {
      const errorMessage = await shell.openPath(targetPath);
      if (errorMessage) throw new Error(errorMessage);
    }
    if (preferencePath)
      await this.#preferences.write(target.id, preferencePath);
    return {};
  }

  async setGlobalPreferredTarget(
    args: HostArgs,
  ): Promise<Record<string, never>> {
    const target = await this.detectTarget(args);
    if (!target) throw new Error("The requested application is unavailable");
    await this.#preferences.write(target.id, null);
    return {};
  }

  async openFilePreviewWindow(
    args: HostArgs,
  ): Promise<OpenFilePreviewWindowResult> {
    const request = readRequest(args);
    const targetPath = readRequiredAbsolutePath(request, "path");
    const requestedTitle = readString(request, "title");
    const title = requestedTitle || path.basename(targetPath) || targetPath;
    const url = pathToFileURL(targetPath).toString();
    return openFilePreviewBrowserWindow(url, title);
  }

  async revealInFinder(args: HostArgs): Promise<Record<string, never>> {
    const request = readRequest(args);
    const targetPath = readRequiredString(request, "path");

    if (await isFile(targetPath)) {
      shell.showItemInFolder(targetPath);
      return {};
    }

    const errorMessage = await shell.openPath(targetPath);
    if (errorMessage) {
      throw new Error(errorMessage);
    }
    return {};
  }

  async getFileIconDataUrl(args: HostArgs): Promise<string | null> {
    const request = readRequest(args);
    const targetPath = readRequiredString(request, "path");
    const read = async () => {
      try {
        const icon = await app.getFileIcon(targetPath, { size: "normal" });
        if (icon.isEmpty()) return null;
        return icon.toDataURL() || null;
      } catch {
        return null;
      }
    };
    if (this.#platform !== "darwin") return read();
    const pending = fileIconQueue.then(read);
    fileIconQueue = pending.then(() => undefined);
    return pending;
  }

  getHomeDir(): string {
    const homePath = readElectronPath("home");
    if (!homePath) {
      throw new Error("无法获取主目录");
    }
    return homePath;
  }
}

function openFilePreviewBrowserWindow(
  url: string,
  title: string,
): OpenFilePreviewWindowResult {
  const existing = BrowserWindow.getAllWindows().find(
    (window) => window.webContents.getURL() === url,
  );
  const targetWindow =
    existing ??
    new BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: 860,
      minHeight: 560,
      title,
      show: false,
      backgroundColor: "#f8fafc",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

  if (!existing) {
    void targetWindow.loadURL(url);
    targetWindow.once("ready-to-show", () => {
      targetWindow.show();
    });
  } else {
    targetWindow.show();
  }
  targetWindow.focus();

  return {
    opened: true,
    reused: Boolean(existing),
    url,
    title,
  };
}

function readRequest(value: unknown): Record<string, unknown> {
  return readRecord(value, "request") ?? toRecord(value) ?? {};
}

function readLocalRequest(value: unknown): Record<string, unknown> {
  const request = readRequest(value);
  if (request.hostId != null && request.hostId !== "local")
    throw new Error("Remote open-in targets require a host transport");
  return request;
}

function readLocalPath(
  request: Record<string, unknown>,
  key: string,
): string | null {
  if (request[key] == null) return null;
  const value = readRequiredAbsolutePath(request, key);
  if (value.includes("\0")) throw new Error(`Invalid path: ${key}`);
  return value;
}

function readRecord(
  value: unknown,
  key: string,
): Record<string, unknown> | null {
  const record = toRecord(value);
  if (!record) {
    return null;
  }
  const next = record[key];
  return next && typeof next === "object" && !Array.isArray(next)
    ? (next as Record<string, unknown>)
    : null;
}

function readRequiredString(value: unknown, key: string): string {
  const next = readString(value, key);
  if (!next) {
    throw new Error(`Missing required string field: ${key}`);
  }
  return next;
}

function readRequiredAbsolutePath(value: unknown, key: string): string {
  const next = readRequiredString(value, key);
  if (!path.isAbsolute(next)) {
    throw new Error(`${key} 必须是绝对路径`);
  }
  return next;
}

function readString(value: unknown, key: string): string | null {
  const record = toRecord(value);
  const next = record?.[key];
  if (typeof next !== "string") {
    return null;
  }
  const trimmed = next.trim();
  return trimmed || null;
}

function readElectronPath(name: "home"): string | null {
  try {
    const next = app.getPath(name);
    return next.trim() ? next : null;
  } catch {
    return null;
  }
}

async function isFile(targetPath: string): Promise<boolean> {
  try {
    return (await stat(targetPath)).isFile();
  } catch {
    return false;
  }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
