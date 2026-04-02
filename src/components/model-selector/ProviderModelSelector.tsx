/**
 * @file ProviderModelSelector 组件
 * @description 双栏模型选择器：左侧 Provider 列表，右侧模型列表
 * @module components/model-selector/ProviderModelSelector
 */

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  Check,
  ChevronRight,
  Eye,
  Wrench,
  Brain,
  Loader2,
  AlertCircle,
} from "lucide-react";
import {
  useConfiguredProviders,
  type ConfiguredProvider,
} from "@/hooks/useConfiguredProviders";
import { useProviderModels } from "@/hooks/useProviderModels";
import { getProviderLabel } from "@/lib/constants/providerMappings";
import type { EnhancedModelMetadata } from "@/lib/types/modelRegistry";
import { getProviderModelCompatibilityIssue } from "@/components/agent/chat/utils/providerModelCompatibility";
import { resolveProviderModelLoadOptions } from "@/lib/model/providerModelLoadOptions";

// ============================================================================
// 类型定义
// ============================================================================

export interface ProviderModelSelectorProps {
  /** 选择模型回调 */
  onSelect?: (model: EnhancedModelMetadata, providerId: string) => void;
  /** 初始选中的 Provider */
  initialProviderId?: string;
  /** 初始选中的模型 */
  initialModelId?: string;
  /** 自定义类名 */
  className?: string;
}

// ============================================================================
// 子组件
// ============================================================================

interface ProviderItemProps {
  provider: ConfiguredProvider;
  isSelected: boolean;
  onClick: () => void;
}

