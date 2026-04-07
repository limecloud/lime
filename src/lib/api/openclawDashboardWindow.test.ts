import { describe, expect, it } from "vitest";
import { resolveOpenClawDashboardProfileKey } from "./openclawDashboardWindow";

describe("openclawDashboardWindow", () => {
  it("未提供版本键时使用默认 profile key", () => {
    expect(resolveOpenClawDashboardProfileKey()).toBe(
      "openclaw-dashboard-profile",
    );
    expect(resolveOpenClawDashboardProfileKey("   ")).toBe(
      "openclaw-dashboard-profile",
    );
  });

  it("版本键会被规范化后拼入 profile key", () => {
    expect(resolveOpenClawDashboardProfileKey("2026.3.13-zh.1")).toBe(
      "openclaw-dashboard-profile-2026.3.13-zh.1",
    );
    expect(resolveOpenClawDashboardProfileKey(" OpenClaw UI Rev #42 ")).toBe(
      "openclaw-dashboard-profile-openclaw-ui-rev-42",
    );
  });
});
