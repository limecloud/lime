/**
 * @file useApiKeyProvider Hook
 * @description 管理 API Key Provider 状态和 CRUD 操作
 * @module hooks/useApiKeyProvider
 *
 * **Feature: provider-ui-refactor**
 * **Validates: Requirements 9.1**
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  apiKeyProviderApi,
  ProviderWithKeysDisplay,
  ProviderDisplay,
  ApiKeyDisplay,
  AddCustomProviderRequest,
  UpdateProviderRequest,
  AddApiKeyRequest,
  ImportResult,
} from "@/lib/api/apiKeyProvider";
import { ProviderGroup } from "@/lib/types/provider";
import {
  emitProviderDataChanged,
  subscribeProviderDataChanged,
} from "@/lib/providerDataEvents";
import { isDebugFlagEnabled } from "@/lib/perfDebug";
import { isOemManagedHubProvider } from "@/lib/oemLimeHubProvider";

// ============================================================================
// Hook 返回类型
// ============================================================================

export interface UseApiKeyProviderReturn {
  /** 所有 Provider（包含 API Keys） */
  providers: ProviderWithKeysDisplay[];
  /** 当前选中的 Provider ID */
  selectedProviderId: string | null;
  /** 当前选中的 Provider（包含 API Keys） */
  selectedProvider: ProviderWithKeysDisplay | null;
  /** 是否正在加载 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 搜索查询 */
  searchQuery: string;
  /** 折叠的分组 */
  collapsedGroups: Set<ProviderGroup>;

  // ===== 操作方法 =====

  /** 刷新 Provider 列表 */
  refresh: () => Promise<void>;
  /** 选择 Provider */
  selectProvider: (id: string | null) => void;
  /** 设置搜索查询 */
  setSearchQuery: (query: string) => void;
  /** 切换分组折叠状态 */
  toggleGroup: (group: ProviderGroup) => void;
  /** 重新排序 Provider（在分组内） */
  reorderProviders: (
    group: ProviderGroup,
    reorderedIds: string[],
  ) => Promise<void>;

  // ===== Provider CRUD =====

  /** 添加自定义 Provider */
  addCustomProvider: (
    request: AddCustomProviderRequest,
  ) => Promise<ProviderDisplay>;
  /** 更新 Provider */
  updateProvider: (
    id: string,
    request: UpdateProviderRequest,
  ) => Promise<ProviderDisplay>;
  /** 删除自定义 Provider */
  deleteCustomProvider: (id: string) => Promise<boolean>;
  /** 切换 Provider 启用状态 */
  toggleProviderEnabled: (
    id: string,
    enabled: boolean,
  ) => Promise<ProviderDisplay>;

  // ===== API Key CRUD =====

  /** 添加 API Key */
  addApiKey: (
    providerId: string,
    apiKey: string,
    alias?: string,
  ) => Promise<ApiKeyDisplay>;
  /** 删除 API Key */
  deleteApiKey: (keyId: string) => Promise<boolean>;
  /** 切换 API Key 启用状态 */
  toggleApiKey: (keyId: string, enabled: boolean) => Promise<ApiKeyDisplay>;
  /** 更新 API Key 别名 */
  updateApiKeyAlias: (keyId: string, alias?: string) => Promise<ApiKeyDisplay>;

  // ===== 导入导出 =====

  /** 导出配置 */
  exportConfig: (includeKeys: boolean) => Promise<string>;
  /** 导入配置 */
  importConfig: (configJson: string) => Promise<ImportResult>;

  // ===== 过滤后的数据 =====

  /** 按搜索过滤后的 Provider 列表 */
  filteredProviders: ProviderWithKeysDisplay[];
  /** 按分组组织的 Provider */
  providersByGroup: Map<ProviderGroup, ProviderWithKeysDisplay[]>;
}

interface UseApiKeyProviderOptions {
  autoLoad?: boolean;
}

// ============================================================================
// UI 状态键
// ============================================================================

const UI_STATE_KEYS = {
  COLLAPSED_GROUPS: "collapsed_groups",
  SELECTED_PROVIDER: "selected_provider",
  PROVIDER_SORT_ORDERS: "provider_sort_orders",
} as const;

const PROVIDER_DEBUG_KEY = "lime:provider-debug";

interface ProviderCacheState {
  providers: ProviderWithKeysDisplay[] | null;
  inFlight: Promise<ProviderWithKeysDisplay[]> | null;
}

const providerCacheState: ProviderCacheState = {
  providers: null,
  inFlight: null,
};

