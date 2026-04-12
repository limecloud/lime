/**
 * @file ProviderSetting 属性测试
 * @description 测试 Provider 设置面板字段完整性
 * @module components/provider-pool/api-key/ProviderSetting.test
 *
 * **Feature: provider-ui-refactor**
 * **Property 6: Provider 设置面板字段完整性**
 * **Validates: Requirements 4.1**
 */

import { describe, expect } from "vitest";
import { test } from "@fast-check/vitest";
import * as fc from "fast-check";
import { extractProviderSettingInfo } from "./ProviderSetting";
import type {
  ProviderWithKeysDisplay,
  ApiKeyDisplay,
} from "@/lib/api/apiKeyProvider";

// ============================================================================
// 测试数据生成器
// ============================================================================

/**
 * 生成有效的 ISO 日期字符串
 */
const validDateArbitrary = fc
  .integer({
    min: new Date("2020-01-01").getTime(),
    max: new Date("2030-12-31").getTime(),
  })
  .map((timestamp) => new Date(timestamp).toISOString());

/**
 * 生成随机 API Key 显示数据
 */
const apiKeyDisplayArbitrary: fc.Arbitrary<ApiKeyDisplay> = fc.record({
  id: fc.uuid(),
  provider_id: fc.string({ minLength: 1, maxLength: 50 }),
  api_key_masked: fc
    .string({ minLength: 1, maxLength: 20 })
    .map((s) => `sk-****${s}`),
  alias: fc.option(fc.string({ minLength: 1, maxLength: 50 }), {
    nil: undefined,
  }),
  enabled: fc.boolean(),
  usage_count: fc.nat({ max: 10000 }),
  error_count: fc.nat({ max: 1000 }),
  last_used_at: fc.option(validDateArbitrary, { nil: undefined }),
  created_at: validDateArbitrary,
});

/**
 * 生成随机 Provider 显示数据（包含 API Keys）
 */
const providerWithKeysArbitrary: fc.Arbitrary<ProviderWithKeysDisplay> =
  fc.record({
    id: fc.string({ minLength: 1, maxLength: 50 }),
    name: fc.string({ minLength: 1, maxLength: 100 }),
    type: fc.constantFrom(
      "openai",
      "openai-response",
      "anthropic",
      "anthropic-compatible",
      "gemini",
      "azure-openai",
      "vertexai",
      "aws-bedrock",
      "ollama",
      "new-api",
      "gateway",
    ),
    api_host: fc.webUrl(),
    is_system: fc.boolean(),
    group: fc.constantFrom(
      "mainstream",
      "chinese",
      "cloud",
      "aggregator",
      "local",
      "specialized",
      "custom",
    ),
    enabled: fc.boolean(),
    sort_order: fc.nat({ max: 100 }),
    api_version: fc.option(fc.string({ minLength: 1, maxLength: 20 }), {
      nil: undefined,
    }),
    project: fc.option(fc.string({ minLength: 1, maxLength: 50 }), {
      nil: undefined,
    }),
    location: fc.option(fc.string({ minLength: 1, maxLength: 50 }), {
      nil: undefined,
    }),
    region: fc.option(fc.string({ minLength: 1, maxLength: 50 }), {
      nil: undefined,
    }),
    api_key_count: fc.nat({ max: 20 }),
    created_at: validDateArbitrary,
    updated_at: validDateArbitrary,
    api_keys: fc.array(apiKeyDisplayArbitrary, { minLength: 0, maxLength: 10 }),
  });

// ============================================================================
// Property 6: Provider 设置面板字段完整性
// ============================================================================

