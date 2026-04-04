import { describe, expect, it } from "vitest";

import { onboardingPlugins, userProfiles } from "./constants";

describe("onboarding constants", () => {
  it("开发者引导与配置管理描述应使用 current 品牌表述", () => {
    const developerProfile = userProfiles.find((item) => item.id === "developer");
    const configSwitchPlugin = onboardingPlugins.find(
      (item) => item.id === "config-switch",
    );

    expect(developerProfile?.description).toContain("Claude、Codex、Gemini");
    expect(developerProfile?.description).not.toContain("Claude Code");
    expect(configSwitchPlugin?.description).toContain("Claude、Codex、Gemini");
    expect(configSwitchPlugin?.description).not.toContain("Claude Code");
  });
});
