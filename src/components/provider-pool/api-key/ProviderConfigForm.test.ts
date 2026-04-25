/**
 * @file ProviderConfigForm 属性测试
 * @description 测试 Provider 类型处理正确性
 * @module components/provider-pool/api-key/ProviderConfigForm.test
 *
 * **Feature: provider-ui-refactor**
 * **Property 7: Provider 类型处理正确性**
 * **Validates: Requirements 5.1-5.5**
 */

import { describe, expect } from "vitest";
import { test } from "@fast-check/vitest";
import * as fc from "fast-check";
import {
  getLatestSelectableModel,
  getFieldsForProviderType,
  getSpecialProtocolHint,
  parseCustomModelsValue,
  providerTypeRequiresField,
  PROVIDER_TYPE_FIELDS,
  PROVIDER_TYPE_VALUES,
  serializeCustomModels,
  sortSelectableModels,
} from "./ProviderConfigForm.utils";
import type { EnhancedModelMetadata } from "@/lib/types/modelRegistry";
import type { ProviderType } from "@/lib/types/provider";

// ============================================================================
// 测试数据生成器
// ============================================================================

/**
 * 所有有效的 Provider 类型
 */
const ALL_PROVIDER_TYPES: ProviderType[] = PROVIDER_TYPE_VALUES;

/**
 * 生成随机 Provider 类型
 */
const providerTypeArbitrary: fc.Arbitrary<ProviderType> = fc.constantFrom(
  ...ALL_PROVIDER_TYPES,
);

/**
 * Provider 类型与其额外字段的映射
 */
const EXPECTED_EXTRA_FIELDS: Record<ProviderType, string[]> =
  PROVIDER_TYPE_FIELDS;

function createModel(
  overrides: Partial<EnhancedModelMetadata> &
    Pick<EnhancedModelMetadata, "id" | "display_name">,
): EnhancedModelMetadata {
  return {
    id: overrides.id,
    display_name: overrides.display_name,
    provider_id: overrides.provider_id ?? "openai",
    provider_name: overrides.provider_name ?? "OpenAI",
    family: overrides.family ?? null,
    tier: overrides.tier ?? "pro",
    capabilities: overrides.capabilities ?? {
      vision: true,
      tools: true,
      streaming: true,
      json_mode: true,
      function_calling: true,
      reasoning: true,
    },
    pricing: overrides.pricing ?? null,
    limits: overrides.limits ?? {
      context_length: null,
      max_output_tokens: null,
      requests_per_minute: null,
      tokens_per_minute: null,
    },
    status: overrides.status ?? "active",
    release_date: overrides.release_date ?? null,
    is_latest: overrides.is_latest ?? false,
    description: overrides.description ?? null,
    source: overrides.source ?? "local",
    created_at: overrides.created_at ?? 0,
    updated_at: overrides.updated_at ?? 0,
  };
}

// ============================================================================
// Property 7: Provider 类型处理正确性
// ============================================================================

