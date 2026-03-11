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
import type { OpenClawLastSynced } from "./types";
import { OpenClawMark } from "./OpenClawMark";

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
  onGoProviderPool: () => void;
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
  onGoProviderPool,
}: OpenClawConfigurePageProps) {
  const hasProviders = compatibleProviders.length > 0;
  const gatewayStatusLabel = gatewayRunning ? "运行中" : gatewayStatus;
  const healthText = healthInfo
    ? `${healthInfo.status}${healthInfo.version ? ` · ${healthInfo.version}` : ""}`
    : "尚未执行健康检查";

  return (
    <div className="flex min-h-0 flex-col items-center px-6 py-10">
      <div className="w-full max-w-[760px] space-y-6">
        <div className="flex flex-col items-center text-center">
          <OpenClawMark size="lg" />
          <h1 className="mt-6 text-4xl font-semibold tracking-tight">
            OpenClaw
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
            安装已完成。现在只需要选择模型并启动 Gateway，就可以打开 Dashboard。
          </p>
        </div>

        <section className="rounded-2xl border bg-card px-5 py-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 flex-1">
              <div className="text-sm text-muted-foreground">
                OpenClaw 安装路径
              </div>
              <div className="mt-2 flex items-center gap-2 text-sm leading-6 text-foreground/90">
                <span className="break-all">
                  {installPath || "未检测到安装路径"}
                </span>
                <button
                  type="button"
                  onClick={onCopyPath}
                  className="inline-flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
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
              className="inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
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

        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-base font-semibold">当前状态</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                安装完成后默认建议先看状态页，再决定是否同步配置或启动 Gateway。
              </p>
            </div>

            <button
              type="button"
              onClick={onOpenRuntime}
              className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm hover:bg-muted"
            >
              <ShieldCheck className="h-4 w-4" />
              进入状态页
            </button>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border bg-background px-4 py-3 text-sm text-muted-foreground">
              <div className="text-xs">Gateway 状态</div>
              <div className="mt-2 text-foreground">
                {gatewayStatusLabel} · {gatewayPort}
              </div>
            </div>
            <div className="rounded-xl border bg-background px-4 py-3 text-sm text-muted-foreground">
              <div className="text-xs">健康检查</div>
              <div className="mt-2 text-foreground">{healthText}</div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-5 shadow-sm space-y-4">
          <div>
            <h2 className="text-base font-semibold">模型</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              选择服务商和模型，启动时会自动确保配置同步到独立副本。
            </p>
          </div>

          {!hasProviders ? (
            <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
              当前没有可用于 OpenClaw 的兼容 Provider。请先添加 API Key 类型的
              Provider。
              <div className="mt-3">
                <button
                  type="button"
                  onClick={onGoProviderPool}
                  className="text-primary hover:underline"
                >
                  前往凭证池
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <label className="block text-sm font-medium">
                Provider 服务商
                <select
                  value={selectedProviderKey}
                  onChange={(event) => onSelectProvider(event.target.value)}
                  className="mt-2 w-full rounded-xl border bg-background px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {providersLoading ? <option>加载中...</option> : null}
                  {compatibleProviders.map((provider) => (
                    <option key={provider.key} value={provider.key}>
                      {provider.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-medium">
                主模型
                <select
                  value={
                    providerModels.some((model) => model.id === selectedModelId)
                      ? selectedModelId
                      : ""
                  }
                  onChange={(event) => onSelectModel(event.target.value)}
                  className="mt-2 w-full rounded-xl border bg-background px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
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

              <label className="block text-sm font-medium">
                主模型 ID（可手动输入）
                <input
                  type="text"
                  value={selectedModelId}
                  onChange={(event) => onInputModel(event.target.value)}
                  placeholder="例如：gpt-4.1"
                  className="mt-2 w-full rounded-xl border bg-background px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>

              {modelsError ? (
                <div className="text-xs text-amber-600">
                  模型列表加载失败：{modelsError}。你仍可直接手动输入模型 ID。
                </div>
              ) : null}

              {lastSynced ? (
                <div className="rounded-xl border bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700">
                  最近一次已同步：{lastSynced.providerId} / {lastSynced.modelId}
                </div>
              ) : null}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-amber-300/40 bg-amber-500/5 p-5 shadow-sm">
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

        <div className="space-y-3">
          <button
            type="button"
            onClick={onStart}
            disabled={!canStart || starting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-base text-primary-foreground disabled:opacity-60"
          >
            {starting ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Play className="h-5 w-5" />
            )}
            启动
          </button>

          <div className="flex flex-wrap items-center justify-center gap-3 text-sm">
            <button
              type="button"
              onClick={onSync}
              disabled={!canSync || syncing}
              className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 hover:bg-muted disabled:opacity-60"
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
              onClick={onRefreshProviders}
              className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 hover:bg-muted"
            >
              <RefreshCw className="h-4 w-4" />
              刷新 Provider
            </button>
            <button
              type="button"
              onClick={onOpenDocs}
              className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 hover:bg-muted"
            >
              <ExternalLink className="h-4 w-4" />
              查看文档
            </button>
            {gatewayRunning ? (
              <button
                type="button"
                onClick={onOpenRuntime}
                className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 hover:bg-muted"
              >
                查看运行页
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default OpenClawConfigurePage;
