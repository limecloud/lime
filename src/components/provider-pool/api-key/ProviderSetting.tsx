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
import { Bot, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
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
import { getProviderModelAutoFetchCapability } from "@/lib/model/providerModelFetchSupport";
import { getProviderPromptCacheMode } from "@/lib/model/providerPromptCacheSupport";
import { SectionInfoButton } from "./SectionInfoButton";
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
          "flex h-full items-center justify-center bg-slate-50/60 px-6",
          className,
        )}
        data-testid="provider-setting-empty"
      >
        <div className="w-full max-w-2xl rounded-[28px] border border-slate-200/80 bg-white p-8 shadow-sm shadow-slate-950/5">
          <div className="flex items-center gap-3 text-slate-900">
            <Sparkles className="h-5 w-5" />
            <p className="text-lg font-semibold">服务商配置工作台</p>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            选择一个服务商后，这里只保留模型、密钥和必要配置，不再铺满整页说明。
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
  const modelAutoFetchCapability = getProviderModelAutoFetchCapability({
    providerId: provider.id,
    providerType: provider.type,
    apiHost: provider.api_host,
  });
  const requiresLiveModelTruth = modelAutoFetchCapability.supported;
  const hasRequiredApiAccess =
    !modelAutoFetchCapability.requiresApiKey || enabledApiKeyCount > 0;
  const hasResolvedLiveModelDirectory =
    !requiresLiveModelTruth || Boolean(recommendedLatestModelId);
  const showVerifiedModelState =
    !requiresLiveModelTruth || hasResolvedLiveModelDirectory;
  const defaultModel = showVerifiedModelState
    ? (draftCustomModels[0] ?? recommendedLatestModelId ?? null)
    : null;
  const connectionReady =
    provider.enabled && hasRequiredApiAccess && hasResolvedLiveModelDirectory;
  const connectionBlockHint = !provider.enabled
    ? "请先启用当前 Provider，再进行连通性验证。"
    : !hasRequiredApiAccess
      ? "先添加并启用至少一把 API Key，再进行连通性验证。"
      : !hasResolvedLiveModelDirectory
        ? "先读取真实模型目录，再进行连接测试与默认模型验证。"
        : null;
  const modelStatusNotice = !hasRequiredApiAccess
    ? "先添加并启用 API Key，才能读取真实模型目录。"
    : !hasResolvedLiveModelDirectory
      ? "读取真实模型目录前，不展示旧模型，避免把历史缓存误认为当前可用模型。"
      : null;
  const showExplicitPromptCacheBadge =
    getProviderPromptCacheMode(
      provider.type,
      provider.prompt_cache_mode,
      provider.api_host,
    ) === "explicit_only";

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
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 p-4 lg:p-6">
          <section
            className="rounded-[26px] border border-slate-200/80 bg-white px-5 py-5 shadow-sm shadow-slate-950/5"
            data-testid="provider-header"
          >
            <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex min-w-0 items-center gap-4">
                <ProviderIcon
                  providerType={provider.id}
                  fallbackText={provider.name}
                  size={52}
                  className="flex-shrink-0"
                  data-testid="provider-icon"
                />

                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3
                      className="min-w-0 truncate text-2xl font-semibold tracking-tight text-slate-900"
                      data-testid="provider-name"
                    >
                      {provider.name}
                    </h3>
                    <Badge
                      variant="outline"
                      className="border-slate-200 bg-slate-50 text-slate-600"
                    >
                      {provider.is_system ? "系统预设" : "自定义 Provider"}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={cn(
                        "border",
                        provider.enabled
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-slate-50 text-slate-500",
                      )}
                    >
                      {provider.enabled ? "运行中" : "已停用"}
                    </Badge>
                    {showExplicitPromptCacheBadge ? (
                      <Badge
                        variant="outline"
                        className="border-amber-200 bg-amber-50 text-amber-700"
                        data-testid="provider-prompt-cache-badge"
                      >
                        显式缓存
                      </Badge>
                    ) : null}
                  </div>
                  <div
                    className="flex flex-wrap items-center gap-2 text-sm text-slate-500"
                    data-testid="provider-type"
                  >
                    <span>{getProviderTypeLabel(provider.type)}</span>
                    <span className="text-slate-300">/</span>
                    <span className="break-all">{providerHostLabel}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Badge
                  variant="outline"
                  className="border-slate-200 bg-slate-50 text-slate-600"
                >
                  密钥 {enabledApiKeyCount}
                </Badge>
                <Badge
                  variant="outline"
                  className="max-w-[240px] truncate border-slate-200 bg-slate-50 text-slate-600"
                >
                  默认
                  {defaultModel ??
                    (requiresLiveModelTruth ? "模型待同步" : "未设置")}
                </Badge>
                <div className="inline-flex items-center gap-3 rounded-full border border-slate-200 bg-slate-50 px-4 py-2">
                  <span className="text-sm text-slate-600">
                    {provider.enabled ? "已启用" : "已停用"}
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
                    className="border-red-200 bg-white text-red-600 hover:bg-red-50 hover:text-red-700"
                    title="删除此 Provider"
                    data-testid="delete-provider-button"
                  >
                    <Trash2 className="mr-1.5 h-4 w-4" />
                    删除 Provider
                  </Button>
                )}
              </div>
            </div>
          </section>

          <div
            className="grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,340px)]"
            data-testid="provider-setting-workbench-grid"
          >
            <section
              className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5"
              data-testid="supported-models-section"
            >
              <div
                className="mb-4 flex flex-wrap items-start justify-between gap-3"
                data-testid="supported-models-header"
              >
                <div className="flex min-w-0 items-center gap-2 text-slate-900">
                  <Bot className="h-4 w-4" />
                  <h4 className="text-base font-semibold">模型设置</h4>
                  <SectionInfoButton
                    label="查看模型设置说明"
                    triggerTestId="provider-models-info-button"
                  >
                    <p>
                      模型区只展示当前真实可用的目录。支持自动拉取的渠道会优先读取最新模型；读取失败前不会继续展示旧模型。
                    </p>
                  </SectionInfoButton>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge
                    variant="outline"
                    className="border-slate-200 bg-slate-50 text-slate-600"
                  >
                    默认：
                    {defaultModel ??
                      (requiresLiveModelTruth ? "待读取" : "未设置")}
                  </Badge>
                  {showVerifiedModelState && recommendedLatestModelId ? (
                    <Badge
                      variant="outline"
                      className="border-sky-200 bg-sky-50 text-sky-700"
                    >
                      推荐最新：{recommendedLatestModelId}
                    </Badge>
                  ) : null}
                </div>
              </div>

              {modelStatusNotice ? (
                <div className="mb-4 rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  {modelStatusNotice}
                </div>
              ) : null}

              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
                <ProviderModelList
                  providerId={provider.id}
                  providerType={provider.type}
                  selectedModelId={draftCustomModels[0] ?? null}
                  latestModelId={recommendedLatestModelId}
                  onSelectModel={handleSelectDefaultModel}
                  onLatestModelResolved={handleRecommendedLatestModelChange}
                  hasApiKey={enabledApiKeyCount > 0}
                  apiHost={provider.api_host}
                />
              </div>
            </section>

            <div className="space-y-5">
              <section data-testid="api-key-section">
                <ApiKeyList
                  key={`${provider.id}-${provider.api_keys?.length || 0}`}
                  apiKeys={provider.api_keys || []}
                  providerId={provider.id}
                  providerName={provider.name}
                  apiHost={provider.api_host}
                  onAdd={onAddApiKey}
                  onToggle={onToggleApiKey}
                  onDelete={onDeleteApiKey}
                  loading={loading}
                />
              </section>

              <section data-testid="config-section">
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

              <section
                className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-950/5"
                data-testid="connection-test-section"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-slate-900">
                    <ShieldCheck className="h-4 w-4" />
                    <h4 className="text-base font-semibold">连接验证</h4>
                    <SectionInfoButton
                      label="查看连接验证说明"
                      triggerTestId="provider-connection-info-button"
                    >
                      <p>
                        连接验证会用当前默认模型检查鉴权、路由和最小对话是否可用。未启用
                        Provider、缺少可用 Key
                        或模型目录尚未同步时不会放行测试。
                      </p>
                    </SectionInfoButton>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "border",
                      connectionReady
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 bg-slate-50 text-slate-500",
                    )}
                  >
                    {connectionReady ? "可测试" : "待就绪"}
                  </Badge>
                </div>

                <div className="mt-4 rounded-[18px] border border-slate-200/80 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  默认模型：
                  <span className="ml-1 font-semibold text-slate-900">
                    {defaultModel ??
                      (requiresLiveModelTruth ? "待读取真实目录" : "未设置")}
                  </span>
                </div>

                <div className="mt-4 flex flex-col gap-3">
                  <ConnectionTestButton
                    providerId={provider.id}
                    onTest={onTestConnection}
                    disabled={loading || !connectionReady}
                    className="w-full"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-slate-200 bg-white"
                    disabled={loading || !connectionReady || !onTestChat}
                    onClick={() => setChatDialogOpen(true)}
                  >
                    对话测试
                  </Button>
                </div>

                {connectionBlockHint ? (
                  <p className="mt-3 text-xs text-slate-500">
                    {connectionBlockHint}
                  </p>
                ) : null}
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