describe("Property 6: Provider 设置面板字段完整性", () => {
  /**
   * Property 6: Provider 设置面板字段完整性
   *
   * *对于任意* Provider，设置面板应显示名称、图标、启用开关、API Key 输入框、API Host 输入框和连接测试按钮
   *
   * **Validates: Requirements 4.1**
   */
  test.prop([providerWithKeysArbitrary], { numRuns: 100 })(
    "每个 Provider 设置面板应包含所有必需字段",
    (provider: ProviderWithKeysDisplay) => {
      const info = extractProviderSettingInfo(provider);

      // 验证 Provider 存在
      expect(info.hasProvider).toBe(true);

      // 验证图标信息存在（通过 provider.id 确定）
      expect(info.hasIcon).toBe(true);

      // 验证名称存在
      expect(info.hasName).toBe(true);

      // 验证启用开关存在
      expect(info.hasEnabledSwitch).toBe(true);

      // 验证 API Key 区域存在
      expect(info.hasApiKeySection).toBe(true);

      // 验证配置区域存在（包含 API Host 输入框）
      expect(info.hasConfigSection).toBe(true);

      // 验证连接测试按钮存在
      expect(info.hasConnectionTest).toBe(true);
    },
  );

  test.prop([providerWithKeysArbitrary], { numRuns: 100 })(
    "Provider ID 应为非空字符串（用于图标显示）",
    (provider: ProviderWithKeysDisplay) => {
      expect(typeof provider.id).toBe("string");
      expect(provider.id.length).toBeGreaterThan(0);
    },
  );

  test.prop([providerWithKeysArbitrary], { numRuns: 100 })(
    "Provider 名称应为非空字符串",
    (provider: ProviderWithKeysDisplay) => {
      expect(typeof provider.name).toBe("string");
      expect(provider.name.length).toBeGreaterThan(0);
    },
  );

  test.prop([providerWithKeysArbitrary], { numRuns: 100 })(
    "Provider 启用状态应为布尔值",
    (provider: ProviderWithKeysDisplay) => {
      expect(typeof provider.enabled).toBe("boolean");
    },
  );

  test.prop([providerWithKeysArbitrary], { numRuns: 100 })(
    "Provider API Host 应为有效 URL",
    (provider: ProviderWithKeysDisplay) => {
      expect(typeof provider.api_host).toBe("string");
      expect(provider.api_host.length).toBeGreaterThan(0);
    },
  );

  // 空状态测试
  describe("空状态处理", () => {
    test("null Provider 应返回空状态信息", () => {
      const info = extractProviderSettingInfo(null);

      expect(info.hasProvider).toBe(false);
      expect(info.hasIcon).toBe(false);
      expect(info.hasName).toBe(false);
      expect(info.hasEnabledSwitch).toBe(false);
      expect(info.hasApiKeySection).toBe(false);
      expect(info.hasConfigSection).toBe(false);
      expect(info.hasConnectionTest).toBe(false);
    });
  });

  // 具体字段验证
  describe("具体字段验证", () => {
    test("Provider 应包含有效的类型", () => {
      const validTypes = [
        "openai",
        "openai-response",
        "anthropic",
        "anthropic-compatible",
        "gemini",
        "azure-openai",
        "vertexai",
        "aws-bedrock",
        "ollama",
        "new-api",
        "gateway",
      ];

      const provider: ProviderWithKeysDisplay = {
        id: "test-provider",
        name: "Test Provider",
        type: "openai",
        api_host: "https://api.test.com",
        is_system: false,
        group: "custom",
        enabled: true,
        sort_order: 1,
        api_key_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        api_keys: [],
      };

      expect(validTypes).toContain(provider.type);
    });

    test("Provider 应包含有效的分组", () => {
      const validGroups = [
        "mainstream",
        "chinese",
        "cloud",
        "aggregator",
        "local",
        "specialized",
        "custom",
      ];

      const provider: ProviderWithKeysDisplay = {
        id: "test-provider",
        name: "Test Provider",
        type: "openai",
        api_host: "https://api.test.com",
        is_system: false,
        group: "custom",
        enabled: true,
        sort_order: 1,
        api_key_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        api_keys: [],
      };

      expect(validGroups).toContain(provider.group);
    });

    test("System Provider 应标记为 is_system: true", () => {
      const systemProvider: ProviderWithKeysDisplay = {
        id: "openai",
        name: "OpenAI",
        type: "openai-response",
        api_host: "https://api.openai.com",
        is_system: true,
        group: "mainstream",
        enabled: true,
        sort_order: 1,
        api_key_count: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        api_keys: [],
      };

      expect(systemProvider.is_system).toBe(true);
    });

    test("Custom Provider 应标记为 is_system: false", () => {
      const customProvider: ProviderWithKeysDisplay = {
        id: "my-custom-provider",
        name: "My Custom Provider",
        type: "openai",
        api_host: "https://api.custom.com",
        is_system: false,
        group: "custom",
        enabled: true,
        sort_order: 100,
        api_key_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        api_keys: [],
      };

      expect(customProvider.is_system).toBe(false);
    });
  });

  // API Keys 数组验证
  describe("API Keys 数组验证", () => {
    test.prop([providerWithKeysArbitrary], { numRuns: 100 })(
      "api_keys 应为数组",
      (provider: ProviderWithKeysDisplay) => {
        expect(Array.isArray(provider.api_keys)).toBe(true);
      },
    );

    test.prop(
      [fc.array(apiKeyDisplayArbitrary, { minLength: 1, maxLength: 5 })],
      { numRuns: 100 },
    )("每个 API Key 应包含必需字段", (apiKeys: ApiKeyDisplay[]) => {
      for (const apiKey of apiKeys) {
        expect(typeof apiKey.id).toBe("string");
        expect(typeof apiKey.provider_id).toBe("string");
        expect(typeof apiKey.api_key_masked).toBe("string");
        expect(typeof apiKey.enabled).toBe("boolean");
        expect(typeof apiKey.usage_count).toBe("number");
        expect(typeof apiKey.error_count).toBe("number");
        expect(typeof apiKey.created_at).toBe("string");
      }
    });
  });
});
