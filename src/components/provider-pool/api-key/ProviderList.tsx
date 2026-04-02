/**
 * @file ProviderList 组件
 * @description Provider 列表组件，集成搜索框、分组显示和拖拽排序
 * @module components/provider-pool/api-key/ProviderList
 *
 * **Feature: provider-ui-refactor**
 * **Validates: Requirements 1.2, 1.5, 8.1, 8.2**
 */

import React, { useMemo } from "react";
import { Search, Plus, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PROVIDER_GROUPS } from "@/lib/config/providers";
import type { ProviderGroup as ProviderGroupType } from "@/lib/types/provider";
import type { ProviderWithKeysDisplay } from "@/lib/api/apiKeyProvider";
import { ProviderGroup } from "./ProviderGroup";

// ============================================================================
// 类型定义
// ============================================================================

export interface ProviderListProps {
  /** Provider 列表（按分组组织） */
  providersByGroup: Map<ProviderGroupType, ProviderWithKeysDisplay[]>;
  /** 当前选中的 Provider ID */
  selectedProviderId?: string | null;
  /** Provider 选择回调 */
  onProviderSelect?: (id: string) => void;
  /** 搜索查询 */
  searchQuery?: string;
  /** 搜索查询变更回调 */
  onSearchChange?: (query: string) => void;
  /** 折叠的分组集合 */
  collapsedGroups?: Set<ProviderGroupType>;
  /** 分组折叠/展开回调 */
  onToggleGroup?: (group: ProviderGroupType) => void;
  /** 添加自定义 Provider 回调 */
  onAddCustomProvider?: () => void;
  /** 导入导出回调 */
  onImportExport?: () => void;
  /** 额外的 CSS 类名 */
  className?: string;
}

// ============================================================================
// 分组排序
// ============================================================================

/**
 * 获取排序后的分组列表
 */
function getSortedGroups(): ProviderGroupType[] {
  return (
    Object.entries(PROVIDER_GROUPS) as [ProviderGroupType, { order: number }][]
  )
    .sort((a, b) => a[1].order - b[1].order)
    .map(([group]) => group);
}

// ============================================================================
// 组件实现
// ============================================================================

/**
 * Provider 列表组件
 *
 * 显示所有 Provider，支持搜索过滤、分组显示和折叠/展开。
 * 固定宽度约 240px，用于左右分栏布局的左侧。
 *
 * @example
 * ```tsx
 * <ProviderList
 *   providersByGroup={providersByGroup}
 *   selectedProviderId={selectedId}
 *   onProviderSelect={setSelectedId}
 *   searchQuery={searchQuery}
 *   onSearchChange={setSearchQuery}
 *   collapsedGroups={collapsedGroups}
 *   onToggleGroup={toggleGroup}
 *   onAddCustomProvider={() => setShowAddModal(true)}
 * />
 * ```
 */
