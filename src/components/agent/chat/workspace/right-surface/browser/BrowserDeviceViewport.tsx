import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import {
  setBrowserTabDevice,
  type BrowserTabState,
} from "@/lib/api/browserTab";
import type { EmbeddedBrowserDeviceState } from "@/lib/api/embeddedBrowser";
import {
  browserDevicePreset,
  resizeBrowserDevice,
  type BrowserDeviceEdge,
} from "./browserDeviceModel";
import type { RunBrowserOperation } from "./BrowserNavigationBar";
import { observeBrowserBounds } from "./observeBrowserBounds";

const edges: BrowserDeviceEdge[] = [
  "left",
  "right",
  "bottom",
  "bottom-left",
  "bottom-right",
];
const edgeStyle: Record<BrowserDeviceEdge, CSSProperties> = {
  left: { left: -20, top: 0, width: 20, height: "100%", cursor: "ew-resize" },
  right: {
    left: "100%",
    top: 0,
    width: 20,
    height: "100%",
    cursor: "ew-resize",
  },
  bottom: {
    left: 0,
    top: "100%",
    width: "100%",
    height: 20,
    cursor: "ns-resize",
  },
  "bottom-left": {
    left: -20,
    top: "100%",
    width: 20,
    height: 20,
    cursor: "nesw-resize",
  },
  "bottom-right": {
    left: "100%",
    top: "100%",
    width: 20,
    height: 20,
    cursor: "nwse-resize",
  },
};

type Drag = {
  pointerId: number;
  target: HTMLButtonElement;
  edge: BrowserDeviceEdge;
  x: number;
  y: number;
  device: EmbeddedBrowserDeviceState;
  scale: number;
};

/** Handles live outside the native child view, which paints above the renderer. */
export function BrowserDeviceViewport({
  selected,
  active,
  viewportRef,
  run,
}: {
  selected: BrowserTabState;
  active: boolean;
  viewportRef: RefObject<HTMLDivElement | null>;
  run: RunBrowserOperation;
}) {
  const { t } = useTranslation("agent");
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const drag = useRef<Drag | null>(null);
  const enqueue = useRef<(device: EmbeddedBrowserDeviceState) => void>(
    () => undefined,
  );
  const cancel = useRef<() => void>(() => undefined);
  const identity = [
    active,
    selected.selected,
    selected.browserSessionId,
    selected.tabId,
    selected.viewId,
    selected.webContentsId,
    selected.navigationRevision,
    selected.controlOwner,
    selected.activeTurnId,
    !!selected.device,
  ].join("\0");

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setOrigin((previous) =>
        previous.x === rect.x && previous.y === rect.y
          ? previous
          : { x: rect.x, y: rect.y },
      );
    };
    return observeBrowserBounds(element, update);
  }, [viewportRef]);

  useLayoutEffect(() => {
    let valid = true;
    let pending = false;
    let latest: EmbeddedBrowserDeviceState | null = null;
    let frame: number | null = null;
    const flush = () => {
      if (!valid || pending || !latest) return;
      const next = latest;
      latest = null;
      pending = true;
      void run(
        () => setBrowserTabDevice(selected.tabId, next),
        () => valid,
      ).finally(() => {
        pending = false;
        flush();
      });
    };
    enqueue.current = (device) => {
      latest = device;
      if (frame === null)
        frame = requestAnimationFrame(() => {
          frame = null;
          flush();
        });
    };
    cancel.current = () => {
      latest = null;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      const current = drag.current;
      drag.current = null;
      if (current?.target.hasPointerCapture?.(current.pointerId))
        current.target.releasePointerCapture(current.pointerId);
    };
    return () => {
      valid = false;
      cancel.current();
      enqueue.current = () => undefined;
    };
  }, [identity, run, selected.tabId]);

  const viewport = selected.deviceViewport;
  const device = selected.device;
  if (
    !active ||
    !selected.selected ||
    !device ||
    !viewport ||
    viewport.scale <= 0 ||
    !viewport.bounds.width ||
    !viewport.bounds.height
  )
    return null;
  const responsive = browserDevicePreset(device) === "responsive";
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const start = drag.current;
    if (!start || event.pointerId !== start.pointerId) return;
    enqueue.current(
      resizeBrowserDevice(
        start.device,
        start.edge,
        event.clientX - start.x,
        event.clientY - start.y,
        start.scale,
      ),
    );
  };
  return (
    <div
      data-testid="browser-device-viewport"
      className="pointer-events-none absolute outline outline-1 outline-border"
      style={{
        left: viewport.bounds.x - origin.x,
        top: viewport.bounds.y - origin.y,
        width: viewport.bounds.width,
        height: viewport.bounds.height,
      }}
    >
      {responsive
        ? edges.map((edge) => (
            <button
              key={edge}
              type="button"
              data-testid={`browser-device-resize-${edge}`}
              aria-label={t(`browserChrome.resize.${edge}`)}
              title={t(`browserChrome.resize.${edge}`)}
              className="pointer-events-auto absolute flex touch-none select-none items-center justify-center text-[color:var(--lime-text-muted)] hover:bg-muted focus-visible:bg-muted focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring"
              style={edgeStyle[edge]}
              onPointerDown={(event) => {
                if (event.button !== 0 || drag.current) return;
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = {
                  pointerId: event.pointerId,
                  target: event.currentTarget,
                  edge,
                  x: event.clientX,
                  y: event.clientY,
                  device,
                  scale: viewport.scale,
                };
              }}
              onPointerMove={move}
              onPointerUp={(event) => {
                if (drag.current?.pointerId !== event.pointerId) return;
                move(event);
                drag.current = null;
                event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => cancel.current()}
              onLostPointerCapture={() => {
                if (drag.current) cancel.current();
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  cancel.current();
                  return;
                }
                const step = event.shiftKey ? 50 : 10;
                const dx =
                  event.key === "ArrowLeft"
                    ? -step
                    : event.key === "ArrowRight"
                      ? step
                      : 0;
                const dy =
                  event.key === "ArrowUp"
                    ? -step
                    : event.key === "ArrowDown"
                      ? step
                      : 0;
                if (!dx && !dy) return;
                event.preventDefault();
                enqueue.current(
                  resizeBrowserDevice(device, edge, dx, dy, viewport.scale),
                );
              }}
            >
              <span
                aria-hidden
                className={
                  edge === "bottom"
                    ? "h-0.5 w-6 rounded bg-current"
                    : edge === "left" || edge === "right"
                      ? "h-6 w-0.5 rounded bg-current"
                      : "size-1 rounded bg-current"
                }
              />
            </button>
          ))
        : null}
    </div>
  );
}
