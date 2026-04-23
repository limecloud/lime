/**
 * @file ProviderModelList 组件
 * @description 显示 Provider 支持的模型列表，支持从 API 刷新
 * @module components/provider-pool/api-key/ProviderModelList
 */

import React, { useMemo, useState, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useModelRegistry } from "@/hooks/useModelRegistry";
import {
  Sparkles,
  Check,
  AlertCircle,
  Loader2,
  RefreshCw,
  Cloud,
  HardDrive,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { EnhancedModelMetadata } from "@/lib/types/modelRegistry";
import { apiKeyProviderApi } from "@/lib/api/apiKeyProvider";
import {
  fetchProviderModelsAuto,
  modelRegistryApi,
  normalizeFetchProviderModelsSource,
  type FetchProviderModelsResult,
} from "@/lib/api/modelRegistry";
import { ModelCapabilityBadges } from "@/components/model/ModelCapabilityBadges";
import {
  buildCatalogAliasMap,
  resolveRegistryProviderId,
} from "./providerTypeMapping";
import { getLatestSelectableModel } from "./ProviderConfigForm.utils";
import { getProviderModelAutoFetchCapability } from "@/lib/model/providerModelFetchSupport";
import {
  getModelAliasSource,
  getModelDeploymentSource,
  getModelInputModalities,
  getModelOutputModalities,
  getModelTaskFamilies,
  modelSupportsTaskFamily,
} from "@/lib/model/inferModelCapabilities";
import {
  buildProviderModelsCacheKey,
  isProviderModelsCacheExpired,
} from "./providerModelListCache";

// ============================================================================
// 类型定义
// ============================================================================

export interface ProviderModelListProps {
  /** Provider ID，如 "deepseek", "openai", "anthropic" */
  providerId: string;
  /** Provider 类型（API 协议），如 "anthropic", "openai", "gemini" */
  providerType: string;
  /** 当前默认模型 ID */
  selectedModelId?: string | null;
  /** 推荐最新模型 ID */
  latestModelId?: string | null;
  /** 点击模型时设为默认模型 */
  onSelectModel?: (modelId: string) => void;
  /** 当前列表解析出的最新模型变化回调 */
  onLatestModelResolved?: (modelId: string | null) => void;
  /** 是否有可用的 API Key（用于显示刷新按钮） */
  hasApiKey?: boolean;
  /** 当前 Provider 的 API Host */
  apiHost?: string;
  /** 额外的 CSS 类名 */
  className?: string;
  /** 最大显示数量，默认显示全部 */
  maxItems?: number;
}

// ============================================================================
// API 响应类型
// ============================================================================

interface CachedProviderModels {
  models: EnhancedModelMetadata[];
  source: "Api" | "Catalog" | "CustomModels" | "LocalFallback" | null;
  error: string | null;
  requestUrl: string | null;
  diagnosticHint: string | null;
  shouldPromptError: boolean;
  cachedAt: number;
}

const providerModelsCache = new Map<string, CachedProviderModels>();
const DEFAULT_MODEL_CARD_CLASS =
  "border-emerald-200 bg-[linear-gradient(135deg,rgba(240,253,250,0.98)_0%,rgba(236,253,245,0.96)_52%,rgba(224,242,254,0.94)_100%)] shadow-sm shadow-emerald-950/10";
const DEFAULT_MODEL_PILL_CLASS =
  "border-emerald-200 bg-emerald-50 text-emerald-700";

function buildApiDiagnosticLines(result: {
  error: string | null;
  request_url?: string | null;
  diagnostic_hint?: string | null;
}): string[] {
  const lines: string[] = [];
  const errorText = result.error?.trim() ?? "";
  const requestUrl = result.request_url?.trim() ?? "";
  const diagnosticHint = result.diagnostic_hint?.trim() ?? "";

  if (errorText) {
    lines.push(errorText);
  }

  if (requestUrl && !errorText.includes(requestUrl)) {
    lines.push(`请求地址：${requestUrl}`);
  }

  if (diagnosticHint && !errorText.includes(diagnosticHint)) {
    lines.push(diagnosticHint);
  }

  return lines;
}

// ============================================================================
// 子组件
// ============================================================================

interface ModelItemProps {
  model: EnhancedModelMetadata;
  isDefault: boolean;
  isLatest: boolean;
  onSelect?: (modelId: string) => void;
}

type CapabilityFilter =
  | "all"
  | "chat"
  | "vision_understanding"
  | "image_generation"
  | "audio"
  | "embedding";

const CAPABILITY_FILTERS: Array<{
  value: CapabilityFilter;
  label: string;
}> = [
  { value: "all", label: "全部" },
  { value: "chat", label: "对话与推理" },
  { value: "vision_understanding", label: "视觉理解" },
  { value: "image_generation", label: "图片生成" },
  { value: "audio", label: "音频" },
  { value: "embedding", label: "Embedding / 检索" },
];

const TASK_FAMILY_BADGE_CLASS: Record<string, string> = {
  chat: "border-slate-200 bg-slate-50 text-slate-700",
  reasoning: "border-violet-200 bg-violet-50 text-violet-700",
  vision_understanding: "border-sky-200 bg-sky-50 text-sky-700",
  image_generation: "border-amber-200 bg-amber-50 text-amber-700",
  image_edit: "border-orange-200 bg-orange-50 text-orange-700",
  speech_to_text: "border-cyan-200 bg-cyan-50 text-cyan-700",
  text_to_speech: "border-teal-200 bg-teal-50 text-teal-700",
  embedding: "border-indigo-200 bg-indigo-50 text-indigo-700",
  rerank: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
  moderation: "border-rose-200 bg-rose-50 text-rose-700",
};

function formatTaskFamilyLabel(value: string): string {
  switch (value) {
    case "chat":
      return "对话";
    case "reasoning":
      return "思考";
    case "vision_understanding":
      return "视觉理解";
    case "image_generation":
      return "图片生成";
    case "image_edit":
      return "图片编辑";
    case "speech_to_text":
      return "语音转写";
    case "text_to_speech":
      return "语音合成";
    case "embedding":
      return "Embedding";
    case "rerank":
      return "检索重排";
    case "moderation":
      return "审核";
    default:
      return value;
  }
}

function formatModalityLabel(value: string): string {
  switch (value) {
    case "text":
      return "文本";
    case "image":
      return "图片";
    case "audio":
      return "音频";
    case "video":
      return "视频";
    case "file":
      return "文件";
    case "embedding":
      return "向量";
    case "json":
      return "JSON";
    default:
      return value;
  }
}

function formatDeploymentSourceLabel(model: EnhancedModelMetadata): string {
  switch (getModelDeploymentSource(model)) {
    case "local":
      return "本地";
    case "oem_cloud":
      return "OEM 云端";
    case "user_cloud":
    default:
      return "云端";
  }
}

function isProxyAliasSource(aliasSource: string | null): boolean {
  return aliasSource === "relay" || aliasSource === "oem";
}

function matchesCapabilityFilter(
  model: EnhancedModelMetadata,
  filter: CapabilityFilter,
): boolean {
  switch (filter) {
    case "chat":
      return (
        modelSupportsTaskFamily(model, "chat") ||
        modelSupportsTaskFamily(model, "reasoning")
      );
    case "vision_understanding":
      return modelSupportsTaskFamily(model, "vision_understanding");
    case "image_generation":
      return (
        modelSupportsTaskFamily(model, "image_generation") ||
        modelSupportsTaskFamily(model, "image_edit")
      );
    case "audio":
      return (
        modelSupportsTaskFamily(model, "speech_to_text") ||
        modelSupportsTaskFamily(model, "text_to_speech")
      );
    case "embedding":
      return (
        modelSupportsTaskFamily(model, "embedding") ||
        modelSupportsTaskFamily(model, "rerank")
      );
    case "all":
    default:
      return true;
  }
}

/**
 * 单个模型项
 */
const ModelItem: React.FC<ModelItemProps> = ({
  model,
  isDefault,
  isLatest,
  onSelect,
}) => {
  const taskFamilies = getModelTaskFamilies(model).slice(0, 3);
  const inputModalities = getModelInputModalities(model);
  const outputModalities = getModelOutputModalities(model);
  const aliasSource = getModelAliasSource(model);
  const sourceLabel = formatDeploymentSourceLabel(model);
  const showProxyAlias = isProxyAliasSource(aliasSource);

  return (
    <div
      className={cn(
        "group flex items-start justify-between gap-3 rounded-[18px] border px-4 py-3 transition-colors",
        onSelect
          ? "cursor-pointer hover:border-slate-300 hover:bg-slate-50"
          : "hover:bg-slate-50",
        isDefault ? DEFAULT_MODEL_CARD_CLASS : "border-slate-200/80 bg-white",
      )}
      onClick={onSelect ? () => onSelect(model.id) : undefined}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={
        onSelect
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(model.id);
              }
            }
          : undefined
      }
      data-testid={`model-item-${model.id}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">
            {model.display_name}
          </span>
          {isLatest ? <Badge variant="outline">最新</Badge> : null}
          {isDefault ? <Badge variant="secondary">默认</Badge> : null}
          <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
            {sourceLabel}
          </span>
          {showProxyAlias ? (
            <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700">
              代理别名
            </span>
          ) : null}
        </div>
        <div className="truncate text-xs text-muted-foreground">{model.id}</div>
        {taskFamilies.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {taskFamilies.map((family) => (
              <span
                key={`${model.id}-${family}`}
                className={cn(
                  "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  TASK_FAMILY_BADGE_CLASS[family] ??
                    "border-slate-200 bg-slate-50 text-slate-700",
                )}
              >
                {formatTaskFamilyLabel(family)}
              </span>
            ))}
          </div>
        ) : null}
        <ModelCapabilityBadges
          capabilities={model.capabilities}
          className="mt-2"
        />
        <p className="mt-2 text-[11px] leading-5 text-slate-500">
          输入：
          {inputModalities.map(formatModalityLabel).join(" / ") || "未标注"}
          {" · "}
          输出：
          {outputModalities.map(formatModalityLabel).join(" / ") || "未标注"}
        </p>
        {showProxyAlias &&
        model.provider_model_id &&
        model.canonical_model_id &&
        model.provider_model_id !== model.canonical_model_id ? (
          <p className="mt-1 text-[11px] leading-5 text-violet-600">
            实际映射：{model.provider_model_id} → {model.canonical_model_id}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2 pt-1">
        {isDefault ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : null}
        {onSelect ? (
          <span
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
              isDefault
                ? DEFAULT_MODEL_PILL_CLASS
                : "border-slate-200 bg-white text-slate-600 group-hover:border-slate-300 group-hover:text-slate-900",
            )}
          >
            {isDefault ? "当前默认" : "设为默认"}
          </span>
        ) : null}
      </div>
    </div>
  );
};

// ============================================================================
// 主组件
// ============================================================================

/**
 * Provider 支持的模型列表组件
 *
 * 显示指定 Provider 支持的所有模型，包括模型名称和能力标签
 *
 * @example
 * ```tsx
 * <ProviderModelList providerType="anthropic" />
 * ```
 */
export const ProviderModelList: React.FC<ProviderModelListProps> = ({
  providerId,
  providerType,
  selectedModelId = null,
  latestModelId = null,
  onSelectModel,
  onLatestModelResolved,
  hasApiKey = false,
  apiHost,
  className,
  maxItems,
}) => {
  const autoFetchCapability = useMemo(
    () =>
      getProviderModelAutoFetchCapability({
        providerId,
        providerType,
        apiHost,
      }),
    [apiHost, providerId, providerType],
  );
  const canRefreshFromApi =
    autoFetchCapability.supported &&
    (!autoFetchCapability.requiresApiKey || hasApiKey);
  const refreshTooltipText = autoFetchCapability.supported
    ? autoFetchCapability.requiresApiKey && !hasApiKey
      ? "先配置可用 API Key 后才能获取最新模型"
      : "自动获取最新模型列表"
    : (autoFetchCapability.unsupportedReason ??
      "当前协议暂不支持自动获取最新模型");
  const [searchQuery, setSearchQuery] = useState("");
  const [capabilityFilter, setCapabilityFilter] =
    useState<CapabilityFilter>("all");
  const [catalogAliasMap, setCatalogAliasMap] = useState<Record<
    string,
    string
  > | null>(null);
  const [validRegistryProviderIds, setValidRegistryProviderIds] =
    useState<Set<string> | null>(null);
  const [registryTruthError, setRegistryTruthError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;

    const loadCatalog = async () => {
      try {
        const catalog = await apiKeyProviderApi.getSystemProviderCatalog();
        if (cancelled) {
          return;
        }
        setCatalogAliasMap(buildCatalogAliasMap(catalog));
      } catch {
        if (cancelled) {
          return;
        }
        setCatalogAliasMap(null);
      }
    };

    loadCatalog();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadRegistryProviders = async () => {
      try {
        const providerIds =
          await modelRegistryApi.getModelRegistryProviderIds();
        if (cancelled) {
          return;
        }

        setValidRegistryProviderIds(new Set(providerIds));
        setRegistryTruthError(null);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setRegistryTruthError(
          error instanceof Error ? error.message : String(error),
        );
        setValidRegistryProviderIds(null);
      }
    };

    loadRegistryProviders();

    return () => {
      cancelled = true;
    };
  }, []);

  // 转换 Provider ID 为 registry ID（优先使用 providerId，回退到 providerType）
  const registryProviderId = useMemo(() => {
    return resolveRegistryProviderId(providerId, {
      providerType,
      apiHost,
      catalogAliasMap,
      validRegistryProviders: validRegistryProviderIds ?? undefined,
    });
  }, [
    apiHost,
    catalogAliasMap,
    providerId,
    providerType,
    validRegistryProviderIds,
  ]);

  // 获取模型数据
  const { models, loading, error } = useModelRegistry({
    autoLoad: true,
    providerFilter: [registryProviderId],
  });

  // 从 API 刷新状态
  const [refreshing, setRefreshing] = useState(false);
  const [apiModels, setApiModels] = useState<EnhancedModelMetadata[] | null>(
    null,
  );
  const [apiSource, setApiSource] = useState<
    "Api" | "Catalog" | "CustomModels" | "LocalFallback" | null
  >(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [apiRequestUrl, setApiRequestUrl] = useState<string | null>(null);
  const [apiDiagnosticHint, setApiDiagnosticHint] = useState<string | null>(
    null,
  );
  const [apiShouldPromptError, setApiShouldPromptError] = useState(false);
  const cacheKey = buildProviderModelsCacheKey({
    providerId,
    providerType,
    apiHost,
  });

  useEffect(() => {
    const cached = providerModelsCache.get(cacheKey);
    if (!cached) {
      setApiModels(null);
      setApiSource(null);
      setApiError(null);
      setApiRequestUrl(null);
      setApiDiagnosticHint(null);
      setApiShouldPromptError(false);
      return;
    }

    if (
      isProviderModelsCacheExpired(cached.cachedAt) ||
      (autoFetchCapability.requiresApiKey && !hasApiKey)
    ) {
      providerModelsCache.delete(cacheKey);
      setApiModels(null);
      setApiSource(null);
      setApiError(null);
      setApiRequestUrl(null);
      setApiDiagnosticHint(null);
      setApiShouldPromptError(false);
      return;
    }

    setApiModels(cached.models);
    setApiSource(cached.source);
    setApiError(cached.error);
    setApiRequestUrl(cached.requestUrl);
    setApiDiagnosticHint(cached.diagnosticHint);
    setApiShouldPromptError(cached.shouldPromptError);
  }, [autoFetchCapability.requiresApiKey, cacheKey, hasApiKey]);

  // 从 API 获取模型列表（自动获取 API Key）
  const handleRefreshFromApi = useCallback(async () => {
    if (!autoFetchCapability.supported) {
      return;
    }

    setRefreshing(true);
    setApiError(null);
    setApiRequestUrl(null);
    setApiDiagnosticHint(null);
    setApiShouldPromptError(false);

    try {
      const result: FetchProviderModelsResult =
        await fetchProviderModelsAuto(providerId);
      const normalizedSource = normalizeFetchProviderModelsSource(result);

      if (result && result.models) {
        const shouldDisplayFetchedModels =
          result.models.length > 0 &&
          (normalizedSource === "Api" ||
            normalizedSource === "Catalog" ||
            normalizedSource === "CustomModels" ||
            normalizedSource === "LocalFallback");
        const nextModels = shouldDisplayFetchedModels ? result.models : [];

        setApiModels(nextModels);
        setApiSource(shouldDisplayFetchedModels ? normalizedSource : null);
        setApiRequestUrl(result.request_url ?? null);
        setApiDiagnosticHint(result.diagnostic_hint ?? null);
        setApiShouldPromptError(Boolean(result.should_prompt_error));
        if (result.error) {
          setApiError(result.error);
        } else {
          setApiError(null);
        }

        if (shouldDisplayFetchedModels) {
          providerModelsCache.set(cacheKey, {
            models: nextModels,
            source: normalizedSource,
            error: result.error ?? null,
            requestUrl: result.request_url ?? null,
            diagnosticHint: result.diagnostic_hint ?? null,
            shouldPromptError: Boolean(result.should_prompt_error),
            cachedAt: Date.now(),
          });
        } else {
          providerModelsCache.delete(cacheKey);
        }
      } else {
        setApiError("返回结果格式错误");
      }
    } catch (err) {
      setApiError(err instanceof Error ? err.message : String(err));
      providerModelsCache.delete(cacheKey);
    } finally {
      setRefreshing(false);
    }
  }, [autoFetchCapability.supported, cacheKey, providerId]);

  // 使用 API 模型或本地模型
  const displayModelsSource = useMemo(() => {
    if (registryTruthError) {
      return [];
    }

    if (!autoFetchCapability.supported) {
      return models;
    }

    if (autoFetchCapability.requiresLiveModelTruth) {
      return apiModels ?? [];
    }

    if (apiModels && apiModels.length > 0) {
      return apiModels;
    }

    return models;
  }, [
    apiModels,
    autoFetchCapability.requiresLiveModelTruth,
    autoFetchCapability.supported,
    models,
    registryTruthError,
  ]);
  const filteredModelsSource = useMemo(() => {
    const capabilityFilteredModels = displayModelsSource.filter((model) =>
      matchesCapabilityFilter(model, capabilityFilter),
    );
    if (!searchQuery.trim()) {
      return capabilityFilteredModels;
    }

    const query = searchQuery.trim().toLowerCase();
    return capabilityFilteredModels.filter(
      (model) =>
        model.display_name.toLowerCase().includes(query) ||
        model.id.toLowerCase().includes(query) ||
        getModelTaskFamilies(model).some((family) =>
          formatTaskFamilyLabel(family).toLowerCase().includes(query),
        ),
    );
  }, [capabilityFilter, displayModelsSource, searchQuery]);
  const capabilityFilterCounts = useMemo(() => {
    return Object.fromEntries(
      CAPABILITY_FILTERS.map((filter) => [
        filter.value,
        displayModelsSource.filter((model) =>
          matchesCapabilityFilter(model, filter.value),
        ).length,
      ]),
    ) as Record<CapabilityFilter, number>;
  }, [displayModelsSource]);
  const apiDiagnosticLines = buildApiDiagnosticLines({
    error: apiError,
    request_url: apiRequestUrl,
    diagnostic_hint: apiDiagnosticHint,
  });
  const showBlockingApiPromptError =
    apiShouldPromptError && displayModelsSource.length === 0;
  const registryDiagnosticLines = registryTruthError
    ? [
        "模型真相源异常：无法校验当前 Provider 是否存在于内置 registry。",
        registryTruthError,
      ]
    : [];

  // 限制显示数量
  const displayModels = useMemo(() => {
    if (maxItems && maxItems > 0) {
      return filteredModelsSource.slice(0, maxItems);
    }
    return filteredModelsSource;
  }, [filteredModelsSource, maxItems]);

  const hasMore = maxItems && filteredModelsSource.length > maxItems;
  const resolvedLatestModelId =
    latestModelId ?? getLatestSelectableModel(displayModelsSource)?.id ?? null;
  const effectiveDefaultModelId = selectedModelId ?? resolvedLatestModelId;
  const resolvedLatestModelKey = resolvedLatestModelId?.toLowerCase() ?? null;
  const effectiveDefaultModelKey =
    effectiveDefaultModelId?.toLowerCase() ?? null;

  useEffect(() => {
    onLatestModelResolved?.(resolvedLatestModelId);
  }, [onLatestModelResolved, resolvedLatestModelId]);

  // 加载状态
  if (loading && !apiModels) {
    return (
      <div
        className={cn(
          "flex items-center justify-center py-8 text-muted-foreground",
          className,
        )}
        data-testid="provider-model-list-loading"
      >
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        <span className="text-sm">加载模型列表...</span>
      </div>
    );
  }

  // 错误状态
  if (error && !apiModels) {
    return (
      <div
        className={cn("py-4 text-center text-sm text-red-500", className)}
        data-testid="provider-model-list-error"
      >
        加载失败: {error}
      </div>
    );
  }

  // 空状态
  if (displayModelsSource.length === 0) {
    return (
      <div className={cn("space-y-2", className)}>
        <div
          className="mb-2 flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between"
          data-testid="provider-model-list-empty-toolbar"
        >
          <div className="min-w-0 space-y-1">
            <h4 className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
              <Sparkles className="h-4 w-4 text-muted-foreground" />
              支持的模型
            </h4>
            {onSelectModel ? (
              <p className="text-xs text-muted-foreground">
                点击模型即可设为默认模型；未显式选择时，自动使用最新模型。
              </p>
            ) : null}
          </div>
          <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center 2xl:w-auto 2xl:min-w-[320px]">
            <div className="relative min-w-0 flex-1 sm:min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索模型"
                className="h-8 border-slate-200 bg-white pl-8 text-xs"
              />
            </div>
            {autoFetchCapability.supported ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleRefreshFromApi}
                      disabled={refreshing || !canRefreshFromApi}
                      className="h-8 shrink-0 whitespace-nowrap border border-slate-200 bg-white px-3"
                    >
                      {refreshing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-1 h-3.5 w-3.5" />
                      )}
                      获取最新模型
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{refreshTooltipText}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
          </div>
        </div>
        <div
          className="py-4 text-center text-sm text-muted-foreground"
          data-testid="provider-model-list-empty"
        >
          {registryTruthError
            ? "模型真相源异常"
            : autoFetchCapability.supported
              ? autoFetchCapability.requiresApiKey && !hasApiKey
                ? "请先添加可用 API Key"
                : apiError
                  ? "当前未读取到可用模型"
                  : "尚未获取模型目录"
              : "暂无模型数据"}
          {!registryTruthError && autoFetchCapability.supported && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefreshFromApi}
              disabled={refreshing || !canRefreshFromApi}
              className="ml-1 h-auto p-0 text-primary underline-offset-4 hover:underline disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-60"
            >
              {canRefreshFromApi
                ? "点击获取最新模型"
                : autoFetchCapability.requiresApiKey
                  ? "配置 API Key 后可获取最新模型"
                  : "当前暂不可自动获取最新模型"}
            </Button>
          )}
        </div>
        {!registryTruthError &&
        !autoFetchCapability.supported &&
        autoFetchCapability.unsupportedReason ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs text-slate-600">
            {autoFetchCapability.unsupportedReason}
          </div>
        ) : null}
        {registryTruthError && (
          <div
            className="rounded-md border border-rose-200 bg-rose-50/90 px-3 py-2 text-left text-xs text-rose-700"
            data-testid="provider-model-list-registry-error"
          >
            <div className="mb-1 flex items-center gap-1.5 font-semibold">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>请先修复内置模型索引</span>
            </div>
            {registryDiagnosticLines.map((line) => (
              <div key={line} className="break-all leading-5">
                {line}
              </div>
            ))}
          </div>
        )}
        {apiError && (
          <div className="rounded-md border border-amber-200 bg-amber-50/80 px-3 py-2 text-left text-xs text-amber-700">
            {showBlockingApiPromptError ? (
              <div className="mb-1 font-semibold text-red-600">
                检测到 Provider 配置错误，请优先修正 Base URL 或鉴权配置
              </div>
            ) : null}
            {apiDiagnosticLines.map((line) => (
              <div key={line} className="break-all leading-5">
                {line}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn("space-y-3", className)}
      data-testid="provider-model-list"
    >
      <div
        className="flex flex-col gap-3 2xl:flex-row 2xl:items-start 2xl:justify-between"
        data-testid="provider-model-list-toolbar"
      >
        <div className="min-w-0 space-y-1">
          <h4 className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            支持的模型
            <span className="text-xs font-normal text-muted-foreground">
              ({filteredModelsSource.length})
            </span>
            {apiSource && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                        apiSource === "Api"
                          ? "bg-emerald-100 text-emerald-700"
                          : apiSource === "Catalog"
                            ? "bg-sky-100 text-sky-700"
                            : apiSource === "CustomModels"
                              ? "bg-violet-100 text-violet-700"
                              : "bg-amber-100 text-amber-700",
                      )}
                    >
                      {apiSource === "Api" ? (
                        <>
                          <Cloud className="h-3 w-3" />
                          API
                        </>
                      ) : apiSource === "Catalog" ? (
                        <>
                          <HardDrive className="h-3 w-3" />
                          目录
                        </>
                      ) : apiSource === "CustomModels" ? (
                        <>
                          <HardDrive className="h-3 w-3" />
                          自定义
                        </>
                      ) : (
                        <>
                          <HardDrive className="h-3 w-3" />
                          本地
                        </>
                      )}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {apiSource === "Api"
                      ? "数据来自 Provider API"
                      : apiSource === "Catalog"
                        ? "数据来自厂商目录"
                        : apiSource === "CustomModels"
                          ? "数据来自当前 Provider 已配置的自定义模型"
                          : "API 获取失败，使用本地数据"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </h4>
          <p className="text-xs text-muted-foreground">
            支持搜索、刷新模型目录，并直接把任一模型设为默认模型。
          </p>
        </div>

        <div
          className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center 2xl:w-auto 2xl:min-w-[360px]"
          data-testid="provider-model-list-actions"
        >
          <div className="relative min-w-0 flex-1 sm:min-w-[220px] 2xl:w-[280px]">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索模型名称或 ID"
              className="h-8 border-slate-200 bg-white pl-8 text-xs"
            />
          </div>
          {autoFetchCapability.supported ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefreshFromApi}
                    disabled={refreshing || !canRefreshFromApi}
                    className="h-8 shrink-0 whitespace-nowrap border-slate-200 bg-white px-3"
                  >
                    {refreshing ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1 h-3.5 w-3.5" />
                    )}
                    获取最新模型
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{refreshTooltipText}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
        </div>
      </div>

      <div
        role="tablist"
        aria-label="模型能力筛选"
        className="flex h-auto flex-wrap justify-start gap-2 rounded-[18px] border border-slate-200/80 bg-slate-50/80 p-2"
      >
        {CAPABILITY_FILTERS.map((filter) => {
          const active = capabilityFilter === filter.value;
          return (
            <button
              key={filter.value}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`provider-model-filter-${filter.value}`}
              onClick={() => setCapabilityFilter(filter.value)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs transition-colors",
                active
                  ? "border-emerald-200 bg-white text-slate-900"
                  : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-white/80 hover:text-slate-900",
              )}
            >
              {filter.label}
              <span className="ml-1 text-[10px] text-slate-500">
                {capabilityFilterCounts[filter.value] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {/* API 错误提示 */}
      {apiError && (
        <div className="mb-2 rounded-md border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-700">
          {showBlockingApiPromptError ? (
            <div className="mb-1 font-semibold text-red-600">
              检测到 Provider 配置错误，请优先修正 Base URL 或鉴权配置
            </div>
          ) : null}
          {apiDiagnosticLines.map((line) => (
            <div key={line} className="break-all leading-5">
              {line}
            </div>
          ))}
        </div>
      )}

      {registryTruthError ? (
        <div
          className="mb-2 rounded-md border border-rose-200 bg-rose-50/90 px-3 py-2 text-xs text-rose-700"
          data-testid="provider-model-list-registry-error"
        >
          <div className="mb-1 flex items-center gap-1.5 font-semibold">
            <AlertCircle className="h-3.5 w-3.5" />
            <span>模型真相源异常</span>
          </div>
          {registryDiagnosticLines.map((line) => (
            <div key={line} className="break-all leading-5">
              {line}
            </div>
          ))}
        </div>
      ) : null}

      {!autoFetchCapability.supported &&
      autoFetchCapability.unsupportedReason ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {autoFetchCapability.unsupportedReason}
        </div>
      ) : null}

      {filteredModelsSource.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
          {searchQuery
            ? "没有匹配的模型"
            : capabilityFilter !== "all"
              ? "当前能力分组下暂无模型"
              : "暂无模型数据"}
        </div>
      ) : (
        <div className="space-y-3">
          {displayModels.map((model) => (
            <ModelItem
              key={model.id}
              model={model}
              isDefault={effectiveDefaultModelKey === model.id.toLowerCase()}
              isLatest={resolvedLatestModelKey === model.id.toLowerCase()}
              onSelect={onSelectModel}
            />
          ))}
        </div>
      )}

      {/* 显示更多提示 */}
      {hasMore && (
        <p className="text-xs text-muted-foreground text-center pt-2">
          还有 {filteredModelsSource.length - maxItems!} 个模型未显示
        </p>
      )}
    </div>
  );
};

export default ProviderModelList;
