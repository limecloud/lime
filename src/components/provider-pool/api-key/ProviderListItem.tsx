/**
 * @file ProviderListItem 组件
 * @description Provider 列表项组件，显示图标、名称、启用状态和 API Key 数量徽章
 * @module components/provider-pool/api-key/ProviderListItem
 *
 * **Feature: provider-ui-refactor**
 * **Validates: Requirements 1.6, 7.2**
 */

import React from "react";
import { cn } from "@/lib/utils";
import { ProviderIcon } from "@/icons/providers";
import { Badge } from "@/components/ui/badge";
import type { ProviderWithKeysDisplay } from "@/lib/api/apiKeyProvider";
import { getProviderPromptCacheMode } from "@/lib/model/providerPromptCacheSupport";

// ============================================================================
// 类型定义
// ============================================================================

export interface ProviderListItemProps {
  /** Provider 数据（包含 API Keys） */
  provider: ProviderWithKeysDisplay;
  /** 是否选中 */
  selected?: boolean;
  /** 点击回调 */
  onClick?: () => void;
  /** 额外的 CSS 类名 */
  className?: string;
}

// ============================================================================
// 组件实现
// ============================================================================

/**
 * Provider 列表项组件
 *
 * 显示 Provider 的图标、名称、启用状态和 API Key 数量徽章。
 * 支持选中状态高亮显示。
 *
 * @example
 * ```tsx
 * <ProviderListItem
 *   provider={provider}
 *   selected={selectedId === provider.id}
 *   onClick={() => onSelect(provider.id)}
 * />
 * ```
 */
export const ProviderListItem: React.FC<ProviderListItemProps> = ({
  provider,
  selected = false,
  onClick,
  className,
}) => {
  const apiKeyCount = provider.api_keys?.length ?? 0;
  const isEnabled = provider.enabled;
  const showExplicitPromptCacheBadge =
    getProviderPromptCacheMode(
      provider.type,
      provider.prompt_cache_mode,
      provider.api_host,
    ) === "explicit_only";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={cn(
        // 基础样式
        "flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer",
        "transition-all duration-150 ease-in-out",
        // 默认状态
        "hover:bg-muted/60",
        // 选中状态
        selected &&
          "bg-primary/10 hover:bg-primary/15 border border-primary/20",
        // 禁用状态
        !isEnabled && "opacity-60",
        className,
      )}
      data-testid="provider-list-item"
      data-provider-id={provider.id}
      data-selected={selected}
      data-enabled={isEnabled}
    >
      {/* Provider 图标 */}
      <ProviderIcon
        providerType={provider.id}
        fallbackText={provider.name}
        size={24}
        className="flex-shrink-0"
        data-testid="provider-icon"
      />

      {/* Provider 名称 */}
      <span
        className={cn(
          "flex-1 text-sm font-medium truncate",
          !isEnabled && "text-muted-foreground",
        )}
        data-testid="provider-name"
      >
        {provider.name}
      </span>

      {showExplicitPromptCacheBadge && (
        <Badge
          variant="outline"
          className="h-5 flex-shrink-0 border-amber-200 bg-amber-50 px-1.5 text-[11px] font-medium text-amber-700"
          data-testid="provider-prompt-cache-badge"
        >
          显式缓存
        </Badge>
      )}

      {/* 启用状态指示器 */}
      <div
        className={cn(
          "w-2 h-2 rounded-full flex-shrink-0",
          isEnabled ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600",
        )}
        title={isEnabled ? "已启用" : "已禁用"}
        data-testid="provider-status"
        data-enabled={isEnabled}
      />

      {/* API Key 数量徽章 */}
      {apiKeyCount > 0 && (
        <Badge
          variant="secondary"
          className="flex-shrink-0 min-w-[20px] h-5 px-1.5 text-xs font-medium"
          data-testid="api-key-count-badge"
        >
          {apiKeyCount}
        </Badge>
      )}
    </div>
  );
};

// ============================================================================
// 辅助函数（用于测试）
// ============================================================================

/**
 * 从 Provider 数据中提取列表项显示所需的信息
 * 用于属性测试验证显示完整性
 */
export function extractListItemDisplayInfo(provider: ProviderWithKeysDisplay): {
  hasIcon: boolean;
  hasName: boolean;
  hasStatus: boolean;
  apiKeyCount: number;
} {
  return {
    hasIcon: typeof provider.id === "string" && provider.id.length > 0,
    hasName: typeof provider.name === "string" && provider.name.length > 0,
    hasStatus: typeof provider.enabled === "boolean",
    apiKeyCount: provider.api_keys?.length ?? 0,
  };
}

/**
 * 计算 Provider 的 API Key 数量
 * 用于属性测试验证徽章正确性
 */
export function getApiKeyCount(provider: ProviderWithKeysDisplay): number {
  return provider.api_keys?.length ?? 0;
}

export default ProviderListItem;
