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

        // 如果 Provider 配置了自定义模型，使用第一个模型进行测试
        let modelName =
          provider.custom_models && provider.custom_models.length > 0
            ? provider.custom_models[0]
            : undefined;

        // 兜底：自定义模型可能还在防抖保存中（provider.custom_models 还未更新）
        // 直接从输入框读取当前值，确保连接测试可用
        if (!modelName) {
          const input = document.getElementById(
            "custom-models",
          ) as HTMLInputElement | null;
          const raw = input?.value ?? "";
          const parsed = raw
            .split(",")
            .map((m) => m.trim())
            .filter((m) => m.length > 0);
          if (parsed.length > 0) {
            modelName = parsed[0];
          }
        }

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
    [selectedProvider],
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

      let modelName =
        provider.custom_models && provider.custom_models.length > 0
          ? provider.custom_models[0]
          : undefined;

      if (!modelName) {
        const input = document.getElementById(
          "custom-models",
        ) as HTMLInputElement | null;
        const raw = input?.value ?? "";
        const parsed = raw
          .split(",")
          .map((m) => m.trim())
          .filter((m) => m.length > 0);
        if (parsed.length > 0) {
          modelName = parsed[0];
        }
      }

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
    [selectedProvider],
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

/**
 * 验证 Provider 选择同步
 * 用于属性测试验证 Requirements 1.4
 *
 * @param selectedId 当前选中的 Provider ID
 * @param displayedProviderId 设置面板显示的 Provider ID
 * @returns 是否同步
 */
export function verifyProviderSelectionSync(
  selectedId: string | null,
  displayedProviderId: string | null,
): boolean {
  // 如果没有选中任何 Provider，设置面板应该显示空状态
  if (selectedId === null) {
    return displayedProviderId === null;
  }
  // 如果选中了 Provider，设置面板应该显示相同的 Provider
  return selectedId === displayedProviderId;
}

/**
 * 从组件状态中提取选择同步信息
 * 用于属性测试
 */
export function extractSelectionState(
  selectedProviderId: string | null,
  selectedProvider: { id: string } | null,
): {
  listSelectedId: string | null;
  settingProviderId: string | null;
  isSynced: boolean;
} {
  const settingProviderId = selectedProvider?.id ?? null;
  return {
    listSelectedId: selectedProviderId,
    settingProviderId,
    isSynced: verifyProviderSelectionSync(
      selectedProviderId,
      settingProviderId,
    ),
  };
}

export default ApiKeyProviderSection;
