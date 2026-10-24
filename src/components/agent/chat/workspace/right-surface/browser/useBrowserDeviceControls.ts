import { useLayoutEffect, useRef, useState } from "react";
import {
  setBrowserTabDevice,
  setBrowserTabZoom,
  type BrowserTabState,
} from "@/lib/api/browserTab";
import type { EmbeddedBrowserDeviceState } from "@/lib/api/embeddedBrowser";
import type { RunBrowserOperation } from "./BrowserNavigationBar";

type Request =
  | {
      type: "device";
      device: EmbeddedBrowserDeviceState | null;
      resetZoom: boolean;
    }
  | { type: "zoom"; zoom: number };
interface Scope {
  identity: string;
  tabId: string;
  desired: EmbeddedBrowserDeviceState | null;
  queue: Request[];
  processing: boolean;
}

export function useBrowserDeviceControls(
  selected: BrowserTabState,
  active: boolean,
  run: RunBrowserOperation,
) {
  const identity = JSON.stringify([
    selected.tabId,
    selected.browserSessionId,
    selected.threadId,
    selected.viewId,
    selected.webContentsId,
    selected.ownerWebContentsId,
    selected.windowId,
  ]);
  const current = useRef({ selected, active, identity, run });
  current.current = { selected, active, identity, run };
  const scopeRef = useRef<Scope | null>(null);
  const [pending, setPending] = useState(false);
  useLayoutEffect(() => {
    const tab = current.current.selected;
    const scope: Scope = {
      identity,
      tabId: tab.tabId,
      desired: tab.device ?? null,
      queue: [],
      processing: false,
    };
    scopeRef.current = active ? scope : null;
    setPending(false);
    return () => {
      if (scopeRef.current === scope) scopeRef.current = null;
    };
  }, [identity, active]);
  useLayoutEffect(() => {
    const scope = scopeRef.current;
    if (scope && !scope.processing) scope.desired = selected.device ?? null;
  }, [selected.device]);

  const isCurrent = (scope: Scope) =>
    scopeRef.current === scope &&
    current.current.active &&
    current.current.identity === scope.identity;
  const drain = async (scope: Scope) => {
    if (scope.processing) return;
    scope.processing = true;
    setPending(true);
    try {
      while (isCurrent(scope) && scope.queue.length) {
        const request = scope.queue.shift()!;
        let succeeded = false;
        await current.current.run(
          async () => {
            let state: BrowserTabState;
            if (request.type === "device") {
              state = await setBrowserTabDevice(scope.tabId, request.device);
              if (request.resetZoom && isCurrent(scope))
                state = await setBrowserTabZoom(scope.tabId, 1);
            } else state = await setBrowserTabZoom(scope.tabId, request.zoom);
            succeeded = true;
            return state;
          },
          () => isCurrent(scope),
        );
        if (!succeeded) {
          scope.queue.length = 0;
          scope.desired = current.current.selected.device ?? null;
        }
      }
    } finally {
      scope.processing = false;
      if (isCurrent(scope)) setPending(false);
    }
  };
  const changeDevice = (
    update: (
      device: EmbeddedBrowserDeviceState,
    ) => EmbeddedBrowserDeviceState | null,
    resetZoom = false,
  ) => {
    const scope = scopeRef.current;
    if (!scope || !isCurrent(scope) || !scope.desired) return;
    const device = update(scope.desired);
    scope.desired = device;
    const request: Request = { type: "device", device, resetZoom };
    const last = scope.queue.at(-1);
    if (!resetZoom && last?.type === "device" && !last.resetZoom)
      scope.queue[scope.queue.length - 1] = request;
    else scope.queue.push(request);
    void drain(scope);
  };
  const changeZoom = (zoom: number) => {
    const scope = scopeRef.current;
    if (!scope || !isCurrent(scope)) return;
    const request: Request = { type: "zoom", zoom };
    if (scope.queue.at(-1)?.type === "zoom")
      scope.queue[scope.queue.length - 1] = request;
    else scope.queue.push(request);
    void drain(scope);
  };
  return { pending, changeDevice, changeZoom, identity };
}
