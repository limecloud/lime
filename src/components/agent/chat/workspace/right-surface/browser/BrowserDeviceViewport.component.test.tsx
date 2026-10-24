import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserDeviceViewport } from "./BrowserDeviceViewport";
import {
  browserState,
  createBrowserComponentHarness,
  deferred,
} from "./browserWorkspace.testFixtures";
import type { BrowserTabState } from "@/lib/api/browserTab";

const native = vi.hoisted(() => ({ setDevice: vi.fn() }));
vi.mock("@/lib/api/browserTab", () => ({
  setBrowserTabDevice: native.setDevice,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const device = {
  presetId: "responsive" as const,
  width: 500,
  height: 800,
  scale: 1,
  deviceScaleFactor: 0,
  mobile: false,
};
const viewport = {
  bounds: { x: 200, y: 30, width: 250, height: 400 },
  scale: 0.5,
};
let harness: ReturnType<typeof createBrowserComponentHarness>;
let frames: Map<number, (time: number) => void>;
let accepted: BrowserTabState[];
let ref: { current: HTMLDivElement };
const run = vi.fn(
  async (op: () => Promise<BrowserTabState>, valid = () => true) => {
    if (!valid()) return;
    const result = await op();
    if (valid()) accepted.push(result);
  },
);
const render = (patch: Partial<BrowserTabState> = {}, active = true) =>
  harness.render(
    <BrowserDeviceViewport
      selected={browserState({ device, deviceViewport: viewport, ...patch })}
      active={active}
      viewportRef={ref}
      run={run}
    />,
  );
const pointer = async (
  edge: string,
  type: string,
  x: number,
  y: number,
  pointerId = 1,
) => {
  const target = harness.query<HTMLButtonElement>(
    `browser-device-resize-${edge}`,
  );
  target.setPointerCapture ??= vi.fn();
  target.releasePointerCapture ??= vi.fn();
  const event = Object.assign(
    new Event(type, { bubbles: true, cancelable: true }),
    { clientX: x, clientY: y, pointerId, button: 0 },
  );
  await harness.dispatch(target, event);
};
const frame = () =>
  act(async () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(0));
  });

describe("BrowserDeviceViewport", () => {
  beforeEach(() => {
    harness = createBrowserComponentHarness();
    accepted = [];
    frames = new Map();
    let nextFrame = 1;
    vi.stubGlobal("requestAnimationFrame", (fn: (time: number) => void) => {
      const id = nextFrame++;
      frames.set(id, fn);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    ref = { current: document.createElement("div") };
    vi.spyOn(ref.current, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 30,
      width: 500,
      height: 420,
    } as DOMRect);
    vi.clearAllMocks();
    native.setDevice.mockResolvedValue(browserState({ device }));
  });
  afterEach(async () => {
    await harness.unmount();
    vi.unstubAllGlobals();
  });

  it("places all five handles outside the actual native viewport", async () => {
    await render();
    const element = harness.query("browser-device-viewport");
    expect(element.style.left).toBe("100px");
    expect(element.style.top).toBe("0px");
    expect(element.style.width).toBe("250px");
    expect(document.querySelectorAll("button")).toHaveLength(5);
    expect(harness.query("browser-device-resize-right").style.left).toBe(
      "100%",
    );
    expect(harness.query("browser-device-resize-bottom").style.top).toBe(
      "100%",
    );
    expect(native.setDevice).not.toHaveBeenCalled();
  });

  it("realigns after an ancestor moves without changing its size", async () => {
    document.body.append(ref.current);
    try {
      await render();
      vi.mocked(ref.current.getBoundingClientRect).mockReturnValue({
        x: 125,
        y: 35,
        width: 500,
        height: 420,
      } as DOMRect);
      await act(async () => {
        ref.current.dispatchEvent(
          new Event("transitionend", { bubbles: true }),
        );
      });
      const element = harness.query("browser-device-viewport");
      expect(element.style.left).toBe("75px");
      expect(element.style.top).toBe("-5px");
      expect(native.setDevice).not.toHaveBeenCalled();
    } finally {
      ref.current.remove();
    }
  });

  it("preserves fractional CSS origins when aligning integer native bounds", async () => {
    vi.mocked(ref.current.getBoundingClientRect).mockReturnValue({
      x: 99.75,
      y: 30.25,
      width: 500,
      height: 420,
    } as DOMRect);
    await render();
    const element = harness.query("browser-device-viewport");
    expect(element.style.left).toBe("100.25px");
    expect(element.style.top).toBe("-0.25px");
    expect(native.setDevice).not.toHaveBeenCalled();
  });

  it("coalesces motion and serializes the latest size behind an outstanding native request", async () => {
    const pending = deferred<BrowserTabState>();
    native.setDevice.mockReturnValueOnce(pending.promise);
    await render();
    await pointer("bottom-right", "pointerdown", 100, 100);
    await pointer("bottom-right", "pointermove", 110, 110);
    await pointer("bottom-right", "pointermove", 120, 120);
    expect(native.setDevice).not.toHaveBeenCalled();
    await frame();
    expect(native.setDevice).toHaveBeenLastCalledWith(browserState().tabId, {
      ...device,
      width: 580,
      height: 840,
    });
    await render({
      pageRevision: 1,
      device: { ...device, width: 580 },
      deviceViewport: { ...viewport, scale: 0.4 },
    });
    await pointer("bottom-right", "pointermove", 125, 125);
    await pointer("bottom-right", "pointerup", 130, 130);
    await frame();
    expect(native.setDevice).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(browserState()));
    expect(native.setDevice).toHaveBeenCalledTimes(2);
    expect(native.setDevice).toHaveBeenLastCalledWith(browserState().tabId, {
      ...device,
      width: 620,
      height: 860,
    });
  });

  it.each(["left", "right", "bottom", "bottom-left", "bottom-right"])(
    "supports pointer resizing at %s",
    async (edge) => {
      await render();
      await pointer(edge, "pointerdown", 0, 0);
      await pointer(edge, "pointermove", 10, 10, 2);
      await frame();
      expect(native.setDevice).not.toHaveBeenCalled();
      await pointer(edge, "pointerup", 10, 10);
      await frame();
      expect(native.setDevice).toHaveBeenCalledOnce();
      expect(native.setDevice.mock.calls[0][1]).toMatchObject({
        deviceScaleFactor: 0,
        mobile: false,
        scale: 1,
      });
    },
  );

  it.each([
    { navigationRevision: 1 },
    { tabId: "other" },
    { controlOwner: "agent" as const },
    { selected: false },
    { device: null },
  ])(
    "discards queued work and late receipts after identity change %j",
    async (patch) => {
      const pending = deferred<BrowserTabState>();
      native.setDevice.mockReturnValueOnce(pending.promise);
      await render();
      await pointer("right", "pointerdown", 0, 0);
      await pointer("right", "pointermove", 10, 0);
      await frame();
      await pointer("right", "pointermove", 30, 0);
      await render(patch);
      await frame();
      await act(async () => pending.resolve(browserState()));
      expect(native.setDevice).toHaveBeenCalledOnce();
      expect(accepted).toHaveLength(0);
    },
  );

  it("cancels on deactivation or pointer cancellation and leaves named presets fixed", async () => {
    await render();
    await pointer("right", "pointerdown", 0, 0);
    await pointer("right", "pointermove", 10, 0);
    await pointer("right", "pointercancel", 10, 0);
    await frame();
    expect(native.setDevice).not.toHaveBeenCalled();
    await render({}, false);
    expect(document.querySelector("button")).toBeNull();
    await render({
      device: {
        ...device,
        presetId: "iphone-15-pro",
        width: 393,
        height: 852,
        mobile: true,
        deviceScaleFactor: 3,
      },
    });
    expect(document.querySelector("button")).toBeNull();
  });

  it("supports keyboard resizing and Escape cancellation", async () => {
    await render();
    const button = harness.query("browser-device-resize-bottom");
    expect(button.getAttribute("aria-label")).toBe(
      "browserChrome.resize.bottom",
    );
    await harness.dispatch(
      button,
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    await frame();
    expect(native.setDevice).toHaveBeenLastCalledWith(browserState().tabId, {
      ...device,
      height: 820,
    });
    await harness.dispatch(
      button,
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    await harness.dispatch(
      button,
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await frame();
    expect(native.setDevice).toHaveBeenCalledOnce();
  });
});
