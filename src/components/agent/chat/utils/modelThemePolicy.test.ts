import { describe, expect, it } from "vitest";
import type { EnhancedModelMetadata } from "@/lib/types/modelRegistry";
import { filterModelsByTheme } from "./modelThemePolicy";

function createModel(
  id: string,
  overrides: Partial<EnhancedModelMetadata> = {},
): EnhancedModelMetadata {
  return {
    id,
    display_name: id,
    provider_id: "test-provider",
    provider_name: "Test Provider",
    family: null,
    tier: "pro",
    capabilities: {
      vision: false,
      tools: true,
      streaming: true,
      json_mode: true,
      function_calling: true,
      reasoning: false,
    },
    pricing: null,
    limits: {
      context_length: null,
      max_output_tokens: null,
      requests_per_minute: null,
      tokens_per_minute: null,
    },
    status: "active",
    release_date: null,
    is_latest: false,
    description: null,
    source: "local",
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

describe("modelThemePolicy", () => {
  it("knowledge 主题应优先保留推理聊天模型", () => {
    const models = [
      createModel("gemini-3-pro-image-preview"),
      createModel("deepseek-reasoner", {
        capabilities: {
          vision: false,
          tools: true,
          streaming: true,
          json_mode: true,
          function_calling: true,
          reasoning: true,
        },
      }),
      createModel("deepseek-chat"),
    ];

    const result = filterModelsByTheme("knowledge", models);

    expect(result.usedFallback).toBe(false);
    expect(result.models.map((model) => model.id)).toEqual([
      "deepseek-reasoner",
    ]);
    expect(result.policyName).toBe("reasoning-priority");
  });

  it("knowledge 主题在无推理模型时应回退到聊天模型", () => {
    const models = [
      createModel("gemini-3-pro-image-preview"),
      createModel("deepseek-chat"),
      createModel("text-embedding-3-large"),
    ];

    const result = filterModelsByTheme("knowledge", models);

    expect(result.usedFallback).toBe(false);
    expect(result.models.map((model) => model.id)).toEqual(["deepseek-chat"]);
    expect(result.policyName).toBe("chat-fallback");
  });

  it("social-media 主题应过滤掉图像和非聊天模型", () => {
    const models = [
      createModel("gemini-3-pro-image-preview"),
      createModel("text-embedding-3-large"),
      createModel("gpt-4o"),
    ];

    const result = filterModelsByTheme("social-media", models);

    expect(result.usedFallback).toBe(false);
    expect(result.models.map((model) => model.id)).toEqual(["gpt-4o"]);
    expect(result.policyName).toBe("chat-only");
  });

  it("general 主题不应改动模型列表", () => {
    const models = [
      createModel("gemini-3-pro-image-preview"),
      createModel("gemini-3-pro-preview"),
    ];

    const result = filterModelsByTheme("general", models);

    expect(result.usedFallback).toBe(false);
    expect(result.filteredOutCount).toBe(0);
    expect(result.models).toEqual(models);
    expect(result.policyName).toBe("none");
  });
});
