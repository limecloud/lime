import { describe, expect, it } from "vitest";
import {
  browserPageZoomFromRendered,
  clampBrowserPageZoom,
  renderedBrowserZoom,
} from "./browserZoom";

describe("browser page zoom and fitted device zoom", () => {
  it.each([
    [1.5, 0.5, 75],
    [1, 0.33, 33],
    [1.66, 0.5, 83],
    [2, 0, 0],
  ])(
    "renders native zoom %s through viewport scale %s as %s%%",
    (native, scale, expected) => {
      expect(renderedBrowserZoom(native, scale)).toBe(expected);
    },
  );
  it.each([
    [125, 0.5, 2.5],
    [200, 0.1, 5],
    [50, 3, 0.25],
    [125, 0, 1.25],
    [100, 0.3, 3.33],
    [10, 0.1, 2.5],
    [0, 0.5, 0.5],
  ])(
    "converts %s%% at viewport scale %s to native zoom %s",
    (percent, scale, expected) => {
      expect(browserPageZoomFromRendered(percent, scale)).toBe(expected);
    },
  );
  it("shares the reference native clamp without mixing it with viewport scaling", () => {
    expect(clampBrowserPageZoom(0.1)).toBe(0.25);
    expect(clampBrowserPageZoom(8)).toBe(5);
  });
});
