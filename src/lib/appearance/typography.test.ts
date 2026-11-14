import { beforeEach, describe, expect, it } from "vitest";
import {
  getContentFontSize,
  resetContentFontSizeForTest,
  setContentFontSize,
} from "./typography";

describe("appearance typography", () => {
  beforeEach(() => resetContentFontSizeForTest());

  it("persists a supported content font size", () => {
    expect(getContentFontSize()).toBe(14);
    setContentFontSize(18);
    expect(getContentFontSize()).toBe(18);
  });
});
