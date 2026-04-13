import { describe, expect, it } from "vitest";
import type { ProviderWithKeysDisplay } from "@/lib/api/apiKeyProvider";
import type { ProviderPoolOverview } from "@/lib/api/providerPool";
import {
  buildConfiguredProviders,
  findConfiguredProviderBySelection,
  resolveConfiguredProviderPromptCacheSupportNotice,
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
    prompt_cache_mode: null,
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
          api_host: "http://127.0.0.1:11434",
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
          apiHost: "http://127.0.0.1:11434",
          promptCacheMode: null,
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
          api_host: "http://127.0.0.1:11434",
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

  it("应基于真实受管 Provider 解析 prompt cache 提示", () => {
    const providers = buildConfiguredProviders(
      [],
      [
        createApiKeyProvider({
          id: "custom-provider-id",
          name: "GLM Anthropic",
          type: "anthropic-compatible",
          api_key_count: 1,
        }),
      ],
    );

    const notice = resolveConfiguredProviderPromptCacheSupportNotice(
      providers,
      "custom-provider-id",
    );

    expect(notice).toEqual(
      expect.objectContaining({
        label: "未声明自动缓存",
        source: "configured_provider",
      }),
    );
  });

  it("显式声明 automatic 的 anthropic-compatible Provider 不应误报 prompt cache 提示", () => {
    const providers = buildConfiguredProviders(
      [],
      [
        createApiKeyProvider({
          id: "glm-anthropic",
          name: "GLM Anthropic",
          type: "anthropic-compatible",
          prompt_cache_mode: "automatic",
          api_key_count: 1,
        }),
      ],
    );

    const notice = resolveConfiguredProviderPromptCacheSupportNotice(
      providers,
      "glm-anthropic",
    );

    expect(notice).toBeNull();
  });

  it.each([
    {
      id: "glm-anthropic",
      name: "GLM Anthropic",
      apiHost: "https://open.bigmodel.cn/api/anthropic",
    },
    {
      id: "kimi-anthropic",
      name: "Kimi Anthropic",
      apiHost: "https://api.moonshot.cn/anthropic",
    },
    {
      id: "minimax-anthropic",
      name: "MiniMax Anthropic",
      apiHost: "https://api.minimaxi.com/anthropic",
    },
    {
      id: "mimo-anthropic",
      name: "MiMo Anthropic",
      apiHost: "https://token-plan-cn.xiaomimimo.com/anthropic",
    },
  ])("$name 官方 Anthropic 兼容 Host 不应误报 prompt cache 提示", ({ id, name, apiHost }) => {
    const providers = buildConfiguredProviders(
      [],
      [
        createApiKeyProvider({
          id,
          name,
          type: "anthropic-compatible",
          api_host: apiHost,
          api_key_count: 1,
        }),
      ],
    );

    const notice = resolveConfiguredProviderPromptCacheSupportNotice(
      providers,
      id,
    );

    expect(notice).toBeNull();
  });
});
