/**
 * @file Relay Registry 管理 Hook
 * @description 管理中转商注册表的加载、刷新和状态
 * @module hooks/useRelayRegistry
 *
 * _Requirements: 2.1, 7.2, 7.3_
 */

import { useState, useEffect, useCallback } from "react";
import { safeInvoke } from "@/lib/dev-bridge";
import type { RelayInfo } from "./useDeepLink";
import {
  showRegistryLoadError,
  showRegistryNoCacheError,
} from "@/lib/utils/connectError";

interface UseRelayRegistryOptions {
  autoLoad?: boolean;
}

/**
 * Registry 错误
 */
export interface RegistryError {
  code: string;
  message: string;
}

/**
 * useRelayRegistry Hook 返回值
 */
export interface UseRelayRegistryReturn {
  /** 所有中转商列表 */
  providers: RelayInfo[];
  /** 是否正在加载 */
  isLoading: boolean;
  /** 错误信息 */
  error: RegistryError | null;
  /** 刷新注册表 */
  refresh: () => Promise<void>;
  /** 获取指定中转商信息 */
  getProvider: (relayId: string) => RelayInfo | undefined;
}

/**
 * Relay Registry 管理 Hook
 *
 * 管理中转商注册表的加载、刷新和状态。
 *
 * ## 功能
 *
 * - 应用启动时自动加载注册表（Requirements 2.1）
 * - 加载失败时回退到缓存（Requirements 7.2）
 * - 无缓存且加载失败时显示错误（Requirements 7.3）
 * - 提供手动刷新功能
 *
 * ## 使用示例
 *
 * ```tsx
 * function App() {
 *   const { providers, isLoading, error, refresh } = useRelayRegistry();
 *
 *   if (error) {
 *     return <ErrorMessage error={error} onRetry={refresh} />;
 *   }
 *
 *   return <ProviderList providers={providers} />;
 * }
 * ```
 *
 * @returns Hook 返回值
 */
export function useRelayRegistry(
  options: UseRelayRegistryOptions = {},
): UseRelayRegistryReturn {
  const { autoLoad = true } = options;
  const [providers, setProviders] = useState<RelayInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<RegistryError | null>(null);

  /**
   * 加载中转商列表
   * _Requirements: 2.1_
   */
  const loadProviders = useCallback(async () => {
    try {
      const list = await safeInvoke<RelayInfo[]>("list_relay_providers");
      setProviders(list);
      setError(null);
    } catch (err) {
      console.error("[useRelayRegistry] 加载中转商列表失败:", err);
      // 不设置错误，因为可能是 Connect 模块还未初始化
      // 后端会自动处理缓存回退
    }
  }, []);

  /**
   * 刷新注册表
   * _Requirements: 2.5, 7.2, 7.3_
   */
  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    // 在调用前捕获当前 providers 长度，避免闭包问题
    const hasCache = providers.length > 0;

    try {
      // 调用后端刷新注册表
      const count = await safeInvoke<number>("refresh_relay_registry");
      console.log(`[useRelayRegistry] 注册表已刷新，共 ${count} 个中转商`);

      // 重新加载列表
      await loadProviders();
    } catch (err) {
      console.error("[useRelayRegistry] 刷新注册表失败:", err);
      // _Requirements: 7.2, 7.3_
      const registryError = err as RegistryError;
      setError(registryError);

      // 根据错误类型显示不同的 Toast
      // 检查是否有缓存数据（providers 不为空表示有缓存）
      if (hasCache) {
        // _Requirements: 7.2_ - 有缓存，显示加载失败但已回退到缓存
        showRegistryLoadError(registryError.message);
      } else {
        // _Requirements: 7.3_ - 无缓存，显示错误并允许重试
        showRegistryNoCacheError(registryError.message);
      }
    } finally {
      setIsLoading(false);
    }
  }, [loadProviders, providers.length]);

  /**
   * 获取指定中转商信息
   */
  const getProvider = useCallback(
    (relayId: string): RelayInfo | undefined => {
      return providers.find((p) => p.id === relayId);
    },
    [providers],
  );

  // 初始加载
  // _Requirements: 2.1_
  useEffect(() => {
    if (!autoLoad) {
      setIsLoading(false);
      return;
    }

    // 延迟加载，等待 Connect 模块初始化
    const timer = setTimeout(() => {
      loadProviders();
    }, 1000);

    return () => clearTimeout(timer);
  }, [autoLoad, loadProviders]);

  return {
    providers,
    isLoading,
    error,
    refresh,
    getProvider,
  };
}

export default useRelayRegistry;
