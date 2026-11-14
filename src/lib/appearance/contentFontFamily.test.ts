import { beforeEach, describe, expect, it } from "vitest";
import {
  getContentFontFamily,
  resetContentFontFamilyForTest,
  setContentFontFamily,
} from "./contentFontFamily";

describe("contentFontFamily", () => {
  beforeEach(() => resetContentFontFamilyForTest());

  it("persists a supported content font family", () => {
    expect(getContentFontFamily()).toBe("system");
    setContentFontFamily("serif");
    expect(getContentFontFamily()).toBe("serif");
  });
});
