import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BrowserAnnotationEditorBridge,
  BrowserAnnotationEditorLayout,
} from "@/lib/api/browserAnnotationEditorTypes";
import { useBrowserAnnotationLayout } from "./useBrowserAnnotationLayout";

let root: Root;
let container: HTMLDivElement;
let height: number;
let observers: Observer[];
let bridge: BrowserAnnotationEditorBridge;
type ObserverCallback = ConstructorParameters<typeof ResizeObserver>[0];
class Observer {
  callback: ObserverCallback;
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(callback: ObserverCallback) {
    this.callback = callback;
    observers.push(this);
  }
  deliver() {
    this.callback([], this as unknown as ResizeObserver);
  }
}
function Harness({
  transport = bridge,
  preview = false,
  layout = { width: 360, maxHeight: 584 },
}: {
  transport?: BrowserAnnotationEditorBridge;
  preview?: boolean;
  layout?: BrowserAnnotationEditorLayout;
}) {
  const ref = useBrowserAnnotationLayout(transport, layout, preview);
  return <section ref={ref}>Measured content</section>;
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  height = 96;
  observers = [];
  vi.stubGlobal("ResizeObserver", Observer);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, 360, height),
  );
  bridge = {
    onUpdate: vi.fn(() => () => {}),
    ready: vi.fn(),
    resize: vi.fn(),
    act: vi.fn(),
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("annotation layout lifetime", () => {
  it("retries the same content height after native constraints change", () => {
    act(() => root.render(<Harness />));
    expect(bridge.resize).toHaveBeenCalledExactlyOnceWith(112);
    act(() => root.render(<Harness layout={{ width: 320, maxHeight: 300 }} />));
    expect(bridge.resize).toHaveBeenCalledTimes(2);
    expect(bridge.resize).toHaveBeenLastCalledWith(112);
    act(() => observers.at(-1)!.deliver());
    expect(bridge.resize).toHaveBeenCalledTimes(2);
  });

  it("reports content changes once and clamps to the current host's available height", () => {
    act(() => root.render(<Harness />));
    expect(bridge.resize).toHaveBeenLastCalledWith(112);
    act(() => observers[0].deliver());
    expect(bridge.resize).toHaveBeenCalledTimes(1);
    height = 230.2;
    act(() => observers[0].deliver());
    expect(bridge.resize).toHaveBeenLastCalledWith(247);
    act(() => root.render(<Harness layout={{ width: 320, maxHeight: 200 }} />));
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    expect(bridge.resize).toHaveBeenLastCalledWith(200);
    act(() => observers[0].deliver());
    expect(bridge.resize).toHaveBeenCalledTimes(3);
    expect(bridge.act).not.toHaveBeenCalled();
  });

  it("expands previews to the host constraint and restores the measured editor afterwards", () => {
    act(() => root.render(<Harness />));
    act(() => root.render(<Harness preview />));
    expect(bridge.resize).toHaveBeenLastCalledWith(584);
    height = 180;
    act(() => observers.at(-1)!.deliver());
    expect(bridge.resize).toHaveBeenCalledTimes(2);
    act(() => root.render(<Harness />));
    expect(bridge.resize).toHaveBeenLastCalledWith(196);
  });

  it("ignores disconnected callbacks after StrictMode replacement and unmount", () => {
    act(() =>
      root.render(
        <StrictMode>
          <Harness />
        </StrictMode>,
      ),
    );
    expect(bridge.resize).toHaveBeenCalledTimes(1);
    height = 150;
    act(() => observers[0].deliver());
    expect(bridge.resize).toHaveBeenCalledTimes(1);
    act(() => observers.at(-1)!.deliver());
    expect(bridge.resize).toHaveBeenLastCalledWith(166);
    act(() => root.render(null));
    height = 220;
    act(() => observers.at(-1)!.deliver());
    expect(bridge.resize).toHaveBeenCalledTimes(2);
    expect(
      observers.every(
        (observer) => observer.disconnect.mock.calls.length === 1,
      ),
    ).toBe(true);
  });

  it("reports identical content to a new transport and retries a failed height report on the next observation", () => {
    vi.mocked(bridge.resize).mockImplementationOnce(() => {
      throw new Error("Closing transport");
    });
    act(() => root.render(<Harness />));
    act(() => observers[0].deliver());
    expect(bridge.resize).toHaveBeenCalledTimes(2);
    const next = { ...bridge, resize: vi.fn() };
    act(() => root.render(<Harness transport={next} />));
    expect(next.resize).toHaveBeenCalledExactlyOnceWith(112);
    height = 160;
    act(() => observers[0].deliver());
    expect(bridge.resize).toHaveBeenCalledTimes(2);
  });

  it("does not manufacture a content height while the surface has no layout", () => {
    height = 0;
    act(() => root.render(<Harness />));
    expect(bridge.resize).not.toHaveBeenCalled();
    height = 90;
    act(() => observers[0].deliver());
    expect(bridge.resize).toHaveBeenCalledExactlyOnceWith(106);
  });
});
