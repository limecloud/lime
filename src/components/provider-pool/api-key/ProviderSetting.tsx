/**
 * @file ProviderSetting 组件
 * @description Provider 设置面板组件，集成所有子组件，显示 Provider 头部信息和配置
 * @module components/provider-pool/api-key/ProviderSetting
 *
 * **Feature: provider-ui-refactor**
 * **Validates: Requirements 4.1, 6.3, 6.4**
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Trash2 } from "lucide-react";
import { ProviderIcon } from "@/icons/providers";
import { ApiKeyList } from "./ApiKeyList";
import {
  ProviderConfigForm,
  type ProviderConfigFormRef,
} from "./ProviderConfigForm";
import {
  ConnectionTestButton,
  ConnectionTestResult,
} from "./ConnectionTestButton";
import { ProviderModelList } from "./ProviderModelList";
import { getProviderTypeLabel } from "./ProviderConfigForm.utils";
import type {
  ChatTestResult,
  ProviderWithKeysDisplay,
  UpdateProviderRequest,
} from "@/lib/api/apiKeyProvider";

// ============================================================================
// 类型定义
// ============================================================================

export interface ProviderSettingProps {
  /** Provider 数据（包含 API Keys） */
  provider: ProviderWithKeysDisplay | null;
  /** 更新 Provider 配置回调 */
  onUpdate?: (id: string, request: UpdateProviderRequest) => Promise<void>;
  /** 添加 API Key 回调 */
  onAddApiKey?: (
    providerId: string,
    apiKey: string,
    alias?: string,
  ) => Promise<void>;
  /** 删除 API Key 回调 */
  onDeleteApiKey?: (keyId: string) => void;
  /** 切换 API Key 启用状态回调 */
  onToggleApiKey?: (keyId: string, enabled: boolean) => void;
  /** 测试连接回调 */
  onTestConnection?: (providerId: string) => Promise<ConnectionTestResult>;
  /** 对话测试回调 */
  onTestChat?: (providerId: string, prompt: string) => Promise<ChatTestResult>;
  /** 删除自定义 Provider 回调 */
  onDeleteProvider?: (providerId: string) => void;
  /** 是否正在加载 */
  loading?: boolean;
  /** 额外的 CSS 类名 */
  className?: string;
}

// ============================================================================
// 组件实现
// ============================================================================

/**
 * Provider 设置面板组件
 *
 * 显示选中 Provider 的完整配置界面，包括：
 * - Provider 头部信息（图标、名称、启用开关）
 * - API Key 列表
 * - Provider 配置表单
 * - 连接测试按钮
 *
 * @example
 * ```tsx
 * <ProviderSetting
 *   provider={selectedProvider}
 *   onUpdate={updateProvider}
 *   onAddApiKey={addApiKey}
 *   onDeleteApiKey={deleteApiKey}
 *   onToggleApiKey={toggleApiKey}
 *   onTestConnection={testConnection}
 * />
 * ```
 */