describe("Property 7: Provider 类型处理正确性", () => {
  /**
   * Property 7: Provider 类型处理正确性
   *
   * *对于任意* Provider Type，系统应使用对应的 API 调用方式，并显示该类型所需的额外配置字段
   *
   * **Validates: Requirements 5.1-5.5**
   */
  test.prop([providerTypeArbitrary], { numRuns: 100 })(
    "每个 Provider 类型应返回正确的字段列表",
    (type: ProviderType) => {
      const fields = getFieldsForProviderType(type);

      // 所有类型都应包含 apiHost 字段
      expect(fields).toContain("apiHost");

      // 验证额外字段
      const expectedExtra = EXPECTED_EXTRA_FIELDS[type];
      for (const field of expectedExtra) {
        expect(fields).toContain(field);
      }

      // 验证字段数量正确
      expect(fields.length).toBe(1 + expectedExtra.length);
    },
  );

  test.prop([providerTypeArbitrary], { numRuns: 100 })(
    "apiHost 字段对所有 Provider 类型都是必需的",
    (type: ProviderType) => {
      expect(providerTypeRequiresField(type, "apiHost")).toBe(true);
    },
  );

  test.prop([providerTypeArbitrary], { numRuns: 100 })(
    "Azure OpenAI 类型应需要 apiVersion 字段",
    (type: ProviderType) => {
      const requiresApiVersion = providerTypeRequiresField(type, "apiVersion");
      expect(requiresApiVersion).toBe(type === "azure-openai");
    },
  );

  test.prop([providerTypeArbitrary], { numRuns: 100 })(
    "VertexAI 类型应需要 project 和 location 字段",
    (type: ProviderType) => {
      const requiresProject = providerTypeRequiresField(type, "project");
      const requiresLocation = providerTypeRequiresField(type, "location");

      expect(requiresProject).toBe(type === "vertexai");
      expect(requiresLocation).toBe(type === "vertexai");
    },
  );

  test.prop([providerTypeArbitrary], { numRuns: 100 })(
    "AWS Bedrock 类型应需要 region 字段",
    (type: ProviderType) => {
      const requiresRegion = providerTypeRequiresField(type, "region");
      expect(requiresRegion).toBe(type === "aws-bedrock");
    },
  );

  test.prop([providerTypeArbitrary], { numRuns: 100 })(
    "标准 OpenAI 兼容类型不应需要额外字段",
    (type: ProviderType) => {
      const standardTypes: ProviderType[] = [
        "openai",
        "openai-response",
        "anthropic",
        "gemini",
        "ollama",
        "fal",
        "new-api",
        "gateway",
      ];

      if (standardTypes.includes(type)) {
        const fields = getFieldsForProviderType(type);
        // 只应有 apiHost 字段
        expect(fields.length).toBe(1);
        expect(fields[0]).toBe("apiHost");
      }
    },
  );

  // 具体类型的单元测试
  describe("具体 Provider 类型字段验证", () => {
    test("openai 类型只需要 apiHost", () => {
      const fields = getFieldsForProviderType("openai");
      expect(fields).toEqual(["apiHost"]);
    });

    test("openai-response 类型只需要 apiHost", () => {
      const fields = getFieldsForProviderType("openai-response");
      expect(fields).toEqual(["apiHost"]);
    });

    test("anthropic 类型只需要 apiHost", () => {
      const fields = getFieldsForProviderType("anthropic");
      expect(fields).toEqual(["apiHost"]);
    });

    test("gemini 类型只需要 apiHost", () => {
      const fields = getFieldsForProviderType("gemini");
      expect(fields).toEqual(["apiHost"]);
    });

    test("azure-openai 类型需要 apiHost 和 apiVersion", () => {
      const fields = getFieldsForProviderType("azure-openai");
      expect(fields).toContain("apiHost");
      expect(fields).toContain("apiVersion");
      expect(fields.length).toBe(2);
    });

    test("vertexai 类型需要 apiHost、project 和 location", () => {
      const fields = getFieldsForProviderType("vertexai");
      expect(fields).toContain("apiHost");
      expect(fields).toContain("project");
      expect(fields).toContain("location");
      expect(fields.length).toBe(3);
    });

    test("aws-bedrock 类型需要 apiHost 和 region", () => {
      const fields = getFieldsForProviderType("aws-bedrock");
      expect(fields).toContain("apiHost");
      expect(fields).toContain("region");
      expect(fields.length).toBe(2);
    });

    test("ollama 类型只需要 apiHost", () => {
      const fields = getFieldsForProviderType("ollama");
      expect(fields).toEqual(["apiHost"]);
    });

    test("fal 类型只需要 apiHost", () => {
      const fields = getFieldsForProviderType("fal");
      expect(fields).toEqual(["apiHost"]);
    });

  test("new-api 类型只需要 apiHost", () => {
      const fields = getFieldsForProviderType("new-api");
      expect(fields).toEqual(["apiHost"]);
    });

    test("gateway 类型只需要 apiHost", () => {
      const fields = getFieldsForProviderType("gateway");
      expect(fields).toEqual(["apiHost"]);
    });

    test("anthropic-compatible 协议提示不应再暗示自动 Prompt Cache", () => {
      expect(getSpecialProtocolHint("anthropic-compatible")).toContain(
        "已知官方 Anthropic 兼容端点",
      );
    });
  });

  // 边界情况测试
  describe("边界情况", () => {
    test("所有 Provider 类型都应被支持", () => {
      for (const type of ALL_PROVIDER_TYPES) {
        const fields = getFieldsForProviderType(type);
        expect(Array.isArray(fields)).toBe(true);
        expect(fields.length).toBeGreaterThan(0);
      }
    });

    test("不存在的字段应返回 false", () => {
      for (const type of ALL_PROVIDER_TYPES) {
        expect(providerTypeRequiresField(type, "nonExistentField")).toBe(false);
      }
    });
  });
});

