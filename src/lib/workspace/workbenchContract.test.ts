import { describe, expect, it } from "vitest";
import {
  isContentCreationTheme,
  isThemeType,
  normalizeThemeType,
} from "./workbenchContract";

describe("workbenchContract", () => {
  it("应识别支持的工作台主题", () => {
    expect(isThemeType("general")).toBe(true);
    expect(isThemeType("video")).toBe(true);
    expect(isThemeType("persistent")).toBe(false);
  });

  it("应把非法主题归一到 general", () => {
    expect(normalizeThemeType("poster")).toBe("poster");
    expect(normalizeThemeType("persistent")).toBe("general");
    expect(normalizeThemeType(undefined)).toBe("general");
  });

  it("应只把非 general 的合法主题视为内容工作台主题", () => {
    expect(isContentCreationTheme("general")).toBe(false);
    expect(isContentCreationTheme("knowledge")).toBe(true);
    expect(isContentCreationTheme("persistent")).toBe(false);
  });
});
