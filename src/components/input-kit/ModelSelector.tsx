import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ProviderIcon } from "@/icons/providers";
import {
  findConfiguredProviderBySelection,
  useConfiguredProviders,
} from "@/hooks/useConfiguredProviders";
import { useProviderModels } from "@/hooks/useProviderModels";
import { filterModelsByTheme } from "@/components/agent/chat/utils/modelThemePolicy";
import { getProviderModelCompatibilityIssue } from "@/components/agent/chat/utils/providerModelCompatibility";
import { getProviderLabel } from "@/lib/constants/providerMappings";
import { ModelCapabilityBadges } from "@/components/model/ModelCapabilityBadges";
import { resolveOemCloudRuntimeContext } from "@/lib/api/oemCloudRuntime";
import { resolveOemLimeHubProviderName } from "@/lib/oemLimeHubProvider";
import { resolveProviderModelLoadOptions } from "@/lib/model/providerModelLoadOptions";

const compactTriggerClassName =
  "h-8 min-w-[104px] max-w-[168px] justify-start gap-1.5 rounded-full border-slate-200/80 bg-white/92 px-2.5 text-slate-600 shadow-none transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-800";

const defaultTriggerClassName =
  "h-9 w-full min-w-0 justify-start gap-2 rounded-full border-slate-200/80 bg-white/92 px-3 font-normal text-slate-700 shadow-none transition-colors hover:border-slate-300 hover:bg-white";

const itemClassName =
  "flex w-full items-center justify-between rounded-xl border border-transparent px-2.5 py-2 text-left text-sm transition-colors";

const BACKGROUND_PRELOAD_IDLE_TIMEOUT_MS = 1_500;
const BACKGROUND_PRELOAD_FALLBACK_DELAY_MS = 180;

const THEME_LABEL_MAP: Record<string, string> = {
  general: "通用对话",
};

