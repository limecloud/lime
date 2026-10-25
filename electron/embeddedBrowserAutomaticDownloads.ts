import type { WebContents } from "electron";
import {
  permissionSource,
  type EmbeddedBrowserPermissionGrants,
} from "./embeddedBrowserPermissionGrants";

type PendingDownloads = {
  isCurrent(): boolean;
  controller: AbortController;
  consumers: Set<symbol>;
  settled: boolean;
  promise: Promise<boolean>;
};

/** One document's concurrent files share a decision; cancelling one file never cancels its siblings. */
export function createAutomaticDownloadRequest(
  grants: EmbeddedBrowserPermissionGrants,
  request: (
    contents: WebContents,
    callback: (allowed: boolean) => void,
    signal: AbortSignal,
  ) => void,
) {
  const pending = new WeakMap<WebContents, PendingDownloads>();
  return (
    viewId: string,
    contents: WebContents,
    signal?: AbortSignal,
  ): Promise<boolean> => {
    if (signal?.aborted) return Promise.resolve(false);
    const source = permissionSource(contents, {
      isMainFrame: true,
      requestingUrl: contents.getURL(),
    });
    if (!source) return Promise.resolve(false);
    const slot = grants.takeDownloadSlot(viewId, source);
    if (slot !== "ask") return Promise.resolve(slot === "first");
    // DownloadItem has no request_initiator. Do not assign a child frame's request to the top origin.
    if (
      contents.mainFrame.framesInSubtree.some(
        (frame) => frame !== contents.mainFrame && !frame.detached,
      )
    )
      return Promise.resolve(false);
    let group = pending.get(contents);
    if (
      !group?.isCurrent() ||
      group.controller.signal.aborted ||
      group.settled
    ) {
      group?.controller.abort();
      const scope = grants.capture(viewId, source, "automatic-downloads");
      const controller = new AbortController();
      const next: PendingDownloads = {
        isCurrent: scope.isCurrent,
        controller,
        consumers: new Set(),
        settled: false,
        promise: Promise.resolve(false),
      };
      next.promise = new Promise<boolean>((resolve) =>
        request(contents, resolve, controller.signal),
      )
        .then(
          (allowed) => {
            next.settled = true;
            if (!allowed && !controller.signal.aborted && scope.isCurrent())
              grants.denyAutomaticDownloads(viewId, source);
            return allowed && scope.isCurrent();
          },
          () => {
            next.settled = true;
            return false;
          },
        )
        .finally(() => {
          if (pending.get(contents) === next) pending.delete(contents);
        });
      pending.set(contents, next);
      group = next;
    }
    return followDownloadPermission(group, signal);
  };
}

function followDownloadPermission(
  group: PendingDownloads,
  signal?: AbortSignal,
): Promise<boolean> {
  const id = Symbol();
  group.consumers.add(id);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (allowed: boolean) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      group.consumers.delete(id);
      resolve(allowed && !signal?.aborted && group.isCurrent());
      if (!group.settled && group.consumers.size === 0)
        group.controller.abort();
    };
    const abort = () => finish(false);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    else void group.promise.then(finish);
  });
}
