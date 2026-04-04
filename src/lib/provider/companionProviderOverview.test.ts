import { describe, expect, it } from "vitest";
import { buildCompanionProviderOverview } from "./companionProviderOverview";

describe("buildCompanionProviderOverview", () => {
  it("应过滤未配置 provider，并输出脱敏摘要", () => {
    expect(
      buildCompanionProviderOverview([
        {
          provider_type: "openai",
          stats: {
            total: 2,
            healthy: 1,
            unhealthy: 1,
            disabled: 0,
            total_usage: 12,
            total_errors: 1,
          },
          credentials: [],
        },
        {
          provider_type: "claude",
          stats: {
            total: 0,
            healthy: 0,
            unhealthy: 0,
            disabled: 0,
            total_usage: 0,
            total_errors: 0,
          },
          credentials: [],
        },
        {
          provider_type: "codex",
          stats: {
            total: 1,
            healthy: 1,
            unhealthy: 0,
            disabled: 0,
            total_usage: 3,
            total_errors: 0,
          },
          credentials: [],
        },
      ]),
    ).toEqual({
      providers: [
        {
          provider_type: "codex",
          display_name: "Codex",
          total_count: 1,
          healthy_count: 1,
          available: true,
          needs_attention: false,
        },
        {
          provider_type: "openai",
          display_name: "OpenAI",
          total_count: 2,
          healthy_count: 1,
          available: true,
          needs_attention: true,
        },
      ],
      total_provider_count: 2,
      available_provider_count: 2,
      needs_attention_provider_count: 1,
    });
  });

  it("当所有 provider 都不可用时，应标记为需要关注", () => {
    expect(
      buildCompanionProviderOverview([
        {
          provider_type: "gemini",
          stats: {
            total: 1,
            healthy: 0,
            unhealthy: 1,
            disabled: 0,
            total_usage: 0,
            total_errors: 2,
          },
          credentials: [],
        },
      ]),
    ).toEqual({
      providers: [
        {
          provider_type: "gemini",
          display_name: "Gemini OAuth",
          total_count: 1,
          healthy_count: 0,
          available: false,
          needs_attention: true,
        },
      ],
      total_provider_count: 1,
      available_provider_count: 0,
      needs_attention_provider_count: 1,
    });
  });

  it("不应把原始凭证字段泄露给桌宠摘要", () => {
    const result = buildCompanionProviderOverview([
      {
        provider_type: "openai",
        stats: {
          total: 1,
          healthy: 1,
          unhealthy: 0,
          disabled: 0,
          total_usage: 7,
          total_errors: 0,
        },
        credentials: [
          {
            uuid: "cred-1",
            provider_type: "openai",
            credential_type: "openai_key",
            name: "主 OpenAI Key",
            display_credential: "sk-***abcd",
            is_healthy: true,
            is_disabled: false,
            check_health: true,
            not_supported_models: [],
            usage_count: 7,
            error_count: 0,
            created_at: "2026-04-02T00:00:00Z",
            updated_at: "2026-04-02T00:00:00Z",
            source: "manual",
            api_key: "sk-live-super-secret",
            base_url: "https://api.openai.com/v1",
          },
        ],
      },
    ]);

    expect(result).toEqual({
      providers: [
        {
          provider_type: "openai",
          display_name: "OpenAI",
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
    expect(serialized).not.toContain("sk-live-super-secret");
    expect(serialized).not.toContain("cred-1");
    expect(serialized).not.toContain("base_url");
    expect(serialized).not.toContain("display_credential");
  });

  it("应把 API Key Provider 与凭证池摘要合并给桌宠", () => {
    const result = buildCompanionProviderOverview(
      [
        {
          provider_type: "openai",
          stats: {
            total: 1,
            healthy: 1,
            unhealthy: 0,
            disabled: 0,
            total_usage: 2,
            total_errors: 0,
          },
          credentials: [],
        },
      ],
      [
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
      ],
    );

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
        {
          provider_type: "openai",
          display_name: "OpenAI",
          total_count: 1,
          healthy_count: 1,
          available: true,
          needs_attention: false,
        },
      ],
      total_provider_count: 2,
      available_provider_count: 2,
      needs_attention_provider_count: 0,
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("sk-***1234");
    expect(serialized).not.toContain("deepseek-key-1");
    expect(serialized).not.toContain("api_host");
  });
});
