/**
 * @file Provider 模型列表 Hook
 * @description 根据 Provider 获取对应的模型列表
 * @module hooks/useProviderModels
 */

import { useMemo, useState, useEffect } from "react";
import {
  modelRegistryApi,
  type FetchProviderModelsResult,
} from "@/lib/api/modelRegistry";
import { providerPoolApi } from "@/lib/api/providerPool";
import { useModelRegistry } from "./useModelRegistry";
import { useAliasConfig } from "./useAliasConfig";
import {
  getAliasConfigKey,
  isAliasProvider,
} from "@/lib/constants/providerMappings";
import {
  buildProviderModelsFromBackendModelIds,
  buildProviderModelsFromRegistry,
} from "@/lib/model/providerModelsCatalog";
import { getProviderModelAutoFetchCapability } from "@/lib/model/providerModelFetchSupport";
import type { ConfiguredProvider } from "./useConfiguredProviders";
import type { EnhancedModelMetadata } from "@/lib/types/modelRegistry";

// ============================================================================
// 类型定义
// ============================================================================

export interface UseProviderModelsOptions {
  /** 是否返回完整的模型元数据（默认只返回模型 ID） */
  returnFullMetadata?: boolean;
  /** 是否自动加载模型注册表 */
  autoLoad?: boolean;
  /** 对支持实时拉取模型的 Provider，仅接受实时模型目录 */
  liveFetchOnly?: boolean;
  /** 当前 Provider 是否有可用 API Key */
  hasApiKey?: boolean;
}

export interface UseProviderModelsResult {
  /** 模型 ID 列表 */
  modelIds: string[];
  /** 完整的模型元数据列表（仅当 returnFullMetadata 为 true 时有值） */
  models: EnhancedModelMetadata[];
  /** 是否正在加载 */
  loading: boolean;
  /** 加载错误 */
  error: string | null;
}

interface LoadProviderModelsOptions {
  forceRefresh?: boolean;
  liveFetchOnly?: boolean;
  hasApiKey?: boolean;
}

function getProviderAutoFetchCapability(selectedProvider: ConfiguredProvider) {
  return getProviderModelAutoFetchCapability({
    providerId: selectedProvider.providerId ?? selectedProvider.key,
    providerType: selectedProvider.type,
    apiHost: selectedProvider.apiHost,
  });
}

async function fetchProviderModelsFromApi(
  selectedProvider: ConfiguredProvider,
): Promise<EnhancedModelMetadata[]> {
  if (!getProviderAutoFetchCapability(selectedProvider).supported) {
    return [];
  }

  try {
    const result: FetchProviderModelsResult =
      await modelRegistryApi.fetchProviderModelsAuto(
        selectedProvider.providerId ?? selectedProvider.key,
      );

    if (
      result &&
      result.source === "Api" &&
      result.models &&
      result.models.length > 0
    ) {
      return result.models;
    }
  } catch {
    // ignore and fall back below
  }

  return [];
}

async function fetchProviderModelsFromProviderPool(
  selectedProvider: ConfiguredProvider,
  registryModels: EnhancedModelMetadata[],
): Promise<EnhancedModelMetadata[]> {
  if (selectedProvider.providerId) {
    return [];
  }

  try {
    const modelsByProvider = await providerPoolApi.getAllModelsByProvider();
    const providerModelIds = modelsByProvider[selectedProvider.type] ?? [];

    if (!Array.isArray(providerModelIds) || providerModelIds.length === 0) {
      return [];
    }

    return buildProviderModelsFromBackendModelIds(
      selectedProvider,
      registryModels,
      providerModelIds,
    );
  } catch {
    return [];
  }
}

