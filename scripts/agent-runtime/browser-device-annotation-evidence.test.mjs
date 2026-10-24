import { describe, it, expect } from "vitest";
import { browserDeviceAnnotationAssertions } from "./browser-device-annotation-evidence.mjs";

function fixture() {
  const bounds = { x: 500, y: 120, width: 180, height: 320 };
  const rect = { x: 80, y: 100, width: 120, height: 72 };
  return {
    kind: "element",
    expectedRect: rect,
    input: [{ x: 34, y: 30 }],
    clicksAfter: 0,
    baselineSample: [92, 180, 12, 255],
    selection: {
      kind: "element",
      targetRect: rect,
      viewportSize: { width: 900, height: 1600 },
    },
    before: {
      state: { deviceViewport: { bounds } },
      metrics: { innerWidth: 900, innerHeight: 1600, clicks: 0 },
      native: { bounds, windowId: 1, ownerWebContentsId: 2, webContentsId: 3 },
    },
    editor: {
      native: {
        bounds: { x: 552, y: 140, width: 360, height: 264 },
        windowId: 1,
        ownerWebContentsId: 2,
        webContentsId: 4,
      },
      window: { width: 1200, height: 900 },
      bridge: { narrow: true, node: false, general: false },
    },
    capture: {
      status: "success",
      screenshotStatus: "captured",
      screenshot: { kind: "viewport", width: 360, height: 640 },
    },
    image: {
      file: "actual.png",
      size: { width: 360, height: 640 },
      rawSize: { width: 360, height: 640 },
      sample: [92, 180, 12, 255],
    },
  };
}
describe("native device annotation evidence", () => {
  it("accepts measured CSS, native and pixel coordinates with distinct scales", () => {
    expect(
      Object.values(browserDeviceAnnotationAssertions(fixture())).every(
        Boolean,
      ),
    ).toBe(true);
  });
  it.each([
    [
      "liveSelectionMatchesInput",
      (cell) => {
        cell.selection.targetRect = { ...cell.selection.targetRect, x: 300 };
      },
    ],
    [
      "cssViewportMatchesPage",
      (cell) => {
        cell.before.metrics.innerWidth = 180;
      },
    ],
    [
      "nativeBoundsMatchProjection",
      (cell) => {
        cell.before.state.deviceViewport = {
          bounds: { x: 0, y: 0, width: 900, height: 1600 },
        };
      },
    ],
    [
      "inputInsideNativeView",
      (cell) => {
        cell.input[0].x = 180;
      },
    ],
    [
      "editorUsesActualPageBounds",
      (cell) => {
        cell.editor.native.bounds.x = 1040;
      },
    ],
    [
      "editorStaysWithNativeOwner",
      (cell) => {
        cell.editor.native.ownerWebContentsId = 9;
      },
    ],
    [
      "trustedEditorHasNarrowBridge",
      (cell) => {
        cell.editor.bridge.general = true;
      },
    ],
    [
      "captureSucceeded",
      (cell) => {
        cell.capture.screenshotStatus = "timeout";
      },
    ],
    [
      "capturePolicyMatchesSelection",
      (cell) => {
        cell.capture.screenshot.kind = "crop";
      },
    ],
    [
      "capturePixelDimensions",
      (cell) => {
        cell.image.size.width = 900;
      },
    ],
    [
      "captureContainsSelectedColor",
      (cell) => {
        cell.image.sample = [255, 255, 255, 255];
      },
    ],
    [
      "pickerDidNotActivatePage",
      (cell) => {
        cell.clicksAfter = 1;
      },
    ],
  ])("rejects a broken boundary: %s", (name, change) => {
    const cell = fixture();
    change(cell);
    expect(browserDeviceAnnotationAssertions(cell)[name]).toBe(false);
  });
  it("requires an actual bounded crop for a region", () => {
    const cell = fixture();
    cell.kind = cell.selection.kind = "region";
    cell.capture.screenshot = {
      kind: "crop",
      width: 120,
      height: 120,
      cropRect: { x: 0, y: 0, width: 300, height: 300 },
    };
    cell.image.size = { width: 120, height: 120 };
    expect(
      Object.values(browserDeviceAnnotationAssertions(cell)).every(Boolean),
    ).toBe(true);
    delete cell.capture.screenshot.cropRect;
    expect(browserDeviceAnnotationAssertions(cell).capturePixelDimensions).toBe(
      false,
    );
  });
});
