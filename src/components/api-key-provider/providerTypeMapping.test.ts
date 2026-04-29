/**
 * @file Provider 映射契约测试
 * @description 验证 Catalog 别名映射与模型注册表 provider_id 解析行为
 * @module components/api-key-provider/providerTypeMapping.test
 */

import { describe, expect, it } from "vitest";
import { getProviderPromptCacheMode } from "@/lib/model/providerPromptCacheSupport";
import {
  buildCatalogAliasMap,
  resolveRegistryProviderId,
} from "./providerTypeMapping";
import type { SystemProviderCatalogItem } from "@/lib/api/apiKeyProvider";

describe("providerTypeMapping", () => {
  it("应根据 Catalog 构建 canonical/legacy 双向查询映射", () => {
    const catalog: SystemProviderCatalogItem[] = [
      {
        id: "google",
        name: "Gemini",
        type: "gemini",
        api_host: "https://generativelanguage.googleapis.com",
        group: "mainstream",
        sort_order: 1,
        legacy_ids: ["gemini"],
      },
      {
        id: "zhipuai",
        name: "智谱",
        type: "openai",
        api_host: "https://open.bigmodel.cn/api/paas/v4/",
        group: "chinese",
        sort_order: 2,
        legacy_ids: ["zhipu"],
      },
    ];

    const aliasMap = buildCatalogAliasMap(catalog);
    expect(aliasMap.google).toBe("google");
    expect(aliasMap.gemini).toBe("google");
    expect(aliasMap.zhipu).toBe("zhipuai");
  });

  it("应优先使用 validRegistryProviders 中存在的候选", () => {
    const aliasMap = {
      gemini: "google",
      google: "google",
    };

    const resolved = resolveRegistryProviderId("gemini", {
      providerType: "gemini",
      catalogAliasMap: aliasMap,
      validRegistryProviders: ["openai", "google", "anthropic"],
    });

    expect(resolved).toBe("google");
  });

  it("当 providerId 本身有效时应优先于 providerType 通用回退", () => {
    const resolved = resolveRegistryProviderId("deepseek", {
      providerType: "openai",
      catalogAliasMap: null,
      validRegistryProviders: ["openai", "deepseek", "anthropic"],
    });

    expect(resolved).toBe("deepseek");
  });

  it("codex 类型应强制解析到 codex", () => {
    const resolved = resolveRegistryProviderId("custom-anything", {
      providerType: "codex",
      catalogAliasMap: null,
      validRegistryProviders: ["openai", "codex"],
    });

    expect(resolved).toBe("codex");
  });

  it("无 Catalog 时应回退到静态映射", () => {
    const resolved = resolveRegistryProviderId("dashscope", {
      providerType: "openai",
      catalogAliasMap: null,
      validRegistryProviders: null,
    });

    expect(resolved).toBe("alibaba");
  });

  it("当候选不在 validRegistryProviders 中时应回退到有效候选", () => {
    const aliasMap = {
      moonshot: "moonshotai",
    };

    const resolved = resolveRegistryProviderId("moonshot", {
      providerType: "openai",
      catalogAliasMap: aliasMap,
      validRegistryProviders: ["openai", "anthropic"],
    });

    expect(resolved).toBe("openai");
  });

  it("anthropic-compatible 复用 Anthropic 模型目录时不应被当成自动缓存能力", () => {
    const resolved = resolveRegistryProviderId("custom-anthropic-gateway", {
      providerType: "anthropic-compatible",
      catalogAliasMap: null,
      validRegistryProviders: ["openai", "anthropic"],
    });

    expect(resolved).toBe("anthropic");
    expect(getProviderPromptCacheMode("anthropic-compatible")).toBe(
      "explicit_only",
    );
  });

  it("已知官方 Anthropic 兼容 Host 应优先映射到对应厂商目录", () => {
    const resolved = resolveRegistryProviderId("custom-minimax-provider", {
      providerType: "anthropic-compatible",
      apiHost: "https://api.minimaxi.com/anthropic",
      catalogAliasMap: null,
      validRegistryProviders: ["anthropic", "minimax"],
    });

    expect(resolved).toBe("minimax");
  });

  it("Z.AI 海外 Anthropic 兼容 Host 应映射到 Z.AI 目录", () => {
    const resolved = resolveRegistryProviderId("custom-zai-provider", {
      providerType: "anthropic-compatible",
      apiHost: "https://api.z.ai/api/anthropic",
      catalogAliasMap: null,
      validRegistryProviders: ["anthropic", "zai", "zhipuai"],
    });

    expect(resolved).toBe("zai");
  });

  it("Kimi Code 订阅 Host 应映射到 Kimi For Coding 目录", () => {
    const resolved = resolveRegistryProviderId("custom-kimi-code-provider", {
      providerType: "anthropic-compatible",
      apiHost: "https://api.kimi.com/coding/",
      catalogAliasMap: null,
      validRegistryProviders: ["anthropic", "kimi-for-coding", "moonshotai"],
    });

    expect(resolved).toBe("kimi-for-coding");
  });

  it("阿里 Coding Plan 国内和海外 Host 应分别映射到对应目录", () => {
    expect(
      resolveRegistryProviderId("custom-alibaba-cn-provider", {
        providerType: "anthropic-compatible",
        apiHost: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
        catalogAliasMap: null,
        validRegistryProviders: ["anthropic", "alibaba-cn", "alibaba"],
      }),
    ).toBe("alibaba-cn");

    expect(
      resolveRegistryProviderId("custom-alibaba-global-provider", {
        providerType: "anthropic-compatible",
        apiHost: "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic",
        catalogAliasMap: null,
        validRegistryProviders: ["anthropic", "alibaba-cn", "alibaba"],
      }),
    ).toBe("alibaba");
  });

  it("MiMo 的 Anthropic 兼容 Host 应映射到 Xiaomi 模型目录", () => {
    const resolved = resolveRegistryProviderId("custom-mimo-provider", {
      providerType: "anthropic-compatible",
      apiHost: "https://token-plan-cn.xiaomimimo.com/anthropic",
      catalogAliasMap: null,
      validRegistryProviders: ["anthropic", "xiaomi"],
    });

    expect(resolved).toBe("xiaomi");
  });
});
