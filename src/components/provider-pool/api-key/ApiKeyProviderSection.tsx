/**
 * @file ApiKeyProviderSection 组件
 * @description API Key Provider 管理区域，实现左右分栏布局
 * @module components/provider-pool/api-key/ApiKeyProviderSection
 *
 * **Feature: provider-ui-refactor**
 * **Validates: Requirements 1.1, 1.3, 1.4, 6.3, 6.4, 9.4, 9.5**
 */

import React, {
  useCallback,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { cn } from "@/lib/utils";
import { useApiKeyProvider } from "@/hooks/useApiKeyProvider";
import {
  apiKeyProviderApi,
  UpdateProviderRequest,
} from "@/lib/api/apiKeyProvider";
import { ProviderList } from "./ProviderList";
import { ProviderSetting } from "./ProviderSetting";
import { DeleteProviderDialog } from "./DeleteProviderDialog";
import { ImportExportDialog } from "./ImportExportDialog";
import type { ConnectionTestResult } from "./ConnectionTestButton";
import { resolveProviderTestModel } from "./ApiKeyProviderSection.helpers";

// ============================================================================
// 类型定义
// ============================================================================

export interface ApiKeyProviderSectionProps {
  /** 添加自定义 Provider 回调 */
  onAddCustomProvider?: () => void;
  /** 额外的 CSS 类名 */
  className?: string;
}

export interface ApiKeyProviderSectionRef {
  /** 刷新 Provider 列表 */
  refresh: () => Promise<void>;
}

// ============================================================================
// 组件实现
// ============================================================================

/**
 * API Key Provider 管理区域组件
 *
 * 实现左右分栏布局：
 * - 左侧：Provider 列表（固定宽度 240px）
 * - 右侧：Provider 设置面板（填充剩余空间）
 *
 * 当用户点击左侧列表中的 Provider 时，右侧面板同步显示该 Provider 的配置。
 *
 * @example
 * ```tsx
 * <ApiKeyProviderSection
 *   ref={apiKeyProviderRef}
 *   onAddCustomProvider={() => setShowAddModal(true)}
 * />
 * ```
 */
export const ApiKeyProviderSection = forwardRef<
  ApiKeyProviderSectionRef,
  ApiKeyProviderSectionProps
>(({ onAddCustomProvider, className }, ref) => {
  // 使用 Hook 管理状态
  const {
    providersByGroup,
    selectedProviderId,
    selectedProvider,
    loading,
    searchQuery,
    collapsedGroups,
    selectProvider,
    setSearchQuery,
    toggleGroup,
    updateProvider,
    addApiKey,
    deleteApiKey,
    toggleApiKey,
    deleteCustomProvider,
    exportConfig,
    importConfig,
    refresh,
  } = useApiKeyProvider();

  // 暴露 refresh 方法给父组件
  useImperativeHandle(
    ref,
    () => ({
      refresh,
    }),
    [refresh],
  );

  // 删除对话框状态
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  // 导入导出对话框状态
  const [showImportExportDialog, setShowImportExportDialog] = useState(false);
  const resolveCurrentTestModel = useCallback(() => {
    const input = document.getElementById(
      "custom-models",
    ) as HTMLInputElement | null;
    return resolveProviderTestModel(
      selectedProvider?.custom_models,
      input?.value ?? "",
    );
  }, [selectedProvider?.custom_models]);

  // ===== 包装回调函数以匹配 ProviderSetting 的类型要求 =====

  const handleUpdateProvider = useCallback(
    async (id: string, request: UpdateProviderRequest): Promise<void> => {
      await updateProvider(id, request);
    },
    [updateProvider],
  );

  const handleAddApiKey = useCallback(
    async (
      providerId: string,
      apiKey: string,
      alias?: string,
    ): Promise<void> => {
      console.log("[ApiKeyProviderSection] handleAddApiKey 被调用:", {
        providerId,
        selectedProviderId,
        alias,
      });
      await addApiKey(providerId, apiKey, alias);
    },
    [addApiKey, selectedProviderId],
  );

  // ===== 连接测试 =====
  const handleTestConnection = useCallback(
    async (providerId: string): Promise<ConnectionTestResult> => {
      try {
        const provider = selectedProvider;
        if (!provider || provider.api_keys.length === 0) {
          return {
            success: false,
            error: "没有可用的 API Key",
          };
        }

        const modelName = resolveCurrentTestModel();

        // 调用后端连接测试 API
        const result = await apiKeyProviderApi.testConnection(
          providerId,
          modelName,
        );

        // 转换后端返回的 latency_ms 为前端期望的 latencyMs
        return {
          success: result.success,
          latencyMs: result.latency_ms,
          error: result.error,
        };
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : "连接测试失败",
        };
      }
    },
    [resolveCurrentTestModel, selectedProvider],
  );

  const handleTestChat = useCallback(
    async (providerId: string, prompt: string) => {
      const provider = selectedProvider;
      if (!provider || provider.api_keys.length === 0) {
        return {
          success: false,
          error: "没有可用的 API Key",
        };
      }

      const modelName = resolveCurrentTestModel();

      try {
        return await apiKeyProviderApi.testChat(providerId, modelName, prompt);
      } catch (e) {
        const msg =
          e instanceof Error
            ? e.message
            : typeof e === "string"
              ? e
              : JSON.stringify(e);
        return {
          success: false,
          error: msg || "对话测试失败",
        };
      }
    },
    [resolveCurrentTestModel, selectedProvider],
  );

  // ===== 删除 Provider =====
  const handleDeleteProviderClick = useCallback(() => {
    if (selectedProvider && !selectedProvider.is_system) {
      setShowDeleteDialog(true);
    }
  }, [selectedProvider]);

  const handleDeleteProviderConfirm = useCallback(
    async (providerId: string) => {
      await deleteCustomProvider(providerId);
      setShowDeleteDialog(false);
    },
    [deleteCustomProvider],
  );

  return (
    <div
      className={cn(
        "relative flex h-full overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-sm shadow-slate-950/5",
        className,
      )}
      data-testid="api-key-provider-section"
    >
      {/* 左侧：Provider 列表 */}
      <ProviderList
        providersByGroup={providersByGroup}
        selectedProviderId={selectedProviderId}
        onProviderSelect={selectProvider}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        collapsedGroups={collapsedGroups}
        onToggleGroup={toggleGroup}
        onAddCustomProvider={onAddCustomProvider}
        onImportExport={() => setShowImportExportDialog(true)}
        className="flex-shrink-0 bg-slate-50/80"
      />

      {/* 右侧：Provider 设置面板 */}
      <div className="relative flex-1 min-w-0 overflow-hidden bg-white">
        <ProviderSetting
          provider={selectedProvider}
          onUpdate={handleUpdateProvider}
          onAddApiKey={handleAddApiKey}
          onDeleteApiKey={deleteApiKey}
          onToggleApiKey={toggleApiKey}
          onTestConnection={handleTestConnection}
          onTestChat={handleTestChat}
          onDeleteProvider={handleDeleteProviderClick}
          loading={loading}
          className="h-full"
        />
      </div>

      {/* 删除 Provider 确认对话框 */}
      <DeleteProviderDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        provider={selectedProvider}
        onConfirm={handleDeleteProviderConfirm}
      />

      {/* 导入导出对话框 */}
      <ImportExportDialog
        isOpen={showImportExportDialog}
        onClose={() => setShowImportExportDialog(false)}
        onExport={exportConfig}
        onImport={importConfig}
      />
    </div>
  );
});

ApiKeyProviderSection.displayName = "ApiKeyProviderSection";

// ============================================================================
// 辅助函数（用于测试）
// ============================================================================

export default ApiKeyProviderSection;
