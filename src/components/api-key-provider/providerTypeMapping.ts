/*
 * @Author: Chiron 598621670@qq.com
 * @Date: 2026-01-06 17:34:03
 * @LastEditors: Chiron 598621670@qq.com
 * @LastEditTime: 2026-01-07 00:53:05
 * @FilePath: /lime/src/components/api-key-provider/providerTypeMapping.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
/**
 * @file Provider 类型映射工具
 * @description Provider ID/类型到 model_registry provider_id 的映射
 * @module components/api-key-provider/providerTypeMapping
 */

import type { SystemProviderCatalogItem } from "@/lib/api/apiKeyProvider";
import { resolveKnownAnthropicCompatibleProvider } from "@/lib/model/providerPromptCacheSupport";

/**
 * 兼容旧版本/历史配置的 Provider ID 别名映射。
 *
 * 说明：
 * - 常规 canonical provider id 优先由后端 catalog + model registry provider 集合决定；
 * - 这里只保留“老 ID -> 新 ID”的最小必要集合，避免前端维护大而散的硬编码表。
 */
const LEGACY_PROVIDER_ID_TO_REGISTRY_ID: Record<string, string> = {
  gemini: "google",
  zhipu: "zhipuai",
  dashscope: "alibaba",
  moonshot: "moonshotai",
  grok: "xai",
  github: "github-models",
  copilot: "github-copilot",
  vertexai: "google-vertex",
  "aws-bedrock": "amazon-bedrock",
  together: "togetherai",
  fireworks: "fireworks-ai",
  mimo: "xiaomi",
  silicon: "siliconflow",
  iflow: "iflowcn",
};

/**
 * Provider 类型（API 协议）到 model_registry provider_id 的映射
 * 作为 Provider ID 映射的回退。
 *
 * 注意：
 * - 这里只负责把 Provider 类型归一到模型注册表 provider_id；
 * - 该映射不能用于推断 Prompt Cache、工具能力等运行时语义；
 * - 已知官方 Anthropic 兼容 Host 必须优先映射到对应厂商目录。
 */
const PROVIDER_TYPE_TO_REGISTRY_ID: Record<string, string> = {
  anthropic: "anthropic",
  "anthropic-compatible": "anthropic",
  openai: "openai",
  "openai-response": "openai",
  codex: "codex",
  gemini: "google",
  "azure-openai": "azure",
  vertexai: "google-vertex",
  "aws-bedrock": "amazon-bedrock",
  ollama: "ollama-cloud",
  fal: "fal",
  "new-api": "openai",
  gateway: "vercel",
};

export interface ResolveRegistryProviderOptions {
  providerType?: string;
  apiHost?: string;
  /** 后端 Catalog 别名映射（legacy_id -> canonical_id） */
  catalogAliasMap?: Record<string, string> | null;
  /** 模型注册表中实际存在的 provider_id 集合 */
  validRegistryProviders?: Iterable<string> | null;
}

function toLowerSet(values: Iterable<string>): Set<string> {
  const set = new Set<string>();
  for (const value of values) {
    set.add(value.toLowerCase());
  }
  return set;
}

