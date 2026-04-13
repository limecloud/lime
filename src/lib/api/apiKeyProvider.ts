/**
 * @file API Key Provider API 模块
 * @description 封装 API Key Provider 相关的 Tauri 命令调用
 * @module lib/api/apiKeyProvider
 *
 * **Feature: provider-ui-refactor**
 * **Validates: Requirements 9.1**
 */

import { safeInvoke } from "@/lib/dev-bridge";
import type { ProviderDeclaredPromptCacheMode } from "@/lib/types/provider";

interface ProviderQueryOptions {
  forceRefresh?: boolean;
}

let providersCache: ProviderWithKeysDisplay[] | null = null;
let providersLoadingPromise: Promise<ProviderWithKeysDisplay[]> | null = null;

function cloneProviderList(
  providers: ProviderWithKeysDisplay[],
): ProviderWithKeysDisplay[] {
  return providers.map((provider) => ({
    ...provider,
    api_keys: Array.isArray(provider.api_keys)
      ? provider.api_keys.map((apiKey) => ({ ...apiKey }))
      : [],
    custom_models: Array.isArray(provider.custom_models)
      ? [...provider.custom_models]
      : [],
    prompt_cache_mode: provider.prompt_cache_mode ?? null,
  }));
}

export function invalidateApiKeyProviderCache(): void {
  providersCache = null;
  providersLoadingPromise = null;
}

async function loadProviders(
  options: ProviderQueryOptions = {},
): Promise<ProviderWithKeysDisplay[]> {
  if (options.forceRefresh) {
    invalidateApiKeyProviderCache();
  }

  if (providersCache) {
    return cloneProviderList(providersCache);
  }

  if (!providersLoadingPromise) {
    providersLoadingPromise = safeInvoke<ProviderWithKeysDisplay[]>(
      "get_api_key_providers",
    )
      .then((providers) => {
        providersCache = cloneProviderList(providers);
        return providersCache;
      })
      .finally(() => {
        providersLoadingPromise = null;
      });
  }

  return cloneProviderList(await providersLoadingPromise);
}

async function invalidateAfterMutation<T>(promise: Promise<T>): Promise<T> {
  const result = await promise;
  invalidateApiKeyProviderCache();
  return result;
}

// ============================================================================
// 请求类型
// ============================================================================

/**
 * 添加自定义 Provider 请求
 */
export interface AddCustomProviderRequest {
  name: string;
  type: string;
  api_host: string;
  api_version?: string;
  project?: string;
  location?: string;
  region?: string;
  prompt_cache_mode?: ProviderDeclaredPromptCacheMode | null;
}

/**
 * 更新 Provider 请求
 */
export interface UpdateProviderRequest {
  name?: string;
  /** Provider 类型（系统/自定义 Provider 均可修改） */
  type?: string;
  api_host?: string;
  enabled?: boolean;
  sort_order?: number;
  api_version?: string;
  project?: string;
  location?: string;
  region?: string;
  prompt_cache_mode?: ProviderDeclaredPromptCacheMode | null;
  /** 自定义模型列表 */
  custom_models?: string[];
}

/**
 * 添加 API Key 请求
 */
export interface AddApiKeyRequest {
  provider_id: string;
  api_key: string;
  alias?: string;
}

// ============================================================================
// 响应类型
// ============================================================================

/**
 * Provider 显示数据（用于前端）
 */
