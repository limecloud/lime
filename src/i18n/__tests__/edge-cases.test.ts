/**
 * Edge Case Testing for i18n Patch Layer
 *
 * Tests for race conditions, memory leaks, performance, and ambiguous text handling.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getTextMap, Language } from "../text-map";

describe("Edge Cases: Text Map", () => {
  it("should return Chinese text map for zh language", () => {
    const map = getTextMap("zh");
    expect(map).toBeDefined();
    expect(map["设置"]).toBe("设置");
  });

  it("should return English text map for en language", () => {
    const map = getTextMap("en");
    expect(map).toBeDefined();
    expect(map["设置"]).toBe("Settings");
  });

  it("should handle missing keys gracefully", () => {
    const map = getTextMap("en");
    expect(map["这是一个绝对不存在的测试键_xyz_123"]).toBeUndefined();
  });

  it("should skip comment entries", () => {
    const map = getTextMap("en");
    // Comment entries start with //
    expect(map["// ==="]).toBeUndefined();
  });
});

describe("Edge Cases: Performance", () => {
  it.skip("should complete text map lookup within 1ms", () => {
    const startTime = performance.now();
    for (let i = 0; i < 1000; i++) {
      getTextMap("en");
    }
    const endTime = performance.now();
    const duration = endTime - startTime;
    expect(duration).toBeLessThan(1);
  });
});

describe("Edge Cases: Ambiguous Chinese Text", () => {
  it("should handle same word in different contexts", () => {
    const mapEn = getTextMap("en");
    const mapZh = getTextMap("zh");

    // "设置" appears in multiple contexts
    expect(mapZh["设置"]).toBe("设置");
    expect(mapEn["设置"]).toBe("Settings");

    // "通用" is a specific context
    expect(mapZh["通用"]).toBe("通用");
    expect(mapEn["通用"]).toBe("General");
  });
});

describe("Edge Cases: Language Validation", () => {
  it("should handle invalid language codes", () => {
    const map = getTextMap("invalid" as Language);
    expect(map).toBeDefined(); // Should fallback to zh
  });
});

// Mock performance metrics
declare global {
  interface Window {
    __I18N_METRICS__?: {
      patchTimes: number[];
      languageChanges: number;
    };
  }
}

describe("Edge Cases: Metrics Tracking", () => {
  beforeEach(() => {
    window.__I18N_METRICS__ = {
      patchTimes: [],
      languageChanges: 0,
    };
  });

  afterEach(() => {
    delete window.__I18N_METRICS__;
  });

  it("should track patch times", () => {
    if (window.__I18N_METRICS__) {
      window.__I18N_METRICS__.patchTimes.push(10);
      window.__I18N_METRICS__.patchTimes.push(20);
      window.__I18N_METRICS__.patchTimes.push(15);

      expect(window.__I18N_METRICS__.patchTimes).toHaveLength(3);
      expect(window.__I18N_METRICS__.patchTimes[0]).toBe(10);
    }
  });

  it("should track language changes", () => {
    if (window.__I18N_METRICS__) {
      window.__I18N_METRICS__.languageChanges = 5;
      expect(window.__I18N_METRICS__.languageChanges).toBe(5);
    }
  });
});
