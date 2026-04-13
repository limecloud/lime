/**
 * @file AddCustomProviderModal 属性测试
 * @description 测试自定义 Provider 表单验证
 * @module components/provider-pool/api-key/AddCustomProviderModal.test
 *
 * **Feature: provider-ui-refactor**
 * **Property 8: 自定义 Provider 表单验证**
 * **Validates: Requirements 6.2**
 */

import { describe, expect } from "vitest";
import { test } from "@fast-check/vitest";
import * as fc from "fast-check";
import {
  validateCustomProviderForm,
  isFormValid,
  hasRequiredFields,
} from "./AddCustomProviderModal";
import { PROVIDER_TYPE_VALUES } from "./ProviderConfigForm.utils";
import type {
  ProviderDeclaredPromptCacheMode,
  ProviderType,
} from "@/lib/types/provider";

// ============================================================================
// 测试数据生成器
// ============================================================================

/** 所有有效的 Provider 类型 */
const VALID_PROVIDER_TYPES: ProviderType[] = PROVIDER_TYPE_VALUES;

/**
 * 生成有效的 Provider 类型
 */
const providerTypeArbitrary: fc.Arbitrary<ProviderType> = fc.constantFrom(
  ...VALID_PROVIDER_TYPES,
);
const promptCacheModeArbitrary: fc.Arbitrary<ProviderDeclaredPromptCacheMode> =
  fc.constantFrom("explicit_only", "automatic");

/**
 * 生成有效的 URL
 */
const validUrlArbitrary: fc.Arbitrary<string> = fc.webUrl();

/**
 * 生成非空字符串（用于名称和 API Key）
 */
const nonEmptyStringArbitrary: fc.Arbitrary<string> = fc
  .string({
    minLength: 1,
    maxLength: 50,
  })
  .filter((s) => s.trim().length > 0);

/**
 * 生成空白字符串（用于测试验证）
 */
const whitespaceStringArbitrary: fc.Arbitrary<string> = fc.constantFrom(
  "",
  " ",
  "  ",
  "\t",
  "\n",
  "   \t\n  ",
);

/**
 * 生成无效的 URL（无法被 URL 构造函数解析的字符串）
 */
const invalidUrlArbitrary: fc.Arbitrary<string> = fc.oneof(
  fc.constant("not-a-url"),
  fc.constant("just-text"),
  fc.constant("://missing-protocol"),
  fc.constant("http//missing-colon"),
  fc.constant("missing-protocol.com"),
  fc.string({ minLength: 1, maxLength: 20 }).filter((s) => {
    try {
      new URL(s);
      return false;
    } catch {
      return true;
    }
  }),
);

/**
 * 生成完整的有效表单状态
 */
const validFormStateArbitrary = fc.record({
  name: nonEmptyStringArbitrary,
  type: providerTypeArbitrary,
  promptCacheMode: promptCacheModeArbitrary,
  apiHost: validUrlArbitrary,
  apiKey: nonEmptyStringArbitrary,
  apiVersion: fc.string({ maxLength: 30 }),
  project: fc.string({ maxLength: 50 }),
  location: fc.string({ maxLength: 50 }),
  region: fc.string({ maxLength: 50 }),
});

/**
 * 生成缺少名称的表单状态
 */
const formStateMissingNameArbitrary = fc.record({
  name: whitespaceStringArbitrary,
  type: providerTypeArbitrary,
  promptCacheMode: promptCacheModeArbitrary,
  apiHost: validUrlArbitrary,
  apiKey: nonEmptyStringArbitrary,
  apiVersion: fc.string({ maxLength: 30 }),
  project: fc.string({ maxLength: 50 }),
  location: fc.string({ maxLength: 50 }),
  region: fc.string({ maxLength: 50 }),
});

/**
 * 生成缺少 API Host 的表单状态
 */
const formStateMissingApiHostArbitrary = fc.record({
  name: nonEmptyStringArbitrary,
  type: providerTypeArbitrary,
  promptCacheMode: promptCacheModeArbitrary,
  apiHost: whitespaceStringArbitrary,
  apiKey: nonEmptyStringArbitrary,
  apiVersion: fc.string({ maxLength: 30 }),
  project: fc.string({ maxLength: 50 }),
  location: fc.string({ maxLength: 50 }),
  region: fc.string({ maxLength: 50 }),
});

