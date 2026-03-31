import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_AUTO_CONTINUE_SETTINGS,
  getAutoContinueSettingsStorageKey,
  loadAutoContinueSettings,
  saveAutoContinueSettings,
  sanitizeAutoContinueSettings,
} from "./autoContinueSettings";

describe("autoContinueSettings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("未保存时应返回默认设置", () => {
    const settings = loadAutoContinueSettings("project-a");
    expect(settings).toEqual(DEFAULT_AUTO_CONTINUE_SETTINGS);
  });

  it("应按 projectId 隔离保存和读取", () => {
    saveAutoContinueSettings("project-a", {
      ...DEFAULT_AUTO_CONTINUE_SETTINGS,
      continuationLength: 2,
    });
    saveAutoContinueSettings("project-b", {
      ...DEFAULT_AUTO_CONTINUE_SETTINGS,
      continuationLength: 1,
    });

    expect(loadAutoContinueSettings("project-a").continuationLength).toBe(2);
    expect(loadAutoContinueSettings("project-b").continuationLength).toBe(1);
  });

  it("应对非法值做归一化处理", () => {
    localStorage.setItem(
      getAutoContinueSettingsStorageKey("project-a"),
      JSON.stringify({
        enabled: "true",
        fastModeEnabled: 1,
        continuationLength: 10,
        sensitivity: -20,
      }),
    );

    const settings = loadAutoContinueSettings("project-a");
    expect(settings).toEqual({
      ...DEFAULT_AUTO_CONTINUE_SETTINGS,
      continuationLength: 2,
      sensitivity: 0,
    });
  });

  it("sanitizeAutoContinueSettings 应补全缺省字段", () => {
    const sanitized = sanitizeAutoContinueSettings({
      enabled: false,
      fastModeEnabled: true,
    });

    expect(sanitized).toEqual({
      ...DEFAULT_AUTO_CONTINUE_SETTINGS,
      enabled: false,
      fastModeEnabled: true,
    });
  });
});
