import path from "node:path";
import process from "node:process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { app, shell } from "./electronRuntime";
import { MacOSNativeHostClient, NativeHostError } from "./macosNativeHost";
import {
  WindowsNativeHostClient,
  NativeHostError as WindowsNativeHostError,
} from "./windowsNativeHost";

type HostArgs = Record<string, unknown> | null | undefined;
type HostEventEmitter = (event: string, payload?: unknown) => void;

type SystemUtilityHostOptions = {
  appDataRoot: string;
  emit?: HostEventEmitter;
};

export class SystemUtilityHost {
  readonly #isDefaultBrowser = app.isDefaultProtocolClient("https");
  readonly #appDataRoot: string;
  readonly #macOSNativeHost = new MacOSNativeHostClient();
  readonly #windowsNativeHost = new WindowsNativeHostClient();
  readonly #activeBookmarkTokens = new Map<string, string>();
  readonly #unsubscribeNativeEvents: () => void;

  constructor(options: SystemUtilityHostOptions) {
    this.#appDataRoot = options.appDataRoot;
    const unsubscribeMac = options.emit
      ? this.#macOSNativeHost.onEvent((event) =>
          options.emit?.(event.event, event.payload),
        )
      : () => undefined;
    const unsubscribeWindows = options.emit
      ? this.#windowsNativeHost.onEvent((event) =>
          options.emit?.(event.event, event.payload),
        )
      : () => undefined;
    this.#unsubscribeNativeEvents = () => {
      unsubscribeMac();
      unsubscribeWindows();
    };
  }

  async openExternalUrl(args: HostArgs): Promise<Record<string, never>> {
    const request = readRequest(args);
    const url = readRequiredString(request, "url");
    await shell.openExternal(normalizeExternalUrl(url));
    return {};
  }

  isDefaultBrowser(): boolean {
    return this.#isDefaultBrowser;
  }

  async openSystemSettingsUrl(args: HostArgs): Promise<Record<string, never>> {
    const request = readRequest(args);
    const url = readRequiredString(request, "url");
    await shell.openExternal(normalizeSystemSettingsUrl(url));
    return {};
  }

  async invokeMacOSNativeHost(args: HostArgs): Promise<unknown> {
    if (process.platform !== "darwin") {
      throw new NativeHostError(
        "unsupported",
        "macOS native host is only available on macOS.",
      );
    }
    const request = readRequest(args);
    const method = readRequiredString(request, "method");
    if (method.startsWith("computerUse.")) {
      throw new NativeHostError(
        "unsupported",
        "Computer Use requires the shared App Server authority.",
      );
    }
    const rawParams =
      request.params &&
      typeof request.params === "object" &&
      !Array.isArray(request.params)
        ? (request.params as Record<string, unknown>)
        : {};
    if (method === "bookmark.revoke") {
      const bookmarkId = readBookmarkId(rawParams.bookmarkId);
      const token = this.#activeBookmarkTokens.get(bookmarkId);
      if (token) {
        await this.#macOSNativeHost.invoke({
          method: "bookmark.stop",
          params: { token },
        });
        this.#activeBookmarkTokens.delete(bookmarkId);
      }
      await this.#revokeBookmark(bookmarkId);
      return { bookmarkId, revoked: true };
    }

    const bookmarkId =
      method === "bookmark.start" || method === "bookmark.stop"
        ? optionalBookmarkId(rawParams.bookmarkId)
        : undefined;
    const persistId =
      method === "bookmark.create"
        ? optionalBookmarkId(rawParams.persistId)
        : undefined;
    const params = { ...rawParams };
    delete params.persistId;
    if (
      (method === "bookmark.resolve" || method === "bookmark.start") &&
      !readString(params, "bookmark")
    ) {
      const persistedId = readBookmarkId(params.bookmarkId);
      const persisted = await this.#readBookmark(persistedId);
      params.bookmark = persisted.bookmark;
    }
    if (method === "bookmark.stop" && !readString(params, "token")) {
      if (!bookmarkId) {
        throw new NativeHostError(
          "invalid_argument",
          "bookmark.stop requires a token or bookmarkId.",
        );
      }
      const token = this.#activeBookmarkTokens.get(bookmarkId);
      if (!token) {
        throw new NativeHostError(
          "bookmark_unavailable",
          `No active security-scoped bookmark token exists: ${bookmarkId}`,
        );
      }
      params.token = token;
    }
    delete params.bookmarkId;

    const result = await this.#macOSNativeHost.invoke({ method, params });
    if (method === "bookmark.create" && persistId) {
      const bookmark = toRecord(result);
      const encoded = readRequiredString(bookmark, "bookmark");
      await this.#writeBookmark(persistId, {
        bookmark: encoded,
        path: readString(bookmark, "path") ?? null,
      });
      return { ...bookmark, bookmarkId: persistId, persisted: true };
    }
    if (method === "bookmark.start" && bookmarkId) {
      const token = readString(result, "token");
      if (token) {
        this.#activeBookmarkTokens.set(bookmarkId, token);
        return { ...toRecord(result), bookmarkId };
      }
    }
    if (method === "bookmark.stop") {
      if (bookmarkId) {
        this.#activeBookmarkTokens.delete(bookmarkId);
      } else {
        for (const [activeBookmarkId, activeToken] of this
          .#activeBookmarkTokens) {
          if (activeToken === readString(result, "token")) {
            this.#activeBookmarkTokens.delete(activeBookmarkId);
            break;
          }
        }
      }
    }
    return result;
  }

  async invokeWindowsNativeHost(args: HostArgs): Promise<unknown> {
    if (process.platform !== "win32") {
      throw new WindowsNativeHostError(
        "unsupported",
        "Windows native host is only available on Windows.",
      );
    }
    const request = readRequest(args);
    const method = readRequiredString(request, "method");
    if (method.startsWith("computerUse.")) {
      throw new WindowsNativeHostError(
        "unsupported",
        "Computer Use requires the shared App Server authority.",
      );
    }
    const rawParams =
      request.params &&
      typeof request.params === "object" &&
      !Array.isArray(request.params)
        ? (request.params as Record<string, unknown>)
        : {};
    return await this.#windowsNativeHost.invoke({ method, params: rawParams });
  }

  dispose(): void {
    this.#activeBookmarkTokens.clear();
    this.#unsubscribeNativeEvents();
    this.#macOSNativeHost.dispose();
    this.#windowsNativeHost.dispose();
  }

  async #writeBookmark(
    bookmarkId: string,
    bookmark: { bookmark: string; path: string | null },
  ): Promise<void> {
    try {
      const directory = this.#bookmarkDirectory();
      const target = this.#bookmarkPath(bookmarkId);
      await mkdir(directory, { recursive: true });
      await chmod(directory, 0o700);
      await writeFile(
        target,
        `${JSON.stringify({
          schemaVersion: 1,
          bookmarkId,
          bookmark: bookmark.bookmark,
          path: bookmark.path,
        })}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      await chmod(target, 0o600);
    } catch (error) {
      throw new NativeHostError(
        "bookmark_persist_failed",
        `Persisted macOS security-scoped bookmark could not be written: ${bookmarkId}`,
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  async #readBookmark(
    bookmarkId: string,
  ): Promise<{ bookmark: string; path?: string | null }> {
    try {
      const value = JSON.parse(
        await readFile(this.#bookmarkPath(bookmarkId), "utf8"),
      ) as Record<string, unknown>;
      if (
        value.schemaVersion !== 1 ||
        value.bookmarkId !== bookmarkId ||
        typeof value.bookmark !== "string" ||
        value.bookmark.trim().length === 0
      ) {
        throw new Error("invalid bookmark record");
      }
      return {
        bookmark: value.bookmark,
        path: readString(value, "path"),
      };
    } catch (error) {
      throw new NativeHostError(
        "bookmark_unavailable",
        `Persisted macOS security-scoped bookmark is unavailable: ${bookmarkId}`,
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  async #revokeBookmark(bookmarkId: string): Promise<void> {
    try {
      await rm(this.#bookmarkPath(bookmarkId), { force: true });
    } catch (error) {
      throw new NativeHostError(
        "bookmark_revoke_failed",
        `Persisted macOS security-scoped bookmark could not be revoked: ${bookmarkId}`,
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  #bookmarkDirectory(): string {
    return path.join(this.#appDataRoot, "macos", "security-scoped-bookmarks");
  }

  #bookmarkPath(bookmarkId: string): string {
    return path.join(this.#bookmarkDirectory(), `${bookmarkId}.json`);
  }
}

function normalizeExternalUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch (error) {
    throw new Error(
      `外部链接格式无效: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("外部链接只支持 http/https 地址");
  }
  return parsed.toString();
}

function normalizeSystemSettingsUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch (error) {
    throw new Error(
      `系统设置链接格式无效: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    parsed.protocol !== "x-apple.systempreferences:" &&
    parsed.protocol !== "ms-settings:"
  ) {
    throw new Error(
      "系统设置链接只支持 x-apple.systempreferences 或 ms-settings scheme",
    );
  }
  return parsed.toString();
}

function readRequest(value: unknown): Record<string, unknown> {
  return readRecord(value, "request") ?? toRecord(value) ?? {};
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

function optionalBookmarkId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return readBookmarkId(value);
}

function readBookmarkId(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Bookmark id must be a string");
  }
  const bookmarkId = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(bookmarkId)) {
    throw new Error(
      "Bookmark id must contain only letters, numbers, dot, underscore, or hyphen",
    );
  }
  return bookmarkId;
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

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
