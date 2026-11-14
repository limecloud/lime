import { beforeEach, describe, expect, it } from "vitest";
import {
  CODE_FONT_SIZES,
  getCodeFontSize,
  isCodeFontSize,
  resetCodeFontSizeForTest,
  setCodeFontSize,
} from "./codeFontSize";

describe("codeFontSize", () => {
  beforeEach(() => resetCodeFontSizeForTest());

  it("uses the Codex code range and default", () => {
    expect(CODE_FONT_SIZES[0]).toBe(8);
    expect(CODE_FONT_SIZES.at(-1)).toBe(24);
    expect(getCodeFontSize()).toBe(12);
  });

  it("persists a supported code font size", () => {
    setCodeFontSize(24);
    expect(getCodeFontSize()).toBe(24);
  });

  it("rejects values outside the Codex schema", () => {
    expect(isCodeFontSize(7)).toBe(false);
    expect(isCodeFontSize(25)).toBe(false);
    expect(isCodeFontSize(12.5)).toBe(false);
    setCodeFontSize(7);
    expect(getCodeFontSize()).toBe(12);
  });
});