export async function loadProviderModels(
  selectedProvider: ConfiguredProvider | undefined | null,
  options: LoadProviderModelsOptions = {},
): Promise<EnhancedModelMetadata[]> {
  if (!selectedProvider) {
    return [];
  }

  const sourceOptions = options.forceRefresh
    ? { forceRefresh: true }
    : undefined;
  const aliasConfigPromise = isAliasProvider(selectedProvider.key)
    ? modelRegistryApi.getProviderAliasConfig(
        getAliasConfigKey(selectedProvider.key),
        sourceOptions,
      )
    : Promise.resolve(null);

  const [registryModels, aliasConfig] = await Promise.all([
    modelRegistryApi.getModelRegistry(sourceOptions),
    aliasConfigPromise,
  ]);
  const autoFetchCapability = getProviderAutoFetchCapability(selectedProvider);
  const useLiveFetchTruthOnly =
    options.liveFetchOnly && autoFetchCapability.supported;

  if (
    useLiveFetchTruthOnly &&
    autoFetchCapability.requiresApiKey &&
    !options.hasApiKey
  ) {
    return [];
  }

  const localResult = buildProviderModelsFromRegistry(
    selectedProvider,
    registryModels,
    aliasConfig,
  );
  const providerPoolModels = await fetchProviderModelsFromProviderPool(
    selectedProvider,
    registryModels,
  );
  if (useLiveFetchTruthOnly) {
    return fetchProviderModelsFromApi(selectedProvider);
  }

  if (providerPoolModels.length > 0) {
    return providerPoolModels;
  }

  if (localResult.hasLocalModels || localResult.models.length > 0) {
    return localResult.models;
  }

  if (isAliasProvider(selectedProvider.key)) {
    return localResult.models;
  }

  if (!autoFetchCapability.supported) {
    return localResult.models;
  }

  const apiModels = await fetchProviderModelsFromApi(selectedProvider);
  if (apiModels.length === 0) {
    return localResult.models;
  }
  const existingModelIds = new Set(
    localResult.models.map((model) => model.id.toLowerCase()),
  );

  return [
    ...localResult.models,
    ...apiModels.filter((model) => {
      const normalizedModelId = model.id.toLowerCase();
      if (existingModelIds.has(normalizedModelId)) {
        return false;
      }
      existingModelIds.add(normalizedModelId);
      return true;
    }),
  ];
}

// ============================================================================
// Hook 实现
// ============================================================================

/**
 * 获取 Provider 的模型列表
 *
 * 根据 Provider 类型，从别名配置或模型注册表获取模型列表。
 * 如果本地没有模型，会尝试从 Provider API 获取。
 * 支持返回模型 ID 列表或完整的模型元数据。
 *
 * @param selectedProvider 当前选中的 Provider
 * @param options 配置选项
 * @returns 模型列表、加载状态和错误信息
 *
 * @example
 * ```tsx
 * // 只获取模型 ID
 * const { modelIds, loading } = useProviderModels(selectedProvider);
 *
 * // 获取完整元数据
 * const { models, loading } = useProviderModels(selectedProvider, {
 *   returnFullMetadata: true
 * });
 * ```
 */
