/**
 * @file ProviderList 属性测试
 * @description 测试 Provider 分组正确性和搜索正确性
 * @module components/provider-pool/api-key/ProviderList.test
 *
 * **Feature: provider-ui-refactor**
 * **Property 10: 自定义 Provider 分组显示**
 * **Property 14: Provider 分组正确性**
 * **Property 15: Provider 搜索正确性**
 * **Validates: Requirements 6.5, 8.1, 8.2**
 */

import { describe, expect } from "vitest";
import { test } from "@fast-check/vitest";
import * as fc from "fast-check";
import {
  filterProviders,
  groupProviders,
  matchesSearchQuery,
} from "./ProviderList";
import { isProviderInGroup } from "./ProviderGroup";
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
 * 有效的分组类型
 */
const validGroups: ProviderGroup[] = [
  "mainstream",
  "chinese",
  "cloud",
  "aggregator",
  "local",
  "specialized",
  "custom",
];

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
    group: fc.constantFrom(...validGroups),
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
    api_keys: fc.array(apiKeyDisplayArbitrary, { minLength: 0, maxLength: 5 }),
  });

/**
 * 生成 Provider 列表
 */
const providerListArbitrary = fc.array(providerWithKeysArbitrary, {
  minLength: 0,
  maxLength: 20,
});

/**
 * 生成自定义 Provider（is_system = false, group = "custom"）
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
    is_system: fc.constant(false), // 自定义 Provider
    group: fc.constant("custom") as fc.Arbitrary<ProviderGroup>, // 必须在 custom 分组
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
    api_keys: fc.array(apiKeyDisplayArbitrary, { minLength: 0, maxLength: 5 }),
  });

/**
 * 生成自定义 Provider 列表
 */
const customProviderListArbitrary = fc.array(customProviderArbitrary, {
  minLength: 1,
  maxLength: 10,
});

/**
 * 生成搜索查询字符串
 */
const searchQueryArbitrary = fc.string({ minLength: 0, maxLength: 50 });

// ============================================================================
// Property 14: Provider 分组正确性
// ============================================================================

describe("Property 14: Provider 分组正确性", () => {
  /**
   * Property 14: Provider 分组正确性
   *
   * *对于任意* Provider，应被分配到正确的分组中
   *
   * **Validates: Requirements 8.1**
   */
  test.prop([providerListArbitrary], { numRuns: 100 })(
    "每个 Provider 应被分配到其 group 属性指定的分组中",
    (providers: ProviderWithKeysDisplay[]) => {
      const grouped = groupProviders(providers);

      // 验证每个 Provider 都在正确的分组中
      providers.forEach((provider) => {
        const expectedGroup = provider.group as ProviderGroup;
        const groupList = grouped.get(expectedGroup);

        // 分组应该存在
        expect(groupList).toBeDefined();

        // Provider 应该在该分组中
        const found = groupList?.some((p) => p.id === provider.id);
        expect(found).toBe(true);
      });
    },
  );

  test.prop([providerWithKeysArbitrary, fc.constantFrom(...validGroups)], {
    numRuns: 100,
  })(
    "isProviderInGroup 应正确判断 Provider 是否属于指定分组",
    (provider: ProviderWithKeysDisplay, group: ProviderGroup) => {
      const result = isProviderInGroup(provider, group);
      const expected = provider.group === group;

      expect(result).toBe(expected);
    },
  );

  test.prop([providerListArbitrary], { numRuns: 100 })(
    "分组后的 Provider 总数应等于原始列表长度",
    (providers: ProviderWithKeysDisplay[]) => {
      const grouped = groupProviders(providers);

      let totalCount = 0;
      grouped.forEach((list) => {
        totalCount += list.length;
      });

      expect(totalCount).toBe(providers.length);
    },
  );

  test.prop([providerListArbitrary], { numRuns: 100 })(
    "每个分组内的 Provider 应按 sort_order 排序",
    (providers: ProviderWithKeysDisplay[]) => {
      const grouped = groupProviders(providers);

      grouped.forEach((list) => {
        for (let i = 1; i < list.length; i++) {
          expect(list[i].sort_order).toBeGreaterThanOrEqual(
            list[i - 1].sort_order,
          );
        }
      });
    },
  );

  test("所有有效分组都应在结果中存在", () => {
    const grouped = groupProviders([]);

    validGroups.forEach((group) => {
      expect(grouped.has(group)).toBe(true);
    });
  });
});

