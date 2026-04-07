import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  LogIn,
  LogOut,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import { ProviderIcon } from "@/icons/providers";
import {
  formatOemCloudDateTime,
  useOemCloudAccess,
} from "@/hooks/useOemCloudAccess";
import { cn } from "@/lib/utils";

const SURFACE_CLASS_NAME =
  "rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5";

function SessionValueCard(props: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-[22px] border border-white/90 bg-white/88 p-4 shadow-sm shadow-slate-950/5">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
        <span>{props.label}</span>
        <WorkbenchInfoTip
          ariaLabel={`${props.label}说明`}
          content={props.hint}
          tone="slate"
        />
      </div>
      <p className="mt-2 break-words text-sm font-semibold leading-6 text-slate-900">
        {props.value}
      </p>
    </div>
  );
}

function NoticeBar(props: { tone: "error" | "success"; message: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-[20px] border px-4 py-3 text-sm shadow-sm shadow-slate-950/5",
        props.tone === "success"
          ? "border-emerald-200 bg-emerald-50/90 text-emerald-700"
          : "border-rose-200 bg-rose-50/90 text-rose-700",
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

function resolveServiceSkillCount(payload: unknown): number {
  if (!payload || typeof payload !== "object") {
    return 0;
  }

  const items = (payload as { items?: unknown[] }).items;
  return Array.isArray(items) ? items.length : 0;
}

function formatProviderLabel(provider?: string) {
  const normalized = provider?.trim();
  if (!normalized) {
    return "系统账号";
  }

  if (normalized.toLowerCase() === "google") {
    return "Google";
  }

  return normalized;
}

function buildAccountInitials(value?: string) {
  const normalized = value?.trim();
  if (!normalized) {
    return "LH";
  }

  return normalized.slice(0, 2).toUpperCase();
}

export function UserCenterSessionSettings() {
  const [showAlternativeMethods, setShowAlternativeMethods] = useState(false);
  const {
    runtime,
    loginMode,
    setLoginMode,
    passwordForm,
    setPasswordForm,
    emailCodeForm,
    setEmailCodeForm,
    codeDelivery,
    session,
    bootstrap,
    initializing,
    refreshing,
    sendingCode,
    loggingIn,
    loggingOut,
    openingGoogleLogin,
    errorMessage,
    infoMessage,
    defaultProviderSummary,
    handleRefresh,
    handleSendEmailCode,
    handleEmailCodeLogin,
    handlePasswordLogin,
    handleGoogleLogin,
    handleLogout,
    openUserCenter,
  } = useOemCloudAccess();

  const accountName =
    session?.user.displayName?.trim() ||
    session?.user.username?.trim() ||
    session?.user.email?.trim() ||
    "未登录";
  const accountEmail =
    session?.user.email?.trim() ||
    session?.user.username?.trim() ||
    "登录后显示";
  const accountIdentity =
    session?.user.username?.trim() || session?.user.id || "登录后显示";
  const identityLabel = session?.user.username?.trim() ? "账号" : "用户 ID";
  const providerLabel = formatProviderLabel(session?.session.provider);
  const accountInitials = buildAccountInitials(
    session?.user.displayName ||
      session?.user.username ||
      session?.user.email ||
      undefined,
  );
  const syncedCapabilitiesSummary = session
    ? `${resolveServiceSkillCount(bootstrap?.serviceSkillCatalog)} 项技能 / ${
        bootstrap?.sceneCatalog?.length || 0
      } 个入口`
    : "登录后自动同步";
  const manageProfileLabel = bootstrap?.features?.profileEditable
    ? "前往账号中心修改资料"
    : "打开账号中心";

  return (
    <section className="space-y-4">
      <div className="relative overflow-hidden rounded-[30px] border border-emerald-200/70 bg-[linear-gradient(135deg,rgba(245,250,248,0.98)_0%,rgba(255,255,255,0.98)_52%,rgba(242,247,255,0.96)_100%)] shadow-sm shadow-slate-950/5">
        <div className="pointer-events-none absolute -left-16 top-[-68px] h-52 w-52 rounded-full bg-emerald-200/25 blur-3xl" />
        <div className="pointer-events-none absolute right-[-88px] top-[-14px] h-56 w-56 rounded-full bg-sky-200/25 blur-3xl" />

        <div className="relative flex flex-col gap-5 p-6 lg:p-7">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl space-y-3">
              <span className="inline-flex items-center rounded-full border border-emerald-200 bg-white/85 px-3 py-1 text-xs font-semibold tracking-[0.16em] text-emerald-700 shadow-sm">
                ACCOUNT
              </span>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-3xl font-semibold tracking-tight text-slate-900">
                    账户资料
                  </h2>
                  <WorkbenchInfoTip
                    ariaLabel="账户资料说明"
                    content="昵称、头像、邮箱等资料统一由账号中心维护。本地只同步展示当前账户状态与默认服务配置，避免在多个入口重复编辑后出现不一致。"
                    tone="mint"
                  />
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium",
                      session
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-100 text-slate-600",
                    )}
                  >
                    {session ? "已登录" : "未登录"}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[420px]">
              <SessionValueCard
                label="当前状态"
                value={session ? "账号已连接" : "等待登录"}
                hint={
                  session
                    ? "当前桌面端会直接复用这份账号状态。"
                    : "登录后将自动同步账户资料与服务配置。"
                }
              />
              <SessionValueCard
                label="默认服务"
                value={defaultProviderSummary || "登录后自动同步"}
                hint="来自账号中心当前默认设置。"
              />
            </div>
          </div>

          {errorMessage ? (
            <NoticeBar tone="error" message={errorMessage} />
          ) : null}
          {infoMessage ? (
            <NoticeBar tone="success" message={infoMessage} />
          ) : null}

          {!runtime ? (
            <div className="rounded-[24px] border border-dashed border-slate-300 bg-white/80 px-5 py-6 text-sm leading-6 text-slate-600">
              当前没有可用的运行时配置。请先在
              <span className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                public/oem-runtime-config.js
              </span>
              中配置域名、网关地址和租户信息，然后再进行登录。
            </div>
          ) : initializing ? (
            <div className="rounded-[24px] border border-white/90 bg-white/84 p-5 shadow-sm">
              <div className="flex items-center gap-3 text-sm text-slate-600">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                正在恢复账户状态...
              </div>
            </div>
          ) : session ? (
            <div
              className="grid gap-4 xl:grid-cols-[minmax(0,2.15fr)_minmax(300px,1fr)]"
              data-testid="oem-cloud-session-panel"
            >
              <article className={SURFACE_CLASS_NAME}>
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 space-y-4">
                    <div className="flex items-start gap-4">
                      <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-[22px] border border-slate-200 bg-slate-100 text-lg font-semibold text-slate-700">
                        {session.user.avatarUrl ? (
                          <img
                            src={session.user.avatarUrl}
                            alt={`${accountName} 头像`}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span>{accountInitials}</span>
                        )}
                      </div>

                      <div className="min-w-0 space-y-3">
                        <div>
                          <p className="break-words text-xl font-semibold text-slate-900">
                            {accountName}
                          </p>
                          <p className="mt-1 break-words text-sm text-slate-500">
                            {accountEmail}
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                            登录方式：{providerLabel}
                          </span>
                          <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                            已同步：{syncedCapabilitiesSummary}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm text-slate-600">
                            资料维护已统一到账号中心
                          </span>
                          <WorkbenchInfoTip
                            ariaLabel="账号中心同步说明"
                            content="资料修改请前往账号中心完成。客户端会同步最新昵称、头像、邮箱与默认服务状态，不再在本地维护第二份个人资料。"
                            tone="slate"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 xl:w-[220px]">
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
                      同步最新状态
                    </button>
                    <button
                      type="button"
                      onClick={() => void openUserCenter("")}
                      className="inline-flex items-center justify-center gap-2 rounded-[18px] border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                    >
                      <ExternalLink className="h-4 w-4" />
                      {manageProfileLabel}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleLogout()}
                      disabled={loggingOut}
                      className="inline-flex items-center justify-center gap-2 rounded-[18px] bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
                      data-testid="oem-cloud-logout"
                    >
                      <LogOut className="h-4 w-4" />
                      {loggingOut ? "退出中..." : "退出当前账号"}
                    </button>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <SessionValueCard
                    label="邮箱"
                    value={accountEmail}
                    hint="来自账号中心当前账户信息。"
                  />
                  <SessionValueCard
                    label={identityLabel}
                    value={accountIdentity}
                    hint="用于识别当前账户身份。"
                  />
                  <SessionValueCard
                    label="会话有效期"
                    value={formatOemCloudDateTime(session.session.expiresAt)}
                    hint="到期后需要重新登录。"
                  />
                  <SessionValueCard
                    label="默认服务"
                    value={defaultProviderSummary || "尚未设定"}
                    hint="当前 AI 服务页默认使用的来源。"
                  />
                </div>
              </article>

              <article className={SURFACE_CLASS_NAME}>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-slate-900">
                      资料维护方式
                    </h3>
                    <WorkbenchInfoTip
                      ariaLabel="资料维护方式说明"
                      content={
                        <div className="space-y-1">
                          <p>
                            昵称、头像、邮箱等资料由账号中心统一维护。这里专注展示当前账户状态，不再提供单独的本地资料编辑入口。
                          </p>
                          <p>
                            如需调整资料，请前往账号中心完成修改，然后回到这里点击“同步最新状态”。
                          </p>
                        </div>
                      }
                      tone="slate"
                    />
                  </div>
                  {codeDelivery ? (
                    <p className="text-sm leading-6 text-slate-600">
                      最近一次验证码已发送到 {codeDelivery.maskedEmail}。
                    </p>
                  ) : null}
                </div>
              </article>
            </div>
          ) : (
            <article
              className={SURFACE_CLASS_NAME}
              data-testid="oem-cloud-login-panel"
            >
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.75fr)_minmax(280px,0.95fr)]">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-slate-900">
                        使用 Google 一键登录
                      </h3>
                      <WorkbenchInfoTip
                        ariaLabel="Google 一键登录说明"
                        content="Google 是默认登录方式。授权完成后，客户端会自动同步账户资料、默认服务与已开通能力。"
                        tone="slate"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleGoogleLogin()}
                    disabled={openingGoogleLogin}
                    className="flex w-full items-center gap-4 rounded-[22px] border border-slate-200 bg-white px-4 py-4 text-left shadow-sm shadow-slate-950/5 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                    data-testid="oem-cloud-google-login"
                  >
                    <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white">
                      <ProviderIcon providerType="google" size={22} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-slate-900">
                        {openingGoogleLogin
                          ? "正在打开 Google 登录..."
                          : "使用 Google 一键登录"}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-slate-500">
                        在系统浏览器完成授权后，客户端会自动完成登录。
                      </span>
                    </span>
                  </button>

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void openUserCenter(runtime.loginPath)}
                      className="inline-flex items-center justify-center gap-2 rounded-[18px] border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                    >
                      <ExternalLink className="h-4 w-4" />
                      打开登录页
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setShowAlternativeMethods((current) => !current)
                      }
                      className="inline-flex items-center justify-center gap-2 rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-white"
                      data-testid="oem-cloud-toggle-alternative-login"
                    >
                      {showAlternativeMethods ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                      {showAlternativeMethods
                        ? "收起其他登录方式"
                        : "使用邮箱验证码 / 账号密码"}
                    </button>
                  </div>
                </div>

                <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/90 p-5">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-slate-900">
                        登录后会自动完成
                      </h4>
                      <WorkbenchInfoTip
                        ariaLabel="登录后自动完成说明"
                        content={
                          <div className="space-y-1">
                            <p>同步当前账户资料与头像、昵称显示。</p>
                            <p>同步默认 AI 服务、模型目录与已开通能力。</p>
                            <p>
                              个人资料统一在账号中心维护，避免多入口重复编辑。
                            </p>
                          </div>
                        }
                        tone="slate"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {showAlternativeMethods ? (
                <div className="mt-5 rounded-[24px] border border-slate-200/80 bg-slate-50/80 p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <h4 className="text-base font-semibold text-slate-900">
                          备用登录方式
                        </h4>
                        <WorkbenchInfoTip
                          ariaLabel="备用登录方式说明"
                          content="如果当前组织没有启用 Google，或需要兼容已有账号体系，可以改用邮箱验证码或账号密码登录。"
                          tone="slate"
                        />
                      </div>
                    </div>

                    <div className="inline-flex rounded-full border border-slate-200 bg-white p-1">
                      <button
                        type="button"
                        onClick={() => setLoginMode("password")}
                        className={cn(
                          "rounded-full px-3 py-1.5 text-xs font-medium transition",
                          loginMode === "password"
                            ? "bg-slate-900 text-white"
                            : "text-slate-600 hover:text-slate-900",
                        )}
                      >
                        账号密码
                      </button>
                      <button
                        type="button"
                        onClick={() => setLoginMode("email_code")}
                        className={cn(
                          "rounded-full px-3 py-1.5 text-xs font-medium transition",
                          loginMode === "email_code"
                            ? "bg-slate-900 text-white"
                            : "text-slate-600 hover:text-slate-900",
                        )}
                      >
                        邮箱验证码
                      </button>
                    </div>
                  </div>

                  {loginMode === "password" ? (
                    <div className="mt-5 space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700">
                          邮箱 / 账号
                        </label>
                        <input
                          value={passwordForm.identifier}
                          onChange={(event) =>
                            setPasswordForm((current) => ({
                              ...current,
                              identifier: event.target.value,
                            }))
                          }
                          placeholder="例如：operator@example.com"
                          className="w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-300"
                          data-testid="oem-cloud-password-identifier"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700">
                          密码
                        </label>
                        <input
                          type="password"
                          value={passwordForm.password}
                          onChange={(event) =>
                            setPasswordForm((current) => ({
                              ...current,
                              password: event.target.value,
                            }))
                          }
                          placeholder="输入账号中心密码"
                          className="w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-300"
                          data-testid="oem-cloud-password-secret"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => void handlePasswordLogin()}
                        disabled={loggingIn}
                        className="inline-flex items-center justify-center gap-2 rounded-[18px] bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
                        data-testid="oem-cloud-password-submit"
                      >
                        <LogIn className="h-4 w-4" />
                        {loggingIn ? "登录中..." : "登录并同步账户"}
                      </button>
                    </div>
                  ) : (
                    <div className="mt-5 space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700">
                          邮箱 / 账号
                        </label>
                        <input
                          value={emailCodeForm.identifier}
                          onChange={(event) =>
                            setEmailCodeForm((current) => ({
                              ...current,
                              identifier: event.target.value,
                            }))
                          }
                          placeholder="例如：operator@example.com"
                          className="w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-300"
                          data-testid="oem-cloud-code-identifier"
                        />
                      </div>

                      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-slate-700">
                            验证码
                          </label>
                          <input
                            value={emailCodeForm.code}
                            onChange={(event) =>
                              setEmailCodeForm((current) => ({
                                ...current,
                                code: event.target.value,
                              }))
                            }
                            placeholder="输入 6 位验证码"
                            className="w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-300"
                            data-testid="oem-cloud-code-value"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleSendEmailCode()}
                          disabled={sendingCode}
                          className="self-end rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                          data-testid="oem-cloud-code-send"
                        >
                          {sendingCode ? "发送中..." : "发送验证码"}
                        </button>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-slate-700">
                            首次登录昵称
                          </label>
                          <input
                            value={emailCodeForm.displayName || ""}
                            onChange={(event) =>
                              setEmailCodeForm((current) => ({
                                ...current,
                                displayName: event.target.value,
                              }))
                            }
                            placeholder="选填"
                            className="w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-300"
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium text-slate-700">
                            首次登录账号
                          </label>
                          <input
                            value={emailCodeForm.username || ""}
                            onChange={(event) =>
                              setEmailCodeForm((current) => ({
                                ...current,
                                username: event.target.value,
                              }))
                            }
                            placeholder="选填"
                            className="w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-300"
                          />
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleEmailCodeLogin()}
                        disabled={loggingIn}
                        className="inline-flex items-center justify-center gap-2 rounded-[18px] bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
                        data-testid="oem-cloud-code-submit"
                      >
                        <LogIn className="h-4 w-4" />
                        {loggingIn ? "登录中..." : "验证并同步账户"}
                      </button>
                    </div>
                  )}
                </div>
              ) : null}
            </article>
          )}
        </div>
      </div>
    </section>
  );
}