/** Provider 列表项 */
const ProviderItem: React.FC<ProviderItemProps> = ({
  provider,
  isSelected,
  onClick,
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between px-3 py-2 text-sm rounded-md transition-colors",
        isSelected
          ? "bg-primary text-primary-foreground"
          : "hover:bg-muted text-foreground",
      )}
      data-testid={`provider-item-${provider.key}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <ChevronRight
          className={cn(
            "h-4 w-4 flex-shrink-0 transition-transform",
            isSelected && "rotate-90",
          )}
        />
        <span className="truncate">{provider.label}</span>
      </div>
    </button>
  );
};

interface ModelItemProps {
  model: EnhancedModelMetadata;
  isSelected: boolean;
  onClick: () => void;
}

/** 模型列表项 */
const ModelItem: React.FC<ModelItemProps> = ({
  model,
  isSelected,
  onClick,
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between px-3 py-2 text-sm rounded-md transition-colors",
        isSelected
          ? "bg-primary/10 border border-primary"
          : "hover:bg-muted border border-transparent",
      )}
      data-testid={`model-item-${model.id}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{model.display_name}</span>
          {model.is_latest && (
            <span className="text-[10px] bg-green-100 text-green-700 px-1 py-0.5 rounded">
              最新
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate">{model.id}</div>
      </div>

      {/* 能力标签 */}
      <div className="flex items-center gap-1.5 ml-2">
        {model.capabilities.vision && (
          <span title="支持视觉">
            <Eye className="h-3.5 w-3.5 text-blue-500" />
          </span>
        )}
        {model.capabilities.tools && (
          <span title="支持工具">
            <Wrench className="h-3.5 w-3.5 text-orange-500" />
          </span>
        )}
        {model.capabilities.reasoning && (
          <span title="支持推理">
            <Brain className="h-3.5 w-3.5 text-purple-500" />
          </span>
        )}
        {isSelected && <Check className="h-4 w-4 text-primary ml-1" />}
      </div>
    </button>
  );
};

// ============================================================================
// 主组件
// ============================================================================

/**
 * 双栏模型选择器组件
 *
 * 左侧显示已配置凭证的 Provider 列表（单选）
 * 右侧显示选中 Provider 对应的模型列表（单选）
 *
 * @example
 * ```tsx
 * <ProviderModelSelector
 *   onSelect={(model, providerId) => {
 *     console.log("选中模型:", model.display_name);
 *   }}
 * />
 * ```
 */
export const ProviderModelSelector: React.FC<ProviderModelSelectorProps> = ({
  onSelect,
  initialProviderId,
  initialModelId,
  className,
}) => {
  // 状态
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    initialProviderId || null,
  );
  const [selectedModelId, setSelectedModelId] = useState<string | null>(
    initialModelId || null,
  );

  // 获取已配置的 Provider 列表（使用共享 hook）
  const { providers: configuredProviders, loading: providersLoading } =
    useConfiguredProviders();

  // 获取当前选中的 Provider
  const selectedProvider = useMemo(() => {
    return configuredProviders.find((p) => p.key === selectedProviderId);
  }, [configuredProviders, selectedProviderId]);
  const providerModelLoadOptions = useMemo(
    () =>
      resolveProviderModelLoadOptions({
        providerId: selectedProvider?.providerId,
        providerType: selectedProvider?.type,
        apiHost: selectedProvider?.apiHost,
      }),
    [selectedProvider?.apiHost, selectedProvider?.providerId, selectedProvider?.type],
  );

  // 获取模型列表（使用共享 hook，返回完整元数据）
  const {
    models: filteredModels,
    loading: modelsLoading,
    error: modelsError,
  } = useProviderModels(selectedProvider, {
    returnFullMetadata: true,
    ...providerModelLoadOptions,
  });

  const compatibleModels = useMemo(
    () =>
      filteredModels.filter(
        (model) =>
          !getProviderModelCompatibilityIssue({
            providerType: selectedProvider?.key || "",
            configuredProviderType: selectedProvider?.type,
            model: model.id,
          }),
      ),
    [filteredModels, selectedProvider?.key, selectedProvider?.type],
  );

  const incompatibleModelCount = useMemo(
    () => filteredModels.length - compatibleModels.length,
    [compatibleModels.length, filteredModels.length],
  );

  // 默认选中第一个 Provider
  useEffect(() => {
    if (!selectedProviderId && configuredProviders.length > 0) {
      setSelectedProviderId(configuredProviders[0].key);
    }
  }, [selectedProviderId, configuredProviders]);

  // 选择 Provider
  const handleSelectProvider = useCallback((providerId: string) => {
    setSelectedProviderId(providerId);
    setSelectedModelId(null); // 切换 Provider 时清除模型选择
  }, []);

  // 选择模型
  const handleSelectModel = useCallback(
    (model: EnhancedModelMetadata) => {
      setSelectedModelId(model.id);
      if (selectedProviderId) {
        onSelect?.(model, selectedProviderId);
      }
    },
    [selectedProviderId, onSelect],
  );

  const isLoading = providersLoading || modelsLoading;

  // 空状态
  if (!isLoading && configuredProviders.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center py-12 text-muted-foreground",
          className,
        )}
        data-testid="provider-model-selector-empty"
      >
        <AlertCircle className="h-12 w-12 mb-4 opacity-50" />
        <p className="text-sm">暂无已配置的 Provider</p>
        <p className="text-xs mt-1">请先在凭证池中添加凭证</p>
      </div>
    );
  }

  return (
    <div
      className={cn("flex border rounded-lg overflow-hidden", className)}
      data-testid="provider-model-selector"
    >
      {/* 左侧：Provider 列表 */}
      <div className="w-48 border-r bg-muted/30 flex flex-col">
        <div className="px-3 py-2 border-b bg-muted/50">
          <h4 className="text-sm font-medium">Providers</h4>
          <p className="text-xs text-muted-foreground">已配置凭证的</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {providersLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            configuredProviders.map((provider) => (
              <ProviderItem
                key={provider.key}
                provider={provider}
                isSelected={selectedProviderId === provider.key}
                onClick={() => handleSelectProvider(provider.key)}
              />
            ))
          )}
        </div>
      </div>

      {/* 右侧：模型列表 */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-3 py-2 border-b bg-muted/50">
          <h4 className="text-sm font-medium">Models</h4>
          <p className="text-xs text-muted-foreground">
            {selectedProvider
              ? `${getProviderLabel(selectedProvider.key)} 的模型`
              : "请选择 Provider"}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {modelsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : modelsError ? (
            <div className="flex flex-col items-center justify-center py-8 text-red-500">
              <AlertCircle className="h-8 w-8 mb-2" />
              <p className="text-sm">{modelsError}</p>
            </div>
          ) : compatibleModels.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <p className="text-sm">暂无模型数据</p>
            </div>
          ) : (
            <>
              {incompatibleModelCount > 0 ? (
                <div className="px-1 py-1 text-xs text-amber-600">
                  已隐藏 {incompatibleModelCount} 个当前登录态不兼容的模型
                </div>
              ) : null}
              {compatibleModels.map((model) => (
              <ModelItem
                key={model.id}
                model={model}
                isSelected={selectedModelId === model.id}
                onClick={() => handleSelectModel(model)}
              />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProviderModelSelector;
