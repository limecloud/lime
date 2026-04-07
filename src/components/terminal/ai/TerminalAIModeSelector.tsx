/**
 * @file TerminalAIModeSelector.tsx
 * @description Terminal AI 模式选择器 - 复用 Agent 的模型选择逻辑
 * @module components/terminal/ai/TerminalAIModeSelector
 *
 * 参考 Waveterm 的 AIModeDropdown 设计，但复用 Lime 的 Provider/Model 选择器
 */

import React, { useState, useMemo, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useConfiguredProviders } from "@/hooks/useConfiguredProviders";
import { useProviderModels } from "@/hooks/useProviderModels";
import { isAliasProvider } from "@/lib/constants/providerMappings";
import { filterProviderModelsByCompatibility } from "@/components/agent/chat/utils/providerModelCompatibility";

// ============================================================================
// 常量
// ============================================================================

/**
 * 从凭证类型提取支持的模型列表
 * 对应后端 orchestrator_cmd.rs 中的 extract_supported_models 函数
 * 这是一个降级策略：优先使用凭证池中的模型列表
 */
const extractSupportedModels = (
  providerType: string,
  credentialType: string,
  providerId?: string,
): string[] => {
  const type = providerType.toLowerCase();
  const credType = credentialType.toLowerCase();

  // 特殊处理：DeepSeek（通过 providerId 判断）
  if (providerId === "deepseek") {
    return ["deepseek-chat", "deepseek-reasoner"];
  }

  // Claude 凭证
  if (type === "claude" || type === "claude_oauth") {
    return [
      "claude-opus-4-5-20251101",
      "claude-opus-4-20250514",
      "claude-sonnet-4-5-20250929",
      "claude-sonnet-4-20250514",
      "claude-haiku-4-5-20251001",
      "claude-3-7-sonnet-20250219",
      "claude-3-5-haiku-20241022",
    ];
  }

  // OpenAI 凭证
  if (type === "openai") {
    return [
      "gpt-5.2-codex",
      "gpt-5.2",
      "gpt-5.1-codex-max",
      "gpt-5.1-codex",
      "gpt-5.1-codex-mini",
      "gpt-5.1",
      "gpt-5-codex",
      "gpt-5-codex-mini",
      "gpt-5",
      "gpt-4o",
      "gpt-4o-mini",
    ];
  }

  // Gemini OAuth 凭证
  if (type === "gemini" && credType.includes("oauth")) {
    return [
      "gemini-3-pro-preview",
      "gemini-3-flash-preview",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
    ];
  }

  // Gemini API Key 凭证
  if (
    type === "gemini_api_key" ||
    (type === "gemini" && credType.includes("key"))
  ) {
    return [
      "gemini-3-pro-preview",
      "gemini-3-flash-preview",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
    ];
  }

  // Kiro OAuth 凭证
  if (type === "kiro") {
    return [
      "claude-opus-4-5",
      "claude-opus-4-5-20251101",
      "claude-haiku-4-5",
      "claude-sonnet-4-5",
      "claude-sonnet-4-5-20250929",
      "claude-sonnet-4-20250514",
      "claude-3-7-sonnet-20250219",
    ];
  }

  // Codex OAuth 凭证 - 从后端别名配置加载，这里返回空数组触发降级逻辑
  if (type === "codex") {
    return [];
  }

  // Qwen OAuth 凭证
  if (type === "qwen") {
    return ["qwen3-coder-plus", "qwen3-coder-flash"];
  }

  // Antigravity OAuth 凭证
  if (type === "antigravity") {
    return [
      // Max 等级
      "gemini-3-pro-preview",
      "gemini-3-pro-image-preview",
      "gemini-claude-opus-4-5-thinking",
      // Pro 等级
      "gemini-2.5-flash",
      "gemini-2.5-computer-use-preview-10-2025",
      "gemini-claude-sonnet-4-5",
      "gemini-claude-sonnet-4-5-thinking",
      // Mini 等级
      "gemini-3-flash-preview",
    ];
  }

  // iFlow 凭证（DeepSeek 代理）
  if (type === "iflow") {
    return ["deepseek-chat", "deepseek-reasoner"];
  }

  return [];
};

// ============================================================================
// 类型
// ============================================================================

interface TerminalAIModeSelectorProps {
  /** 当前 Provider ID */
  providerId: string;
  /** Provider 变化回调 */
  onProviderChange: (id: string) => void;
  /** 当前模型 ID */
  modelId: string;
  /** 模型变化回调 */
  onModelChange: (id: string) => void;
  /** 自定义类名 */
  className?: string;
}

// ============================================================================
// 组件
// ============================================================================

