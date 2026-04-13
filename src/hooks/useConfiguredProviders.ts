/**
 * @file 已配置 Provider 列表 Hook
 * @description 从 OAuth 凭证和 API Key Provider 中提取已配置的 Provider 列表
 * @module hooks/useConfiguredProviders
 */

import { useMemo } from "react";
import { apiKeyProviderApi } from "@/lib/api/apiKeyProvider";
import {
  providerPoolApi,
  type ProviderPoolOverview,
} from "@/lib/api/providerPool";
import type { ProviderWithKeysDisplay } from "@/lib/api/apiKeyProvider";
import { useProviderPool } from "./useProviderPool";
import { useApiKeyProvider } from "./useApiKeyProvider";
import {
  getRegistryIdFromType,
  getProviderLabel,
} from "@/lib/constants/providerMappings";
import { resolvePromptCacheSupportNotice } from "@/lib/model/providerPromptCacheSupport";
import type { ProviderDeclaredPromptCacheMode } from "@/lib/types/provider";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 已配置的 Provider 信息
 */
export interface ConfiguredProvider {
  /** Provider 唯一标识 */
  key: string;
  /** 显示标签 */
  label: string;
  /** 模型注册表中的 provider_id */
  registryId: string;
  /** 回退的 registry_id（当 registryId 没有模型时使用） */
  fallbackRegistryId?: string;
  /** 原始 provider type，用于确定 API 协议 */
  type: string;
  /** 凭证类型（用于特殊处理） */
  credentialType?: string;
  /** Provider ID（用于 API Key Provider） */
  providerId?: string;
  /** Provider API Host */
  apiHost?: string;
  /** Provider 声明的 Prompt Cache 模式 */
  promptCacheMode?: ProviderDeclaredPromptCacheMode | null;
  /** 自定义模型列表（用于 API Key Provider） */
  customModels?: string[];
}

export interface UseConfiguredProvidersResult {
  /** 已配置的 Provider 列表 */
  providers: ConfiguredProvider[];
  /** 是否正在加载 */
  loading: boolean;
}

export interface UseConfiguredProvidersOptions {
  autoLoad?: boolean;
}

interface LoadConfiguredProvidersOptions {
  forceRefresh?: boolean;
}

function normalizeProviderType(value?: string | null): string {
  return (value || "").trim().toLowerCase();
}

function normalizeConfiguredProviderSelector(value?: string | null): string {
  return (value || "").trim().toLowerCase();
}

function hasConfiguredKeylessAccess(
  provider: ProviderWithKeysDisplay,
): boolean {
  return (
    normalizeProviderType(provider.type) === "ollama" &&
    provider.enabled &&
    provider.api_host.trim().length > 0
  );
}

function isConfiguredApiKeyProvider(
  provider: ProviderWithKeysDisplay,
): boolean {
  return (
    provider.enabled &&
    (provider.api_key_count > 0 || hasConfiguredKeylessAccess(provider))
  );
}

export function buildConfiguredProviders(
  oauthCredentials: ProviderPoolOverview[],
  apiKeyProviders: ProviderWithKeysDisplay[],
): ConfiguredProvider[] {
  const safeOauthCredentials = Array.isArray(oauthCredentials)
    ? oauthCredentials
    : [];
  const safeApiKeyProviders = Array.isArray(apiKeyProviders)
    ? apiKeyProviders
    : [];
  const providerMap = new Map<string, ConfiguredProvider>();

  safeOauthCredentials.forEach((overview) => {
    if (overview.credentials.length > 0) {
      const key = overview.provider_type;
      const firstCredential = overview.credentials[0];
      const credentialType = firstCredential.credential_type || key;

      if (!providerMap.has(key)) {
        providerMap.set(key, {
          key,
          label: getProviderLabel(key),
          registryId: getRegistryIdFromType(key),
          type: key,
          credentialType,
        });
      }
    }
  });

  safeApiKeyProviders.filter(isConfiguredApiKeyProvider).forEach((provider) => {
    let key = provider.id;
    let label = provider.name;

    if (providerMap.has(key)) {
      key = `${provider.id}_api_key`;
      label = `${provider.name} API Key`;
    }

    if (!providerMap.has(key)) {
      providerMap.set(key, {
        key,
        label,
        registryId: provider.id,
        fallbackRegistryId: getRegistryIdFromType(provider.type),
        type: provider.type,
        credentialType: `${provider.type}_key`,
        providerId: provider.id,
        apiHost: provider.api_host,
        promptCacheMode: provider.prompt_cache_mode,
        customModels: provider.custom_models,
      });
    }
  });

  return Array.from(providerMap.values());
}

