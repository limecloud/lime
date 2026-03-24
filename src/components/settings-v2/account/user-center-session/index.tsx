import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Cloud,
  ExternalLink,
  LoaderCircle,
  LogIn,
  LogOut,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
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
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
        {props.label}
      </p>
      <p className="mt-2 break-all text-sm font-semibold text-slate-900">
        {props.value}
      </p>
      <p className="mt-2 text-xs text-slate-500">{props.hint}</p>
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

export function UserCenterSessionSettings() {
  const [showAlternativeMethods, setShowAlternativeMethods] = useState(false);
  const {
    runtime,
    configuredTarget,
    hubProviderName,
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

  return (
    <section className="space-y-4">
      <div className="relative overflow-hidden rounded-[30px] border border-emerald-200/70 bg-[linear-gradient(135deg,rgba(245,250,248,0.98)_0%,rgba(255,255,255,0.98)_52%,rgba(242,247,255,0.96)_100%)] shadow-sm shadow-slate-950/5">
        <div className="pointer-events-none absolute -left-16 top-[-68px] h-52 w-52 rounded-full bg-emerald-200/25 blur-3xl" />
        <div className="pointer-events-none absolute right-[-88px] top-[-14px] h-56 w-56 rounded-full bg-sky-200/25 blur-3xl" />

        <div className="relative flex flex-col gap-5 p-6 lg:p-7">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl space-y-3">
              <span className="inline-flex items-center rounded-full border border-emerald-200 bg-white/85 px-3 py-1 text-xs font-semibold tracking-[0.16em] text-emerald-700 shadow-sm">
                USER CENTER
              </span>
              <div className="space-y-2">
                <h2 className="text-3xl font-semibold tracking-tight text-slate-900">
                  个人中心会话
                </h2>
                <p className="max-w-2xl text-sm leading-6 text-slate-600">
                  用户登录、退出和云端会话同步统一放在这里。登录成功后，Providers 页里的 {hubProviderName} 云服务入口会直接复用这份会话。
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[520px]">
              <SessionValueCard
                label="用户中心"
                value={configuredTarget?.baseUrl || "未配置"}
                hint="控制面与场景目录入口"
              />
              <SessionValueCard
                label="Gateway"
                value={runtime?.gatewayBaseUrl || "未配置"}
                hint="云端 OpenAI 兼容网关地址"
              />
              <SessionValueCard
                label="租户"
                value={configuredTarget?.tenantId || "未配置"}
                hint="个人中心登录所属租户"
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
                正在恢复个人中心会话...
              </div>
            </div>
          ) : session ? (
            <div
              className="grid gap-4 xl:grid-cols-[minmax(0,2.2fr)_minmax(300px,1fr)]"
              data-testid="oem-cloud-session-panel"
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

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                      <SessionValueCard
                        label="会话到期"
                        value={formatOemCloudDateTime(session.session.expiresAt)}
                        hint="会话过期后需重新登录"
                      />
                      <SessionValueCard
                        label="服务技能"
                        value={`${resolveServiceSkillCount(bootstrap?.serviceSkillCatalog)} 项`}
                        hint="登录后自动同步到本地"
                      />
                      <SessionValueCard
                        label="Scene 入口"
                        value={`${bootstrap?.sceneCatalog?.length || 0} 项`}
                        hint="来自个人中心 bootstrap"
                      />
                      <SessionValueCard
                        label="默认来源"
                        value={defaultProviderSummary || "未设定"}
                        hint="登录后自动同步当前云端默认来源"
                      />
                      <SessionValueCard
                        label="Gateway"
                        value={bootstrap?.gateway?.basePath || "/gateway-api"}
                        hint="OpenAI 兼容调用入口"
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
                      onClick={() => void openUserCenter("")}
                      className="inline-flex items-center justify-center gap-2 rounded-[18px] border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                    >
                      <ExternalLink className="h-4 w-4" />
                      打开用户中心
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleLogout()}
                      disabled={loggingOut}
                      className="inline-flex items-center justify-center gap-2 rounded-[18px] bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
                      data-testid="oem-cloud-logout"
                    >
                      <LogOut className="h-4 w-4" />
                      {loggingOut ? "退出中..." : "退出登录"}
                    </button>
                  </div>
                </div>
              </article>

              <article className={SURFACE_CLASS_NAME}>
                <div className="space-y-3">
                  <h3 className="text-base font-semibold text-slate-900">
                    会话说明
                  </h3>
                  <p className="text-sm leading-6 text-slate-600">
                    Providers 页里的 {hubProviderName} 云服务入口不再单独维护登录表单，而是直接读取这里的会话。你在这里刷新、退出之后，上游云端目录和下游面板都会一起同步。
                  </p>
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
                    <h3 className="text-lg font-semibold text-slate-900">
                      使用 Google 一键登录
                    </h3>
                    <p className="text-sm leading-6 text-slate-600">
                      Google 是默认登录方式。授权完成后桌面端会自动完成登录，并同步默认云端来源、服务技能目录与 Scene 入口。
                    </p>
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
                        在系统浏览器完成授权，桌面端会自动同步登录结果。
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
                      打开完整登录页
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
                    <h4 className="text-sm font-semibold text-slate-900">
                      登录后自动完成
                    </h4>
                    <ul className="space-y-2 text-sm leading-6 text-slate-600">
                      <li>同步当前租户下的默认云端来源与模型目录。</li>
                      <li>把个人中心会话复用到 Providers 页，不再重复登录。</li>
                      <li>同步服务技能目录与 Scene 入口，形成完整闭环。</li>
                    </ul>
                  </div>
                </div>
              </div>

              {showAlternativeMethods ? (
                <div className="mt-5 rounded-[24px] border border-slate-200/80 bg-slate-50/80 p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <h4 className="text-base font-semibold text-slate-900">
                        备用登录方式
                      </h4>
                      <p className="text-sm leading-6 text-slate-600">
                        如果当前租户没有启用 Google，或需要兼容已有账号体系，可以改用邮箱验证码或账号密码登录。
                      </p>
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
                          placeholder="输入用户中心密码"
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
                        {loggingIn ? "登录中..." : "登录并同步云端"}
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
                        {loggingIn ? "登录中..." : "验证并同步云端"}
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

export default UserCenterSessionSettings;
