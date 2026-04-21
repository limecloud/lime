import { describe, expect, it } from "vitest";
import {
  mergeAutomationServiceSkillContexts,
  resolveServiceSkillContextFromMetadataRecord,
} from "./serviceSkillContext";

describe("serviceSkillContext", () => {
  it("应把 cloud_required 解析成客户端执行的兼容目录标记", () => {
    const context = resolveServiceSkillContextFromMetadataRecord({
      service_skill: {
        id: "daily-trend-briefing",
        title: "每日趋势摘要",
        runner_type: "scheduled",
        execution_location: "cloud_required",
        source: "cloud_catalog",
      },
    });

    expect(context).not.toBeNull();
    expect(context?.executionLocationLabel).toBe("客户端执行");
    expect(context?.executionLocationLegacyCompat).toBe(true);
  });

  it("应在 merge 时保留 fallback 带来的兼容目录标记", () => {
    const primary = resolveServiceSkillContextFromMetadataRecord({
      service_skill: {
        id: "daily-trend-briefing",
        title: "每日趋势摘要",
        runner_type: "scheduled",
        execution_location: "client_default",
        source: "cloud_catalog",
      },
    });
    const fallback = resolveServiceSkillContextFromMetadataRecord({
      service_skill: {
        id: "daily-trend-briefing",
        title: "每日趋势摘要",
        runner_type: "scheduled",
        execution_location: "cloud_required",
        source: "cloud_catalog",
      },
    });

    const merged = mergeAutomationServiceSkillContexts(primary, fallback);

    expect(merged).not.toBeNull();
    expect(merged?.executionLocationLabel).toBe("客户端执行");
    expect(merged?.executionLocationLegacyCompat).toBe(true);
  });
});
