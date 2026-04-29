/**
 * @file ApiKeyProviderSection 属性测试
 * @description 测试 Provider 选择同步
 * @module components/api-key-provider/ApiKeyProviderSection.test
 *
 * **Feature: provider-ui-refactor**
 * **Property 2: Provider 选择同步**
 * **Validates: Requirements 1.4**
 */

import { describe, expect } from "vitest";
import { test } from "@fast-check/vitest";
import * as fc from "fast-check";
import {
  verifyProviderSelectionSync,
  extractSelectionState,
  resolveProviderTestModel,
} from "./ApiKeyProviderSection.helpers";
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

/**
 * 生成 Provider ID（可能为 null）
 */
const providerIdArbitrary = fc.option(
  fc.string({ minLength: 1, maxLength: 50 }),
  { nil: null },
);

// ============================================================================
// Property 2: Provider 选择同步
// ============================================================================

describe("Property 2: Provider 选择同步", () => {
  /**
   * Property 2: Provider 选择同步
   *
   * *对于任意* Provider 列表中的点击操作，右侧设置面板应显示被点击 Provider 的配置信息
   *
   * **Validates: Requirements 1.4**
   */
  test.prop([providerIdArbitrary, providerIdArbitrary], { numRuns: 100 })(
    "选中的 Provider ID 应与设置面板显示的 Provider ID 同步",
    (selectedId: string | null, displayedId: string | null) => {
      // 当两个 ID 相同时，应该同步
      const isSynced = verifyProviderSelectionSync(selectedId, displayedId);

      if (selectedId === null) {
        // 如果没有选中任何 Provider，设置面板应该显示空状态
        expect(isSynced).toBe(displayedId === null);
      } else {
        // 如果选中了 Provider，设置面板应该显示相同的 Provider
        expect(isSynced).toBe(selectedId === displayedId);
      }
    },
  );

  test.prop([providerWithKeysArbitrary], { numRuns: 100 })(
    "当选中 Provider 时，设置面板应显示该 Provider 的信息",
    (provider: ProviderWithKeysDisplay) => {
      const state = extractSelectionState(provider.id, provider);

      // 验证选中状态同步
      expect(state.listSelectedId).toBe(provider.id);
      expect(state.settingProviderId).toBe(provider.id);
      expect(state.isSynced).toBe(true);
    },
  );

  test("当没有选中 Provider 时，设置面板应显示空状态", () => {
    const state = extractSelectionState(null, null);

    expect(state.listSelectedId).toBeNull();
    expect(state.settingProviderId).toBeNull();
    expect(state.isSynced).toBe(true);
  });

  test.prop([providerWithKeysArbitrary], { numRuns: 100 })(
    "选中状态变化时应保持同步",
    (provider: ProviderWithKeysDisplay) => {
      // 模拟从空状态到选中状态
      const emptyState = extractSelectionState(null, null);
      expect(emptyState.isSynced).toBe(true);

      // 模拟选中 Provider
      const selectedState = extractSelectionState(provider.id, provider);
      expect(selectedState.isSynced).toBe(true);

      // 模拟取消选中
      const deselectedState = extractSelectionState(null, null);
      expect(deselectedState.isSynced).toBe(true);
    },
  );

  // 边界情况测试
  describe("边界情况", () => {
    test("空字符串 ID 应被视为有效选择", () => {
      // 注意：实际上空字符串 ID 不应该出现，但测试边界情况
      const isSynced = verifyProviderSelectionSync("", "");
      expect(isSynced).toBe(true);
    });

    test("不同 ID 应被视为不同步", () => {
      const isSynced = verifyProviderSelectionSync("provider-a", "provider-b");
      expect(isSynced).toBe(false);
    });

    test("一个为 null 一个不为 null 应被视为不同步", () => {
      expect(verifyProviderSelectionSync(null, "provider-a")).toBe(false);
      expect(verifyProviderSelectionSync("provider-a", null)).toBe(false);
    });
  });

  // 状态提取测试
  describe("状态提取", () => {
    test.prop([providerWithKeysArbitrary], { numRuns: 100 })(
      "extractSelectionState 应正确提取选择状态",
      (provider: ProviderWithKeysDisplay) => {
        const state = extractSelectionState(provider.id, provider);

        expect(state).toHaveProperty("listSelectedId");
        expect(state).toHaveProperty("settingProviderId");
        expect(state).toHaveProperty("isSynced");
        expect(typeof state.isSynced).toBe("boolean");
      },
    );

    test("extractSelectionState 应处理 null provider", () => {
      const state = extractSelectionState("some-id", null);

      expect(state.listSelectedId).toBe("some-id");
      expect(state.settingProviderId).toBeNull();
      expect(state.isSynced).toBe(false);
    });
  });

  describe("测试模型解析", () => {
    test("应优先使用当前输入框里的模型名", () => {
      expect(
        resolveProviderTestModel(["claude-opus-4-6"], "MiniMax-M2.7"),
      ).toBe("MiniMax-M2.7");
    });

    test("输入框为空时应回退到 provider 当前模型", () => {
      expect(resolveProviderTestModel(["glm-5"], "")).toBe("glm-5");
    });

    test("应忽略空白模型项", () => {
      expect(resolveProviderTestModel(["  "], "  , MiniMax-M2.5 ")).toBe(
        "MiniMax-M2.5",
      );
    });
  });

  // Provider 列表选择测试
  describe("Provider 列表选择", () => {
    test.prop(
      [fc.array(providerWithKeysArbitrary, { minLength: 1, maxLength: 10 })],
      { numRuns: 100 },
    )(
      "从 Provider 列表中选择任意 Provider 应同步到设置面板",
      (providers: ProviderWithKeysDisplay[]) => {
        // 随机选择一个 Provider
        const randomIndex = Math.floor(Math.random() * providers.length);
        const selectedProvider = providers[randomIndex];

        // 验证选择同步
        const state = extractSelectionState(
          selectedProvider.id,
          selectedProvider,
        );
        expect(state.isSynced).toBe(true);
        expect(state.listSelectedId).toBe(selectedProvider.id);
        expect(state.settingProviderId).toBe(selectedProvider.id);
      },
    );

    test.prop(
      [fc.array(providerWithKeysArbitrary, { minLength: 2, maxLength: 10 })],
      { numRuns: 100 },
    )(
      "切换选择不同 Provider 应正确同步",
      (providers: ProviderWithKeysDisplay[]) => {
        // 选择第一个 Provider
        const firstProvider = providers[0];
        const firstState = extractSelectionState(
          firstProvider.id,
          firstProvider,
        );
        expect(firstState.isSynced).toBe(true);

        // 切换到第二个 Provider
        const secondProvider = providers[1];
        const secondState = extractSelectionState(
          secondProvider.id,
          secondProvider,
        );
        expect(secondState.isSynced).toBe(true);

        // 验证两次选择的 ID 不同（除非恰好相同）
        if (firstProvider.id !== secondProvider.id) {
          expect(firstState.listSelectedId).not.toBe(
            secondState.listSelectedId,
          );
        }
      },
    );
  });
});