// ============================================================================
// Property 15: Provider 搜索正确性
// ============================================================================

describe("Property 15: Provider 搜索正确性", () => {
  /**
   * Property 15: Provider 搜索正确性
   *
   * *对于任意* 搜索查询，返回的 Provider 列表应只包含名称匹配的 Provider
   *
   * **Validates: Requirements 8.2**
   */
  test.prop([providerListArbitrary, searchQueryArbitrary], { numRuns: 100 })(
    "过滤后的 Provider 应都匹配搜索查询",
    (providers: ProviderWithKeysDisplay[], query: string) => {
      const filtered = filterProviders(providers, query);

      // 所有过滤后的 Provider 都应匹配查询
      filtered.forEach((provider) => {
        expect(matchesSearchQuery(provider, query)).toBe(true);
      });
    },
  );

  test.prop([providerListArbitrary, searchQueryArbitrary], { numRuns: 100 })(
    "过滤后的 Provider 数量应小于等于原始数量",
    (providers: ProviderWithKeysDisplay[], query: string) => {
      const filtered = filterProviders(providers, query);

      expect(filtered.length).toBeLessThanOrEqual(providers.length);
    },
  );

  test.prop([providerListArbitrary], { numRuns: 100 })(
    "空查询应返回所有 Provider",
    (providers: ProviderWithKeysDisplay[]) => {
      const filtered = filterProviders(providers, "");

      expect(filtered.length).toBe(providers.length);
    },
  );

  test.prop([providerListArbitrary], { numRuns: 100 })(
    "空白查询应返回所有 Provider",
    (providers: ProviderWithKeysDisplay[]) => {
      const filtered = filterProviders(providers, "   ");

      expect(filtered.length).toBe(providers.length);
    },
  );

  test.prop([providerWithKeysArbitrary], { numRuns: 100 })(
    "使用 Provider 名称搜索应返回该 Provider",
    (provider: ProviderWithKeysDisplay) => {
      const providers = [provider];
      const filtered = filterProviders(providers, provider.name);

      expect(filtered.length).toBe(1);
      expect(filtered[0].id).toBe(provider.id);
    },
  );

  test.prop([providerWithKeysArbitrary], { numRuns: 100 })(
    "使用 Provider ID 搜索应返回该 Provider",
    (provider: ProviderWithKeysDisplay) => {
      const providers = [provider];
      const filtered = filterProviders(providers, provider.id);

      expect(filtered.length).toBe(1);
      expect(filtered[0].id).toBe(provider.id);
    },
  );

  test.prop([providerWithKeysArbitrary], { numRuns: 100 })(
    "搜索应不区分大小写",
    (provider: ProviderWithKeysDisplay) => {
      const providers = [provider];

      // 使用大写名称搜索
      const filteredUpper = filterProviders(
        providers,
        provider.name.toUpperCase(),
      );
      // 使用小写名称搜索
      const filteredLower = filterProviders(
        providers,
        provider.name.toLowerCase(),
      );

      expect(filteredUpper.length).toBe(1);
      expect(filteredLower.length).toBe(1);
    },
  );

  test.prop([providerWithKeysArbitrary], { numRuns: 100 })(
    "matchesSearchQuery 应对空查询返回 true",
    (provider: ProviderWithKeysDisplay) => {
      expect(matchesSearchQuery(provider, "")).toBe(true);
      expect(matchesSearchQuery(provider, "   ")).toBe(true);
    },
  );
});

// ============================================================================
// Property 10: 自定义 Provider 分组显示
// ============================================================================

