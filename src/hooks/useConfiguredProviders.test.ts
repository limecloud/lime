import { describe, expect, it } from "vitest";
import type { ProviderWithKeysDisplay } from "@/lib/api/apiKeyProvider";
import type { ProviderPoolOverview } from "@/lib/api/providerPool";
import {
  buildConfiguredProviders,
  findConfiguredProviderBySelection,
} from "./useConfiguredProviders";

function createProviderPoolOverview(
  overrides: Partial<ProviderPoolOverview> = {},
): ProviderPoolOverview {
  return {
    provider_type: "openai",
    stats: {
      total: 0,
      healthy: 0,
      unhealthy: 0,
      disabled: 0,
      total_usage: 0,
      total_errors: 0,
    },
    credentials: [],
    ...overrides,
  };
}

function createApiKeyProvider(
  overrides: Partial<ProviderWithKeysDisplay> = {},
): ProviderWithKeysDisplay {
  return {
    id: "openai",
    name: "OpenAI",
    type: "openai",
    api_host: "https://api.openai.com/v1",
    is_system: true,
    group: "cloud",
    enabled: true,
    sort_order: 0,
    custom_models: [],
    api_key_count: 0,
    api_keys: [],
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

describe("buildConfiguredProviders", () => {
  it("应将无 Key 但已启用且地址有效的 Ollama 视为已配置渠道", () => {
    const providers = buildConfiguredProviders(
      [createProviderPoolOverview()],
      [
        createApiKeyProvider({
          id: "ollama",
          name: "Ollama (本地)",
          type: "ollama",
          api_host: "http://localhost:11434",
          api_key_count: 0,
        }),
      ],
    );

    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "ollama",
          providerId: "ollama",
          type: "ollama",
          apiHost: "http://localhost:11434",
        }),
      ]),
    );
  });

  it("不应误把其他无 Key 云渠道当成已配置", () => {
    const providers = buildConfiguredProviders(
      [],
      [
        createApiKeyProvider({
          id: "openai",
          name: "OpenAI",
          type: "openai",
          api_key_count: 0,
        }),
      ],
    );

    expect(providers).toEqual([]);
  });

  it("无 Key 的 Ollama 缺少地址或被禁用时不应展示", () => {
    const missingHostProviders = buildConfiguredProviders(
      [],
      [
        createApiKeyProvider({
          id: "ollama",
          name: "Ollama (本地)",
          type: "ollama",
          api_host: "   ",
          api_key_count: 0,
        }),
      ],
    );
    const disabledProviders = buildConfiguredProviders(
      [],
      [
        createApiKeyProvider({
          id: "ollama",
          name: "Ollama (本地)",
          type: "ollama",
          api_host: "http://localhost:11434",
          enabled: false,
          api_key_count: 0,
        }),
      ],
    );

    expect(missingHostProviders).toEqual([]);
    expect(disabledProviders).toEqual([]);
  });

  it("后端返回原始 providerId 时，应优先命中真实受管 Provider", () => {
    const providers = buildConfiguredProviders(
      [
        createProviderPoolOverview({
          provider_type: "openai",
          credentials: [
            {
              uuid: "oauth-openai",
              provider_type: "openai",
              credential_type: "openai",
              name: "OpenAI OAuth",
              display_credential: "OpenAI OAuth",
              is_healthy: true,
              is_disabled: false,
              check_health: true,
              not_supported_models: [],
              usage_count: 0,
              error_count: 0,
              created_at: "2026-04-01T00:00:00Z",
              updated_at: "2026-04-01T00:00:00Z",
              source: "manual",
            },
          ],
        }),
      ],
      [
        createApiKeyProvider({
          id: "openai",
          name: "OpenAI API Key",
          api_key_count: 1,
        }),
      ],
    );

    const resolvedProvider = findConfiguredProviderBySelection(
      providers,
      "openai",
    );

    expect(resolvedProvider).toEqual(
      expect.objectContaining({
        key: "openai_api_key",
        providerId: "openai",
      }),
    );
  });
});
