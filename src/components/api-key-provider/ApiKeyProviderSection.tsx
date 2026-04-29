/**
 * @file ApiKeyProviderSection 组件
 * @description API Key Provider 管理区域，实现左右分栏布局
 * @module components/api-key-provider/ApiKeyProviderSection
 *
 * **Feature: provider-ui-refactor**
 * **Validates: Requirements 1.1, 1.3, 1.4, 6.3, 6.4, 9.4, 9.5**
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { cn } from "@/lib/utils";
import { useApiKeyProvider } from "@/hooks/useApiKeyProvider";
import {
  apiKeyProviderApi,
  type UpdateProviderRequest,
} from "@/lib/api/apiKeyProvider";
import { ProviderSetting } from "./ProviderSetting";
import { ImportExportDialog } from "./ImportExportDialog";
import type { ConnectionTestResult } from "./connectionTestTypes";
import { resolveProviderTestModel } from "./ApiKeyProviderSection.helpers";
import { ModelAddPanel } from "./ModelAddPanel";
import { ModelProviderList } from "./ModelProviderList";
import { buildEnabledModelItems } from "./ModelProviderList.utils";

// ============================================================================
// 类型定义
// ============================================================================

export interface ApiKeyProviderSectionProps {
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
 * <ApiKeyProviderSection ref={apiKeyProviderRef} />
 * ```
 */
export const ApiKeyProviderSection = forwardRef<
  ApiKeyProviderSectionRef,
  ApiKeyProviderSectionProps
>(({ className }, ref) => {
  // 使用 Hook 管理状态
  const {
    providers,
    selectedProviderId,
    selectedProvider,
    loading,
    selectProvider,
    addCustomProvider,
    updateProvider,
    addApiKey,
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

  // 导入导出对话框状态
  const [showImportExportDialog, setShowImportExportDialog] = useState(false);
  const [showAddModelFlow, setShowAddModelFlow] = useState(false);
  const enabledModelItems = useMemo(
    () => buildEnabledModelItems(providers),
    [providers],
  );

  useEffect(() => {
    if (showAddModelFlow) {
      return;
    }

    if (enabledModelItems.length === 0) {
      if (selectedProviderId) {
        selectProvider(null);
      }
      return;
    }

    if (
      !selectedProviderId ||
      !enabledModelItems.some((item) => item.id === selectedProviderId)
    ) {
      selectProvider(enabledModelItems[0].id);
    }
  }, [enabledModelItems, selectProvider, selectedProviderId, showAddModelFlow]);

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
      await addApiKey(providerId, apiKey, alias);
    },
    [addApiKey],
  );

  // ===== 连接测试 =====
  const handleTestConnection = useCallback(
    async (providerId: string): Promise<ConnectionTestResult> => {
      try {
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
    [resolveCurrentTestModel],
  );

  const handleModelActivated = useCallback(
    (providerId: string) => {
      selectProvider(providerId);
      setShowAddModelFlow(false);
    },
    [selectProvider],
  );

  const handleSelectEnabledModel = useCallback(
    (providerId: string) => {
      setShowAddModelFlow(false);
      selectProvider(providerId);
    },
    [selectProvider],
  );

  return (
    <div
      className={cn(
        "relative flex h-full overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-sm shadow-slate-950/5",
        className,
      )}
      data-testid="api-key-provider-section"
    >
      {/* 左侧：已启用模型列表 */}
      <ModelProviderList
        providers={providers}
        selectedProviderId={selectedProviderId}
        onProviderSelect={handleSelectEnabledModel}
        onAddModel={() => setShowAddModelFlow(true)}
        onImportExport={() => setShowImportExportDialog(true)}
        className="flex-shrink-0"
      />

      {/* 右侧：Provider 设置面板 / 添加模型流程 */}
      <div className="relative flex-1 min-w-0 overflow-hidden bg-white">
        {showAddModelFlow ? (
          <ModelAddPanel
            providers={providers}
            onAddProvider={addCustomProvider}
            onUpdateProvider={updateProvider}
            onAddApiKey={handleAddApiKey}
            onActivated={handleModelActivated}
            onCancel={() => setShowAddModelFlow(false)}
            className="h-full"
          />
        ) : (
          <ProviderSetting
            provider={selectedProvider}
            onUpdate={handleUpdateProvider}
            onAddApiKey={handleAddApiKey}
            onTestConnection={handleTestConnection}
            loading={loading}
            className="h-full"
          />
        )}
      </div>

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
