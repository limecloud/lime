/**
 * Config Validation Tests for i18n
 *
 * Tests for invalid config scenarios, fallback behavior, and type safety.
 */

import { describe, it, expect } from "vitest";
import { isValidLanguage, Language, getTextMap } from "../text-map";

describe("Config Validation: Language Types", () => {
  it("should accept valid language codes", () => {
    expect(isValidLanguage("zh")).toBe(true);
    expect(isValidLanguage("en")).toBe(true);
  });

  it("should reject invalid language codes", () => {
    expect(isValidLanguage("invalid")).toBe(false);
    expect(isValidLanguage("")).toBe(false);
    expect(isValidLanguage("ZH")).toBe(false);
    expect(isValidLanguage("EN")).toBe(false);
    expect(isValidLanguage("english")).toBe(false);
  });
});

describe("Config Validation: Default Language Fallback", () => {
  it("should fallback to zh for invalid language", () => {
    const map = getTextMap("invalid" as Language);
    expect(map).toBeDefined();
    expect(map["设置"]).toBe("设置"); // Chinese
  });

  it("should fallback to zh for null language", () => {
    const map = getTextMap(null as unknown as Language);
    expect(map).toBeDefined();
  });

  it("should fallback to zh for undefined language", () => {
    const map = getTextMap(undefined as unknown as Language);
    expect(map).toBeDefined();
  });
});

describe("Config Validation: Type Safety", () => {
  it("should only allow valid Language type", () => {
    const validLanguages: Language[] = ["zh", "en"];
    validLanguages.forEach((lang) => {
      expect(isValidLanguage(lang)).toBe(true);
    });
  });
});

describe("Config Validation: Text Map Integrity", () => {
  it("should have same keys in zh and en maps", () => {
    const zhMap = getTextMap("zh");
    const enMap = getTextMap("en");

    const zhKeys = Object.keys(zhMap).filter((k) => !k.startsWith("//"));
    const enKeys = Object.keys(enMap).filter((k) => !k.startsWith("//"));

    // Check if all Chinese keys exist in English map
    zhKeys.forEach((key) => {
      expect(enMap).toHaveProperty(key);
    });

    // Check if all English keys exist in Chinese map
    enKeys.forEach((key) => {
      expect(zhMap).toHaveProperty(key);
    });
  });

  it("should not have empty values", () => {
    const enMap = getTextMap("en");
    const zhMap = getTextMap("zh");

    Object.entries(enMap).forEach(([key, value]) => {
      if (!key.startsWith("//")) {
        expect(value).toBeTruthy();
        expect(typeof value).toBe("string");
      }
    });

    Object.entries(zhMap).forEach(([key, value]) => {
      if (!key.startsWith("//")) {
        expect(value).toBeTruthy();
        expect(typeof value).toBe("string");
      }
    });
  });
});
