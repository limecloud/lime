/**
 * @file DeleteProviderDialog 属性测试
 * @description 测试 System Provider 删除保护
 * @module components/provider-pool/api-key/DeleteProviderDialog.test
 *
 * **Feature: provider-ui-refactor**
 * **Property 9: System Provider 删除保护**
 * **Validates: Requirements 6.4**
 */

import { describe, expect } from "vitest";
import { test } from "@fast-check/vitest";
import * as fc from "fast-check";
import { canDeleteProvider, isSystemProvider } from "./DeleteProviderDialog";
import type {
  ProviderWithKeysDisplay,
  ApiKeyDisplay,
} from "@/lib/api/apiKeyProvider";
import type { ProviderGroup } from "@/lib/types/provider";

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
 * 生成 System Provider（is_system = true）
 */
const systemProviderArbitrary: fc.Arbitrary<ProviderWithKeysDisplay> =
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
    is_system: fc.constant(true), // 强制为 System Provider
    group: fc.constantFrom(
      "mainstream",
      "chinese",
      "cloud",
      "aggregator",
      "local",
      "specialized",
    ) as fc.Arbitrary<ProviderGroup>,
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

/**
 * 生成 Custom Provider（is_system = false）
 */
const customProviderArbitrary: fc.Arbitrary<ProviderWithKeysDisplay> =
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
    is_system: fc.constant(false), // 强制为 Custom Provider
    group: fc.constant("custom") as fc.Arbitrary<ProviderGroup>,
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

/**
 * 生成任意 Provider（System 或 Custom）
 */
const anyProviderArbitrary: fc.Arbitrary<ProviderWithKeysDisplay> = fc.oneof(
  systemProviderArbitrary,
  customProviderArbitrary,
);

// ============================================================================
// Property 9: System Provider 删除保护
// ============================================================================

describe("Property 9: System Provider 删除保护", () => {
  /**
   * Property 9: System Provider 删除保护
   *
   * *对于任意* System Provider，删除操作应被拒绝
   *
   * **Validates: Requirements 6.4**
   */

  describe("System Provider 不可删除", () => {
    test.prop([systemProviderArbitrary], { numRuns: 100 })(
      "System Provider 的 canDeleteProvider 应返回 false",
      (provider: ProviderWithKeysDisplay) => {
        expect(canDeleteProvider(provider)).toBe(false);
      },
    );

    test.prop([systemProviderArbitrary], { numRuns: 100 })(
      "System Provider 的 isSystemProvider 应返回 true",
      (provider: ProviderWithKeysDisplay) => {
        expect(isSystemProvider(provider)).toBe(true);
      },
    );

    test.prop([systemProviderArbitrary], { numRuns: 100 })(
      "System Provider 的 is_system 属性应为 true",
      (provider: ProviderWithKeysDisplay) => {
        expect(provider.is_system).toBe(true);
      },
    );
  });

  describe("Custom Provider 可删除", () => {
    test.prop([customProviderArbitrary], { numRuns: 100 })(
      "Custom Provider 的 canDeleteProvider 应返回 true",
      (provider: ProviderWithKeysDisplay) => {
        expect(canDeleteProvider(provider)).toBe(true);
      },
    );

    test.prop([customProviderArbitrary], { numRuns: 100 })(
      "Custom Provider 的 isSystemProvider 应返回 false",
      (provider: ProviderWithKeysDisplay) => {
        expect(isSystemProvider(provider)).toBe(false);
      },
    );

    test.prop([customProviderArbitrary], { numRuns: 100 })(
      "Custom Provider 的 is_system 属性应为 false",
      (provider: ProviderWithKeysDisplay) => {
        expect(provider.is_system).toBe(false);
      },
    );
  });

  describe("canDeleteProvider 与 isSystemProvider 互斥", () => {
    test.prop([anyProviderArbitrary], { numRuns: 100 })(
      "canDeleteProvider 和 isSystemProvider 应互斥",
      (provider: ProviderWithKeysDisplay) => {
        const canDelete = canDeleteProvider(provider);
        const isSystem = isSystemProvider(provider);

        // 如果是 System Provider，则不能删除
        // 如果不是 System Provider，则可以删除
        expect(canDelete).toBe(!isSystem);
      },
    );

    test.prop([anyProviderArbitrary], { numRuns: 100 })(
      "is_system 属性决定删除权限",
      (provider: ProviderWithKeysDisplay) => {
        const canDelete = canDeleteProvider(provider);

        // canDeleteProvider 应该返回 !is_system
        expect(canDelete).toBe(!provider.is_system);
      },
    );
  });

  describe("null Provider 处理", () => {
    test("null Provider 的 canDeleteProvider 应返回 false", () => {
      expect(canDeleteProvider(null)).toBe(false);
    });

    test("null Provider 的 isSystemProvider 应返回 false", () => {
      expect(isSystemProvider(null)).toBe(false);
    });
  });

  describe("边界情况", () => {
    test("Provider 有 API Keys 时仍遵循删除规则", () => {
      const systemWithKeys: ProviderWithKeysDisplay = {
        id: "openai",
        name: "OpenAI",
        type: "openai",
        api_host: "https://api.openai.com",
        is_system: true,
        group: "mainstream",
        enabled: true,
        sort_order: 1,
        api_key_count: 5,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        api_keys: [
          {
            id: "key-1",
            provider_id: "openai",
            api_key_masked: "sk-****abc",
            enabled: true,
            usage_count: 100,
            error_count: 0,
            created_at: new Date().toISOString(),
          },
        ],
      };

      // 即使有 API Keys，System Provider 仍不可删除
      expect(canDeleteProvider(systemWithKeys)).toBe(false);
    });

    test("Custom Provider 无 API Keys 时可删除", () => {
      const customNoKeys: ProviderWithKeysDisplay = {
        id: "my-custom",
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

      expect(canDeleteProvider(customNoKeys)).toBe(true);
    });
  });
});
