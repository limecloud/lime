/**
 * @file ProviderListItem 属性测试
 * @description 测试 Provider 列表项显示完整性和 API Key 数量徽章正确性
 * @module components/provider-pool/api-key/ProviderListItem.test
 *
 * **Feature: provider-ui-refactor**
 * **Property 1: Provider 列表项显示完整性**
 * **Property 11: API Key 数量徽章正确性**
 * **Validates: Requirements 1.6, 7.2, 10.4**
 */

import { describe, expect } from "vitest";
import { test } from "@fast-check/vitest";
import * as fc from "fast-check";
import { extractListItemDisplayInfo, getApiKeyCount } from "./ProviderListItem";
import type {
  ProviderWithKeysDisplay,
  ApiKeyDisplay,
} from "@/lib/api/apiKeyProvider";

// ============================================================================
// 测试数据生成器
// ============================================================================

/**
 * 生成有效的 ISO 日期字符串
 * 使用整数时间戳避免无效日期问题
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
// Property 1: Provider 列表项显示完整性
// ============================================================================

describe("Property 1: Provider 列表项显示完整性", () => {
  /**
   * Property 1: Provider 列表项显示完整性
   *
   * *对于任意* Provider 配置，渲染后的列表项应包含图标、名称和启用状态三个元素
   *
   * **Validates: Requirements 1.6, 10.4**
   */
  test.prop([providerWithKeysArbitrary], { numRuns: 100 })(
    "每个 Provider 列表项应包含图标、名称和启用状态",
    (provider: ProviderWithKeysDisplay) => {
      const displayInfo = extractListItemDisplayInfo(provider);

      // 验证图标信息存在（通过 provider.id 确定）
      expect(displayInfo.hasIcon).toBe(true);

      // 验证名称存在
      expect(displayInfo.hasName).toBe(true);

      // 验证启用状态存在
      expect(displayInfo.hasStatus).toBe(true);
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
});

// ============================================================================
// Property 11: API Key 数量徽章正确性
// ============================================================================

describe("Property 11: API Key 数量徽章正确性", () => {
  /**
   * Property 11: API Key 数量徽章正确性
   *
   * *对于任意* Provider，列表项上的徽章数字应等于该 Provider 的 API Key 数量
   *
   * **Validates: Requirements 7.2**
   */
  test.prop([providerWithKeysArbitrary], { numRuns: 100 })(
    "API Key 数量应等于 api_keys 数组长度",
    (provider: ProviderWithKeysDisplay) => {
      const count = getApiKeyCount(provider);
      const expectedCount = provider.api_keys?.length ?? 0;

      expect(count).toBe(expectedCount);
    },
  );

  test.prop([providerWithKeysArbitrary], { numRuns: 100 })(
    "API Key 数量应为非负整数",
    (provider: ProviderWithKeysDisplay) => {
      const count = getApiKeyCount(provider);

      expect(Number.isInteger(count)).toBe(true);
      expect(count).toBeGreaterThanOrEqual(0);
    },
  );

  test.prop(
    [fc.array(apiKeyDisplayArbitrary, { minLength: 0, maxLength: 20 })],
    { numRuns: 100 },
  )("不同数量的 API Keys 应正确反映在计数中", (apiKeys: ApiKeyDisplay[]) => {
    const provider: ProviderWithKeysDisplay = {
      id: "test-provider",
      name: "Test Provider",
      type: "openai",
      api_host: "https://api.test.com",
      is_system: false,
      group: "custom",
      enabled: true,
      sort_order: 1,
      api_key_count: apiKeys.length,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      api_keys: apiKeys,
    };

    const count = getApiKeyCount(provider);
    expect(count).toBe(apiKeys.length);
  });

  test("空 api_keys 数组应返回 0", () => {
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

    expect(getApiKeyCount(provider)).toBe(0);
  });

  test("undefined api_keys 应返回 0", () => {
    const provider = {
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
    } as ProviderWithKeysDisplay;

    expect(getApiKeyCount(provider)).toBe(0);
  });
});
