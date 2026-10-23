import type { DownloadItem } from "electron";
import { stat } from "node:fs/promises";
import path from "node:path";
import { app, shell } from "./electronRuntime";
import { resolveCurrentDesktopStorageRoots } from "./appDataPaths";
import {
  BrowserDownloadsStore,
  type StoredBrowserDownload,
} from "./browserDownloadsStore";
import {
  assertDownloadKeys,
  downloadRecord,
  parseBrowserDownloadAction,
  parseBrowserDownloadsQuery,
  MAX_DOWNLOAD_RECORDS,
  type BrowserDownloadEntry,
  type BrowserDownloadsChange,
} from "../src/lib/api/browserDownloadsTypes";
import type { EmbeddedBrowserDownloadEvent } from "./embeddedBrowserDownloads";
import { BrowserDownloadFiles } from "./browserDownloadFiles";
import {
  nativeBrowserDownloadResume,
  type BrowserDownloadRecoveryRequest,
} from "./browserDownloadResume";

export const BROWSER_DOWNLOADS_COMMANDS = [
  "browser_downloads_list",
  "browser_downloads_action",
  "browser_downloads_clear",
] as const;
export type BrowserDownloadsCommand =
  (typeof BROWSER_DOWNLOADS_COMMANDS)[number];
export function isBrowserDownloadsCommand(
  command: string,
): command is BrowserDownloadsCommand {
  return BROWSER_DOWNLOADS_COMMANDS.includes(
    command as BrowserDownloadsCommand,
  );
}
type LiveDownload = {
  item: DownloadItem;
  controllable: boolean;
  finished: boolean;
};