export interface ModelSelectorProps {
  providerType: string;
  setProviderType: (type: string) => void;
  model: string;
  setModel: (model: string) => void;
  activeTheme?: string;
  className?: string;
  compactTrigger?: boolean;
  onManageProviders?: () => void;
  popoverSide?: "top" | "bottom";
  disabled?: boolean;
  backgroundPreload?: "immediate" | "idle" | "disabled";
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  providerType,
  setProviderType,
  model,
  setModel,
  activeTheme,
  className,
  compactTrigger = false,
  onManageProviders,
  popoverSide = "top",
  disabled = false,
  backgroundPreload = "immediate",
}) => {
  const [open, setOpen] = useState(false);
  const [backgroundProviderLoadReady, setBackgroundProviderLoadReady] =
    useState(false);
  const hasInitialized = useRef(false);
  const modelRef = useRef(model);
  modelRef.current = model;
  const shouldBackgroundLoadModels =
    backgroundPreload === "immediate" ||
    backgroundProviderLoadReady ||
    !providerType.trim() ||
    !model.trim();
  const shouldLoadProviders =
    open ||
    backgroundPreload === "immediate" ||
    backgroundProviderLoadReady ||
    !providerType.trim() ||
    !model.trim();
  const shouldLoadModels = open || shouldBackgroundLoadModels;

  useEffect(() => {
    if (backgroundPreload !== "idle" || open || backgroundProviderLoadReady) {
      return;
    }

    if (typeof window === "undefined") {
      setBackgroundProviderLoadReady(true);
      return;
    }

    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(
        () => {
          setBackgroundProviderLoadReady(true);
        },
        {
          timeout: BACKGROUND_PRELOAD_IDLE_TIMEOUT_MS,
        },
      );

      return () => {
        if (typeof window.cancelIdleCallback === "function") {
          window.cancelIdleCallback(idleId);
        }
      };
    }

    const timeoutId = window.setTimeout(() => {
      setBackgroundProviderLoadReady(true);
    }, BACKGROUND_PRELOAD_FALLBACK_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [backgroundPreload, backgroundProviderLoadReady, open]);

  const { providers: configuredProviders, loading: providersLoading } =
    useConfiguredProviders({ autoLoad: shouldLoadProviders });

  const selectedProvider = useMemo(() => {
    return findConfiguredProviderBySelection(configuredProviders, providerType);
  }, [configuredProviders, providerType]);
  const providerModelLoadOptions = useMemo(
    () =>
      resolveProviderModelLoadOptions({
        providerId: selectedProvider?.providerId,
        providerType: selectedProvider?.type,
        apiHost: selectedProvider?.apiHost,
      }),
    [
      selectedProvider?.apiHost,
      selectedProvider?.providerId,
      selectedProvider?.type,
    ],
  );

  const { models: providerModels, loading: modelsLoading } = useProviderModels(
    selectedProvider,
    {
      returnFullMetadata: true,
      autoLoad: shouldLoadModels,
      ...providerModelLoadOptions,
    },
  );

  const filteredResult = useMemo(() => {
    return filterModelsByTheme(activeTheme, providerModels);
  }, [activeTheme, providerModels]);

  const modelOptions = useMemo(
    () =>
      filteredResult.models.map((item) => {
        const compatibilityIssue = getProviderModelCompatibilityIssue({
          providerType,
          configuredProviderType: selectedProvider?.type,
          model: item.id,
        });
        return {
          id: item.id,
          metadata: item,
          compatibilityIssue,
        };
      }),
    [filteredResult.models, providerType, selectedProvider?.type],
  );

  const currentModels = useMemo(
    () =>
      modelOptions
        .filter((item) => !item.compatibilityIssue)
        .map((item) => item.id),
    [modelOptions],
  );

  const incompatibleModelCount = useMemo(
    () => modelOptions.filter((item) => item.compatibilityIssue).length,
    [modelOptions],
  );

  useEffect(() => {
    if (hasInitialized.current) return;
    if (!shouldLoadProviders) return;
    if (providersLoading) return;
    if (configuredProviders.length === 0) return;

    hasInitialized.current = true;

    if (!providerType.trim()) {
      setProviderType(
        configuredProviders[0].providerId ?? configuredProviders[0].key,
      );
    }
  }, [
    configuredProviders,
    providerType,
    providersLoading,
    setProviderType,
    shouldLoadProviders,
  ]);

  useEffect(() => {
    if (!shouldLoadModels) return;
    if (!selectedProvider) return;
    if (modelsLoading) return;

    const currentModel = modelRef.current;
    if (
      currentModels.length > 0 &&
      (!currentModel || !currentModels.includes(currentModel))
    ) {
      setModel(currentModels[0]);
    }
  }, [
    currentModels,
    modelsLoading,
    selectedProvider,
    setModel,
    shouldLoadModels,
  ]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (!selectedProvider) return;
    if (!activeTheme) return;
    if (!filteredResult.usedFallback && filteredResult.filteredOutCount === 0) {
      return;
    }

    console.debug("[ModelSelector] 主题模型过滤结果", {
      theme: activeTheme,
      provider: selectedProvider.key,
      policyName: filteredResult.policyName,
      filteredOutCount: filteredResult.filteredOutCount,
      usedFallback: filteredResult.usedFallback,
    });
  }, [
    activeTheme,
    filteredResult.filteredOutCount,
    filteredResult.policyName,
    filteredResult.usedFallback,
    selectedProvider,
  ]);

  useEffect(() => {
    if (!disabled) return;
    if (!open) return;
    setOpen(false);
  }, [disabled, open]);

  const defaultHubProviderLabel = resolveOemLimeHubProviderName(
    resolveOemCloudRuntimeContext(),
  );
  const compactProviderType =
    selectedProvider?.key || providerType || "lime-hub";
  const fallbackProviderLabel =
    compactProviderType.toLowerCase() === "lime-hub"
      ? defaultHubProviderLabel
      : getProviderLabel(compactProviderType);
  const selectedProviderLabel =
    selectedProvider?.label || fallbackProviderLabel;
  const compactProviderLabel = selectedProvider?.label || fallbackProviderLabel;
  const compactModelLabel = model || "切换模型";
  const normalizedTheme = (activeTheme || "").toLowerCase();
  const activeThemeLabel =
    THEME_LABEL_MAP[normalizedTheme] || activeTheme || "当前主题";
  const showThemeFilterHint =
    normalizedTheme !== "" &&
    normalizedTheme !== "general" &&
    !filteredResult.usedFallback &&
    filteredResult.filteredOutCount > 0;
  const showNoProviderGuide =
    shouldLoadProviders &&
    !providersLoading &&
    configuredProviders.length === 0;

  if (showNoProviderGuide) {
    return (
      <div
        className={cn(
          "w-full rounded-lg border border-amber-200 bg-amber-50/60 p-3",
          className,
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-medium text-amber-900">
                工具模型未配置
              </div>
              <div className="text-xs text-amber-700 leading-5">
                配置工具模型以获得更好的对话标题和记忆管理。
              </div>
            </div>
          </div>
          {onManageProviders && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 border-amber-300 bg-white text-amber-800 hover:bg-amber-100 hover:text-amber-900"
              onClick={onManageProviders}
            >
              配置
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center min-w-0", className)}>
      <Popover
        modal={false}
        open={open}
        onOpenChange={(nextOpen) => {
          if (disabled) {
            return;
          }
          setOpen(nextOpen);
        }}
      >
        <PopoverTrigger asChild>
          {compactTrigger ? (
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              disabled={disabled}
              className={cn(
                compactTriggerClassName,
                open && "border-slate-300 bg-white text-slate-700",
              )}
              title={`${selectedProviderLabel} / ${model || "选择模型"}`}
            >
              <ProviderIcon
                providerType={compactProviderType}
                fallbackText={compactProviderLabel}
                size={15}
              />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">
                {compactModelLabel}
              </span>
              <ChevronDown className="h-3 w-3 shrink-0 text-slate-400 opacity-80" />
            </Button>
          ) : (
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              disabled={disabled}
              className={defaultTriggerClassName}
            >
              <Bot size={16} className="text-slate-500" />
              <span className="min-w-0 flex-1 flex items-center gap-1.5">
                <span className="font-medium truncate">
                  {selectedProviderLabel}
                </span>
                <span className="text-slate-300 shrink-0">/</span>
                <span className="text-sm text-slate-500 truncate">
                  {model || "选择模型"}
                </span>
              </span>
              <ChevronDown className="ml-1 h-3 w-3 text-slate-400 opacity-70" />
            </Button>
          )}
        </PopoverTrigger>

        <PopoverContent
          data-model-selector-popover="true"
          className="z-[80] w-[440px] max-w-[calc(100vw-24px)] overflow-hidden rounded-[22px] border border-slate-200/80 bg-white p-0 shadow-xl shadow-slate-950/8 opacity-100"
          align="start"
          side={popoverSide}
          sideOffset={8}
          avoidCollisions
          collisionPadding={8}
        >
          <div className="border-b border-slate-200/80 bg-[linear-gradient(180deg,rgb(255,255,255)_0%,rgb(248,250,252)_100%)] px-4 py-3">
            <div className="text-[11px] font-semibold tracking-[0.08em] text-slate-500">
              模型选择
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm text-slate-700">
              <span className="font-medium">{selectedProviderLabel}</span>
              <span className="text-slate-300">/</span>
              <span className="truncate text-slate-500">
                {model || "选择模型"}
              </span>
            </div>
            {activeTheme ? (
              <div className="mt-1 text-xs text-slate-500">
                当前按 {activeThemeLabel} 组织候选模型
              </div>
            ) : null}
          </div>

          <div className="flex h-[336px]">
            <div className="flex w-[156px] flex-col gap-1 overflow-y-auto border-r border-slate-200/80 bg-slate-50 p-2">
              <div className="mb-1 px-2 py-1 text-[11px] font-semibold tracking-[0.08em] text-slate-500">
                供应商
              </div>

              {configuredProviders.length === 0 ? (
                <div className="px-2 py-3 text-xs leading-5 text-slate-500">
                  暂无已配置供应商
                </div>
              ) : (
                configuredProviders.map((provider) => {
                  const isSelected = selectedProvider?.key === provider.key;

                  return (
                    <button
                      key={provider.key}
                      onClick={() =>
                        setProviderType(provider.providerId ?? provider.key)
                      }
                      className={cn(
                        itemClassName,
                        isSelected
                          ? "border-slate-200 bg-white text-slate-900 shadow-sm shadow-slate-950/5"
                          : "text-slate-500 hover:border-slate-200 hover:bg-white hover:text-slate-900",
                      )}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <ProviderIcon
                          providerType={provider.key}
                          fallbackText={provider.label}
                          size={15}
                        />
                        <span className="truncate">{provider.label}</span>
                      </span>
                      {isSelected && (
                        <div className="h-1.5 w-1.5 rounded-full bg-slate-900" />
                      )}
                    </button>
                  );
                })
              )}
            </div>

            <div className="flex flex-1 flex-col overflow-hidden p-2.5">
              <div className="mb-1 px-2 py-1 text-[11px] font-semibold tracking-[0.08em] text-slate-500">
                模型列表
              </div>
              {showThemeFilterHint ||
              (normalizedTheme !== "general" && filteredResult.usedFallback) ||
              incompatibleModelCount > 0 ? (
                <div className="mb-2 space-y-1 rounded-2xl border border-slate-200/80 bg-slate-50 px-3 py-2">
                  {showThemeFilterHint ? (
                    <div className="text-[11px] leading-5 text-slate-500">
                      已按 {activeThemeLabel} 主题筛选模型
                    </div>
                  ) : null}
                  {normalizedTheme !== "general" &&
                  filteredResult.usedFallback ? (
                    <div className="text-[11px] leading-5 text-amber-700">
                      {activeThemeLabel} 未命中特定主题模型，已回退到完整列表
                    </div>
                  ) : null}
                  {incompatibleModelCount > 0 ? (
                    <div className="text-[11px] leading-5 text-amber-700">
                      已隐藏 {incompatibleModelCount} 个当前登录态不兼容的模型
                    </div>
                  ) : null}
                </div>
              ) : null}

              <ScrollArea className="flex-1">
                <div className="space-y-1 p-1">
                  {modelOptions.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-500">
                      暂无可用模型
                    </div>
                  ) : (
                    modelOptions.map((currentModelItem) => (
                      <button
                        key={currentModelItem.id}
                        disabled={Boolean(currentModelItem.compatibilityIssue)}
                        onClick={() => {
                          if (currentModelItem.compatibilityIssue) {
                            return;
                          }
                          setModel(currentModelItem.id);
                          setOpen(false);
                        }}
                        className={cn(
                          `${itemClassName} group`,
                          currentModelItem.compatibilityIssue
                            ? "cursor-not-allowed border-transparent bg-transparent text-slate-400 opacity-70"
                            : model === currentModelItem.id
                              ? "border-slate-200 bg-slate-50 text-slate-900"
                              : "text-slate-500 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900",
                        )}
                        title={currentModelItem.compatibilityIssue?.message}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          {selectedProvider && (
                            <ProviderIcon
                              providerType={selectedProvider.key}
                              fallbackText={selectedProvider.label}
                              size={15}
                            />
                          )}
                          <span className="min-w-0 flex flex-col gap-1">
                            <span className="truncate">
                              {currentModelItem.id}
                            </span>
                            <ModelCapabilityBadges
                              capabilities={
                                currentModelItem.metadata.capabilities
                              }
                              compact
                            />
                            {currentModelItem.compatibilityIssue ? (
                              <span className="truncate text-[11px] text-amber-700">
                                {currentModelItem.compatibilityIssue.message}
                              </span>
                            ) : null}
                          </span>
                        </span>
                        {currentModelItem.compatibilityIssue ? (
                          <AlertCircle size={14} className="text-amber-500" />
                        ) : model === currentModelItem.id ? (
                          <Check size={14} className="text-slate-900" />
                        ) : null}
                      </button>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>

          {onManageProviders && (
            <button
              type="button"
              className="flex h-11 w-full items-center justify-between border-t border-slate-200/80 px-4 text-sm text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
              onClick={() => {
                setOpen(false);
                onManageProviders();
              }}
            >
              <span className="inline-flex items-center gap-2">
                <Settings2 size={14} className="text-slate-400" />
                管理供应商
              </span>
              <ArrowRight size={14} className="text-slate-400" />
            </button>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
};