/**
 * 生成缺少 API Key 的表单状态
 */
const formStateMissingApiKeyArbitrary = fc.record({
  name: nonEmptyStringArbitrary,
  type: providerTypeArbitrary,
  promptCacheMode: promptCacheModeArbitrary,
  apiHost: validUrlArbitrary,
  apiKey: whitespaceStringArbitrary,
  apiVersion: fc.string({ maxLength: 30 }),
  project: fc.string({ maxLength: 50 }),
  location: fc.string({ maxLength: 50 }),
  region: fc.string({ maxLength: 50 }),
});

/**
 * 生成无效 API Host 的表单状态
 */
const formStateInvalidApiHostArbitrary = fc.record({
  name: nonEmptyStringArbitrary,
  type: providerTypeArbitrary,
  promptCacheMode: promptCacheModeArbitrary,
  apiHost: invalidUrlArbitrary,
  apiKey: nonEmptyStringArbitrary,
  apiVersion: fc.string({ maxLength: 30 }),
  project: fc.string({ maxLength: 50 }),
  location: fc.string({ maxLength: 50 }),
  region: fc.string({ maxLength: 50 }),
});

// ============================================================================
// Property 8: 自定义 Provider 表单验证
// ============================================================================

describe("Property 8: 自定义 Provider 表单验证", () => {
  /**
   * Property 8: 自定义 Provider 表单验证
   *
   * *对于任意* 自定义 Provider 创建请求，如果缺少必填字段（名称、API Key、API Host），
   * 系统应拒绝创建
   *
   * **Validates: Requirements 6.2**
   */

  describe("有效表单验证", () => {
    test.prop([validFormStateArbitrary], { numRuns: 100 })(
      "有效的表单状态应通过验证",
      (formState) => {
        const errors = validateCustomProviderForm(formState);

        // 有效表单不应有名称、API Host、API Key 错误
        expect(errors.name).toBeUndefined();
        expect(errors.apiHost).toBeUndefined();
        expect(errors.apiKey).toBeUndefined();
      },
    );

    test.prop([validFormStateArbitrary], { numRuns: 100 })(
      "有效的表单状态 isFormValid 应返回 true",
      (formState) => {
        expect(isFormValid(formState)).toBe(true);
      },
    );

    test.prop([validFormStateArbitrary], { numRuns: 100 })(
      "有效的表单状态 hasRequiredFields 应返回 true",
      (formState) => {
        expect(hasRequiredFields(formState)).toBe(true);
      },
    );
  });

  describe("缺少名称验证", () => {
    test.prop([formStateMissingNameArbitrary], { numRuns: 100 })(
      "缺少名称的表单应返回名称错误",
      (formState) => {
        const errors = validateCustomProviderForm(formState);

        expect(errors.name).toBeDefined();
        expect(typeof errors.name).toBe("string");
        expect(errors.name!.length).toBeGreaterThan(0);
      },
    );

    test.prop([formStateMissingNameArbitrary], { numRuns: 100 })(
      "缺少名称的表单 isFormValid 应返回 false",
      (formState) => {
        expect(isFormValid(formState)).toBe(false);
      },
    );

    test.prop([formStateMissingNameArbitrary], { numRuns: 100 })(
      "缺少名称的表单 hasRequiredFields 应返回 false",
      (formState) => {
        expect(hasRequiredFields(formState)).toBe(false);
      },
    );
  });

  describe("缺少 API Host 验证", () => {
    test.prop([formStateMissingApiHostArbitrary], { numRuns: 100 })(
      "缺少 API Host 的表单应返回 API Host 错误",
      (formState) => {
        const errors = validateCustomProviderForm(formState);

        expect(errors.apiHost).toBeDefined();
        expect(typeof errors.apiHost).toBe("string");
        expect(errors.apiHost!.length).toBeGreaterThan(0);
      },
    );

    test.prop([formStateMissingApiHostArbitrary], { numRuns: 100 })(
      "缺少 API Host 的表单 isFormValid 应返回 false",
      (formState) => {
        expect(isFormValid(formState)).toBe(false);
      },
    );

    test.prop([formStateMissingApiHostArbitrary], { numRuns: 100 })(
      "缺少 API Host 的表单 hasRequiredFields 应返回 false",
      (formState) => {
        expect(hasRequiredFields(formState)).toBe(false);
      },
    );
  });

  describe("缺少 API Key 验证", () => {
    test.prop([formStateMissingApiKeyArbitrary], { numRuns: 100 })(
      "缺少 API Key 的表单应返回 API Key 错误",
      (formState) => {
        const errors = validateCustomProviderForm(formState);

        expect(errors.apiKey).toBeDefined();
        expect(typeof errors.apiKey).toBe("string");
        expect(errors.apiKey!.length).toBeGreaterThan(0);
      },
    );

    test.prop([formStateMissingApiKeyArbitrary], { numRuns: 100 })(
      "缺少 API Key 的表单 isFormValid 应返回 false",
      (formState) => {
        expect(isFormValid(formState)).toBe(false);
      },
    );

    test.prop([formStateMissingApiKeyArbitrary], { numRuns: 100 })(
      "缺少 API Key 的表单 hasRequiredFields 应返回 false",
      (formState) => {
        expect(hasRequiredFields(formState)).toBe(false);
      },
    );
  });

  describe("无效 API Host 验证", () => {
    test.prop([formStateInvalidApiHostArbitrary], { numRuns: 100 })(
      "无效 API Host 的表单应返回 API Host 错误",
      (formState) => {
        const errors = validateCustomProviderForm(formState);

        expect(errors.apiHost).toBeDefined();
        expect(typeof errors.apiHost).toBe("string");
        expect(errors.apiHost!.length).toBeGreaterThan(0);
      },
    );

    test.prop([formStateInvalidApiHostArbitrary], { numRuns: 100 })(
      "无效 API Host 的表单 isFormValid 应返回 false",
      (formState) => {
        expect(isFormValid(formState)).toBe(false);
      },
    );
  });

  describe("名称长度验证", () => {
    test("名称超过 50 个字符应返回错误", () => {
      const formState = {
        name: "a".repeat(51),
        type: "openai" as ProviderType,
        promptCacheMode: "explicit_only" as ProviderDeclaredPromptCacheMode,
        apiHost: "https://api.example.com",
        apiKey: "sk-test-key",
        apiVersion: "",
        project: "",
        location: "",
        region: "",
      };

      const errors = validateCustomProviderForm(formState);
      expect(errors.name).toBeDefined();
      expect(errors.name).toContain("50");
    });

    test("名称正好 50 个字符应通过验证", () => {
      const formState = {
        name: "a".repeat(50),
        type: "openai" as ProviderType,
        promptCacheMode: "explicit_only" as ProviderDeclaredPromptCacheMode,
        apiHost: "https://api.example.com",
        apiKey: "sk-test-key",
        apiVersion: "",
        project: "",
        location: "",
        region: "",
      };

      const errors = validateCustomProviderForm(formState);
      expect(errors.name).toBeUndefined();
    });
  });

  describe("多个缺失字段验证", () => {
    test("同时缺少多个必填字段应返回所有错误", () => {
      const formState = {
        name: "",
        type: "openai" as ProviderType,
        promptCacheMode: "explicit_only" as ProviderDeclaredPromptCacheMode,
        apiHost: "",
        apiKey: "",
        apiVersion: "",
        project: "",
        location: "",
        region: "",
      };

      const errors = validateCustomProviderForm(formState);

      expect(errors.name).toBeDefined();
      expect(errors.apiHost).toBeDefined();
      expect(errors.apiKey).toBeDefined();
    });

    test("同时缺少多个必填字段 isFormValid 应返回 false", () => {
      const formState = {
        name: "",
        type: "openai" as ProviderType,
        promptCacheMode: "explicit_only" as ProviderDeclaredPromptCacheMode,
        apiHost: "",
        apiKey: "",
        apiVersion: "",
        project: "",
        location: "",
        region: "",
      };

      expect(isFormValid(formState)).toBe(false);
    });
  });
});
