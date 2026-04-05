import { describe, expect, it } from "vitest";
import {
  isSpecializedWorkbenchTheme,
  isThemeType,
  normalizeThemeCanvasType,
  normalizeThemeType,
  normalizeThemeTypeOrNull,
} from "./workbenchContract";

describe("workbenchContract", () => {
  it("应识别支持的工作台主题", () => {
    expect(isThemeType("general")).toBe(true);
    expect(isThemeType("video")).toBe(false);
    expect(isThemeType("persistent")).toBe(false);
  });

  it("应把非法主题归一到 general", () => {
    expect(normalizeThemeType("poster")).toBe("general");
    expect(normalizeThemeType("music")).toBe("general");
    expect(normalizeThemeType("novel")).toBe("general");
    expect(normalizeThemeType("script")).toBe("general");
    expect(normalizeThemeType("persistent")).toBe("general");
    expect(normalizeThemeType(undefined)).toBe("general");
  });

  it("应支持返回 null 的主题归一和画布归一", () => {
    expect(normalizeThemeTypeOrNull("poster")).toBeNull();
    expect(normalizeThemeTypeOrNull("script")).toBeNull();
    expect(normalizeThemeTypeOrNull("persistent")).toBeNull();
    expect(normalizeThemeTypeOrNull("invalid-theme")).toBeNull();

    expect(normalizeThemeCanvasType("document")).toBe("document");
    expect(normalizeThemeCanvasType("video")).toBe("video");
    expect(normalizeThemeCanvasType("general")).toBeNull();
    expect(normalizeThemeCanvasType("invalid-theme")).toBeNull();
  });

  it("应不再识别任何专用工作台主题", () => {
    expect(isSpecializedWorkbenchTheme("general")).toBe(false);
    expect(isSpecializedWorkbenchTheme("custom-theme")).toBe(false);
    expect(isSpecializedWorkbenchTheme("persistent")).toBe(false);
  });
});