function uniqueCandidates(candidates: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const normalized = candidate.trim();
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

/**
 * 基于系统 Provider Catalog 构建别名映射
 *
 * - key: canonical id 或 legacy id（统一小写）
 * - value: canonical id
 */
export function buildCatalogAliasMap(
  catalog: SystemProviderCatalogItem[],
): Record<string, string> {
  const aliasMap: Record<string, string> = {};

  for (const item of catalog) {
    const canonicalId = item.id;
    aliasMap[canonicalId.toLowerCase()] = canonicalId;

    for (const legacyId of item.legacy_ids) {
      aliasMap[legacyId.toLowerCase()] = canonicalId;
    }
  }

  return aliasMap;
}

function tryResolveFromProviderId(providerId: string): string | undefined {
  return (
    LEGACY_PROVIDER_ID_TO_REGISTRY_ID[providerId] ||
    LEGACY_PROVIDER_ID_TO_REGISTRY_ID[providerId.toLowerCase()]
  );
}

function tryResolveFromProviderType(
  providerType?: string,
  apiHost?: string,
): string | undefined {
  const managedProvider = resolveKnownAnthropicCompatibleProvider(apiHost);
  if (managedProvider) {
    return managedProvider;
  }

  if (!providerType) {
    return undefined;
  }
  return PROVIDER_TYPE_TO_REGISTRY_ID[providerType.toLowerCase()];
}

function buildDefaultCandidates(
  providerId: string,
  options: ResolveRegistryProviderOptions,
): string[] {
  const normalizedId = providerId.trim();
  const lowerProviderId = normalizedId.toLowerCase();

  return uniqueCandidates([
    options.catalogAliasMap?.[lowerProviderId],
    tryResolveFromProviderId(normalizedId),
    tryResolveFromProviderId(lowerProviderId),
    tryResolveFromProviderType(options.providerType, options.apiHost),
    normalizedId,
  ]);
}

function buildValidationCandidates(
  providerId: string,
  options: ResolveRegistryProviderOptions,
): string[] {
  const normalizedId = providerId.trim();
  const lowerProviderId = normalizedId.toLowerCase();

  return uniqueCandidates([
    options.catalogAliasMap?.[lowerProviderId],
    tryResolveFromProviderId(normalizedId),
    tryResolveFromProviderId(lowerProviderId),
    normalizedId,
    tryResolveFromProviderType(options.providerType, options.apiHost),
  ]);
}

/**
 * 解析最终用于 model_registry 的 provider_id
 *
 * 优先级：
 * 1) codex 协议强制 `codex`
 * 2) Catalog alias 映射
 * 3) 旧的静态/legacy ID 映射
 * 4) Provider 类型映射（无模型注册表上下文时作为回退）
 * 5) 原始 providerId
 *
 * 如果提供 validRegistryProviders，则会优先返回“实际存在于模型注册表”的候选值，
 * 且优先考虑 providerId 本身，再考虑 providerType 的通用回退值。
 */
export function resolveRegistryProviderId(
  providerId: string,
  options: ResolveRegistryProviderOptions = {},
): string {
  const { providerType, catalogAliasMap, validRegistryProviders } = options;
  const normalizedId = providerId.trim();
  const lowerProviderType = providerType?.toLowerCase();

  if (lowerProviderType === "codex") {
    return "codex";
  }

  const defaultCandidates = buildDefaultCandidates(normalizedId, {
    providerType,
    apiHost: options.apiHost,
    catalogAliasMap,
  });

  if (validRegistryProviders) {
    const validSet = toLowerSet(validRegistryProviders);
    const validationCandidates = buildValidationCandidates(normalizedId, {
      providerType,
      apiHost: options.apiHost,
      catalogAliasMap,
    });

    const matched = validationCandidates.find((candidate) =>
      validSet.has(candidate.toLowerCase()),
    );
    if (matched) {
      return matched;
    }
  }

  return defaultCandidates[0] ?? normalizedId;
}

/**
 * 将 Provider ID 转换为 model_registry 的 provider_id
 * 优先使用 Provider ID 映射，回退到 Provider Type 映射
 *
 * @param providerId Provider ID（如 "deepseek", "openai"）
 * @param providerType Provider 类型/API 协议（如 "openai", "anthropic"）
 * @returns model_registry 中的 provider_id
 */
export function mapProviderIdToRegistryId(
  providerId: string,
  providerType?: string,
): string {
  return resolveRegistryProviderId(providerId, { providerType });
}

/**
 * @deprecated 使用 mapProviderIdToRegistryId 代替
 * 将 Provider 类型转换为 model_registry 的 provider_id
 */
export function mapProviderTypeToRegistryId(providerType: string): string {
  return (
    PROVIDER_TYPE_TO_REGISTRY_ID[providerType.toLowerCase()] || providerType
  );
}