export interface ProviderDisplay {
  id: string;
  name: string;
  type: string;
  api_host: string;
  is_system: boolean;
  group: string;
  enabled: boolean;
  sort_order: number;
  api_version?: string;
  project?: string;
  location?: string;
  region?: string;
  /** 自定义模型列表 */
  custom_models?: string[];
  /** Provider 当前生效的 Prompt Cache 模式（已包含官方兼容端点推断与类型回退） */
  prompt_cache_mode?: ProviderDeclaredPromptCacheMode | null;
  api_key_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * API Key 显示数据（用于前端，掩码显示）
 */
export interface ApiKeyDisplay {
  id: string;
  provider_id: string;
  /** 掩码后的 API Key */
  api_key_masked: string;
  alias?: string;
  enabled: boolean;
  usage_count: number;
  error_count: number;
  last_used_at?: string;
  created_at: string;
}

/**
 * Provider 完整显示数据（包含 API Keys）
 */
export interface ProviderWithKeysDisplay extends ProviderDisplay {
  api_keys: ApiKeyDisplay[];
}

/**
 * 系统 Provider Catalog 条目
 * 用于前端动态构建系统 Provider 元信息
 */
export interface SystemProviderCatalogItem {
  id: string;
  name: string;
  type: string;
  api_host: string;
  group: string;
  sort_order: number;
  api_version?: string;
  /** 兼容旧版本前端/历史配置的别名 ID */
  legacy_ids: string[];
}

/**
 * 导入结果
 */
export interface ImportResult {
  success: boolean;
  imported_providers: number;
  imported_api_keys: number;
  skipped_providers: number;
  errors: string[];
}

export interface ChatTestResult {
  success: boolean;
  latency_ms?: number;
  error?: string;
  content?: string;
  raw?: string;
}

// ============================================================================
// API 函数
// ============================================================================

/**
 * API Key Provider API 封装
 */
export const apiKeyProviderApi = {
  /**
   * 获取系统 Provider Catalog
   */
  async getSystemProviderCatalog(): Promise<SystemProviderCatalogItem[]> {
    return safeInvoke("get_system_provider_catalog");
  },

  /**
   * 获取所有 API Key Provider（包含 API Keys）
   */
  async getProviders(
    options: ProviderQueryOptions = {},
  ): Promise<ProviderWithKeysDisplay[]> {
    return loadProviders(options);
  },

  /**
   * 获取单个 API Key Provider（包含 API Keys）
   */
  async getProvider(id: string): Promise<ProviderWithKeysDisplay | null> {
    return safeInvoke("get_api_key_provider", { id });
  },

  /**
   * 添加自定义 Provider
   */
  async addCustomProvider(
    request: AddCustomProviderRequest,
  ): Promise<ProviderDisplay> {
    return invalidateAfterMutation(
      safeInvoke("add_custom_api_key_provider", { request }),
    );
  },

  /**
   * 更新 Provider 配置
   */
  async updateProvider(
    id: string,
    request: UpdateProviderRequest,
  ): Promise<ProviderDisplay> {
    return invalidateAfterMutation(
      safeInvoke("update_api_key_provider", { id, request }),
    );
  },

  /**
   * 删除自定义 Provider
   */
  async deleteCustomProvider(id: string): Promise<boolean> {
    return invalidateAfterMutation(
      safeInvoke("delete_custom_api_key_provider", { id }),
    );
  },

  /**
   * 添加 API Key
   */
  async addApiKey(request: AddApiKeyRequest): Promise<ApiKeyDisplay> {
    return invalidateAfterMutation(safeInvoke("add_api_key", { request }));
  },

  /**
   * 删除 API Key
   */
  async deleteApiKey(keyId: string): Promise<boolean> {
    return invalidateAfterMutation(safeInvoke("delete_api_key", { keyId }));
  },

  /**
   * 切换 API Key 启用状态
   */
  async toggleApiKey(keyId: string, enabled: boolean): Promise<ApiKeyDisplay> {
    return invalidateAfterMutation(
      safeInvoke("toggle_api_key", { keyId, enabled }),
    );
  },

  /**
   * 更新 API Key 别名
   */
  async updateApiKeyAlias(
    keyId: string,
    alias?: string,
  ): Promise<ApiKeyDisplay> {
    return invalidateAfterMutation(
      safeInvoke("update_api_key_alias", { keyId, alias }),
    );
  },

  /**
   * 获取下一个可用的 API Key（用于 API 调用）
   */
  async getNextApiKey(providerId: string): Promise<string | null> {
    return safeInvoke("get_next_api_key", { providerId });
  },

  /**
   * 记录 API Key 使用
   */
  async recordUsage(keyId: string): Promise<void> {
    return safeInvoke("record_api_key_usage", { keyId });
  },

  /**
   * 记录 API Key 错误
   */
  async recordError(keyId: string): Promise<void> {
    return safeInvoke("record_api_key_error", { keyId });
  },

  /**
   * 获取 UI 状态
   */
  async getUiState(key: string): Promise<string | null> {
    return safeInvoke("get_provider_ui_state", { key });
  },

  /**
   * 设置 UI 状态
   */
  async setUiState(key: string, value: string): Promise<void> {
    return safeInvoke("set_provider_ui_state", { key, value });
  },

  /**
   * 批量更新 Provider 排序顺序
   * **Validates: Requirements 8.4**
   */
  async updateSortOrders(sortOrders: [string, number][]): Promise<void> {
    return invalidateAfterMutation(
      safeInvoke("update_provider_sort_orders", { sortOrders }),
    );
  },

  /**
   * 导出 Provider 配置
   */
  async exportConfig(includeKeys: boolean): Promise<string> {
    return safeInvoke("export_api_key_providers", { includeKeys });
  },

  /**
   * 导入 Provider 配置
   */
  async importConfig(configJson: string): Promise<ImportResult> {
    return invalidateAfterMutation(
      safeInvoke("import_api_key_providers", { configJson }),
    );
  },

  // ============================================================================
  // 连接测试 API
  // ============================================================================

  /**
   * 测试 API Key Provider 连接
   *
   * 方案 C 实现：
   * 1. 默认使用 /v1/models 端点测试
   * 2. 如果提供了 modelName，用该模型发送简单请求
   *
   * @param providerId Provider ID
   * @param modelName 可选的模型名称，用于发送测试请求
   */
  async testConnection(
    providerId: string,
    modelName?: string,
  ): Promise<ConnectionTestResult> {
    return safeInvoke("test_api_key_provider_connection", {
      providerId,
      provider_id: providerId,
      modelName,
      model_name: modelName,
    });
  },

  async testChat(
    providerId: string,
    modelName: string | undefined,
    prompt: string,
  ): Promise<ChatTestResult> {
    return safeInvoke("test_api_key_provider_chat", {
      providerId,
      provider_id: providerId,
      modelName,
      model_name: modelName,
      prompt,
    });
  },
};

// ============================================================================
// 连接测试类型
// ============================================================================

/**
 * 连接测试结果
 */
export interface ConnectionTestResult {
  /** 是否成功 */
  success: boolean;
  /** 延迟（毫秒） */
  latency_ms?: number;
  /** 错误信息 */
  error?: string;
  /** 测试方法 */
  method?: string;
  /** 模型列表（如果使用 models 端点测试） */
  models?: string[];
}