export function useProviderModels(
  selectedProvider: ConfiguredProvider | undefined | null,
  options: UseProviderModelsOptions = {},
): UseProviderModelsResult {
  const {
    returnFullMetadata = false,
    autoLoad = true,
    liveFetchOnly = false,
    hasApiKey = false,
  } = options;

  // 获取模型注册表数据
  const {
    models: registryModels,
    loading: registryLoading,
    error: registryError,
  } = useModelRegistry({ autoLoad });

  // 获取别名配置
  const { aliasConfig, loading: aliasLoading } = useAliasConfig(
    selectedProvider,
    { autoLoad },
  );

  // API 获取的模型缓存
  const [apiModels, setApiModels] = useState<EnhancedModelMetadata[]>([]);
  const [apiLoading, setApiLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [providerPoolModelIds, setProviderPoolModelIds] = useState<string[]>(
    [],
  );
  const [providerPoolLoading, setProviderPoolLoading] = useState(false);
  const [providerPoolError, setProviderPoolError] = useState<string | null>(
    null,
  );

  // 计算本地模型列表
  const localResult = useMemo(
    () =>
      buildProviderModelsFromRegistry(
        selectedProvider,
        registryModels,
        aliasConfig,
      ),
    [selectedProvider, registryModels, aliasConfig],
  );
  const autoFetchCapability = useMemo(
    () =>
      selectedProvider
        ? getProviderAutoFetchCapability(selectedProvider)
        : null,
    [selectedProvider],
  );
  const selectedProviderId = selectedProvider?.providerId;
  const selectedProviderType = selectedProvider?.type;
  const useLiveFetchTruthOnly = Boolean(
    liveFetchOnly && autoFetchCapability?.supported,
  );
  const canReadLiveModels = Boolean(
    !useLiveFetchTruthOnly || !autoFetchCapability?.requiresApiKey || hasApiKey,
  );
  const providerPoolModels = useMemo(
    () =>
      buildProviderModelsFromBackendModelIds(
        selectedProvider,
        registryModels,
        providerPoolModelIds,
      ),
    [providerPoolModelIds, registryModels, selectedProvider],
  );

  useEffect(() => {
    if (!selectedProviderType || selectedProviderId) {
      setProviderPoolModelIds([]);
      setProviderPoolLoading(false);
      setProviderPoolError(null);
      return;
    }

    if (!autoLoad) {
      setProviderPoolModelIds([]);
      setProviderPoolLoading(false);
      setProviderPoolError(null);
      return;
    }

    let cancelled = false;

    const loadProviderPoolModels = async () => {
      setProviderPoolLoading(true);
      setProviderPoolError(null);

      try {
        const modelsByProvider = await providerPoolApi.getAllModelsByProvider();
        if (cancelled) {
          return;
        }

        const nextModelIds = modelsByProvider[selectedProviderType] ?? [];
        setProviderPoolModelIds(
          Array.isArray(nextModelIds) ? nextModelIds : [],
        );
      } catch (error) {
        if (cancelled) {
          return;
        }

        setProviderPoolError(
          error instanceof Error ? error.message : String(error),
        );
        setProviderPoolModelIds([]);
      } finally {
        if (!cancelled) {
          setProviderPoolLoading(false);
        }
      }
    };

    void loadProviderPoolModels();

    return () => {
      cancelled = true;
    };
  }, [autoLoad, selectedProviderId, selectedProviderType]);

  // 当本地没有模型时，从 API 获取
  useEffect(() => {
    if (!selectedProvider) {
      setApiModels([]);
      setApiLoading(false);
      setApiError(null);
      return;
    }

    if (!autoLoad) {
      setApiModels([]);
      setApiLoading(false);
      setApiError(null);
      return;
    }

    // 如果是别名 Provider，不从 API 获取
    if (isAliasProvider(selectedProvider.key)) {
      setApiModels([]);
      setApiLoading(false);
      setApiError(null);
      return;
    }

    if (!autoFetchCapability?.supported) {
      setApiModels([]);
      setApiLoading(false);
      setApiError(null);
      return;
    }

    if (!canReadLiveModels) {
      setApiModels([]);
      setApiLoading(false);
      setApiError(null);
      return;
    }

    // 如果本地有模型，不需要从 API 获取
    if (!useLiveFetchTruthOnly && localResult.hasLocalModels) {
      setApiModels([]);
      return;
    }

    // 如果还在加载本地数据，等待
    if (registryLoading || aliasLoading) {
      return;
    }

    // 从 API 获取模型
    const fetchFromApi = async () => {
      setApiLoading(true);
      setApiError(null);

      try {
        setApiModels(await fetchProviderModelsFromApi(selectedProvider));
      } catch (err) {
        setApiError(err instanceof Error ? err.message : String(err));
        setApiModels([]);
      } finally {
        setApiLoading(false);
      }
    };

    fetchFromApi();
  }, [
    selectedProvider,
    autoLoad,
    autoFetchCapability,
    canReadLiveModels,
    useLiveFetchTruthOnly,
    localResult.hasLocalModels,
    registryLoading,
    aliasLoading,
  ]);

  // 合并本地模型和 API 模型
  const finalResult = useMemo(() => {
    if (useLiveFetchTruthOnly) {
      return {
        modelIds: apiModels.map((model) => model.id),
        models: returnFullMetadata ? apiModels : [],
      };
    }

    if (providerPoolModels.length > 0) {
      return {
        modelIds: providerPoolModels.map((model) => model.id),
        models: returnFullMetadata ? providerPoolModels : [],
      };
    }

    // 如果有本地模型，使用本地模型
    if (localResult.hasLocalModels || localResult.models.length > 0) {
      return {
        modelIds: localResult.modelIds,
        models: returnFullMetadata ? localResult.models : [],
      };
    }

    // 否则使用 API 模型
    if (apiModels.length > 0) {
      const existingModelIds = new Set(
        localResult.models.map((model) => model.id.toLowerCase()),
      );
      const allModels = [
        ...localResult.models,
        ...apiModels.filter((model) => {
          const normalizedModelId = model.id.toLowerCase();
          if (existingModelIds.has(normalizedModelId)) {
            return false;
          }
          existingModelIds.add(normalizedModelId);
          return true;
        }),
      ];
      const allModelIds = allModels.map((m) => m.id);

      return {
        modelIds: allModelIds,
        models: returnFullMetadata ? allModels : [],
      };
    }

    return {
      modelIds: localResult.modelIds,
      models: returnFullMetadata ? localResult.models : [],
    };
  }, [
    apiModels,
    localResult,
    providerPoolModels,
    returnFullMetadata,
    useLiveFetchTruthOnly,
  ]);

  // 计算加载状态
  const loading =
    registryLoading || aliasLoading || apiLoading || providerPoolLoading;

  // 计算错误状态
  const error = registryError || apiError || providerPoolError || null;

  return {
    ...finalResult,
    loading,
    error,
  };
}

/**
 * 简化版本：只返回模型 ID 列表
 */
export function useProviderModelIds(
  selectedProvider: ConfiguredProvider | undefined | null,
): string[] {
  const { modelIds } = useProviderModels(selectedProvider);
  return modelIds;
}

export default useProviderModels;
