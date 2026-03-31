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
    expect(isThemeType("video")).toBe(true);
    expect(isThemeType("persistent")).toBe(false);
  });

  it("应把非法主题归一到 general", () => {
    expect(normalizeThemeType("poster")).toBe("document");
    expect(normalizeThemeType("music")).toBe("document");
    expect(normalizeThemeType("novel")).toBe("document");
    expect(normalizeThemeType("script")).toBe("video");
    expect(normalizeThemeType("persistent")).toBe("general");
    expect(normalizeThemeType(undefined)).toBe("general");
  });

  it("应支持返回 null 的主题归一和画布归一", () => {
    expect(normalizeThemeTypeOrNull("poster")).toBe("document");
    expect(normalizeThemeTypeOrNull("script")).toBe("video");
    expect(normalizeThemeTypeOrNull("persistent")).toBeNull();
    expect(normalizeThemeTypeOrNull("invalid-theme")).toBeNull();

    expect(normalizeThemeCanvasType("poster")).toBe("document");
    expect(normalizeThemeCanvasType("script")).toBe("video");
    expect(normalizeThemeCanvasType("general")).toBeNull();
    expect(normalizeThemeCanvasType("invalid-theme")).toBeNull();
  });

  it("应只把非 general 的合法主题视为内容工作台主题", () => {
    expect(isSpecializedWorkbenchTheme("general")).toBe(false);
    expect(isSpecializedWorkbenchTheme("knowledge")).toBe(true);
    expect(isSpecializedWorkbenchTheme("persistent")).toBe(false);
  });
});
