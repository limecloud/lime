/**
 * 模型注册表 API
 *
 * 提供与后端 ModelRegistryService 交互的 API
 */

import { safeInvoke } from "@/lib/dev-bridge";
import type {
  EnhancedModelMetadata,
  ModelSyncState,
  ModelTier,
  ProviderAliasConfig,
  UserModelPreference,
} from "@/lib/types/modelRegistry";

interface ModelRegistryQueryOptions {
  forceRefresh?: boolean;
}

export interface FetchProviderModelsResult {
  models: EnhancedModelMetadata[];
  source: "Api" | "Catalog" | "CustomModels" | "LocalFallback";
  error: string | null;
  request_url?: string | null;
  diagnostic_hint?: string | null;
  error_kind?:
    | "not_found"
    | "unauthorized"
    | "forbidden"
    | "network"
    | "invalid_response"
    | "other"
    | null;
  should_prompt_error?: boolean;
}

export function normalizeFetchProviderModelsSource(
  result: Pick<FetchProviderModelsResult, "source" | "models" | "error">,
): FetchProviderModelsResult["source"] {
  if (result.source === "CustomModels") {
    return "CustomModels";
  }

  const preservesCurrentProviderCustomModels =
    result.source === "LocalFallback" &&
    Array.isArray(result.models) &&
    result.models.length > 0 &&
    typeof result.error === "string" &&
    result.error.includes("已保留当前 Provider 的自定义模型");

  if (preservesCurrentProviderCustomModels) {
    return "CustomModels";
  }

  return result.source;
}

let modelRegistryCache: EnhancedModelMetadata[] | null = null;
let modelRegistryLoadingPromise: Promise<EnhancedModelMetadata[]> | null = null;
let allAliasConfigsCache: Record<string, ProviderAliasConfig> | null = null;
let allAliasConfigsLoadingPromise: Promise<
  Record<string, ProviderAliasConfig>
> | null = null;
const providerAliasConfigCache = new Map<string, ProviderAliasConfig | null>();
const providerAliasConfigLoadingPromises = new Map<
  string,
  Promise<ProviderAliasConfig | null>
>();

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeProviderKey(provider: string): string {
  return provider.trim();
}

function invalidateAliasConfigCache(): void {
  allAliasConfigsCache = null;
  allAliasConfigsLoadingPromise = null;
  providerAliasConfigCache.clear();
  providerAliasConfigLoadingPromises.clear();
}

export function invalidateModelRegistryCache(): void {
  modelRegistryCache = null;
  modelRegistryLoadingPromise = null;
  invalidateAliasConfigCache();
}

/**
 * 获取所有模型
 */
export async function getModelRegistry(
  options: ModelRegistryQueryOptions = {},
): Promise<EnhancedModelMetadata[]> {
  if (options.forceRefresh) {
    modelRegistryCache = null;
    modelRegistryLoadingPromise = null;
  }

  if (modelRegistryCache) {
    return cloneValue(modelRegistryCache);
  }

  if (!modelRegistryLoadingPromise) {
    modelRegistryLoadingPromise = safeInvoke<EnhancedModelMetadata[]>(
      "get_model_registry",
    )
      .then((models) => {
        modelRegistryCache = cloneValue(models);
        return modelRegistryCache;
      })
      .finally(() => {
        modelRegistryLoadingPromise = null;
      });
  }

  return cloneValue(await modelRegistryLoadingPromise);
}

/**
 * 获取模型注册表中所有 provider_id
 */
export async function getModelRegistryProviderIds(): Promise<string[]> {
  return safeInvoke("get_model_registry_provider_ids");
}

/**
 * 刷新模型注册表（强制从内嵌资源重新加载）
 * @returns 加载的模型数量
 */
export async function refreshModelRegistry(): Promise<number> {
  const count = await safeInvoke<number>("refresh_model_registry");
  invalidateModelRegistryCache();
  return count;
}

/**
 * 搜索模型
 * @param query 搜索关键词
 * @param limit 返回数量限制
 */
export async function searchModels(
  query: string,
  limit?: number,
): Promise<EnhancedModelMetadata[]> {
  return safeInvoke("search_models", { query, limit });
}

/**
 * 获取用户模型偏好
 */
export async function getModelPreferences(): Promise<UserModelPreference[]> {
  return safeInvoke("get_model_preferences");
}

/**
 * 切换模型收藏状态
 * @param modelId 模型 ID
 * @returns 新的收藏状态
 */
export async function toggleModelFavorite(modelId: string): Promise<boolean> {
  return safeInvoke("toggle_model_favorite", { modelId });
}