export function findConfiguredProviderBySelection(
  providers: ConfiguredProvider[],
  selection?: string | null,
): ConfiguredProvider | null {
  const normalizedSelection = normalizeConfiguredProviderSelector(selection);
  if (!normalizedSelection) {
    return null;
  }

  const keyMatch =
    providers.find(
      (provider) =>
        normalizeConfiguredProviderSelector(provider.key) ===
        normalizedSelection,
    ) ?? null;
  const providerIdMatch =
    providers.find(
      (provider) =>
        normalizeConfiguredProviderSelector(provider.providerId) ===
        normalizedSelection,
    ) ?? null;

  if (keyMatch && providerIdMatch && keyMatch !== providerIdMatch) {
    if (!keyMatch.providerId && providerIdMatch.providerId) {
      return providerIdMatch;
    }
  }

  return keyMatch ?? providerIdMatch ?? null;
}

export function resolveConfiguredProviderPromptCacheSupportNotice(
  providers: ConfiguredProvider[],
  selection?: string | null,
) {
  const selectedProvider = findConfiguredProviderBySelection(
    providers,
    selection,
  );
  return resolvePromptCacheSupportNotice({
    providerType: selection,
    configuredProviderType: selectedProvider?.type,
    configuredApiHost: selectedProvider?.apiHost,
    configuredPromptCacheMode: selectedProvider?.promptCacheMode,
  });
}

export async function loadConfiguredProviders(
  options: LoadConfiguredProvidersOptions = {},
): Promise<ConfiguredProvider[]> {
  const sourceOptions = options.forceRefresh
    ? { forceRefresh: true }
    : undefined;
  const [oauthCredentials, apiKeyProviders] = await Promise.all([
    providerPoolApi.getOverview(sourceOptions),
    apiKeyProviderApi.getProviders(sourceOptions),
  ]);

  return buildConfiguredProviders(oauthCredentials, apiKeyProviders);
}

// ============================================================================
// Hook 实现
// ============================================================================

/**
 * 获取已配置的 Provider 列表
 *
 * 从 OAuth 凭证池和 API Key Provider 中提取已配置凭证的 Provider，
 * 合并去重后返回统一的 Provider 列表。
 *
 * @returns 已配置的 Provider 列表和加载状态
 *
 * @example
 * ```tsx
 * const { providers, loading } = useConfiguredProviders();
 *
 * if (loading) return <Spinner />;
 *
 * return (
 *   <select>
 *     {providers.map(p => (
 *       <option key={p.key} value={p.key}>{p.label}</option>
 *     ))}
 *   </select>
 * );
 * ```
 */
export function useConfiguredProviders(
  options: UseConfiguredProvidersOptions = {},
): UseConfiguredProvidersResult {
  const { autoLoad = true } = options;
  // 获取凭证池数据
  const { overview: oauthCredentials, loading: oauthLoading } = useProviderPool(
    { autoLoad },
  );
  const { providers: apiKeyProviders, loading: apiKeyLoading } =
    useApiKeyProvider({ autoLoad });

  // 计算已配置的 Provider 列表
  const providers = useMemo(
    () => buildConfiguredProviders(oauthCredentials, apiKeyProviders),
    [oauthCredentials, apiKeyProviders],
  );

  return {
    providers,
    loading: oauthLoading || apiKeyLoading,
  };
}

export default useConfiguredProviders;
