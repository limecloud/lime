import { beforeEach, describe, expect, it } from "vitest";
import {
  getFontSmoothingEnabled,
  isMacOSPlatform,
  resetFontSmoothingForTest,
  setFontSmoothingEnabled,
} from "./fontSmoothing";

describe("fontSmoothing", () => {
  beforeEach(() => resetFontSmoothingForTest());

  it("defaults to enabled", () => {
    expect(getFontSmoothingEnabled()).toBe(true);
    setFontSmoothingEnabled(false);
    expect(getFontSmoothingEnabled()).toBe(false);
  });

  it("detects the macOS-only control boundary", () => {
    expect(isMacOSPlatform()).toBe(false);
  });
});