/**
 * 隐藏模型
 * @param modelId 模型 ID
 */
export async function hideModel(modelId: string): Promise<void> {
  return safeInvoke("hide_model", { modelId });
}

/**
 * 记录模型使用
 * @param modelId 模型 ID
 */
export async function recordModelUsage(modelId: string): Promise<void> {
  return safeInvoke("record_model_usage", { modelId });
}

/**
 * 获取模型同步状态
 */
export async function getModelSyncState(): Promise<ModelSyncState> {
  return safeInvoke("get_model_sync_state");
}

/**
 * 按 Provider 获取模型
 * @param providerId Provider ID
 */
export async function getModelsForProvider(
  providerId: string,
): Promise<EnhancedModelMetadata[]> {
  return safeInvoke("get_models_for_provider", { providerId });
}

/**
 * 按服务等级获取模型
 * @param tier 服务等级
 */
export async function getModelsByTier(
  tier: ModelTier,
): Promise<EnhancedModelMetadata[]> {
  return safeInvoke("get_models_by_tier", { tier });
}

export async function fetchProviderModelsAuto(
  providerId: string,
): Promise<FetchProviderModelsResult> {
  return safeInvoke("fetch_provider_models_auto", { providerId });
}

/**
 * 获取指定 Provider 的别名配置
 * 用于获取中转服务或协议转换相关的模型别名映射
 * @param provider Provider ID
 */
export async function getProviderAliasConfig(
  provider: string,
  options: ModelRegistryQueryOptions = {},
): Promise<ProviderAliasConfig | null> {
  const normalizedProvider = normalizeProviderKey(provider);
  if (!normalizedProvider) {
    return null;
  }

  if (options.forceRefresh) {
    invalidateAliasConfigCache();
  }

  if (allAliasConfigsCache) {
    return cloneValue(allAliasConfigsCache[normalizedProvider] ?? null);
  }

  if (providerAliasConfigCache.has(normalizedProvider)) {
    return cloneValue(providerAliasConfigCache.get(normalizedProvider) ?? null);
  }

  const existingPromise =
    providerAliasConfigLoadingPromises.get(normalizedProvider);
  if (existingPromise) {
    return cloneValue(await existingPromise);
  }

  const loadingPromise = safeInvoke<ProviderAliasConfig | null>(
    "get_provider_alias_config",
    { provider: normalizedProvider },
  )
    .then((config) => {
      const snapshot = config ? cloneValue(config) : null;
      providerAliasConfigCache.set(normalizedProvider, snapshot);
      return snapshot;
    })
    .finally(() => {
      providerAliasConfigLoadingPromises.delete(normalizedProvider);
    });

  providerAliasConfigLoadingPromises.set(normalizedProvider, loadingPromise);
  return cloneValue(await loadingPromise);
}

/**
 * 获取所有 Provider 的别名配置
 */
export async function getAllAliasConfigs(): Promise<
  Record<string, ProviderAliasConfig>
> {
  return getAllAliasConfigsCached();
}

async function getAllAliasConfigsCached(
  options: ModelRegistryQueryOptions = {},
): Promise<Record<string, ProviderAliasConfig>> {
  if (options.forceRefresh) {
    invalidateAliasConfigCache();
  }

  if (allAliasConfigsCache) {
    return cloneValue(allAliasConfigsCache);
  }

  if (!allAliasConfigsLoadingPromise) {
    allAliasConfigsLoadingPromise = safeInvoke<
      Record<string, ProviderAliasConfig>
    >("get_all_alias_configs")
      .then((configs) => {
        allAliasConfigsCache = cloneValue(configs);
        providerAliasConfigCache.clear();
        Object.entries(allAliasConfigsCache).forEach(([key, value]) => {
          providerAliasConfigCache.set(key, cloneValue(value));
        });
        return allAliasConfigsCache;
      })
      .finally(() => {
        allAliasConfigsLoadingPromise = null;
      });
  }

  return cloneValue(await allAliasConfigsLoadingPromise);
}

/**
 * 模型注册表 API 对象
 */
export const modelRegistryApi = {
  getModelRegistry,
  getModelRegistryProviderIds,
  refreshModelRegistry,
  searchModels,
  getModelPreferences,
  toggleModelFavorite,
  hideModel,
  recordModelUsage,
  getModelSyncState,
  getModelsForProvider,
  getModelsByTier,
  fetchProviderModelsAuto,
  normalizeFetchProviderModelsSource,
  getProviderAliasConfig,
  getAllAliasConfigs: getAllAliasConfigsCached,
};