export const ProviderList: React.FC<ProviderListProps> = ({
  providersByGroup,
  selectedProviderId,
  onProviderSelect,
  searchQuery = "",
  onSearchChange,
  collapsedGroups = new Set(),
  onToggleGroup,
  onAddCustomProvider,
  onImportExport,
  className,
}) => {
  // 获取排序后的分组
  const sortedGroups = useMemo(() => getSortedGroups(), []);

  // 计算总 Provider 数量
  const totalProviders = useMemo(() => {
    let count = 0;
    providersByGroup.forEach((providers) => {
      count += providers.length;
    });
    return count;
  }, [providersByGroup]);

  return (
    <div
      className={cn(
        "flex h-full w-[280px] flex-col border-r border-slate-200/80 bg-slate-50/80",
        className,
      )}
      data-testid="provider-list"
    >
      {/* 搜索框 */}
      <div className="border-b border-slate-200/80 px-4 py-4">
        <div className="mb-3">
          <p className="text-sm font-semibold text-slate-900">服务商列表</p>
          <p className="text-xs text-slate-500">
            已加载 {totalProviders} 个 Provider
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="搜索服务商或协议..."
            value={searchQuery}
            onChange={(e) => onSearchChange?.(e.target.value)}
            className={cn(
              "w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm",
              "placeholder:text-slate-400",
              "focus:border-slate-300 focus:outline-none",
              "transition-colors",
            )}
            data-testid="provider-search-input"
          />
        </div>
      </div>

      {/* Provider 分组列表 */}
      <div
        className="flex-1 overflow-y-auto px-3 py-3"
        data-testid="provider-groups-container"
      >
        {totalProviders === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center text-sm text-slate-500">
            <p>未找到 Provider</p>
            {searchQuery && <p className="text-xs mt-1">尝试其他搜索词</p>}
          </div>
        ) : (
          sortedGroups.map((group) => {
            const providers = providersByGroup.get(group) ?? [];
            if (providers.length === 0) return null;

            return (
              <ProviderGroup
                key={group}
                group={group}
                providers={providers}
                collapsed={collapsedGroups.has(group)}
                onToggle={() => onToggleGroup?.(group)}
                selectedProviderId={selectedProviderId}
                onProviderSelect={onProviderSelect}
              />
            );
          })
        )}
      </div>

      {/* 添加自定义 Provider 按钮 */}
      {(onAddCustomProvider || onImportExport) && (
        <div className="space-y-2 border-t border-slate-200/80 px-4 py-4">
          {onAddCustomProvider && (
            <button
              type="button"
              onClick={onAddCustomProvider}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2",
                "text-sm font-medium text-slate-900",
                "bg-white hover:bg-slate-100 border border-slate-200",
                "transition-colors",
                "focus:outline-none focus:ring-2 focus:ring-slate-200",
              )}
              data-testid="add-custom-provider-button"
            >
              <Plus className="h-4 w-4" />
              添加自定义 Provider
            </button>
          )}
          {onImportExport && (
            <button
              type="button"
              onClick={onImportExport}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2",
                "text-sm font-medium text-slate-600",
                "bg-slate-100 hover:bg-slate-200",
                "transition-colors",
                "focus:outline-none focus:ring-2 focus:ring-slate-200",
              )}
              data-testid="import-export-button"
            >
              <Settings2 className="h-4 w-4" />
              导入/导出配置
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 辅助函数（用于测试）
// ============================================================================

/**
 * 过滤 Provider 列表
 * 用于属性测试验证搜索正确性
 */
export function filterProviders(
  providers: ProviderWithKeysDisplay[],
  query: string,
): ProviderWithKeysDisplay[] {
  if (!query.trim()) return providers;
  const lowerQuery = query.toLowerCase();
  return providers.filter(
    (p) =>
      p.name.toLowerCase().includes(lowerQuery) ||
      p.id.toLowerCase().includes(lowerQuery),
  );
}

/**
 * 按分组组织 Provider
 * 用于属性测试验证分组正确性
 */
export function groupProviders(
  providers: ProviderWithKeysDisplay[],
): Map<ProviderGroupType, ProviderWithKeysDisplay[]> {
  const groups = new Map<ProviderGroupType, ProviderWithKeysDisplay[]>();

  // 初始化所有分组
  const allGroups: ProviderGroupType[] = [
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
  providers.forEach((p) => {
    const group = p.group as ProviderGroupType;
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
}

/**
 * 检查 Provider 是否匹配搜索查询
 * 用于属性测试验证搜索正确性
 */
export function matchesSearchQuery(
  provider: ProviderWithKeysDisplay,
  query: string,
): boolean {
  if (!query.trim()) return true;
  const lowerQuery = query.toLowerCase();
  return (
    provider.name.toLowerCase().includes(lowerQuery) ||
    provider.id.toLowerCase().includes(lowerQuery)
  );
}

export default ProviderList;
