import { beforeEach, describe, expect, it } from "vitest";
import {
  CONTENT_FONT_SIZES,
  getContentFontSize,
  resetContentFontSizeForTest,
  setContentFontSize,
} from "./typography";

describe("appearance typography", () => {
  beforeEach(() => resetContentFontSizeForTest());

  it("uses the Codex Pages range and default", () => {
    expect(CONTENT_FONT_SIZES).toEqual([
      12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    ]);
    expect(getContentFontSize()).toBe(15);
  });

  it("persists a supported content font size", () => {
    setContentFontSize(18);
    expect(getContentFontSize()).toBe(18);
    setContentFontSize(24);
    expect(getContentFontSize()).toBe(24);
  });
});
