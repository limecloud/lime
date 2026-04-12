import { describe, expect, it } from "vitest";
import {
  getStableProcessingDescription,
  resolveStableProcessingProviderGroup,
  shouldShowStableProcessingNotice,
  STABLE_PROCESSING_LABEL,
} from "./stableProcessingExperience";

describe("stableProcessingExperience", () => {
  it("应复用统一的稳妥模式标签", () => {
    expect(STABLE_PROCESSING_LABEL).toBe("稳妥模式");
  });

  it("直接选择高风险 provider 时应命中稳妥模式", () => {
    expect(
      resolveStableProcessingProviderGroup({
        providerType: "zhipuai",
        model: "glm-4.6",
      }),
    ).toBe("zhipuai");
  });

  it("即使走兼容 provider，GLM 模型也应提前命中稳妥模式", () => {
    expect(
      shouldShowStableProcessingNotice({
        providerType: "openai",
        model: "glm-4.7",
      }),
    ).toBe(true);
  });

  it("普通模型不应展示稳妥模式提示", () => {
    expect(
      shouldShowStableProcessingNotice({
        providerType: "openai",
        model: "gpt-4.1",
      }),
    ).toBe(false);
  });

  it("Team 文案应强调子任务依次开始", () => {
    expect(getStableProcessingDescription("team")).toContain("子任务");
    expect(getStableProcessingDescription("request")).toContain("同类请求");
  });
});