export const TerminalAIModeSelector: React.FC<TerminalAIModeSelectorProps> = ({
  providerId,
  onProviderChange,
  modelId,
  onModelChange,
  className,
}) => {
  const [open, setOpen] = useState(false);

  // 获取已配置的 Provider 列表（使用共享 hook）
  const { providers: configuredProviders } = useConfiguredProviders();

  // 当前选中的 Provider
  const selectedProvider = useMemo(() => {
    return configuredProviders.find((p) => p.key === providerId);
  }, [configuredProviders, providerId]);

  // 获取模型列表（使用共享 hook）
  const { modelIds: hookModels, loading: modelsLoading } =
    useProviderModels(selectedProvider);

  // 当前 Provider 的模型列表
  // Terminal 有特殊的降级策略：优先使用 extractSupportedModels
  const currentModels = useMemo(() => {
    if (!selectedProvider) return [];

    // 别名 Provider 使用共享 hook 的结果
    if (isAliasProvider(selectedProvider.key)) {
      return hookModels;
    }

    // 自定义 API Key Provider（非系统预设）直接使用 hook 结果
    // 判断依据：providerId 不在系统预设列表中
    const systemProviders = [
      "kiro",
      "codex",
      "gemini",
      "gemini_api_key",
      "antigravity",
      "qwen",
      "claude",
      "claude_oauth",
      "openai",
      "iflow",
    ];
    if (!systemProviders.includes(selectedProvider.key.toLowerCase())) {
      return hookModels;
    }

    // 优先使用凭证池中的模型列表（从后端 extract_supported_models 逻辑）
    const credentialModels = extractSupportedModels(
      selectedProvider.type,
      selectedProvider.credentialType || "",
      selectedProvider.providerId,
    );

    if (credentialModels.length > 0) {
      return credentialModels;
    }

    // 降级：使用共享 hook 的结果
    return hookModels;
  }, [selectedProvider, hookModels]);

  const compatibilityResult = useMemo(() => {
    if (!selectedProvider) {
      return { compatibleModels: [], incompatibleModels: [] };
    }

    return filterProviderModelsByCompatibility(
      {
        providerType: selectedProvider.key,
        configuredProviderType: selectedProvider.type,
      },
      currentModels,
    );
  }, [currentModels, selectedProvider]);

  // 自动选择第一个模型
  useEffect(() => {
    // 等待模型加载完成
    if (
      selectedProvider &&
      isAliasProvider(selectedProvider.key) &&
      modelsLoading
    ) {
      return;
    }

    if (
      compatibilityResult.compatibleModels.length > 0 &&
      !compatibilityResult.compatibleModels.includes(modelId)
    ) {
      onModelChange(compatibilityResult.compatibleModels[0]);
    }
  }, [
    compatibilityResult.compatibleModels,
    modelId,
    onModelChange,
    selectedProvider,
    modelsLoading,
  ]);

  // 初始化 Provider
  useEffect(() => {
    if (configuredProviders.length > 0 && !selectedProvider) {
      onProviderChange(configuredProviders[0].key);
    }
  }, [configuredProviders, selectedProvider, onProviderChange]);

  const displayLabel = selectedProvider?.label || providerId;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded-md text-sm",
            "bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors",
            className,
          )}
        >
          <span className="font-medium">{displayLabel}</span>
          <ChevronDown size={14} className="text-zinc-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[380px] border-zinc-700 bg-zinc-900 p-0"
        align="start"
      >
        <div className="flex h-[280px]">
          {/* 左侧：Provider 列表 */}
          <div className="w-[130px] overflow-y-auto border-r border-zinc-700 bg-zinc-800 p-2">
            <div className="text-xs font-semibold text-zinc-400 px-2 py-1 mb-1">
              Providers
            </div>
            {configuredProviders.length === 0 ? (
              <div className="text-xs text-zinc-500 p-2">
                暂无已配置的 Provider
              </div>
            ) : (
              configuredProviders.map((provider) => (
                <button
                  key={provider.key}
                  onClick={() => onProviderChange(provider.key)}
                  className={cn(
                    "flex items-center justify-between w-full px-2 py-1.5 text-sm rounded-md transition-colors text-left",
                    providerId === provider.key
                      ? "bg-blue-500/20 text-blue-400 font-medium"
                      : "hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200",
                  )}
                >
                  {provider.label}
                  {providerId === provider.key && (
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                  )}
                </button>
              ))
            )}
          </div>

          {/* 右侧：模型列表 */}
          <div className="flex-1 p-2 flex flex-col overflow-hidden">
            <div className="text-xs font-semibold text-zinc-400 px-2 py-1 mb-1">
              Models
            </div>
            {compatibilityResult.incompatibleModels.length > 0 ? (
              <div className="px-2 pb-1 text-[11px] text-amber-400">
                已隐藏 {compatibilityResult.incompatibleModels.length}{" "}
                个当前登录态不兼容的模型
              </div>
            ) : null}
            <ScrollArea className="flex-1">
              <div className="space-y-0.5 p-1">
                {compatibilityResult.compatibleModels.length === 0 ? (
                  <div className="text-xs text-zinc-500 p-2">暂无可用模型</div>
                ) : (
                  compatibilityResult.compatibleModels.map((m) => (
                    <button
                      key={m}
                      onClick={() => {
                        onModelChange(m);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex items-center justify-between w-full px-2 py-1.5 text-sm rounded-md transition-colors text-left",
                        modelId === m
                          ? "bg-zinc-700 text-zinc-100"
                          : "hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200",
                      )}
                    >
                      <span className="truncate">{m}</span>
                      {modelId === m && (
                        <Check
                          size={14}
                          className="text-blue-400 flex-shrink-0"
                        />
                      )}
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
