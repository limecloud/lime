import { describe, expect, it } from "vitest";
import { getModelCapabilitySummary } from "./inferModelCapabilities";
import {
  buildModelCapabilitySendGateInput,
  evaluateModelInputCapability,
} from "./modelCapabilitySendGate";
import { buildProviderModelsFromRegistry } from "./providerModelsCatalog";

describe("当前官方模型的配置与图片发送", () => {
  it.each([
    ["openai", "gpt-6.1-sol"],
    ["openai", "gpt-6-luna"],
    ["codex", "gpt-6-astra"],
    ["kimi-for-coding", "kimi-for-coding"],
    ["kimi-for-coding", "k3-256k"],
    ["moonshotai-cn", "kimi-k3"],
    ["moonshotai", "kimi-k3"],
    ["zhipuai", "glm-5.3-flash"],
    ["zai-coding-plan", "glm-5.3-flash"],
    ["alibaba-cn", "qwen3.7-plus"],
    ["alibaba", "qwen3.8-flash"],
    ["xiaomi", "mimo-v2.6-flash"],
    ["xiaomi", "mimo-v2.6-pro"],
    ["deepseek", "deepseek-flash"],
    ["xai", "grok-4.7"],
    ["openrouter", "moonshotai/kimi-k3"],
  ])("允许 %s/%s 的截图输入", (providerId, modelId) => {
    const { models } = buildProviderModelsFromRegistry(
      {
        key: providerId,
        label: providerId,
        registryId: providerId,
        models: [modelId],
      },
      [],
      null,
    );
    expect(
      evaluateModelInputCapability(
        getModelCapabilitySummary(models[0]),
        buildModelCapabilitySendGateInput({ text: "分析截图", imageCount: 1 }),
      ),
    ).toMatchObject({ status: "allowed", missingInputModalities: [] });
  });

  it.each([
    ["deepseek", "deepseek-v4-pro"],
    ["zhipuai", "glm-5.3"],
    ["xiaomi", "mimo-v2.5-pro"],
    ["moonshotai", "kimi-k2"],
    ["xai", "grok-4.4"],
  ])("阻止未确认视觉支持的 %s/%s", (providerId, modelId) => {
    const { models } = buildProviderModelsFromRegistry(
      {
        key: providerId,
        label: providerId,
        registryId: providerId,
        models: [modelId],
      },
      [],
      null,
    );
    expect(
      evaluateModelInputCapability(
        getModelCapabilitySummary(models[0]),
        buildModelCapabilitySendGateInput({ text: "分析截图", imageCount: 1 }),
      ),
    ).toMatchObject({ status: "blocked", missingInputModalities: ["image"] });
  });
});
