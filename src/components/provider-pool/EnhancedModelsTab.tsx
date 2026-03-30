/**
 * 增强版模型列表页面
 *
 * 使用 model_registry 数据，支持搜索、收藏、分组等功能
 */

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  Cpu,
  RefreshCw,
  Copy,
  Check,
  Search,
  Star,
  Clock,
  Filter,
  Eye,
  Wrench,
  Brain,
  DollarSign,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useModelRegistry } from "@/hooks/useModelRegistry";
import type {
  EnhancedModelMetadata,
  ModelTier,
} from "@/lib/types/modelRegistry";

export function EnhancedModelsTab() {
  const {
    models,
    preferences,
    loading,
    error,
    lastSyncAt,
    refresh,
    search,
    toggleFavorite,
    groupedByProvider,
  } = useModelRegistry();

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [selectedTier, setSelectedTier] = useState<ModelTier | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [displayLimit, setDisplayLimit] = useState(50); // 初始显示 50 个

  // 防抖搜索
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedSearchQuery(value);
    }, 150);
  }, []);

  // 当筛选条件变化时，重置显示数量
  useEffect(() => {
    setDisplayLimit(50);
  }, [debouncedSearchQuery, selectedProvider, selectedTier, showFavoritesOnly]);

  // 搜索和过滤
  const filteredModels = useMemo(() => {
    let result = debouncedSearchQuery ? search(debouncedSearchQuery) : models;
    if (selectedProvider) {
      result = result.filter((m) => m.provider_id === selectedProvider);
    }
    if (selectedTier) {
      result = result.filter((m) => m.tier === selectedTier);
    }
    if (showFavoritesOnly) {
      result = result.filter((m) => preferences.get(m.id)?.is_favorite);
    }
    return result;
  }, [
    debouncedSearchQuery,
    models,
    selectedProvider,
    selectedTier,
    showFavoritesOnly,
    preferences,
    search,
  ]);

  // 分页显示的模型
  const displayedModels = useMemo(() => {
    return filteredModels.slice(0, displayLimit);
  }, [filteredModels, displayLimit]);

  const hasMore = filteredModels.length > displayLimit;

  // 缓存 providers 列表，避免每次渲染都重新计算
  const providers = useMemo(
    () => Array.from(groupedByProvider.keys()),
    [groupedByProvider],
  );

  const copyModelId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const formatSyncTime = (timestamp: number | null) => {
    if (!timestamp) return "从未同步";
    return new Date(timestamp * 1000).toLocaleString("zh-CN");
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-500 bg-red-50 dark:bg-red-950 p-4 text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* 头部信息 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" />
          <span>上次同步: {formatSyncTime(lastSyncAt)}</span>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          刷新
        </button>
      </div>

      {/* 搜索和过滤 */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索模型名称、ID、Provider..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full rounded-lg border bg-background pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <button
            onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
              showFavoritesOnly
                ? "bg-yellow-100 border-yellow-300 text-yellow-700 dark:bg-yellow-900 dark:border-yellow-700 dark:text-yellow-300"
                : "hover:bg-muted",
            )}
          >
            <Star
              className={cn(
                "h-4 w-4",
                showFavoritesOnly && "fill-yellow-500 text-yellow-500",
              )}
            />
            收藏
          </button>
        </div>

        {/* Provider 过滤 */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedProvider(null)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              !selectedProvider
                ? "bg-primary text-primary-foreground"
                : "bg-muted hover:bg-muted/80",
            )}
          >
            全部 ({models.length})
          </button>
          {providers.map((providerId) => {
            const providerModels = groupedByProvider.get(providerId) || [];
            const providerName = providerModels[0]?.provider_name || providerId;
            return (
              <button
                key={providerId}
                onClick={() =>
                  setSelectedProvider(
                    selectedProvider === providerId ? null : providerId,
                  )
                }
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  selectedProvider === providerId
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted hover:bg-muted/80",
                )}
              >
                {providerName} ({providerModels.length})
              </button>
            );
          })}
        </div>

        {/* Tier 过滤 */}
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">等级:</span>
          {(["mini", "pro", "max"] as ModelTier[]).map((tier) => (
            <button
              key={tier}
              onClick={() =>
                setSelectedTier(selectedTier === tier ? null : tier)
              }
              className={cn(
                "rounded-lg px-3 py-1 text-xs font-medium transition-colors",
                selectedTier === tier
                  ? getTierButtonActiveClass(tier)
                  : "bg-muted hover:bg-muted/80",
              )}
            >
              {tier.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* 模型列表 */}
      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="font-medium">模型列表</span>
            <span className="text-sm text-muted-foreground">
              {hasMore
                ? `显示 ${displayedModels.length} / ${filteredModels.length} 个模型`
                : `${filteredModels.length} 个模型`}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredModels.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Cpu className="h-12 w-12 mb-2 opacity-50" />
            <p>暂无模型数据</p>
          </div>
        ) : (
          <>
            <div className="divide-y max-h-[600px] overflow-y-auto">
              {displayedModels.map((model) => (
                <ModelRow
                  key={model.id}
                  model={model}
                  isFavorite={preferences.get(model.id)?.is_favorite || false}
                  usageCount={preferences.get(model.id)?.usage_count || 0}
                  copied={copied === model.id}
                  onCopy={() => copyModelId(model.id)}
                  onToggleFavorite={() => toggleFavorite(model.id)}
                />
              ))}
            </div>
            {hasMore && (
              <div className="border-t px-4 py-3 flex justify-center">
                <button
                  onClick={() => setDisplayLimit((prev) => prev + 50)}
                  className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
                >
                  加载更多 (还有 {filteredModels.length - displayLimit} 个)
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* 使用说明 */}
      <div className="rounded-lg border bg-card p-4">
        <h3 className="mb-2 font-semibold">使用说明</h3>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>• 模型数据来自 models.dev API 和本地配置</p>
          <p>• 点击星标可收藏常用模型，收藏的模型会优先显示</p>
          <p>• 支持按 Provider、服务等级筛选模型</p>
        </div>
      </div>
    </div>
  );
}

/** 单个模型行 */
function ModelRow({
  model,
  isFavorite,
  usageCount,
  copied,
  onCopy,
  onToggleFavorite,
}: {
  model: EnhancedModelMetadata;
  isFavorite: boolean;
  usageCount: number;
  copied: boolean;
  onCopy: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 hover:bg-muted/50">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <Cpu className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="font-medium truncate">{model.id}</code>
            <TierBadge tier={model.tier} />
            {model.is_latest && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                最新
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
            <span>{model.provider_name}</span>
            {model.limits.context_length && (
              <>
                <span>·</span>
                <span>{formatContextLength(model.limits.context_length)}</span>
              </>
            )}
            {usageCount > 0 && (
              <>
                <span>·</span>
                <span>使用 {usageCount} 次</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 能力图标 */}
      <div className="flex items-center gap-1 mr-3">
        {model.capabilities.vision && (
          <span title="支持视觉">
            <Eye className="h-3.5 w-3.5 text-blue-500" />
          </span>
        )}
        {model.capabilities.tools && (
          <span title="支持工具">
            <Wrench className="h-3.5 w-3.5 text-green-500" />
          </span>
        )}
        {model.capabilities.reasoning && (
          <span title="支持推理">
            <Brain className="h-3.5 w-3.5 text-purple-500" />
          </span>
        )}
      </div>

      {/* 定价 */}
      {model.pricing && model.pricing.input_per_million && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground mr-3">
          <DollarSign className="h-3 w-3" />
          <span>{model.pricing.input_per_million.toFixed(2)}</span>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log("[EnhancedModelsTab] Toggle favorite:", model.id);
            onToggleFavorite();
          }}
          className="p-2 rounded-lg hover:bg-muted transition-colors cursor-pointer"
          title={isFavorite ? "取消收藏" : "收藏"}
        >
          <Star
            className={cn(
              "h-5 w-5",
              isFavorite
                ? "text-yellow-500 fill-yellow-500"
                : "text-muted-foreground hover:text-yellow-400",
            )}
          />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onCopy();
          }}
          className="p-2 rounded-lg hover:bg-muted transition-colors cursor-pointer"
          title="复制模型 ID"
        >
          {copied ? (
            <Check className="h-5 w-5 text-green-500" />
          ) : (
            <Copy className="h-5 w-5 text-muted-foreground hover:text-foreground" />
          )}
        </button>
      </div>
    </div>
  );
}

/** 服务等级徽章 */
function TierBadge({ tier }: { tier: string }) {
  const config = {
    mini: {
      label: "Mini",
      color:
        "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    },
    pro: {
      label: "Pro",
      color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    },
    max: {
      label: "Max",
      color:
        "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
    },
  }[tier] || {
    label: tier,
    color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  };

  return (
    <span className={cn("text-xs px-1.5 py-0.5 rounded", config.color)}>
      {config.label}
    </span>
  );
}

/** 获取 Tier 按钮激活状态的样式 */
function getTierButtonActiveClass(tier: ModelTier): string {
  const classes = {
    mini: "bg-green-100 text-green-700 border-green-300 dark:bg-green-900 dark:text-green-300 dark:border-green-700",
    pro: "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900 dark:text-blue-300 dark:border-blue-700",
    max: "bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900 dark:text-purple-300 dark:border-purple-700",
  };
  return classes[tier] || "bg-primary text-primary-foreground";
}

/** 格式化上下文长度 */
function formatContextLength(length: number): string {
  if (length >= 1000000) {
    return `${(length / 1000000).toFixed(1)}M`;
  }
  if (length >= 1000) {
    return `${(length / 1000).toFixed(0)}K`;
  }
  return String(length);
}
