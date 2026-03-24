import { useEffect, useMemo } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Database,
  ExternalLink,
  KeyRound,
  Layers3,
  LoaderCircle,
  LogIn,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { ProviderPoolPage } from "@/components/provider-pool";
import {
  formatOemCloudAccessModeLabel,
  formatOemCloudConfigModeLabel,
  formatOemCloudDateTime,
  formatOemCloudModelsSourceLabel,
  formatOemCloudOfferStateLabel,
  useOemCloudAccess,
} from "@/hooks/useOemCloudAccess";
import { cn } from "@/lib/utils";

const SURFACE_CLASS_NAME =
  "rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5";

function SessionValueCard(props: {
  label: string;
  value: string;
  hint: string;
  icon?: JSX.Element;
}) {
  return (
    <div className="rounded-[22px] border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-950/5">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
        {props.icon ? <span className="text-slate-400">{props.icon}</span> : null}
        <span>{props.label}</span>
      </div>
      <p className="mt-2 break-all text-sm font-semibold text-slate-900">
        {props.value}
      </p>
      <p className="mt-2 text-xs leading-5 text-slate-500">{props.hint}</p>
    </div>
  );
}

function NoticeBar(props: {
  tone: "error" | "success";
  message: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-[20px] border px-4 py-3 text-sm shadow-sm shadow-slate-950/5",
        props.tone === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-rose-200 bg-rose-50 text-rose-700",
      )}
    >
      {props.tone === "success" ? (
        <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
      ) : (
        <AlertCircle className="h-4 w-4 flex-shrink-0" />
      )}
      <span>{props.message}</span>
    </div>
  );
}

function InfoPill(props: { label: string; tone?: "slate" | "emerald" | "amber" }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2.5 py-1 text-xs font-medium",
        props.tone === "emerald"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : props.tone === "amber"
            ? "border-amber-200 bg-amber-50 text-amber-700"
            : "border-slate-200 bg-slate-50 text-slate-600",
      )}
    >
      {props.label}
    </span>
  );
}

function resolveOfferTone(
  state: string,
): "slate" | "emerald" | "amber" {
  switch (state) {
    case "available_ready":
      return "emerald";
    case "available_quota_low":
    case "available_subscribe_required":
      return "amber";
    default:
      return "slate";
  }
}

export interface CloudProviderSettingsProps {
  onOpenProfile?: () => void;
}

