import type { DownloadItem, Session, WebContents } from "electron";
import type { BrowserDownloadRecoveryRequest } from "./browserDownloadResume";

type Pending = {
  request: BrowserDownloadRecoveryRequest;
  item: DownloadItem | null;
  timer: ReturnType<typeof setTimeout>;
  resolve: () => void;
  reject: (error: unknown) => void;
};

/** Associates only native items created by this owner, without a WebContents or renderer authority. */
export class BrowserDownloadRecovery {
  readonly #pending = new Map<string, Pending>();
  #disposed = false;
  constructor(
    readonly session: Session,
    readonly attach: (
      item: DownloadItem,
      request: BrowserDownloadRecoveryRequest,
      current: () => boolean,
    ) => Promise<void>,
  ) {}
  resume(request: BrowserDownloadRecoveryRequest): Promise<void> {
    if (this.#disposed || this.#pending.has(request.path))
      return Promise.reject(
        new Error("Browser download recovery is unavailable"),
      );
    return new Promise((resolve, reject) => {
      const pending: Pending = {
        request,
        item: null,
        resolve,
        reject,
        timer: setTimeout(() => {
          if (this.#pending.get(request.path) === pending) {
            this.#pending.delete(request.path);
            pending.reject(
              new Error(
                "Browser download recovery did not create a native item",
              ),
            );
          }
        }, 10_000),
      };
      this.#pending.set(request.path, pending);
      try {
        const {
          path,
          urlChain,
          offset,
          length,
          eTag,
          lastModified,
          startTime,
          mimeType,
        } = request;
        this.session.createInterruptedDownload({
          path,
          urlChain,
          offset,
          length,
          eTag,
          lastModified,
          startTime,
          ...(mimeType ? { mimeType } : {}),
        });
      } catch (error) {
        clearTimeout(pending.timer);
        this.#pending.delete(request.path);
        reject(error);
      }
    });
  }
  accept(
    item: DownloadItem,
    contents: WebContents | null | undefined,
  ): boolean {
    if (contents || this.#disposed) return false;
    const pending = this.#pending.get(item.getSavePath());
    if (!pending || pending.item) return false;
    clearTimeout(pending.timer);
    pending.item = item;
    const current = () =>
      !this.#disposed && this.#pending.get(pending.request.path) === pending;
    void Promise.resolve()
      .then(async () => {
        const { request } = pending;
        if (
          item.getState() !== "interrupted" ||
          item.getReceivedBytes() !== request.offset ||
          item.getTotalBytes() !== request.length ||
          JSON.stringify(item.getURLChain()) !==
            JSON.stringify(request.urlChain)
        )
          throw new Error("Browser download recovery native identity mismatch");
        await this.attach(item, request, current);
        if (!current())
          throw new Error("Browser download recovery owner closed");
        pending.resolve();
      })
      .catch((error) => {
        try {
          item.cancel();
        } catch {
          /* Native cancellation may have already finished. */
        }
        pending.reject(error);
      })
      .finally(() => {
        if (this.#pending.get(pending.request.path) === pending)
          this.#pending.delete(pending.request.path);
      });
    return true;
  }
  dispose(): void {
    this.#disposed = true;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      try {
        pending.item?.cancel();
      } catch {
        /* Native item may have closed. */
      }
      pending.reject(new Error("Browser download recovery owner closed"));
    }
    this.#pending.clear();
  }
}
