import { beforeEach, describe, expect, it } from "vitest";
import {
  UI_FONT_SIZES,
  getUiFontSize,
  resetUiFontSizeForTest,
  setUiFontSize,
} from "./uiFontSize";

describe("uiFontSize", () => {
  beforeEach(() => resetUiFontSizeForTest());

  it("uses the Codex sans range and default", () => {
    expect(UI_FONT_SIZES).toEqual([11, 12, 13, 14, 15, 16]);
    expect(getUiFontSize()).toBe(14);
  });

  it("persists a supported UI font size", () => {
    setUiFontSize(11);
    expect(getUiFontSize()).toBe(11);
    setUiFontSize(16);
    expect(getUiFontSize()).toBe(16);
  });
});