export const ProviderSetting: React.FC<ProviderSettingProps> = ({
  provider,
  onUpdate,
  onAddApiKey,
  onDeleteApiKey,
  onToggleApiKey,
  onTestConnection,
  onTestChat,
  onDeleteProvider,
  loading = false,
  className,
}) => {
  const providerConfigFormRef = useRef<ProviderConfigFormRef>(null);
  const [chatDialogOpen, setChatDialogOpen] = useState(false);
  const [chatPrompt, setChatPrompt] = useState("hello");
  const [chatTesting, setChatTesting] = useState(false);
  const [chatResult, setChatResult] = useState<ChatTestResult | null>(null);
  const [draftCustomModels, setDraftCustomModels] = useState<string[]>(
    provider?.custom_models ?? [],
  );
  const [recommendedLatestModelId, setRecommendedLatestModelId] = useState<
    string | null
  >(null);
  const enabledApiKeyCount =
    provider?.api_keys?.filter((apiKey) => apiKey.enabled).length ?? 0;
  const defaultModel = draftCustomModels[0] ?? recommendedLatestModelId ?? null;

  useEffect(() => {
    setDraftCustomModels(provider?.custom_models ?? []);
    setRecommendedLatestModelId(null);
  }, [provider?.id, provider?.custom_models]);

  const handleModelsChange = useCallback((models: string[]) => {
    setDraftCustomModels(models);
  }, []);

  const handleRecommendedLatestModelChange = useCallback(
    (modelId: string | null) => {
      setRecommendedLatestModelId(modelId);
    },
    [],
  );

  const handleSelectDefaultModel = useCallback((modelId: string) => {
    providerConfigFormRef.current?.setDefaultModel(modelId);
  }, []);

  useEffect(() => {
    if (draftCustomModels.length > 0 || !recommendedLatestModelId) {
      return;
    }

    providerConfigFormRef.current?.setDefaultModel(recommendedLatestModelId);
  }, [draftCustomModels.length, recommendedLatestModelId]);

  const handleChatTest = async () => {
    if (!onTestChat || chatTesting || !provider) return;
    setChatTesting(true);
    setChatResult(null);
    try {
      const res = await onTestChat(provider.id, chatPrompt);
      setChatResult(res);
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "string"
            ? e
            : JSON.stringify(e);
      setChatResult({
        success: false,
        error: msg || "对话测试失败",
      });
    } finally {
      setChatTesting(false);
    }
  };

  // 空状态
  if (!provider) {
    return (
      <div
        className={cn(
          "flex h-full items-center justify-center bg-[linear-gradient(180deg,rgba(248,250,252,0.78),rgba(241,245,249,0.42))] px-6",
          className,
        )}
        data-testid="provider-setting-empty"
      >
        <div className="w-full max-w-xl rounded-[28px] border border-emerald-200/70 bg-[linear-gradient(135deg,rgba(244,251,248,0.98)_0%,rgba(248,250,252,0.98)_48%,rgba(241,246,255,0.96)_100%)] p-8 text-center shadow-sm shadow-slate-950/5">
          <p className="text-base font-semibold text-foreground">
            请从左侧列表选择一个 Provider
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            选择后可在此处集中管理 API Key、模型、连接测试与支持模型信息。
          </p>
        </div>
      </div>
    );
  }

  const providerHostLabel = (() => {
    try {
      const url = new URL(provider.api_host);
      return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
    } catch {
      return provider.api_host;
    }
  })();

  const summaryItems = [
    {
      label: "可用密钥",
      value: `${enabledApiKeyCount}`,
      hint: `共 ${provider.api_keys?.length ?? 0} 个 API Key`,
      compact: false,
    },
    {
      label: "默认模型",
      value: defaultModel ?? "未设置",
      hint: defaultModel
        ? "第一个模型用于默认请求与测试"
        : "可在下方配置中指定",
      compact: true,
    },
    {
      label: "协议类型",
      value: getProviderTypeLabel(provider.type),
      hint: `${provider.type} · ${provider.is_system ? "系统预设 Provider" : "自定义 Provider"}`,
      compact: true,
    },
    {
      label: "接口地址",
      value: providerHostLabel,
      hint: provider.api_host,
      compact: true,
    },
  ];

  // 处理启用/禁用切换
  const handleToggleEnabled = async (enabled: boolean) => {
    if (onUpdate) {
      await onUpdate(provider.id, { enabled });
    }
  };

  return (
    <div
      className={cn("flex h-full flex-col", className)}
      data-testid="provider-setting"
      data-provider-id={provider.id}
    >
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-5 lg:p-6">
          {/* Provider 头部 */}
          <section
            className="relative overflow-hidden rounded-[28px] border border-emerald-200/70 bg-[linear-gradient(135deg,rgba(244,251,248,0.98)_0%,rgba(248,250,252,0.98)_45%,rgba(241,246,255,0.96)_100%)] p-5 shadow-sm shadow-slate-950/5"
            data-testid="provider-header"
          >
            <div className="pointer-events-none absolute -left-16 top-[-64px] h-48 w-48 rounded-full bg-emerald-200/30 blur-3xl" />
            <div className="pointer-events-none absolute right-[-52px] top-[-24px] h-48 w-48 rounded-full bg-sky-200/25 blur-3xl" />
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 items-start gap-4">
                <ProviderIcon
                  providerType={provider.id}
                  fallbackText={provider.name}
                  size={44}
                  className="flex-shrink-0"
                  data-testid="provider-icon"
                />

                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3
                      className="min-w-0 truncate text-2xl font-semibold text-foreground"
                      data-testid="provider-name"
                    >
                      {provider.name}
                    </h3>
                    <Badge variant="outline">
                      {provider.is_system ? "系统预设" : "自定义 Provider"}
                    </Badge>
                    <Badge variant={provider.enabled ? "secondary" : "outline"}>
                      {provider.enabled ? "已启用" : "已禁用"}
                    </Badge>
                  </div>
                  <p
                    className="text-sm text-muted-foreground"
                    data-testid="provider-type"
                  >
                    类型: {getProviderTypeLabel(provider.type)}
                  </p>
                  <p className="break-all text-sm text-muted-foreground">
                    {provider.api_host}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex items-center gap-3 rounded-xl border border-border/70 bg-muted/30 px-3 py-2">
                  <span className="text-sm text-muted-foreground">
                    {provider.enabled ? "已启用" : "已禁用"}
                  </span>
                  <Switch
                    checked={provider.enabled}
                    onCheckedChange={handleToggleEnabled}
                    disabled={loading}
                    data-testid="provider-enabled-switch"
                  />
                </div>

                {!provider.is_system && onDeleteProvider && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onDeleteProvider(provider.id)}
                    disabled={loading}
                    className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                    title="删除此 Provider"
                    data-testid="delete-provider-button"
                  >
                    <Trash2 className="mr-1.5 h-4 w-4" />
                    删除
                  </Button>
                )}
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {summaryItems.map((item) => (
                <div
                  key={item.label}
                  className="rounded-[22px] border border-white/90 bg-white/85 p-4 shadow-sm shadow-slate-950/5"
                >
                  <p className="text-[11px] font-medium text-slate-500">
                    {item.label}
                  </p>
                  <p
                    className={cn(
                      "mt-2 font-semibold text-slate-900",
                      item.compact
                        ? "break-all text-sm leading-5"
                        : "text-2xl leading-none",
                    )}
                  >
                    {item.value}
                  </p>
                  <p className="mt-2 line-clamp-2 text-xs text-slate-500">
                    {item.hint}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
            <div className="space-y-6">
              <section
                className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm"
                data-testid="api-key-section"
              >
                <div className="mb-4 space-y-1">
                  <h4 className="text-sm font-semibold text-foreground">
                    访问凭证
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    管理当前 Provider 的 API Key、别名与启用状态。
                  </p>
                </div>
                <ApiKeyList
                  key={`${provider.id}-${provider.api_keys?.length || 0}`}
                  apiKeys={provider.api_keys || []}
                  providerId={provider.id}
                  onAdd={onAddApiKey}
                  onToggle={onToggleApiKey}
                  onDelete={onDeleteApiKey}
                  loading={loading}
                />
              </section>

              <section
                className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm"
                data-testid="config-section"
              >
                <div className="mb-4 space-y-1">
                  <h4 className="text-sm font-semibold text-foreground">
                    请求配置
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    配置 API Host、协议类型与默认模型，表单会自动保存。
                  </p>
                </div>
                <ProviderConfigForm
                  ref={providerConfigFormRef}
                  provider={provider}
                  onUpdate={onUpdate}
                  onModelsChange={handleModelsChange}
                  onRecommendedLatestModelChange={
                    handleRecommendedLatestModelChange
                  }
                  loading={loading}
                />
              </section>
            </div>

            <div className="space-y-6">
              <section
                className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm"
                data-testid="connection-test-section"
              >
                <div className="mb-4 space-y-1">
                  <h4 className="text-sm font-semibold text-foreground">
                    连接测试
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    使用当前默认模型检查连接、鉴权与基础对话可用性。
                  </p>
                </div>

                <div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground">
                  当前默认模型：
                  <span className="ml-1 font-medium text-foreground">
                    {defaultModel ?? "未设置"}
                  </span>
                </div>

                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <ConnectionTestButton
                    providerId={provider.id}
                    onTest={onTestConnection}
                    disabled={
                      loading ||
                      !provider.enabled ||
                      (provider.api_keys?.length ?? 0) === 0
                    }
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="sm:self-start"
                    disabled={
                      loading ||
                      !provider.enabled ||
                      (provider.api_keys?.length ?? 0) === 0 ||
                      !onTestChat
                    }
                    onClick={() => setChatDialogOpen(true)}
                  >
                    对话测试
                  </Button>
                </div>
                {(provider.api_keys?.length ?? 0) === 0 && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    请先添加 API Key 后再进行连接测试。
                  </p>
                )}
              </section>

              <section
                className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm"
                data-testid="supported-models-section"
              >
                <div className="mb-4 space-y-1">
                  <h4 className="text-sm font-semibold text-foreground">
                    模型能力
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    展示当前 Provider 支持的模型，并支持从 API 主动刷新。
                  </p>
                </div>
                <ProviderModelList
                  providerId={provider.id}
                  providerType={provider.type}
                  selectedModelId={draftCustomModels[0] ?? null}
                  latestModelId={recommendedLatestModelId}
                  onSelectModel={handleSelectDefaultModel}
                  onLatestModelResolved={handleRecommendedLatestModelChange}
                  hasApiKey={enabledApiKeyCount > 0}
                />
              </section>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={chatDialogOpen} onOpenChange={setChatDialogOpen}>
        <DialogContent className="sm:max-w-[700px] p-6">
          <DialogHeader className="mb-4">
            <DialogTitle>对话测试</DialogTitle>
            <DialogDescription>
              发送一条最小对话请求，直接查看返回内容或原始错误，便于排查模型、权限或路由问题。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Textarea
              value={chatPrompt}
              onChange={(e) => setChatPrompt(e.target.value)}
              className="h-[120px]"
            />
            {chatResult?.error && (
              <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-600">
                <p className="font-medium">错误详情：</p>
                <p className="mt-1 break-all">{chatResult.error}</p>
              </div>
            )}
            {chatResult?.success && (
              <div className="rounded-md border border-green-200 bg-green-50 p-2 text-xs text-green-700">
                <p className="font-medium">
                  返回内容
                  {chatResult.latency_ms !== undefined
                    ? ` (${chatResult.latency_ms}ms)`
                    : ""}
                  ：
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words">
                  {chatResult.content || ""}
                </p>
              </div>
            )}
            {chatResult?.raw && (
              <Textarea
                value={chatResult.raw}
                readOnly
                className="h-[180px] font-mono text-xs"
              />
            )}
          </div>

          <DialogFooter className="mt-4">
            <Button
              variant="outline"
              onClick={() => setChatDialogOpen(false)}
              disabled={chatTesting}
            >
              关闭
            </Button>
            <Button
              onClick={handleChatTest}
              disabled={chatTesting || !chatPrompt.trim()}
            >
              {chatTesting ? "发送中..." : "发送"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ============================================================================
// 辅助函数（用于测试）
// ============================================================================

/**
 * 从 Provider 数据中提取设置面板显示所需的信息
 * 用于属性测试验证设置面板字段完整性
 */
export function extractProviderSettingInfo(
  provider: ProviderWithKeysDisplay | null,
): {
  hasProvider: boolean;
  hasIcon: boolean;
  hasName: boolean;
  hasEnabledSwitch: boolean;
  hasApiKeySection: boolean;
  hasConfigSection: boolean;
  hasConnectionTest: boolean;
} {
  if (!provider) {
    return {
      hasProvider: false,
      hasIcon: false,
      hasName: false,
      hasEnabledSwitch: false,
      hasApiKeySection: false,
      hasConfigSection: false,
      hasConnectionTest: false,
    };
  }

  return {
    hasProvider: true,
    hasIcon: typeof provider.id === "string" && provider.id.length > 0,
    hasName: typeof provider.name === "string" && provider.name.length > 0,
    hasEnabledSwitch: typeof provider.enabled === "boolean",
    hasApiKeySection: true,
    hasConfigSection: true,
    hasConnectionTest: true,
  };
}

export default ProviderSetting;
