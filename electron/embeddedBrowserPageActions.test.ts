import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Input } from "electron";
import {
  applyBrowserDevice,
  browserCommandForInput,
  captureBrowserPage,
  printBrowserPage,
  readBrowserDevice,
} from "./embeddedBrowserPageActions";

const { writeImage } = vi.hoisted(() => ({ writeImage: vi.fn() }));
vi.mock("./electronRuntime", () => ({ clipboard: { writeImage } }));

function key(key: string, extra: Partial<Input> = {}): Input {
  return {
    type: "keyDown",
    key,
    code: key,
    isAutoRepeat: false,
    isComposing: false,
    shift: false,
    control: false,
    alt: false,
    meta: false,
    location: 0,
    modifiers: [],
    ...extra,
  };
}

describe("native Browser page actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes native focused-page shortcuts by platform and leaves typing/IME untouched", () => {
    expect(browserCommandForInput(key("l", { meta: true }), "darwin")).toBe(
      "focus-address",
    );
    expect(browserCommandForInput(key("f", { control: true }), "win32")).toBe(
      "find",
    );
    expect(
      browserCommandForInput(key("ArrowLeft", { alt: true }), "win32"),
    ).toBe("go-back");
    expect(
      browserCommandForInput(key("+", { meta: true, shift: true }), "darwin"),
    ).toBe("zoom-in");
    expect(
      browserCommandForInput(key(".", { meta: true, shift: true }), "darwin"),
    ).toBe("annotate");
    expect(browserCommandForInput(key(">", { meta: true, shift: true, code: "Period" }), "darwin")).toBe("annotate");
    expect(browserCommandForInput(key("f"), "win32")).toBeNull();
    expect(
      browserCommandForInput(key("l", { control: true }), "darwin"),
    ).toBeNull();
    expect(
      browserCommandForInput(
        key("f", { control: true, isComposing: true }),
        "win32",
      ),
    ).toBeNull();
    expect(
      browserCommandForInput(
        key("w", { control: true, isAutoRepeat: true }),
        "win32",
      ),
    ).toBeNull();
  });

  it("validates device bounds and applies DPR and viewport scale independently of page zoom", () => {
    const device = readBrowserDevice({
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      scale: 0.5,
      mobile: true,
    });
    const native = {
      enableDeviceEmulation: vi.fn(),
      disableDeviceEmulation: vi.fn(),
    };
    applyBrowserDevice(native as never, device);
    expect(native.enableDeviceEmulation).toHaveBeenCalledWith({
      screenPosition: "mobile",
      screenSize: { width: 390, height: 844 },
      viewPosition: { x: 0, y: 0 },
      viewSize: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      scale: 0.5,
    });
    applyBrowserDevice(native as never, null);
    expect(native.disableDeviceEmulation).toHaveBeenCalledOnce();
    expect(() => readBrowserDevice({ ...device, width: NaN })).toThrow("width");
    expect(() => readBrowserDevice({ ...device, scale: 0 })).toThrow("scale");
    expect(() => readBrowserDevice(undefined)).toThrow("object or null");
  });

  it("opens a real print dialog contract and reports cancellation without claiming success", async () => {
    const native = {
      print: vi.fn((_options, done) => done(false, "Print job canceled")),
    };
    await expect(printBrowserPage(native as never)).resolves.toEqual({
      printed: false,
      failureReason: "Print job canceled",
    });
    expect(native.print).toHaveBeenCalledWith(
      { silent: false, printBackground: true },
      expect.any(Function),
    );
    native.print.mockImplementation((_options, done) => done(true, ""));
    await expect(printBrowserPage(native as never)).resolves.toEqual({
      printed: true,
      failureReason: null,
    });
    native.print.mockImplementation(() => {
      throw new Error("printer unavailable");
    });
    await expect(printBrowserPage(native as never)).rejects.toThrow(
      "printer unavailable",
    );
  });

  it("captures the native viewport and writes only explicitly requested captures to clipboard", async () => {
    const image = {
      isEmpty: () => false,
      getSize: () => ({ width: 1170, height: 2532 }),
      toDataURL: () => "data:image/png;base64,aGVsbG8=",
    };
    const native = { capturePage: vi.fn(async () => image) };
    await expect(captureBrowserPage(native as never, false)).resolves.toEqual({
      dataUrl: "data:image/png;base64,aGVsbG8=",
      width: 1170,
      height: 2532,
      copiedToClipboard: false,
    });
    expect(writeImage).not.toHaveBeenCalled();
    await captureBrowserPage(native as never, true);
    expect(writeImage).toHaveBeenCalledWith(image);
    native.capturePage.mockResolvedValue({ ...image, isEmpty: () => true });
    await expect(captureBrowserPage(native as never, true)).rejects.toThrow(
      "empty",
    );
  });
});