export function CloudProviderSettings(props: CloudProviderSettingsProps) {
  const {
    runtime,
    configuredTarget,
    hubProviderName,
    session,
    offers,
    preference,
    selectedOffer,
    selectedModels,
    defaultCloudOffer,
    activeCloudOffer,
    initializing,
    refreshing,
    loadingDetail,
    savingDefault,
    errorMessage,
    infoMessage,
    defaultProviderSummary,
    defaultProviderSourceLabel,
    activeAccessModeLabel,
    activeConfigModeLabel,
    activeModelsSourceLabel,
    activeDeveloperAccessEnabled,
    activeDeveloperAccessLabel,
    handleRefresh,
    openOfferDetail,
    handleSetDefault,
    openUserCenter,
  } = useOemCloudAccess();

  useEffect(() => {
    if (!session || selectedOffer || loadingDetail || offers.length === 0) {
      return;
    }

    const initialOffer = defaultCloudOffer ?? offers[0];
    if (initialOffer) {
      void openOfferDetail(initialOffer.providerKey);
    }
  }, [
    defaultCloudOffer,
    loadingDetail,
    offers,
    openOfferDetail,
    selectedOffer,
    session,
  ]);

  const selectedOfferKey = selectedOffer?.providerKey ?? defaultCloudOffer?.providerKey;

  const localProviderHint = useMemo(() => {
    if (!activeCloudOffer) {
      return "这里管理你自带的 API Key、第三方平台和本地模型。云端入口已经单独收口，不再和本地 Provider 混在一起。";
    }

    if (activeDeveloperAccessEnabled) {
      return "当前云端服务已开放开发者入口。你可以继续在这里管理自带 API Key 或第三方 Provider，作为云端服务之外的补充能力。";
    }

    return "当前云端服务未开放开发者 API Key 模式，这不会影响你在这里管理其它第三方 Provider 或本地模型。";
  }, [activeCloudOffer, activeDeveloperAccessEnabled]);

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[30px] border border-emerald-200/70 bg-[linear-gradient(135deg,rgba(245,250,248,0.98)_0%,rgba(255,255,255,0.98)_56%,rgba(242,247,255,0.96)_100%)] shadow-sm shadow-slate-950/5">
        <div className="pointer-events-none absolute -left-20 top-[-72px] h-52 w-52 rounded-full bg-emerald-200/25 blur-3xl" />
        <div className="pointer-events-none absolute right-[-68px] top-[-24px] h-52 w-52 rounded-full bg-sky-200/30 blur-3xl" />

        <div className="relative flex flex-col gap-6 p-6 lg:p-7">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl space-y-3">
              <span className="inline-flex items-center rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-semibold tracking-[0.16em] text-emerald-700 shadow-sm">
                CLOUD ACCESS
              </span>
              <div className="space-y-2">
                <h2 className="text-3xl font-semibold tracking-tight text-slate-900">
                  {hubProviderName} 云端接入
                </h2>
                <p className="max-w-2xl text-sm leading-6 text-slate-600">
                  这里展示云端会话、默认来源、套餐状态和模型目录；下方的 Provider 面板只负责本地 / 第三方开发者配置，避免把云端消费态和 API Key 管理混在一起。
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[640px] xl:grid-cols-3">
              <SessionValueCard
                label="用户中心"
                value={configuredTarget?.baseUrl || "未配置"}
                hint="控制面、登录页和账户资料入口"
                icon={<Cloud className="h-3.5 w-3.5" />}
              />
              <SessionValueCard
                label="Gateway"
                value={runtime?.gatewayBaseUrl || "未配置"}
                hint="云端 OpenAI 兼容调用入口"
                icon={<ExternalLink className="h-3.5 w-3.5" />}
              />
              <SessionValueCard
                label="默认来源"
                value={defaultProviderSummary || "未设定"}
                hint={`当前来源类型：${defaultProviderSourceLabel}`}
                icon={<Layers3 className="h-3.5 w-3.5" />}
              />
              <SessionValueCard
                label="接入模式"
                value={activeAccessModeLabel}
                hint="由服务端最终态决定，不由客户端猜测"
                icon={<ShieldCheck className="h-3.5 w-3.5" />}
              />
              <SessionValueCard
                label="配置模式"
                value={activeConfigModeLabel}
                hint="区分托管、混合和开发者治理形态"
                icon={<Database className="h-3.5 w-3.5" />}
              />
              <SessionValueCard
                label="开发者入口"
                value={activeDeveloperAccessLabel}
                hint={`模型来源：${activeModelsSourceLabel}`}
                icon={<KeyRound className="h-3.5 w-3.5" />}
              />
            </div>
          </div>

          {errorMessage ? <NoticeBar tone="error" message={errorMessage} /> : null}
          {infoMessage ? <NoticeBar tone="success" message={infoMessage} /> : null}

          {!runtime ? (
            <div className="rounded-[24px] border border-dashed border-slate-300 bg-white px-5 py-6 text-sm leading-6 text-slate-600">
              当前没有可用的运行时配置。请在
              <span className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                public/oem-runtime-config.js
              </span>
              中配置域名、网关地址和租户信息，再继续接入云端服务。
            </div>
          ) : initializing ? (
            <div className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3 text-sm text-slate-600">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                正在恢复个人中心会话...
              </div>
            </div>
          ) : session ? (
            <div className="space-y-4">
              <div
                className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(280px,0.95fr)]"
                data-testid="oem-cloud-session-summary"
              >
                <article className={SURFACE_CLASS_NAME}>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-slate-700">
                          <Cloud className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-lg font-semibold text-slate-900">
                            {session.user.displayName || session.user.email || "已登录"}
                          </p>
                          <p className="text-sm text-slate-500">
                            {session.user.email || session.user.username || session.user.id}
                          </p>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3">
                        <SessionValueCard
                          label="租户"
                          value={session.tenant.id}
                          hint="当前云端会话所属租户"
                        />
                        <SessionValueCard
                          label="到期时间"
                          value={formatOemCloudDateTime(session.session.expiresAt)}
                          hint="会话过期后需重新登录"
                        />
                        <SessionValueCard
                          label="当前云服务"
                          value={activeCloudOffer?.displayName || hubProviderName}
                          hint="当前聚焦的云端来源"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => void handleRefresh()}
                        disabled={refreshing}
                        className="inline-flex items-center justify-center gap-2 rounded-[18px] border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                        data-testid="oem-cloud-refresh"
                      >
                        <RefreshCw
                          className={cn("h-4 w-4", refreshing && "animate-spin")}
                        />
                        刷新云端状态
                      </button>
                      <button
                        type="button"
                        onClick={() => props.onOpenProfile?.()}
                        className="inline-flex items-center justify-center gap-2 rounded-[18px] border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                      >
                        <LogIn className="h-4 w-4" />
                        前往个人中心管理会话
                      </button>
                      <button
                        type="button"
                        onClick={() => void openUserCenter("")}
                        className="inline-flex items-center justify-center gap-2 rounded-[18px] bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
                      >
                        <ExternalLink className="h-4 w-4" />
                        打开用户中心
                      </button>
                    </div>
                  </div>
                </article>

                <article className={SURFACE_CLASS_NAME}>
                  <div className="space-y-3">
                    <h3 className="text-base font-semibold text-slate-900">
                      当前治理结果
                    </h3>
                    <p className="text-sm leading-6 text-slate-600">
                      默认来源：{defaultProviderSummary || "未设定"}。当前接入模式为
                      {activeAccessModeLabel}，配置模式为 {activeConfigModeLabel}，
                      模型目录来自 {activeModelsSourceLabel}。
                    </p>
                    <p className="text-sm leading-6 text-slate-600">
                      开发者入口{activeDeveloperAccessEnabled ? "已开放" : "未开放"}。
                      当后台关闭 API Key 模式时，这里不会再把云端服务伪装成本地 API Key Provider。
                    </p>
                  </div>
                </article>
              </div>

              <section className="space-y-4">
                <div className="flex flex-col gap-2">
                  <h3 className="text-lg font-semibold text-slate-900">
                    云端服务目录
                  </h3>
                  <p className="text-sm leading-6 text-slate-600">
                    每个卡片都来自服务端最终态。是否允许 API Key 模式、当前模型来源、租户覆盖是否生效，都以服务端返回为准。
                  </p>
                </div>

                {offers.length === 0 ? (
                  <article className={SURFACE_CLASS_NAME}>
                    <p className="text-sm leading-6 text-slate-600">
                      当前租户还没有可用的云端服务来源。请先在后台发布可见 Offer。
                    </p>
                  </article>
                ) : (
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.95fr)]">
                    <div className="grid gap-4 lg:grid-cols-2">
                      {offers.map((offer) => {
                        const isDefaultCloudOffer =
                          preference?.providerSource === "oem_cloud" &&
                          preference.providerKey === offer.providerKey;
                        const isFocused = selectedOfferKey === offer.providerKey;
                        const stateTone = resolveOfferTone(offer.state);

                        return (
                          <article
                            key={offer.providerKey}
                            className={cn(
                              SURFACE_CLASS_NAME,
                              isFocused && "border-emerald-300 shadow-emerald-100",
                            )}
                          >
                            <div className="space-y-4">
                              <div className="flex items-start justify-between gap-3">
                                <div className="space-y-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h4 className="text-base font-semibold text-slate-900">
                                      {offer.displayName}
                                    </h4>
                                    {isDefaultCloudOffer ? (
                                      <InfoPill label="云端默认" tone="emerald" />
                                    ) : null}
                                    {offer.tenantOverrideApplied ? (
                                      <InfoPill label="租户覆盖已生效" tone="amber" />
                                    ) : null}
                                  </div>
                                  <p className="text-sm leading-6 text-slate-600">
                                    {offer.description || "当前来源暂无额外说明。"}
                                  </p>
                                </div>
                                <InfoPill
                                  label={formatOemCloudOfferStateLabel(offer.state)}
                                  tone={stateTone}
                                />
                              </div>

                              <div className="flex flex-wrap gap-2">
                                <InfoPill
                                  label={formatOemCloudAccessModeLabel(
                                    offer.effectiveAccessMode,
                                  )}
                                />
                                <InfoPill
                                  label={formatOemCloudConfigModeLabel(offer.configMode)}
                                />
                                <InfoPill
                                  label={formatOemCloudModelsSourceLabel(
                                    offer.modelsSource,
                                  )}
                                />
                                <InfoPill
                                  label={`${offer.availableModelCount} 个模型`}
                                />
                              </div>

                              <div className="grid gap-3 sm:grid-cols-2">
                                <SessionValueCard
                                  label="套餐 / 状态"
                                  value={offer.currentPlan || "未显示"}
                                  hint={
                                    offer.creditsSummary ||
                                    offer.statusReason ||
                                    "由控制面统一下发"
                                  }
                                />
                                <SessionValueCard
                                  label="开发者入口"
                                  value={
                                    offer.apiKeyModeEnabled
                                      ? offer.developerAccessVisible
                                        ? "可见"
                                        : "已隐藏"
                                      : "已关闭"
                                  }
                                  hint="同时受后台 API Key 模式与显示治理控制"
                                />
                              </div>

                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => void openOfferDetail(offer.providerKey)}
                                  disabled={loadingDetail && isFocused}
                                  className="inline-flex items-center justify-center gap-2 rounded-[18px] border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                                >
                                  {loadingDetail && isFocused ? (
                                    <LoaderCircle className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Layers3 className="h-4 w-4" />
                                  )}
                                  查看模型目录
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleSetDefault(offer)}
                                  disabled={savingDefault === offer.providerKey}
                                  className="inline-flex items-center justify-center gap-2 rounded-[18px] bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
                                >
                                  {savingDefault === offer.providerKey ? (
                                    <LoaderCircle className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <CheckCircle2 className="h-4 w-4" />
                                  )}
                                  {isDefaultCloudOffer ? "已是默认来源" : "设为默认来源"}
                                </button>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>

                    <article className={SURFACE_CLASS_NAME}>
                      {selectedOffer ? (
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="text-base font-semibold text-slate-900">
                                {selectedOffer.displayName}
                              </h4>
                              <InfoPill
                                label={formatOemCloudOfferStateLabel(selectedOffer.state)}
                                tone={resolveOfferTone(selectedOffer.state)}
                              />
                            </div>
                            <p className="text-sm leading-6 text-slate-600">
                              当前实际接入方式为
                              {formatOemCloudAccessModeLabel(
                                selectedOffer.access.accessMode,
                              )}
                              ，共下发 {selectedModels.length} 个模型目录项。
                            </p>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-3">
                            <SessionValueCard
                              label="模型目录"
                              value={`${selectedModels.length} 项`}
                              hint="来自当前选中来源的服务端目录"
                            />
                            <SessionValueCard
                              label="模型来源"
                              value={formatOemCloudModelsSourceLabel(
                                selectedOffer.modelsSource,
                              )}
                              hint="决定模型列表来自云端目录还是手动编排"
                            />
                            <SessionValueCard
                              label="开发者入口"
                              value={
                                selectedOffer.apiKeyModeEnabled
                                  ? selectedOffer.developerAccessVisible
                                    ? "可见"
                                    : "已隐藏"
                                  : "已关闭"
                              }
                              hint="后台可按 Offer / 租户治理"
                            />
                          </div>

                          {selectedOffer.loginHint ? (
                            <p className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
                              登录提示：{selectedOffer.loginHint}
                            </p>
                          ) : null}
                          {selectedOffer.subscribeHint ? (
                            <p className="rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">
                              套餐提示：{selectedOffer.subscribeHint}
                            </p>
                          ) : null}
                          {selectedOffer.unavailableHint ? (
                            <p className="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">
                              不可用提示：{selectedOffer.unavailableHint}
                            </p>
                          ) : null}

                          <div className="space-y-3">
                            <h5 className="text-sm font-semibold text-slate-900">
                              模型目录
                            </h5>
                            {loadingDetail ? (
                              <div className="flex items-center gap-3 rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                                <LoaderCircle className="h-4 w-4 animate-spin" />
                                正在加载模型目录...
                              </div>
                            ) : selectedModels.length > 0 ? (
                              <div className="space-y-2 rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-3">
                                {selectedModels.map((model) => (
                                  <div
                                    key={model.id}
                                    className="rounded-[18px] border border-slate-200/80 bg-white px-3 py-3"
                                  >
                                    <div className="flex items-center justify-between gap-3">
                                      <div>
                                        <p className="text-sm font-semibold text-slate-900">
                                          {model.displayName}
                                        </p>
                                        <p className="mt-1 text-xs text-slate-500">
                                          {model.modelId}
                                        </p>
                                      </div>
                                      {model.recommended ? (
                                        <InfoPill label="推荐" tone="emerald" />
                                      ) : null}
                                    </div>
                                    {model.description ? (
                                      <p className="mt-2 text-xs leading-5 text-slate-500">
                                        {model.description}
                                      </p>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="rounded-[18px] border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                                当前来源还没有下发模型目录。
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
                          <Layers3 className="h-8 w-8 text-slate-400" />
                          <p className="mt-3 text-sm font-medium text-slate-700">
                            选择一个云端来源查看详情
                          </p>
                          <p className="mt-2 text-sm leading-6 text-slate-500">
                            这里会展示模型目录、实际接入方式和后台治理结果。
                          </p>
                        </div>
                      )}
                    </article>
                  </div>
                )}
              </section>
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(280px,0.95fr)]">
              <article className={SURFACE_CLASS_NAME}>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold text-slate-900">
                      先在个人中心登录
                    </h3>
                    <p className="text-sm leading-6 text-slate-600">
                      当前还没有可用的个人中心会话。登录后，云端默认来源、模型目录和服务技能目录会自动同步到本地。
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => props.onOpenProfile?.()}
                      className="inline-flex items-center justify-center gap-2 rounded-[18px] bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
                      data-testid="open-profile-login"
                    >
                      <LogIn className="h-4 w-4" />
                      去个人中心登录
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void openUserCenter(runtime?.loginPath || "/login")
                      }
                      className="inline-flex items-center justify-center gap-2 rounded-[18px] border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                    >
                      <ExternalLink className="h-4 w-4" />
                      在浏览器打开登录页
                    </button>
                  </div>
                </div>
              </article>

              <article className={SURFACE_CLASS_NAME}>
                <div className="space-y-3">
                  <h3 className="text-base font-semibold text-slate-900">
                    接入说明
                  </h3>
                  <p className="text-sm leading-6 text-slate-600">
                    云端服务默认通过登录会话消费。是否开放开发者 API Key 模式、是否允许租户覆盖，都由后台统一治理并在这里展示最终态。
                  </p>
                </div>
              </article>
            </div>
          )}
        </div>
      </section>

      <section id="local-provider-management" className="space-y-4">
        <article className={SURFACE_CLASS_NAME}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-slate-900">
                本地 / 其它开发者 Provider
              </h3>
              <p className="max-w-3xl text-sm leading-6 text-slate-600">
                {localProviderHint}
              </p>
            </div>

            <InfoPill
              label={
                activeDeveloperAccessEnabled
                  ? "云端开发者入口已开放"
                  : "云端开发者入口未开放"
              }
              tone={activeDeveloperAccessEnabled ? "emerald" : "slate"}
            />
          </div>
        </article>

        <ProviderPoolPage hideHeader />
      </section>
    </div>
  );
}

export default CloudProviderSettings;
