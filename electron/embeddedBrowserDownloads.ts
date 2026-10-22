import type {
  DownloadItem,
  SaveDialogOptions,
  Session,
  WebContents,
} from "electron";

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
  webContents: WebContents;
}

interface EmbeddedBrowserDownloadController {
  findEntryByWebContents(
    webContents: WebContents,
  ): EmbeddedBrowserDownloadEntry | null;
  onCompletedDownload?: (downloadId: string, savePath: string) => void;
  resolveSavePath?: (filename: string) => string | null;
  resolveSaveDialogOptions?: (filename: string) => SaveDialogOptions | null;
  canDownload?: (viewId: string, url: string) => boolean | Promise<boolean>;
}

const downloadIds = new WeakMap<DownloadItem, string>();

export function installEmbeddedBrowserDownloadHandling(
  browserSession: Session,
  controller: EmbeddedBrowserDownloadController,
  emit: HostEventEmitter,
): void {
  browserSession.on("will-download", (_event, item, webContents) => {
    const entry = controller.findEntryByWebContents(webContents);
    if (!entry) {
      return;
    }
    const savePath = controller.resolveSavePath?.(item.getFilename());
    if (savePath && typeof item.setSavePath === "function") {
      item.setSavePath(savePath);
    }
    const dialogOptions = controller.resolveSaveDialogOptions?.(
      item.getFilename(),
    );
    if (dialogOptions) item.setSaveDialogOptions(dialogOptions);
    const emitDownload = (state: EmbeddedBrowserDownloadState) => {
      emit(
        "embedded-browser-view-download",
        readDownloadEvent(entry, item, state),
      );
    };
    emitDownload("started");
    item.on("updated", (_event, state) => {
      emitDownload(state === "interrupted" ? "interrupted" : "progressing");
    });
    let finished = false;
    item.once("done", (_event, state) => {
      finished = true;
      const finalState =
        state === "completed"
          ? "completed"
          : state === "cancelled"
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
        void allowed
          .then((granted) => {
            if (finished) return;
            if (granted) item.resume();
            else item.cancel();
          })
          .catch(() => {
            if (!finished) item.cancel();
          });
      } else if (allowed === false) item.cancel();
    } catch {
      item.cancel();
    }
  });
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
