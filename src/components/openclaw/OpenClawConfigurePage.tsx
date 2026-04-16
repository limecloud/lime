import {
  AlertTriangle,
  Copy,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type { EnhancedModelMetadata } from "@/lib/types/modelRegistry";
import type { ConfiguredProvider } from "@/hooks/useConfiguredProviders";
import type {
  OpenClawGatewayStatus,
  OpenClawHealthInfo,
} from "@/lib/api/openclaw";
import { cn } from "@/lib/utils";
import type { OpenClawLastSynced } from "./types";
import { compactPathLabel } from "./pathDisplay";
import {
  openClawDangerButtonClassName,
  openClawInputClassName,
  openClawPanelClassName,
  openClawPrimaryButtonClassName,
  openClawSecondaryButtonClassName,
  openClawSubPanelClassName,
} from "./openclawStyles";

interface OpenClawConfigurePageProps {
  installPath?: string | null;
  uninstalling: boolean;
  syncing: boolean;
  starting: boolean;
  canSync: boolean;
  canStart: boolean;
  providersLoading: boolean;
  modelsLoading: boolean;
  modelsError: string | null;
  selectedProviderKey: string;
  selectedModelId: string;
  compatibleProviders: ConfiguredProvider[];
  providerModels: EnhancedModelMetadata[];
  lastSynced: OpenClawLastSynced | null;
  gatewayStatus: OpenClawGatewayStatus;
  gatewayPort: number;
  healthInfo: OpenClawHealthInfo | null;
  gatewayRunning: boolean;
  onCopyPath: () => void;
  onUninstall: () => void;
  onOpenDocs: () => void;
  onSelectProvider: (providerId: string) => void;
  onSelectModel: (modelId: string) => void;
  onInputModel: (modelId: string) => void;
  onRefreshProviders: () => void;
  onSync: () => void;
  onStart: () => void;
  onOpenRuntime: () => void;
  onGoProviderSettings: () => void;
}

export function OpenClawConfigurePage({
  installPath,
  uninstalling,
  syncing,
  starting,
  canSync,
  canStart,
  providersLoading,
  modelsLoading,
  modelsError,
  selectedProviderKey,
  selectedModelId,
  compatibleProviders,
  providerModels,
  lastSynced,
  gatewayStatus,
  gatewayPort,
  healthInfo,
  gatewayRunning,
  onCopyPath,
  onUninstall,
  onOpenDocs,
  onSelectProvider,
  onSelectModel,
  onInputModel,
  onRefreshProviders,
  onSync,
  onStart,
  onOpenRuntime,
  onGoProviderSettings,
}: OpenClawConfigurePageProps) {
  const hasProviders = compatibleProviders.length > 0;
  const gatewayStatusLabel = gatewayRunning ? "运行中" : gatewayStatus;
  const healthText = healthInfo
    ? `${healthInfo.status}${healthInfo.version ? ` · ${healthInfo.version}` : ""}`
    : "尚未执行健康检查";
  const installPathLabel = installPath
    ? compactPathLabel(installPath, 76)
    : "未检测到安装路径";

  return (
    <div className="space-y-4">
      <section className={openClawPanelClassName}>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold tracking-[0.14em] text-emerald-700">
              MODEL SYNC
            </div>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
              配置模型并准备启动
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              安装已经完成。现在只需要选择服务商和模型，同步独立副本配置后就可以启动
              Gateway。
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {hasProviders
                  ? `${compatibleProviders.length} 个兼容 Provider`
                  : "尚无兼容 Provider"}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                Gateway {gatewayStatusLabel}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {lastSynced
                  ? `最近同步 ${lastSynced.modelId}`
                  : "尚未同步模型配置"}
              </span>
            </div>
          </div>

          <div className="flex w-full flex-wrap gap-3 xl:max-w-[440px] xl:justify-end">
            <button
              type="button"
              onClick={onStart}
              disabled={!canStart || starting}
              className={cn(
                openClawPrimaryButtonClassName,
                "min-w-[200px] px-5 py-2.5",
              )}
            >
              {starting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              启动
            </button>
            <button
              type="button"
              onClick={onSync}
              disabled={!canSync || syncing}
              className={cn(
                openClawSecondaryButtonClassName,
                "min-w-[140px] px-5 py-2.5",
              )}
            >
              {syncing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              同步配置
            </button>
            <button
              type="button"
              onClick={onOpenRuntime}
              className={cn(
                openClawSecondaryButtonClassName,
                "min-w-[140px] px-5 py-2.5",
              )}
            >
              <ShieldCheck className="h-4 w-4" />
              进入状态页
            </button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.95fr)]">
        <div className="space-y-4">
          <section className={openClawPanelClassName}>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-900">
                  OpenClaw 安装路径
                </div>
                <div className="mt-2 flex items-center gap-2 text-sm leading-6 text-slate-600">
                  <span
                    className="min-w-0 flex-1 truncate"
                    title={installPath || undefined}
                  >
                    {installPathLabel}
                  </span>
                  <button
                    type="button"
                    onClick={onCopyPath}
                    className="inline-flex shrink-0 items-center justify-center rounded-lg p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                    aria-label="复制安装路径"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={onUninstall}
                disabled={uninstalling}
                className={cn(
                  openClawDangerButtonClassName,
                  "shrink-0 px-4 py-2.5",
                )}
              >
                {uninstalling ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                卸载
              </button>
            </div>
          </section>

          <section className={openClawPanelClassName}>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                模型配置
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                选择服务商和主模型，启动时会自动确保配置同步到独立副本。
              </p>
            </div>

            {!hasProviders ? (
              <div className="mt-4 rounded-[22px] border border-dashed border-slate-300 bg-slate-50/80 px-4 py-6 text-sm leading-6 text-slate-500">
                当前没有可用于 OpenClaw 的兼容 Provider。请先添加 API Key 类型的
                Provider。
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={onGoProviderSettings}
                    className="font-medium text-slate-900 underline-offset-4 hover:underline"
                  >
                    前往凭证管理
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <label className="block text-sm font-medium text-slate-800">
                  Provider 服务商
                  <select
                    value={selectedProviderKey}
                    onChange={(event) => onSelectProvider(event.target.value)}
                    className={openClawInputClassName}
                  >
                    {providersLoading ? <option>加载中...</option> : null}
                    {compatibleProviders.map((provider) => (
                      <option key={provider.key} value={provider.key}>
                        {provider.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-sm font-medium text-slate-800">
                  主模型
                  <select
                    value={
                      providerModels.some(
                        (model) => model.id === selectedModelId,
                      )
                        ? selectedModelId
                        : ""
                    }
                    onChange={(event) => onSelectModel(event.target.value)}
                    className={openClawInputClassName}
                    disabled={modelsLoading || providerModels.length === 0}
                  >
                    <option value="">
                      {modelsLoading ? "模型加载中..." : "请选择模型"}
                    </option>
                    {providerModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.display_name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-sm font-medium text-slate-800">
                  主模型 ID（可手动输入）
                  <input
                    type="text"
                    value={selectedModelId}
                    onChange={(event) => onInputModel(event.target.value)}
                    placeholder="例如：gpt-4.1"
                    className={openClawInputClassName}
                  />
                </label>

                {modelsError ? (
                  <div className="rounded-2xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-900">
                    模型列表加载失败：{modelsError}。你仍可直接手动输入模型 ID。
                  </div>
                ) : null}

                {lastSynced ? (
                  <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    最近一次已同步：{lastSynced.providerId} /{" "}
                    {lastSynced.modelId}
                  </div>
                ) : null}
              </div>
            )}
          </section>
        </div>

        <div className="space-y-4">
          <section className={openClawPanelClassName}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  当前状态
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  安装完成后建议先查看 Gateway
                  状态，再决定是否同步配置或直接启动。
                </p>
              </div>
              <button
                type="button"
                onClick={onRefreshProviders}
                className={cn(
                  openClawSecondaryButtonClassName,
                  "px-3 py-2 text-xs",
                )}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                刷新 Provider
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              <div className={openClawSubPanelClassName}>
                <div className="text-xs font-medium text-slate-500">
                  Gateway 状态
                </div>
                <div className="mt-2 text-sm font-medium text-slate-900">
                  {gatewayStatusLabel} · {gatewayPort}
                </div>
              </div>
              <div className={openClawSubPanelClassName}>
                <div className="text-xs font-medium text-slate-500">
                  健康检查
                </div>
                <div className="mt-2 text-sm font-medium text-slate-900">
                  {healthText}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-[26px] border border-amber-300/70 bg-amber-50/90 p-5 shadow-sm shadow-slate-950/5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div className="text-sm leading-7 text-amber-900/80">
                <div className="font-medium text-amber-800">温馨提示</div>
                <p className="mt-2">
                  OpenClaw
                  具备较高系统权限，建议仅在可信环境中使用。点击启动后会优先同步当前
                  Provider 与模型配置。
                </p>
              </div>
            </div>
          </section>

          <section className={openClawPanelClassName}>
            <div className="text-sm font-medium text-slate-900">辅助动作</div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={onOpenDocs}
                className={cn(openClawSecondaryButtonClassName, "px-4 py-2.5")}
              >
                <ExternalLink className="h-4 w-4" />
                查看文档
              </button>
              {gatewayRunning ? (
                <button
                  type="button"
                  onClick={onOpenRuntime}
                  className={cn(
                    openClawSecondaryButtonClassName,
                    "px-4 py-2.5",
                  )}
                >
                  <ShieldCheck className="h-4 w-4" />
                  查看运行页
                </button>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
