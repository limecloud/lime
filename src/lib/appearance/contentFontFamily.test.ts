import { beforeEach, describe, expect, it } from "vitest";
import {
  getContentFontFamily,
  resetContentFontFamilyForTest,
  resolveContentFontFamily,
  setContentFontFamily,
} from "./contentFontFamily";
import { resetUiFontFamilyForTest, setUiFontFamily } from "./uiFontFamily";

describe("contentFontFamily", () => {
  beforeEach(() => {
    resetContentFontFamilyForTest();
    resetUiFontFamilyForTest();
  });

  it("defaults to the Codex 'Same as UI font' value", () => {
    expect(getContentFontFamily()).toBe("ui");
  });

  it("persists a supported content font family", () => {
    setContentFontFamily("serif");
    expect(getContentFontFamily()).toBe("serif");
  });

  it("follows UI font changes while same-as-UI is selected", () => {
    setUiFontFamily("mono");
    expect(resolveContentFontFamily("ui")).toContain("ui-monospace");
    setUiFontFamily("serif");
    expect(resolveContentFontFamily("ui")).toContain("ui-serif");
  });
});
