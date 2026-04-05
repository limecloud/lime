import { describe, expect, it } from "vitest";

import * as onboardingConstants from "./constants";

describe("onboarding constants", () => {
  it("不再暴露旧插件安装流常量", () => {
    expect("userProfiles" in onboardingConstants).toBe(false);
    expect("onboardingPlugins" in onboardingConstants).toBe(false);
    expect(onboardingConstants.ONBOARDING_VERSION).toBe("1.1.0");
  });
});
