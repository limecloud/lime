import { describe, expect, it } from "vitest";
import type { SceneAppType } from "./types";
import {
  normalizeSceneAppTypeFilter,
  normalizeSceneAppsPageParams,
  serializeSceneAppsPageParams,
} from "./navigation";

describe("sceneapp navigation", () => {
  it("应只允许 current sceneappType 进入页面筛选参数", () => {
    expect(normalizeSceneAppTypeFilter("hybrid")).toBe("hybrid");
    expect(normalizeSceneAppTypeFilter("local_instant")).toBe("local_instant");
    expect(normalizeSceneAppTypeFilter("cloud_managed")).toBeUndefined();
  });

  it("旧目录 cloud_managed 筛选参数应在页面状态中被丢弃", () => {
    const normalized = normalizeSceneAppsPageParams({
      sceneappId: "voice-runtime",
      typeFilter: "cloud_managed" as unknown as SceneAppType,
      search: "配音",
    });

    expect(normalized).toEqual({
      sceneappId: "voice-runtime",
      search: "配音",
    });
    expect(serializeSceneAppsPageParams(normalized)).toBe(
      JSON.stringify({
        sceneappId: "voice-runtime",
        search: "配音",
      }),
    );
  });
});
