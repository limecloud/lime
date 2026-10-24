import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserDeviceToolbar } from "./BrowserDeviceToolbar";
import type { BrowserTabState } from "@/lib/api/browserTab";
import {
  browserState,
  createBrowserComponentHarness,
  deferred,
} from "./browserWorkspace.testFixtures";

const native = vi.hoisted(() => ({ device: vi.fn(), zoom: vi.fn() }));
vi.mock("@/lib/api/browserTab", () => ({
  setBrowserTabDevice: native.device,
  setBrowserTabZoom: native.zoom,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const device = {
  presetId: "responsive" as const,
  width: 390,
  height: 844,
  deviceScaleFactor: 3,
  mobile: true,
  scale: 1,
};
const state = (patch: Partial<BrowserTabState> = {}) =>
  browserState({ device, ...patch });
let harness: ReturnType<typeof createBrowserComponentHarness>;
const run = async (
  operation: () => Promise<BrowserTabState>,
  valid?: () => boolean,
) => {
  if (valid?.() === false) return;
  try {
    await operation();
  } catch {
    /* Workspace owns the error surface. */
  }
};
const render = (patch: Partial<BrowserTabState> = {}, active = true) =>
  harness.render(
    <BrowserDeviceToolbar selected={state(patch)} run={run} active={active} />,
  );
const input = (key: string) =>
  harness.query<HTMLInputElement>(`browser-device-${key}`);
const choose = async (value: string) => {
  const select = document.querySelector<HTMLSelectElement>(
    "select[aria-label='browserChrome.device']",
  )!;
  select.value = value;
  await harness.dispatch(select, new Event("change", { bubbles: true }));
};

describe("device toolbar live input", () => {
  beforeEach(() => {
    harness = createBrowserComponentHarness();
    vi.clearAllMocks();
    native.device.mockResolvedValue(state());
    native.zoom.mockResolvedValue(state());
  });
  afterEach(async () => harness.unmount());

  it("applies valid dimensions immediately and combines width and height while a receipt is pending", async () => {
    const first = deferred<BrowserTabState>();
    native.device.mockReturnValueOnce(first.promise);
    await render();
    await harness.change(input("width"), "640");
    expect(native.device).toHaveBeenCalledWith(state().tabId, {
      ...device,
      width: 640,
    });
    expect(input("height").disabled).toBe(false);
    await harness.change(input("height"), "900");
    await harness.change(input("width"), "720");
    expect(native.device).toHaveBeenCalledTimes(1);
    await act(async () =>
      first.resolve(state({ device: { ...device, width: 640 } })),
    );
    expect(native.device).toHaveBeenCalledTimes(2);
    expect(native.device).toHaveBeenLastCalledWith(state().tabId, {
      ...device,
      width: 720,
      height: 900,
    });
    expect(input("width").value).toBe("720");
  });

  it.each([
    ["width", "99", 240],
    ["height", "99", 160],
    ["width", "5000", 4096],
    ["height", "5000", 4096],
  ] as const)(
    "keeps transient %s=%s until blur then clamps to %s",
    async (key, value, clamped) => {
      await render();
      await harness.change(input(key), value);
      expect(native.device).not.toHaveBeenCalled();
      expect(input(key).value).toBe(value);
      await harness.dispatch(
        input(key),
        new FocusEvent("focusout", { bubbles: true }),
      );
      expect(native.device).toHaveBeenLastCalledWith(state().tabId, {
        ...device,
        [key]: clamped,
      });
    },
  );

  it("resets native page zoom after selecting a preset and retains reset before later size edits", async () => {
    const first = deferred<BrowserTabState>();
    native.device.mockReturnValueOnce(first.promise);
    await render({ zoomFactor: 1.5 });
    await choose("ipad-air");
    await harness.change(input("width"), "821");
    expect(native.zoom).not.toHaveBeenCalled();
    await act(async () =>
      first.resolve(state({ device: { ...device, width: 820, height: 1180 } })),
    );
    expect(native.zoom).toHaveBeenCalledWith(state().tabId, 1);
    expect(native.device).toHaveBeenLastCalledWith(state().tabId, {
      ...device,
      presetId: "responsive",
      width: 821,
      height: 1180,
    });
    expect(native.device.mock.invocationCallOrder[1]).toBeGreaterThan(
      native.zoom.mock.invocationCallOrder[0],
    );
  });

  it.each(["tab", "session", "view", "webContents", "inactive", "unmount"])(
    "discards queued edits and delayed preset zoom reset after %s changes",
    async (identity) => {
      const first = deferred<BrowserTabState>();
      native.device.mockReturnValueOnce(first.promise);
      await render();
      await choose("ipad-air");
      await harness.change(input("width"), "821");
      if (identity === "unmount") await harness.unmount();
      else
        await render(
          {
            ...(identity === "tab" ? { tabId: "other" } : {}),
            ...(identity === "session" ? { browserSessionId: "other" } : {}),
            ...(identity === "view" ? { viewId: "other" } : {}),
            ...(identity === "webContents" ? { webContentsId: 102 } : {}),
          },
          identity !== "inactive",
        );
      await act(async () => first.resolve(state()));
      expect(native.device).toHaveBeenCalledTimes(1);
      expect(native.zoom).not.toHaveBeenCalled();
      if (identity === "unmount") harness = createBrowserComponentHarness();
    },
  );

  it("does not reset zoom or send queued changes after the native device request fails", async () => {
    native.device.mockRejectedValueOnce(new Error("Device unavailable"));
    await render();
    await choose("ipad-air");
    expect(native.zoom).not.toHaveBeenCalled();
    expect(document.querySelector("[aria-busy='true']")).toBeNull();
  });

  it("shows the rendered zoom and converts a selection to base page zoom without changing the viewport", async () => {
    await render({
      zoomFactor: 1.5,
      deviceViewport: {
        bounds: { x: 0, y: 0, width: 195, height: 422 },
        scale: 0.5,
      },
    });
    const zoom = document.querySelector<HTMLSelectElement>(
      "select[aria-label='browserChrome.zoom']",
    )!;
    expect(zoom.value).toBe("75");
    zoom.value = "125";
    await harness.dispatch(zoom, new Event("change", { bubbles: true }));
    expect(native.zoom).toHaveBeenLastCalledWith(state().tabId, 2.5);
    expect(native.device).not.toHaveBeenCalled();
  });
});