describe("模型辅助函数", () => {
  test("parseCustomModelsValue 应去重并保留输入顺序", () => {
    expect(
      parseCustomModelsValue(
        "gpt-5.3-codex, babbage-002, GPT-5.3-codex, , gpt-5.2",
      ),
    ).toEqual(["gpt-5.3-codex", "babbage-002", "gpt-5.2"]);
  });

  test("serializeCustomModels 应输出稳定的逗号分隔字符串", () => {
    expect(
      serializeCustomModels(["gpt-5.3-codex", "gpt-5.2", "GPT-5.3-codex"]),
    ).toBe("gpt-5.3-codex, gpt-5.2");
  });

  test("parseCustomModelsValue 应规范化 MiMo 展示名与历史别名", () => {
    expect(
      parseCustomModelsValue(
        "MiMo-V2.5-Pro, mimo-v2-pro, mimo-v2.5, mimo-v2-flash",
        {
          providerId: "custom-mimo",
          providerType: "anthropic-compatible",
          apiHost: "https://token-plan-cn.xiaomimimo.com/anthropic",
        },
      ),
    ).toEqual(["mimo-v2.5-pro", "mimo-v2-flash"]);
  });

  test("serializeCustomModels 应输出规范化后的 MiMo 模型 ID", () => {
    expect(
      serializeCustomModels(["MiMo-V2.5-Pro", "mimo-v2-pro", "mimo-v2.5"], {
        providerId: "custom-mimo",
        providerType: "anthropic-compatible",
        apiHost: "https://token-plan-cn.xiaomimimo.com/anthropic",
      }),
    ).toBe("mimo-v2.5-pro");
  });

  test("非 Xiaomi Provider 不应误改写模型 ID", () => {
    expect(
      parseCustomModelsValue("mimo-v2-pro", {
        providerId: "openai",
        providerType: "openai",
        apiHost: "https://api.openai.com/v1",
      }),
    ).toEqual(["mimo-v2-pro"]);
  });

  test("sortSelectableModels 应优先最新和带发布日期的模型", () => {
    const models = [
      createModel({
        id: "babbage-002",
        display_name: "babbage-002",
      }),
      createModel({
        id: "gpt-5.2",
        display_name: "GPT-5.2",
        release_date: "2025-12-11",
      }),
      createModel({
        id: "gpt-5.3-codex",
        display_name: "GPT-5.3 Codex",
        release_date: "2026-02-05",
        is_latest: true,
      }),
    ];

    expect(sortSelectableModels(models).map((model) => model.id)).toEqual([
      "gpt-5.3-codex",
      "gpt-5.2",
      "babbage-002",
    ]);
  });

  test("getLatestSelectableModel 不应把按字母序靠前的旧模型当成最新", () => {
    const latestModel = getLatestSelectableModel([
      createModel({
        id: "babbage-002",
        display_name: "babbage-002",
      }),
      createModel({
        id: "gpt-5.3-codex",
        display_name: "GPT-5.3 Codex",
        release_date: "2026-02-05",
        is_latest: true,
      }),
    ]);

    expect(latestModel?.id).toBe("gpt-5.3-codex");
  });

  test("getLatestSelectableModel 在空列表时应返回 null", () => {
    expect(getLatestSelectableModel([])).toBeNull();
  });
});
