import { describe, expect, it } from "vitest";
import {
  annotationCrop,
  readAnnotationSelection,
} from "./browserAnnotationModel";

const source = {
  kind: "region",
  framePath: "main",
  targetRect: { x: 0, y: 0, width: 100, height: 80 },
  viewportSize: { width: 800, height: 600 },
  scrollPosition: { x: 0, y: 0 },
  devicePixelRatio: 2,
  markerViewportPoint: { x: 12, y: 12 },
  targetSelector: null,
  targetPath: null,
  targetRole: null,
  targetText: null,
};
describe("Browser annotation geometry boundary", () => {
  it.each([
    { targetRect: { x: 790, y: 0, width: 100, height: 80 } },
    { viewportSize: { width: NaN, height: 600 } },
    { devicePixelRatio: 0 },
    { markerViewportPoint: { x: -1, y: 0 } },
    { framePath: "child" },
    { kind: "text" },
  ])("rejects malformed or unsupported geometry %j", (patch) => {
    expect(() =>
      readAnnotationSelection(
        { ...source, ...patch },
        "region",
        "https://page.test",
        "Page",
      ),
    ).toThrow();
  });
  it("clamps a necessary crop at image edges and does not crop always mode", () => {
    const selection = readAnnotationSelection(
      source,
      "region",
      "https://page.test",
      "Page",
    );
    expect(
      annotationCrop(selection, { width: 1600, height: 1200 }, "necessary"),
    ).toEqual({
      pixels: { x: 0, y: 0, width: 232, height: 192 },
      viewport: { x: 0, y: 0, width: 116, height: 96 },
    });
    expect(
      annotationCrop(selection, { width: 1600, height: 1200 }, "always"),
    ).toBeNull();
  });
});