function cloneProviders(
  providers: ProviderWithKeysDisplay[],
): ProviderWithKeysDisplay[] {
  return providers.map((provider) => ({
    ...provider,
    api_keys: provider.api_keys.map((apiKey) => ({ ...apiKey })),
  }));
}

function readProvidersFromCache(): ProviderWithKeysDisplay[] | null {
  if (!providerCacheState.providers) {
    return null;
  }
  return cloneProviders(providerCacheState.providers);
}

function writeProvidersToCache(providers: ProviderWithKeysDisplay[]): void {
  providerCacheState.providers = cloneProviders(providers);
}

function providerDebugLog(...args: unknown[]): void {
  if (!isDebugFlagEnabled(PROVIDER_DEBUG_KEY)) {
    return;
  }
  console.debug(...args);
}

// ============================================================================
// Hook 实现
// ============================================================================

export function useApiKeyProvider(
  options: UseApiKeyProviderOptions = {},
): UseApiKeyProviderReturn {
  const { autoLoad = true } = options;
  // ===== 状态 =====
  const [providers, setProviders] = useState<ProviderWithKeysDisplay[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<ProviderGroup>>(
    new Set(),
  );

  const applyCachedProviders = useCallback((): boolean => {
    const cached = readProvidersFromCache();
    if (!cached) {
      return false;
    }
    setProviders(cached);
    setError(null);
    setLoading(false);
    providerDebugLog(
      `[useApiKeyProvider] 使用缓存数据，provider 数量=${cached.length}`,
    );
    return true;
  }, []);

  // ===== 加载 Provider 列表 =====
  const fetchProviders = useCallback(
    async (force = false) => {
      try {
        if (!force && applyCachedProviders()) {
          return;
        }

        if (providerCacheState.inFlight) {
          providerDebugLog("[useApiKeyProvider] 复用进行中的 Provider 请求");
          const inFlightData = await providerCacheState.inFlight;
          setProviders(cloneProviders(inFlightData));
          setError(null);
          setLoading(false);
          return;
        }

        providerDebugLog("[useApiKeyProvider] 开始获取 Provider 列表...");
        if (providers.length === 0) {
          setLoading(true);
        }
        setError(null);
        providerCacheState.inFlight = apiKeyProviderApi.getProviders(
          force ? { forceRefresh: true } : undefined,
        );
        const data = await providerCacheState.inFlight;
        providerDebugLog(
          "[useApiKeyProvider] 获取到",
          data.length,
          "个 Provider",
        );

        // 打印每个 Provider 的 API Key 数量
        data.forEach((p) => {
          providerDebugLog(
            `[useApiKeyProvider] Provider ${p.id} (${p.name}): ${p.api_keys?.length || 0} 个 API Key`,
          );
        });

        writeProvidersToCache(data);
        setProviders(cloneProviders(data));
        providerDebugLog(
          "[useApiKeyProvider] 状态已更新，providers 数组已刷新",
        );
      } catch (e) {
        console.error("[useApiKeyProvider] 获取 Provider 列表失败:", e);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        providerCacheState.inFlight = null;
        setLoading(false);
      }
    },
    [applyCachedProviders, providers.length],
  );

  const refreshAndNotify = useCallback(async () => {
    await fetchProviders(true);
    emitProviderDataChanged("api_key");
  }, [fetchProviders]);

  // ===== 加载 UI 状态 =====
  const loadUiState = useCallback(async () => {
    try {
      // 加载折叠状态
      const collapsedJson = await apiKeyProviderApi.getUiState(
        UI_STATE_KEYS.COLLAPSED_GROUPS,
      );
      if (collapsedJson) {
        const collapsed = JSON.parse(collapsedJson) as ProviderGroup[];
        setCollapsedGroups(new Set(collapsed));
      }

      // 加载选中的 Provider
      const selectedId = await apiKeyProviderApi.getUiState(
        UI_STATE_KEYS.SELECTED_PROVIDER,
      );
      if (selectedId) {
        setSelectedProviderId(selectedId);
      }
    } catch {
      // 忽略 UI 状态加载错误
    }
  }, []);

  // ===== 初始化 =====
  useEffect(() => {
    if (!autoLoad) {
      setLoading(false);
      return;
    }

    if (!applyCachedProviders()) {
      void fetchProviders(true);
    }
    loadUiState();

    const unsubscribe = subscribeProviderDataChanged((source) => {
      if (source === "api_key") {
        if (!applyCachedProviders()) {
          void fetchProviders(true);
        }
        return;
      }

      void fetchProviders(true);
    });

    return () => {
      unsubscribe();
    };
  }, [applyCachedProviders, autoLoad, fetchProviders, loadUiState]);

  // ===== 保存折叠状态 =====
  const saveCollapsedGroups = useCallback(
    async (groups: Set<ProviderGroup>) => {
      try {
        await apiKeyProviderApi.setUiState(
          UI_STATE_KEYS.COLLAPSED_GROUPS,
          JSON.stringify(Array.from(groups)),
        );
      } catch {
        // 忽略保存错误
      }
    },
    [],
  );

  // ===== 保存选中的 Provider =====
  const saveSelectedProvider = useCallback(async (id: string | null) => {
    try {
      if (id) {
        await apiKeyProviderApi.setUiState(UI_STATE_KEYS.SELECTED_PROVIDER, id);
      }
    } catch {
      // 忽略保存错误
    }
  }, []);

  // ===== 选择 Provider =====
  const selectProvider = useCallback(
    (id: string | null) => {
      setSelectedProviderId(id);
      saveSelectedProvider(id);
    },
    [saveSelectedProvider],
  );

  // ===== 切换分组折叠 =====
  const toggleGroup = useCallback(
    (group: ProviderGroup) => {
      setCollapsedGroups((prev) => {
        const next = new Set(prev);
        if (next.has(group)) {
          next.delete(group);
        } else {
          next.add(group);
        }
        saveCollapsedGroups(next);
        return next;
      });
    },
    [saveCollapsedGroups],
  );

  // ===== 重新排序 Provider =====
  const reorderProviders = useCallback(
    async (group: ProviderGroup, reorderedIds: string[]) => {
      // 计算新的 sort_order 值
      // 每个分组内的 Provider 按顺序分配 sort_order
      const sortOrders: [string, number][] = reorderedIds.map((id, index) => [
        id,
        index,
      ]);

      try {
        // 更新数据库
        await apiKeyProviderApi.updateSortOrders(sortOrders);
        // 刷新列表
        await refreshAndNotify();
      } catch {
        // 忽略错误，保持 UI 状态
      }
    },
    [refreshAndNotify],
  );

  // ===== Provider CRUD =====

  const addCustomProvider = useCallback(
    async (request: AddCustomProviderRequest): Promise<ProviderDisplay> => {
      const result = await apiKeyProviderApi.addCustomProvider(request);
      await refreshAndNotify();
      // 自动选中新添加的 Provider
      selectProvider(result.id);
      return result;
    },
    [refreshAndNotify, selectProvider],
  );

  const updateProvider = useCallback(
    async (
      id: string,
      request: UpdateProviderRequest,
    ): Promise<ProviderDisplay> => {
      const result = await apiKeyProviderApi.updateProvider(id, request);
      await refreshAndNotify();
      return result;
    },
    [refreshAndNotify],
  );

  const deleteCustomProvider = useCallback(
    async (id: string): Promise<boolean> => {
      const result = await apiKeyProviderApi.deleteCustomProvider(id);
      if (result) {
        await refreshAndNotify();
        // 如果删除的是当前选中的，清除选中状态
        if (selectedProviderId === id) {
          selectProvider(null);
        }
      }
      return result;
    },
    [refreshAndNotify, selectedProviderId, selectProvider],
  );

  const toggleProviderEnabled = useCallback(
    async (id: string, enabled: boolean): Promise<ProviderDisplay> => {
      const result = await apiKeyProviderApi.updateProvider(id, { enabled });
      await refreshAndNotify();
      return result;
    },
    [refreshAndNotify],
  );

  // ===== API Key CRUD =====

  const addApiKey = useCallback(
    async (
      providerId: string,
      apiKey: string,
      alias?: string,
    ): Promise<ApiKeyDisplay> => {
      const request: AddApiKeyRequest = {
        provider_id: providerId,
        api_key: apiKey,
        alias,
      };

      providerDebugLog("[useApiKeyProvider] 开始添加 API Key:", {
        providerId,
        alias,
      });
      const result = await apiKeyProviderApi.addApiKey(request);
      providerDebugLog("[useApiKeyProvider] API Key 添加成功:", result.id);

      // 强制刷新 Provider 列表以确保新添加的 API Key 显示
      providerDebugLog("[useApiKeyProvider] 刷新 Provider 列表...");
      await refreshAndNotify();
      providerDebugLog("[useApiKeyProvider] Provider 列表刷新完成");

      return result;
    },
    [refreshAndNotify],
  );

  const deleteApiKey = useCallback(
    async (keyId: string): Promise<boolean> => {
      const result = await apiKeyProviderApi.deleteApiKey(keyId);
      if (result) {
        await refreshAndNotify();
      }
      return result;
    },
    [refreshAndNotify],
  );

  const toggleApiKey = useCallback(
    async (keyId: string, enabled: boolean): Promise<ApiKeyDisplay> => {
      const result = await apiKeyProviderApi.toggleApiKey(keyId, enabled);
      await refreshAndNotify();
      return result;
    },
    [refreshAndNotify],
  );

  const updateApiKeyAlias = useCallback(
    async (keyId: string, alias?: string): Promise<ApiKeyDisplay> => {
      const result = await apiKeyProviderApi.updateApiKeyAlias(keyId, alias);
      await refreshAndNotify();
      return result;
    },
    [refreshAndNotify],
  );

  // ===== 导入导出 =====

  const exportConfig = useCallback(
    async (includeKeys: boolean): Promise<string> => {
      return apiKeyProviderApi.exportConfig(includeKeys);
    },
    [],
  );

  const importConfig = useCallback(
    async (configJson: string): Promise<ImportResult> => {
      const result = await apiKeyProviderApi.importConfig(configJson);
      await refreshAndNotify();
      return result;
    },
    [refreshAndNotify],
  );

  // ===== 计算属性 =====

  /** 当前选中的 Provider */
  const selectedProvider = useMemo(() => {
    providerDebugLog("[useApiKeyProvider] 计算 selectedProvider");
    if (!selectedProviderId) {
      providerDebugLog(
        "[useApiKeyProvider] selectedProvider: 没有选中的 Provider",
      );
      return null;
    }
    const found = providers.find(
      (p) => p.id === selectedProviderId && !isOemManagedHubProvider(p),
    );
    if (found) {
      providerDebugLog(
        `[useApiKeyProvider] selectedProvider: ${found.name}, api_keys: ${found.api_keys?.length || 0}`,
      );
    } else {
      providerDebugLog(
        `[useApiKeyProvider] selectedProvider: 未找到 ID=${selectedProviderId}`,
      );
    }
    return found ?? null;
  }, [providers, selectedProviderId]);

  useEffect(() => {
    if (!selectedProviderId) {
      return;
    }

    const selectedProvider = providers.find((p) => p.id === selectedProviderId);
    if (!selectedProvider || !isOemManagedHubProvider(selectedProvider)) {
      return;
    }

    const nextVisibleProvider =
      providers.find((provider) => !isOemManagedHubProvider(provider)) ?? null;
    const nextProviderId = nextVisibleProvider?.id ?? null;
    setSelectedProviderId(nextProviderId);
    void saveSelectedProvider(nextProviderId);
  }, [providers, saveSelectedProvider, selectedProviderId]);

  /** 按搜索过滤后的 Provider 列表 */
  const filteredProviders = useMemo(() => {
    const visibleProviders = providers.filter(
      (provider) => !isOemManagedHubProvider(provider),
    );
    if (!searchQuery.trim()) return visibleProviders;
    const query = searchQuery.toLowerCase();
    return visibleProviders.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        p.id.toLowerCase().includes(query),
    );
  }, [providers, searchQuery]);

  /** 按分组组织的 Provider */
  const providersByGroup = useMemo(() => {
    const groups = new Map<ProviderGroup, ProviderWithKeysDisplay[]>();

    // 初始化所有分组
    const allGroups: ProviderGroup[] = [
      "mainstream",
      "chinese",
      "cloud",
      "aggregator",
      "local",
      "specialized",
      "custom",
    ];
    allGroups.forEach((g) => groups.set(g, []));

    // 分配 Provider 到对应分组
    filteredProviders.forEach((p) => {
      const group = p.group as ProviderGroup;
      const list = groups.get(group);
      if (list) {
        list.push(p);
      } else {
        // 未知分组放入 custom
        groups.get("custom")?.push(p);
      }
    });

    // 按 sort_order 排序每个分组内的 Provider
    groups.forEach((list) => {
      list.sort((a, b) => a.sort_order - b.sort_order);
    });

    return groups;
  }, [filteredProviders]);

  // ===== 返回 =====
  return {
    providers,
    selectedProviderId,
    selectedProvider,
    loading,
    error,
    searchQuery,
    collapsedGroups,

    refresh: () => fetchProviders(true),
    selectProvider,
    setSearchQuery,
    toggleGroup,
    reorderProviders,

    addCustomProvider,
    updateProvider,
    deleteCustomProvider,
    toggleProviderEnabled,

    addApiKey,
    deleteApiKey,
    toggleApiKey,
    updateApiKeyAlias,

    exportConfig,
    importConfig,

    filteredProviders,
    providersByGroup,
  };
}