describe("Property 10: 自定义 Provider 分组显示", () => {
  /**
   * Property 10: 自定义 Provider 分组显示
   *
   * *对于任意* 自定义 Provider，应显示在 Provider 列表的「自定义」分组中
   *
   * **Validates: Requirements 6.5**
   */
  test.prop([customProviderListArbitrary], { numRuns: 100 })(
    "自定义 Provider 应被分配到 custom 分组",
    (customProviders: ProviderWithKeysDisplay[]) => {
      const grouped = groupProviders(customProviders);
      const customGroup = grouped.get("custom");

      // custom 分组应该存在
      expect(customGroup).toBeDefined();

      // 所有自定义 Provider 都应在 custom 分组中
      customProviders.forEach((provider) => {
        const found = customGroup?.some((p) => p.id === provider.id);
        expect(found).toBe(true);
      });
    },
  );

  test.prop([customProviderArbitrary], { numRuns: 100 })(
    "自定义 Provider 的 group 属性应为 custom",
    (provider: ProviderWithKeysDisplay) => {
      expect(provider.group).toBe("custom");
    },
  );

  test.prop([customProviderArbitrary], { numRuns: 100 })(
    "自定义 Provider 的 is_system 属性应为 false",
    (provider: ProviderWithKeysDisplay) => {
      expect(provider.is_system).toBe(false);
    },
  );

  test.prop([customProviderArbitrary], { numRuns: 100 })(
    "isProviderInGroup 应正确识别自定义 Provider 属于 custom 分组",
    (provider: ProviderWithKeysDisplay) => {
      expect(isProviderInGroup(provider, "custom")).toBe(true);
      expect(isProviderInGroup(provider, "mainstream")).toBe(false);
      expect(isProviderInGroup(provider, "chinese")).toBe(false);
      expect(isProviderInGroup(provider, "cloud")).toBe(false);
      expect(isProviderInGroup(provider, "aggregator")).toBe(false);
      expect(isProviderInGroup(provider, "local")).toBe(false);
      expect(isProviderInGroup(provider, "specialized")).toBe(false);
    },
  );

  test.prop([providerListArbitrary, customProviderListArbitrary], {
    numRuns: 100,
  })(
    "混合列表中自定义 Provider 应只出现在 custom 分组",
    (
      otherProviders: ProviderWithKeysDisplay[],
      customProviders: ProviderWithKeysDisplay[],
    ) => {
      // 确保 customProviders 的 ID 是唯一的，不与 otherProviders 重复
      const customIds = new Set(customProviders.map((p) => p.id));
      const filteredOtherProviders = otherProviders.filter(
        (p) => !customIds.has(p.id),
      );

      const allProviders = [...filteredOtherProviders, ...customProviders];
      const grouped = groupProviders(allProviders);
      const customGroup = grouped.get("custom");

      // 验证所有自定义 Provider 都在 custom 分组中
      customProviders.forEach((provider) => {
        const found = customGroup?.some((p) => p.id === provider.id);
        expect(found).toBe(true);
      });

      // 验证自定义 Provider 不在其他分组中
      // 注意：这里只检查 customProviders 列表中的 Provider
      const nonCustomGroups: ProviderGroup[] = [
        "mainstream",
        "chinese",
        "cloud",
        "aggregator",
        "local",
        "specialized",
      ];

      customProviders.forEach((provider) => {
        nonCustomGroups.forEach((group) => {
          const groupList = grouped.get(group);
          const found = groupList?.some((p) => p.id === provider.id);
          expect(found).toBe(false);
        });
      });
    },
  );

  test("空的自定义 Provider 列表应返回空的 custom 分组", () => {
    const grouped = groupProviders([]);
    const customGroup = grouped.get("custom");

    expect(customGroup).toBeDefined();
    expect(customGroup?.length).toBe(0);
  });

  test("自定义 Provider 应按 sort_order 排序", () => {
    const customProviders: ProviderWithKeysDisplay[] = [
      {
        id: "custom-3",
        name: "Custom 3",
        type: "openai",
        api_host: "https://api3.example.com",
        is_system: false,
        group: "custom",
        enabled: true,
        sort_order: 30,
        api_key_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        api_keys: [],
      },
      {
        id: "custom-1",
        name: "Custom 1",
        type: "openai",
        api_host: "https://api1.example.com",
        is_system: false,
        group: "custom",
        enabled: true,
        sort_order: 10,
        api_key_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        api_keys: [],
      },
      {
        id: "custom-2",
        name: "Custom 2",
        type: "openai",
        api_host: "https://api2.example.com",
        is_system: false,
        group: "custom",
        enabled: true,
        sort_order: 20,
        api_key_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        api_keys: [],
      },
    ];

    const grouped = groupProviders(customProviders);
    const customGroup = grouped.get("custom");

    expect(customGroup).toBeDefined();
    expect(customGroup?.length).toBe(3);
    expect(customGroup?.[0].id).toBe("custom-1");
    expect(customGroup?.[1].id).toBe("custom-2");
    expect(customGroup?.[2].id).toBe("custom-3");
  });
});
