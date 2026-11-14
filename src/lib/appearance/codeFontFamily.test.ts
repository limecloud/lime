import { beforeEach, describe, expect, it } from "vitest";
import {
  CODE_FONT_FAMILIES,
  getCodeFontFamily,
  resetCodeFontFamilyForTest,
  resolveCodeFontFamily,
  setCodeFontFamily,
} from "./codeFontFamily";

describe("codeFontFamily", () => {
  beforeEach(() => resetCodeFontFamilyForTest());

  it("defaults to the existing system monospace stack", () => {
    expect(CODE_FONT_FAMILIES).toEqual([
      "system",
      "sf-mono",
      "menlo",
      "consolas",
      "courier",
    ]);
    expect(getCodeFontFamily()).toBe("system");
    expect(resolveCodeFontFamily("system")).toContain("ui-monospace");
  });

  it("persists and resolves a monospace family", () => {
    setCodeFontFamily("menlo");
    expect(getCodeFontFamily()).toBe("menlo");
    expect(resolveCodeFontFamily("menlo")).toContain("Menlo");
    setCodeFontFamily("courier");
    expect(resolveCodeFontFamily("courier")).toContain("Courier New");
  });
});
