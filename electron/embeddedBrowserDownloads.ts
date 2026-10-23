import type {
  DownloadItem,
  SaveDialogOptions,
  Session,
  WebContents,
} from "electron";
import { BrowserDownloadRecovery } from "./browserDownloadRecovery";
import type { BrowserDownloadRecoveryRequest } from "./browserDownloadResume";

type HostEventEmitter = (event: string, payload?: unknown) => void;

export type EmbeddedBrowserDownloadState =
  | "started"
  | "progressing"
  | "completed"
  | "cancelled"
  | "interrupted";

export interface EmbeddedBrowserDownloadEvent {
  viewId: string;
  downloadId: string;
  url: string;
  filename: string;
  mimeType: string | null;
  state: EmbeddedBrowserDownloadState;
  receivedBytes: number;
  totalBytes: number | null;
  canResume: boolean;
}

export interface EmbeddedBrowserDownloadEntry {
  viewId: string;
  webContents?: WebContents;
}

export interface EmbeddedBrowserDownloadController {
  findEntryByWebContents(
    webContents: WebContents,
  ): EmbeddedBrowserDownloadEntry | null;
  onCompletedDownload?: (downloadId: string, savePath: string) => void;
  resolveSavePath?: (filename: string) => string | null;
  resolveSaveDialogOptions?: (filename: string) => SaveDialogOptions | null;
  canDownload?: (viewId: string, url: string) => boolean | Promise<boolean>;
  onDownload?: (
    item: DownloadItem,
    event: EmbeddedBrowserDownloadEvent,
    finished: boolean,
    controllable: boolean,
  ) => void;
}

const downloadIds = new WeakMap<DownloadItem, string>();

export function installEmbeddedBrowserDownloadHandling(
  browserSession: Session,
  controller: EmbeddedBrowserDownloadController,
  emit: HostEventEmitter,
): {
  resume(request: BrowserDownloadRecoveryRequest): Promise<void>;
  prepareShutdown(): void;
  dispose(): void;
} {
  let accepting = true;
  const recovery = new BrowserDownloadRecovery(
    browserSession,
    (item, request, current) =>
      attachEmbeddedBrowserDownload(
        item,
        { viewId: request.viewId },
        controller,
        emit,
        request.id,
        () => accepting && current(),
      ),
  );
  const listener = (
    _event: unknown,
    item: DownloadItem,
    webContents: WebContents | null,
  ) => {
    if (!accepting) {
      item.cancel();
      return;
    }
    if (recovery.accept(item, webContents)) return;
    const entry = webContents
      ? controller.findEntryByWebContents(webContents)
      : null;
    if (entry)
      void attachEmbeddedBrowserDownload(
        item,
        entry,
        controller,
        emit,
        undefined,
        () => accepting,
      ).catch(() => undefined);
  };
  browserSession.on("will-download", listener);
  return {
    resume: (request) =>
      accepting
        ? recovery.resume(request)
        : Promise.reject(new Error("Browser downloads are shutting down")),
    prepareShutdown: () => {
      accepting = false;
      recovery.dispose();
    },
    dispose: () => {
      accepting = false;
      browserSession.removeListener("will-download", listener);
      recovery.dispose();
    },
  };
}

async function attachEmbeddedBrowserDownload(
  item: DownloadItem,
  entry: EmbeddedBrowserDownloadEntry,
  controller: EmbeddedBrowserDownloadController,
  emit: HostEventEmitter,
  recoveredId?: string,
  current: () => boolean = () => true,
): Promise<void> {
  if (recoveredId) downloadIds.set(item, recoveredId);
  if (!recoveredId) {
    const savePath = controller.resolveSavePath?.(item.getFilename());
    if (savePath && typeof item.setSavePath === "function") {
      item.setSavePath(savePath);
    }
    const dialogOptions = controller.resolveSaveDialogOptions?.(
      item.getFilename(),
    );
    if (dialogOptions) item.setSaveDialogOptions(dialogOptions);
  }
  let finished = false;
  let controllable = false;
  const emitDownload = (state: EmbeddedBrowserDownloadState) => {
    const payload = readDownloadEvent(entry, item, state);
    controller.onDownload?.(item, payload, finished, controllable);
    emit("embedded-browser-view-download", payload);
  };
  emitDownload(recoveredId ? "interrupted" : "started");
  item.on("updated", (_event, state) => {
    emitDownload(state === "interrupted" ? "interrupted" : "progressing");
  });
  item.once("done", (_event, state) => {
    finished = true;
    const finalState =
      state === "completed"
        ? "completed"
        : state === "cancelled" && (!recoveredId || controllable)
          ? "cancelled"
          : "interrupted";
    if (finalState === "completed") {
      const savePath =
        typeof item.getSavePath === "function" ? item.getSavePath() : "";
      if (savePath.trim()) {
        controller.onCompletedDownload?.(resolveDownloadId(item), savePath);
      }
    }
    emitDownload(finalState);
  });
  try {
    const allowed = controller.canDownload?.(entry.viewId, item.getURL());
    if (allowed instanceof Promise) {
      item.pause();
      if (!(await allowed) || finished || !current()) {
        if (!finished) item.cancel();
        if (recoveredId)
          throw new Error(
            "Browser download recovery permission denied or owner closed",
          );
        return;
      }
      controllable = true;
      item.resume();
    } else if (allowed === false || !current()) {
      item.cancel();
      if (recoveredId)
        throw new Error(
          "Browser download recovery permission denied or owner closed",
        );
      return;
    } else {
      controllable = true;
      if (recoveredId) item.resume();
    }
    controller.onDownload?.(
      item,
      readDownloadEvent(entry, item, "progressing"),
      finished,
      controllable,
    );
  } catch (error) {
    if (!finished) item.cancel();
    if (recoveredId) throw error;
  }
}

function readDownloadEvent(
  entry: EmbeddedBrowserDownloadEntry,
  item: DownloadItem,
  state: EmbeddedBrowserDownloadState,
): EmbeddedBrowserDownloadEvent {
  return {
    viewId: entry.viewId,
    downloadId: resolveDownloadId(item),
    url: item.getURL(),
    filename: item.getFilename(),
    mimeType: normalizeString(item.getMimeType()),
    state,
    receivedBytes: normalizeBytes(item.getReceivedBytes()),
    totalBytes: normalizeTotalBytes(item.getTotalBytes()),
    canResume: item.canResume(),
  };
}

function resolveDownloadId(item: DownloadItem): string {
  const existing = downloadIds.get(item);
  if (existing) {
    return existing;
  }
  const id = `embedded-download-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  downloadIds.set(item, id);
  return id;
}

function normalizeString(value: string): string | null {
  return value.trim() ? value.trim() : null;
}

function normalizeBytes(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function normalizeTotalBytes(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.round(value);
}