/** Owned by BrowserTabHost; only its native browser download observer may add facts. */
export class BrowserDownloadsHost {
  readonly #store: () => BrowserDownloadsStore;
  readonly #changed: (change: BrowserDownloadsChange) => void;
  readonly #open: (path: string) => Promise<string>;
  readonly #reveal: (path: string) => void;
  readonly #recover:
    | ((request: BrowserDownloadRecoveryRequest) => Promise<void>)
    | undefined;
  #files: BrowserDownloadFiles | null = null;
  #shuttingDown = false;
  #file: BrowserDownloadsStore | null = null;
  #entries: Map<string, StoredBrowserDownload> | null = null;
  #revision = 0;
  #historyRevision = 0;
  #saveError: unknown = null;
  #tail: Promise<void> = Promise.resolve();
  readonly #live = new Map<string, LiveDownload>();
  readonly #pending = new Map<string, StoredBrowserDownload>();
  #timer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    changed: (change: BrowserDownloadsChange) => void,
    options: {
      createStore?: () => BrowserDownloadsStore;
      open?: (path: string) => Promise<string>;
      reveal?: (path: string) => void;
      recover?: (request: BrowserDownloadRecoveryRequest) => Promise<void>;
    } = {},
  ) {
    this.#changed = changed;
    this.#store =
      options.createStore ??
      (() =>
        new BrowserDownloadsStore(
          resolveCurrentDesktopStorageRoots(app.getPath("userData"))
            .appDataRoot,
        ));
    this.#open = options.open ?? ((file) => shell.openPath(file));
    this.#reveal = options.reveal ?? ((file) => shell.showItemInFolder(file));
    this.#recover = options.recover;
  }
  observe(
    item: DownloadItem,
    event: EmbeddedBrowserDownloadEvent,
    finished: boolean,
    controllable: boolean,
  ): void {
    const previous =
      this.#pending.get(event.downloadId) ??
      this.#entries?.get(event.downloadId);
    const now = Math.max(Date.now(), previous?.startedAt ?? 0);
    const state =
      !finished && event.state === "progressing" && item.isPaused()
        ? "paused"
        : event.state;
    const savePath = item.getSavePath();
    this.#live.set(event.downloadId, { item, controllable, finished });
    this.#pending.set(event.downloadId, {
      id: event.downloadId,
      url: event.url.slice(0, 65536),
      filename: event.filename.slice(0, 4096),
      mimeType: event.mimeType?.slice(0, 1024) ?? null,
      state,
      receivedBytes: event.receivedBytes,
      totalBytes: event.totalBytes,
      startedAt: previous?.startedAt ?? now,
      updatedAt: now,
      savePath: savePath && path.isAbsolute(savePath) ? savePath : null,
      finished,
      resume:
        state === "completed" || state === "cancelled"
          ? null
          : nativeBrowserDownloadResume(item, event.viewId),
    });
    if (finished) {
      this.#live.delete(event.downloadId);
      void this.#run(async () => {
        await this.#flush();
        if (state === "completed" || state === "cancelled")
          await this.#files!.remove(event.downloadId);
      }).catch(() => this.#changed({ kind: "invalidated" }));
    } else if (!this.#timer) {
      this.#timer = setTimeout(() => {
        this.#timer = null;
        void this.#run(() => this.#flush()).catch(() =>
          this.#changed({ kind: "invalidated" }),
        );
      }, 200);
      this.#timer.unref?.();
    }
  }
  invoke(
    command: BrowserDownloadsCommand,
    input: unknown = {},
  ): Promise<unknown> {
    if (this.#shuttingDown)
      return Promise.reject(new Error("Browser downloads are shutting down"));
    return this.#run(async () => {
      await this.#load();
      await this.#flush();
      if (command === "browser_downloads_list") {
        const { query, offset, limit } = parseBrowserDownloadsQuery(
          input ?? {},
        );
        const terms = query.split(/\s+/u).filter(Boolean);
        const entries = [...this.#entries!.values()]
          .filter((entry) =>
            terms.every((term) =>
              `${entry.filename}\n${entry.url}`
                .normalize("NFKC")
                .toLocaleLowerCase()
                .includes(term),
            ),
          )
          .sort(
            (a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id),
          );
        return {
          entries: await Promise.all(
            entries
              .slice(offset, offset + limit)
              .map((entry) => this.#public(entry)),
          ),
          total: entries.length,
          nextOffset: offset + limit < entries.length ? offset + limit : null,
          revision: this.#revision,
          historyRevision: this.#historyRevision,
        };
      }
      if (command === "browser_downloads_clear") {
        assertDownloadKeys(downloadRecord(input ?? {}), []);
        const retained = await Promise.all(
          [...this.#entries!].map(async ([id, entry]) => ({
            id,
            entry,
            keep: !entry.finished || (await this.#public(entry)).canResume,
          })),
        );
        const next = new Map(
          retained
            .filter((value) => value.keep)
            .map(({ id, entry }) => [id, entry]),
        );
        if (next.size !== this.#entries!.size) await this.#save(next);
        await Promise.allSettled(
          retained
            .filter((value) => !value.keep)
            .map(({ id }) => this.#files!.remove(id)),
        );
        return { ok: true };
      }
      const { id, action } = parseBrowserDownloadAction(input);
      const entry = this.#entries!.get(id);
      if (!entry) throw new Error("Browser download record is unavailable");
      const current = await this.#public(entry);
      if (action === "remove") {
        if (!entry.finished || current.canResume)
          throw new Error("Active Browser downloads cannot be removed");
        const next = new Map(this.#entries!);
        next.delete(id);
        await this.#save(next);
        await this.#files!.remove(id);
      } else if (action === "open" || action === "reveal") {
        if (
          !current.fileExists ||
          !entry.savePath ||
          (action === "open" && entry.state !== "completed")
        )
          throw new Error("Browser download file is unavailable");
        if (action === "open") {
          if (await this.#open(entry.savePath))
            throw new Error("Browser download file could not be opened");
        } else this.#reveal(entry.savePath);
      } else {
        const live = this.#live.get(id);
        if (action === "cancel" && !live && current.canCancel) {
          const next = new Map(this.#entries!);
          next.set(id, {
            ...entry,
            state: "cancelled",
            finished: true,
            resume: null,
            updatedAt: Math.max(Date.now(), entry.updatedAt),
          });
          await this.#save(next);
          await this.#files!.remove(id);
          return { ok: true };
        }
        if (
          action === "resume" &&
          !live &&
          current.canResume &&
          this.#recover
        ) {
          const request = await this.#files!.prepare(entry);
          try {
            await this.#recover(request);
          } finally {
            await this.#flush();
          }
          return { ok: true };
        }
        if (
          !live ||
          !live.controllable ||
          live.finished ||
          !(action === "pause"
            ? current.canPause
            : action === "resume"
              ? current.canResume
              : current.canCancel)
        )
          throw new Error("Browser download action is unavailable");
        live.item[action]();
        // pause/resume need not emit an updated event until the next network chunk.
        if (action !== "cancel" && !live.finished) {
          const next = new Map(this.#entries!);
          next.set(id, {
            ...entry,
            state: action === "pause" ? "paused" : "progressing",
            updatedAt: Math.max(Date.now(), entry.updatedAt),
          });
          await this.#save(next);
        }
      }
      return { ok: true };
    });
  }
  async #public(entry: StoredBrowserDownload): Promise<BrowserDownloadEntry> {
    const {
      savePath,
      finished: _finished,
      resume: _resume,
      ...metadata
    } = entry;
    const live = this.#live.get(entry.id);
    const active = live?.controllable && !live.finished;
    const recoverable = Boolean(
      !live &&
      entry.finished &&
      this.#recover &&
      (await this.#files!.available(entry)),
    );
    const fileExists =
      entry.state === "completed" &&
      savePath !== null &&
      (await stat(savePath).then(
        (info) => info.isFile(),
        () => false,
      ));
    return {
      ...metadata,
      fileExists,
      canPause: Boolean(
        active && entry.state === "progressing" && !live.item.isPaused(),
      ),
      canResume: Boolean(
        (active &&
          live.item.canResume() &&
          (live.item.isPaused() || entry.state === "interrupted")) ||
        recoverable,
      ),
      canCancel: Boolean(active || recoverable),
    };
  }
  async #load(): Promise<void> {
    if (this.#entries) return;
    this.#file ??= this.#store();
    this.#files ??= new BrowserDownloadFiles(this.#file.directory);
    const state = await this.#file.load();
    this.#entries = new Map(state.entries.map((entry) => [entry.id, entry]));
    this.#revision = state.revision;
    this.#historyRevision = state.revision;
  }
  prepareShutdown(): Promise<void> {
    this.#shuttingDown = true;
    const errors: unknown[] = [];
    for (const live of this.#live.values()) {
      if (!live.finished && live.controllable) {
        try {
          live.item.pause();
        } catch (error) {
          errors.push(error);
        }
      }
    }
    return this.#run(async () => {
      await this.#load();
      await this.#flush();
      for (const entry of this.#entries!.values()) {
        const live = this.#live.get(entry.id);
        if (live && !live.finished && live.controllable) {
          try {
            live.item.pause();
            await this.#files!.preserve(entry);
          } catch (error) {
            errors.push(error);
          }
        }
      }
      await this.#flush();
      if (errors.length)
        throw new AggregateError(
          errors,
          "Browser download checkpoints could not be saved",
        );
    });
  }
  async #flush(): Promise<void> {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    await this.#load();
    if (!this.#pending.size && !this.#saveError) return;
    const pending = new Map(this.#pending);
    const next = new Map(this.#entries!);
    for (const [id, entry] of pending) next.set(id, entry);
    const retained = [...next.values()]
      .sort(
        (a, b) =>
          Number(a.finished) - Number(b.finished) || b.startedAt - a.startedAt,
      )
      .slice(0, MAX_DOWNLOAD_RECORDS);
    try {
      await this.#save(new Map(retained.map((entry) => [entry.id, entry])));
    } catch (error) {
      this.#saveError = error;
      throw error;
    }
    this.#saveError = null;
    for (const [id, entry] of pending)
      if (this.#pending.get(id) === entry) this.#pending.delete(id);
  }
  async #save(next: Map<string, StoredBrowserDownload>): Promise<void> {
    const changed = [...next.values()].filter(
      (entry) => this.#entries!.get(entry.id) !== entry,
    );
    const removedIds = [...this.#entries!.keys()].filter((id) => !next.has(id));
    const historyChanged =
      removedIds.length > 0 ||
      changed.some((entry) => {
        const previous = this.#entries!.get(entry.id);
        return (
          !previous ||
          previous.state !== entry.state ||
          previous.filename !== entry.filename ||
          previous.url !== entry.url ||
          previous.startedAt !== entry.startedAt ||
          previous.finished !== entry.finished
        );
      });
    await this.#file!.save([...next.values()], this.#revision + 1);
    this.#entries = next;
    ++this.#revision;
    if (historyChanged) this.#historyRevision = this.#revision;
    let change: BrowserDownloadsChange;
    try {
      change = {
        kind: "updated",
        revision: this.#revision,
        historyRevision: this.#historyRevision,
        entries: await Promise.all(changed.map((entry) => this.#public(entry))),
        removedIds,
      };
    } catch {
      change = { kind: "invalidated" };
    }
    this.#changed(change);
  }
  #run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#tail.then(operation);
    this.#tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}
