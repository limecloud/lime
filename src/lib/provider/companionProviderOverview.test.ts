import { describe, expect, it } from "vitest";
import { buildCompanionProviderOverview } from "./companionProviderOverview";

describe("buildCompanionProviderOverview", () => {
  it("应从 API Key Provider 输出脱敏摘要", () => {
    const result = buildCompanionProviderOverview([
      {
        id: "deepseek",
        name: "DeepSeek",
        type: "openai",
        api_host: "https://api.deepseek.com/v1",
        is_system: false,
        group: "cloud",
        enabled: true,
        sort_order: 10,
        custom_models: [],
        prompt_cache_mode: null,
        api_key_count: 1,
        api_keys: [
          {
            id: "deepseek-key-1",
            provider_id: "deepseek",
            api_key_masked: "sk-***1234",
            enabled: true,
            usage_count: 0,
            error_count: 0,
            created_at: "2026-04-01T00:00:00Z",
          },
        ],
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:00:00Z",
      },
    ]);

    expect(result).toEqual({
      providers: [
        {
          provider_type: "deepseek",
          display_name: "DeepSeek",
          total_count: 1,
          healthy_count: 1,
          available: true,
          needs_attention: false,
        },
      ],
      total_provider_count: 1,
      available_provider_count: 1,
      needs_attention_provider_count: 0,
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("sk-***1234");
    expect(serialized).not.toContain("deepseek-key-1");
    expect(serialized).not.toContain("api_host");
  });

  it("应忽略未配置 Key 且非本地 keyless 的 Provider", () => {
    const result = buildCompanionProviderOverview([
      {
        id: "openai",
        name: "OpenAI",
        type: "openai",
        api_host: "https://api.openai.com/v1",
        is_system: true,
        group: "cloud",
        enabled: true,
        sort_order: 0,
        custom_models: [],
        prompt_cache_mode: null,
        api_key_count: 0,
        api_keys: [],
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:00:00Z",
      },
    ]);

    expect(result).toEqual({
      providers: [],
      total_provider_count: 0,
      available_provider_count: 0,
      needs_attention_provider_count: 0,
    });
  });
});
