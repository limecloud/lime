import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearSkillCatalogCache } from "@/lib/api/skillCatalog";
import { clearServiceSkillCatalogCache } from "@/lib/api/serviceSkills";
import {
  type ClientPasswordLoginPayload,
  type CreateClientDesktopAuthSessionPayload,
  type OemCloudBootstrapResponse,
  type OemCloudCurrentSession,
  type OemCloudDesktopAuthSessionStartResponse,
  type OemCloudDesktopAuthSessionStatus,
  type OemCloudPartnerHubAccessMode,
  type OemCloudPartnerHubConfigMode,
  type OemCloudPartnerHubModelsSource,
  type OemCloudProviderModelItem,
  type OemCloudProviderOfferDetail,
  type OemCloudProviderOfferState,
  type OemCloudProviderOfferSummary,
  type OemCloudProviderPreference,
  type SendAuthEmailCodeResponse,
  type VerifyClientAuthEmailCodePayload,
  OemCloudControlPlaneError,
  createClientDesktopAuthSession,
  getClientBootstrap,
  getClientProviderOffer,
  getClientProviderPreference,
  listClientProviderOfferModels,
  listClientProviderOffers,
  loginClientByPassword,
  logoutClient,
  pollClientDesktopAuthSession,
  sendClientAuthEmailCode,
  updateClientProviderPreference,
  verifyClientAuthEmailCode,
} from "@/lib/api/oemCloudControlPlane";
import { resolveOemCloudRuntimeContext } from "@/lib/api/oemCloudRuntime";
import {
  completeOemCloudDesktopOAuthLogin,
  OEM_CLOUD_OAUTH_COMPLETED_EVENT,
  type OemCloudDesktopOAuthCompletedDetail,
} from "@/lib/oemCloudDesktopAuth";
import {
  applyStoredOemCloudSessionToWindow,
  clearOemCloudBootstrapSnapshot,
  clearStoredOemCloudSessionState,
  getOemCloudBootstrapSnapshot,
  getStoredOemCloudSessionState,
  setOemCloudBootstrapSnapshot,
  setStoredOemCloudSessionState,
} from "@/lib/oemCloudSession";
import { syncServiceSkillCatalogFromBootstrapPayload } from "@/lib/serviceSkillCatalogBootstrap";
import { syncSkillCatalogFromBootstrapPayload } from "@/lib/skillCatalogBootstrap";
import {
  clearSiteAdapterCatalogCache,
  syncSiteAdapterCatalogFromBootstrapPayload,
} from "@/lib/siteAdapterCatalogBootstrap";
import { resolveOemLimeHubProviderName } from "@/lib/oemLimeHubProvider";

export type OemCloudLoginMode = "password" | "email_code";

const DESKTOP_AUTH_LEGACY_CLIENT_IDS: Record<string, string[]> = {
  "limehub-desktop": ["lobehub-desktop"],
};

async function openExternalUrl(url: string): Promise<void> {
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
    return;
  } catch {
    if (typeof window === "undefined") {
      throw new Error("当前环境不支持打开外部浏览器");
    }
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

function buildUserCenterUrl(baseUrl: string, path = "") {
  const targetPath = path.trim();
  if (!targetPath) {
    return baseUrl;
  }

  if (/^https?:\/\//i.test(targetPath)) {
    return targetPath;
  }

  return `${baseUrl}${targetPath.startsWith("/") ? targetPath : `/${targetPath}`}`;
}

function buildErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  const message = String(error ?? "").trim();
  if (!message || message === "[object Object]") {
    return fallback;
  }
  return message;
}

function isAuthExpired(error: unknown) {
  return (
    error instanceof OemCloudControlPlaneError &&
    (error.status === 401 || error.status === 403)
  );
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isDesktopClientNotFound(error: unknown) {
  return (
    error instanceof OemCloudControlPlaneError &&
    error.status === 404 &&
    /desktop client not found/i.test(error.message)
  );
}

function resolveDesktopClientIdCandidates(clientId: string) {
  const primaryClientId = clientId.trim();
  const fallbackClientIds =
    DESKTOP_AUTH_LEGACY_CLIENT_IDS[primaryClientId] ?? [];
  return [primaryClientId, ...fallbackClientIds];
}

async function createGoogleDesktopAuthSession(
  runtime: ReturnType<typeof resolveOemCloudRuntimeContext>,
): Promise<OemCloudDesktopAuthSessionStartResponse> {
  if (!runtime) {
    throw new Error("缺少 OEM 云端配置，请先配置域名与租户。");
  }

  const payload: CreateClientDesktopAuthSessionPayload = {
    clientId: runtime.desktopClientId,
    provider: "google",
    desktopRedirectUri: runtime.desktopOauthRedirectUrl,
  };

  const clientIdCandidates = resolveDesktopClientIdCandidates(
    runtime.desktopClientId,
  );

  let lastError: unknown = null;
  for (const clientId of clientIdCandidates) {
    try {
      return await createClientDesktopAuthSession(runtime.tenantId, {
        ...payload,
        clientId,
      });
    } catch (error) {
      lastError = error;
      if (
        clientId !== clientIdCandidates[clientIdCandidates.length - 1] &&
        isDesktopClientNotFound(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error("创建 Google 桌面授权会话失败");
}

function buildGoogleDesktopAuthTerminalMessage(
  status: OemCloudDesktopAuthSessionStatus,
) {
  switch (status) {
    case "denied":
      return "Google 授权已被拒绝，请重新发起登录。";
    case "cancelled":
      return "Google 授权已取消，请重新发起登录。";
    case "expired":
      return "Google 授权已过期，请重新发起登录。";
    case "consumed":
      return "当前登录结果已被消费，请重新发起 Google 登录。";
    default:
      return `Google 授权返回了未识别状态：${status}`;
  }
}

async function waitForGoogleOauthCompletion(
  isCompleted: () => boolean,
  timeoutMs: number,
) {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (!isCompleted() && Date.now() < deadline) {
    await sleep(150);
  }

  return isCompleted();
}

async function pollGoogleDesktopAuthSession(
  runtime: NonNullable<ReturnType<typeof resolveOemCloudRuntimeContext>>,
  authSession: OemCloudDesktopAuthSessionStartResponse,
  isCompleted: () => boolean,
) {
  let pollIntervalSeconds = Math.max(1, authSession.pollIntervalSeconds);

  while (!isCompleted()) {
    const status = await pollClientDesktopAuthSession(authSession.deviceCode);
    if (isCompleted()) {
      return;
    }

    pollIntervalSeconds = Math.max(1, status.pollIntervalSeconds);

    switch (status.status) {
      case "pending_login":
      case "pending_consent": {
        await sleep(pollIntervalSeconds * 1000);
        continue;
      }
      case "approved": {
        if (!status.sessionToken) {
          throw new Error("Google 授权已完成，但服务端未返回会话 Token。");
        }

        await completeOemCloudDesktopOAuthLogin({
          tenantId: status.tenantId || authSession.tenantId,
          token: status.sessionToken,
          nextPath: runtime.desktopOauthNextPath,
          error: null,
        });
        return;
      }
      case "consumed": {
        if (
          await waitForGoogleOauthCompletion(
            isCompleted,
            Math.min(2000, pollIntervalSeconds * 1000),
          )
        ) {
          return;
        }
        throw new Error(buildGoogleDesktopAuthTerminalMessage(status.status));
      }
      case "denied":
      case "cancelled":
      case "expired":
      default:
        throw new Error(buildGoogleDesktopAuthTerminalMessage(status.status));
    }
  }
}

export function formatOemCloudDateTime(value?: string) {
  if (!value) {
    return "未知";
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

export function formatOemCloudAccessModeLabel(
  value?: OemCloudPartnerHubAccessMode,
) {
  switch (value) {
    case "session":
      return "登录会话";
    case "hub_token":
      return "平台令牌";
    case "api_key":
      return "API Key";
    default:
      return "未知";
  }
}

export function formatOemCloudConfigModeLabel(
  value?: OemCloudPartnerHubConfigMode,
) {
  switch (value) {
    case "managed":
      return "托管模式";
    case "hybrid":
      return "混合模式";
    case "developer":
      return "开发者模式";
    default:
      return "未知";
  }
}

export function formatOemCloudModelsSourceLabel(
  value?: OemCloudPartnerHubModelsSource,
) {
  switch (value) {
    case "hub_catalog":
      return "云端目录";
    case "manual":
      return "手动目录";
    default:
      return "未知";
  }
}

export function formatOemCloudOfferStateLabel(
  value?: OemCloudProviderOfferState,
) {
  switch (value) {
    case "available_logged_out":
      return "待登录";
    case "available_subscribe_required":
      return "需开通套餐";
    case "available_ready":
      return "可直接使用";
    case "available_quota_low":
      return "额度偏低";
    case "blocked":
      return "已受限";
    case "unavailable":
      return "不可用";
    default:
      return "未知";
  }
}

const LOCAL_PROVIDER_SUMMARY = "本地开发者 Provider";

export function useOemCloudAccess() {
  const runtime = resolveOemCloudRuntimeContext();
  const restoreTargetKey = runtime
    ? `${runtime.baseUrl}::${runtime.tenantId}`
    : "__runtime_unavailable__";
  const [loginMode, setLoginMode] = useState<OemCloudLoginMode>("password");
  const [passwordForm, setPasswordForm] = useState<ClientPasswordLoginPayload>({
    identifier: "",
    password: "",
  });
  const [emailCodeForm, setEmailCodeForm] =
    useState<VerifyClientAuthEmailCodePayload>({
      identifier: "",
      code: "",
      displayName: "",
      username: "",
    });
  const [codeDelivery, setCodeDelivery] =
    useState<SendAuthEmailCodeResponse | null>(null);
  const [session, setSession] = useState<OemCloudCurrentSession | null>(null);
  const [bootstrap, setBootstrap] = useState<OemCloudBootstrapResponse | null>(
    null,
  );
  const [offers, setOffers] = useState<OemCloudProviderOfferSummary[]>([]);
  const [preference, setPreference] =
    useState<OemCloudProviderPreference | null>(null);
  const [selectedOffer, setSelectedOffer] =
    useState<OemCloudProviderOfferDetail | null>(null);
  const [selectedModels, setSelectedModels] = useState<
    OemCloudProviderModelItem[]
  >([]);
  const [initializing, setInitializing] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [openingGoogleLogin, setOpeningGoogleLogin] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [savingDefault, setSavingDefault] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const configuredTarget = useMemo(
    () =>
      runtime
        ? {
            baseUrl: runtime.baseUrl,
            tenantId: runtime.tenantId,
          }
        : null,
    [runtime],
  );

  const clearCloudState = useCallback((message?: string) => {
    clearStoredOemCloudSessionState();
    clearOemCloudBootstrapSnapshot();
    clearSkillCatalogCache();
    clearServiceSkillCatalogCache();
    void clearSiteAdapterCatalogCache();
    setSession(null);
    setBootstrap(null);
    setOffers([]);
    setPreference(null);
    setSelectedOffer(null);
    setSelectedModels([]);
    setCodeDelivery(null);
    if (message) {
      setInfoMessage(message);
    }
  }, []);

  const applyBootstrap = useCallback(
    (
      nextBootstrap: OemCloudBootstrapResponse,
      fallbackToken?: string,
      extraOffers?: OemCloudProviderOfferSummary[],
      extraPreference?: OemCloudProviderPreference,
    ) => {
      const nextSession: OemCloudCurrentSession = {
        ...nextBootstrap.session,
        token: nextBootstrap.session.token ?? fallbackToken ?? session?.token,
      };

      setStoredOemCloudSessionState(nextSession);
      setOemCloudBootstrapSnapshot({
        ...nextBootstrap,
        session: nextSession,
      });
      syncSkillCatalogFromBootstrapPayload({
        ...nextBootstrap,
        session: nextSession,
      });
      syncServiceSkillCatalogFromBootstrapPayload({
        ...nextBootstrap,
        session: nextSession,
      });
      void syncSiteAdapterCatalogFromBootstrapPayload({
        ...nextBootstrap,
        session: nextSession,
      });

      setSession(nextSession);
      setBootstrap({
        ...nextBootstrap,
        session: nextSession,
      });
      setOffers(extraOffers ?? nextBootstrap.providerOffersSummary);
      setPreference(extraPreference ?? nextBootstrap.providerPreference);
      setErrorMessage(null);
    },
    [session?.token],
  );

  const refreshAuthenticatedState = useCallback(
    async (tenantIdOverride?: string, fallbackToken?: string) => {
      const targetTenantId =
        tenantIdOverride ?? session?.tenant.id ?? runtime?.tenantId;
      if (!runtime || !targetTenantId) {
        return null;
      }

      const nextBootstrap = await getClientBootstrap(targetTenantId);
      const [nextOffers, nextPreference] = await Promise.all([
        listClientProviderOffers(targetTenantId),
        getClientProviderPreference(targetTenantId),
      ]);
      applyBootstrap(nextBootstrap, fallbackToken, nextOffers, nextPreference);
      return nextBootstrap;
    },
    [applyBootstrap, runtime, session?.tenant.id],
  );

  const runtimeRef = useRef(runtime);
  const clearCloudStateRef = useRef(clearCloudState);
  const refreshAuthenticatedStateRef = useRef(refreshAuthenticatedState);

  useEffect(() => {
    runtimeRef.current = runtime;
  }, [runtime]);

  useEffect(() => {
    clearCloudStateRef.current = clearCloudState;
  }, [clearCloudState]);

  useEffect(() => {
    refreshAuthenticatedStateRef.current = refreshAuthenticatedState;
  }, [refreshAuthenticatedState]);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      const currentRuntime = runtimeRef.current;
      if (!currentRuntime) {
        setInitializing(false);
        return;
      }

      setInitializing(true);
      const stored = applyStoredOemCloudSessionToWindow();
      if (!stored) {
        setInitializing(false);
        return;
      }

      try {
        await refreshAuthenticatedStateRef.current(
          stored.session.tenant.id,
          stored.token,
        );
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (isAuthExpired(error)) {
          clearCloudStateRef.current("云端会话已过期，请重新登录。");
        } else {
          setErrorMessage(buildErrorMessage(error, "恢复云端会话失败"));
        }
      } finally {
        if (!cancelled) {
          setInitializing(false);
        }
      }
    }

    void restoreSession();

    return () => {
      cancelled = true;
    };
  }, [restoreTargetKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return () => undefined;
    }

    let cancelled = false;

    const handleOauthCompleted = (event: Event) => {
      if (cancelled) {
        return;
      }

      const detail =
        event instanceof CustomEvent
          ? (event.detail as OemCloudDesktopOAuthCompletedDetail)
          : null;
      const storedState = getStoredOemCloudSessionState();
      if (!storedState) {
        return;
      }

      const snapshot =
        getOemCloudBootstrapSnapshot<OemCloudBootstrapResponse>();

      setInitializing(false);
      setSession(storedState.session as OemCloudCurrentSession);
      setCodeDelivery(null);
      setSelectedOffer(null);
      setSelectedModels([]);
      setErrorMessage(null);

      if (snapshot) {
        applyBootstrap(snapshot, storedState.token);
        setInfoMessage(
          detail?.provider === "google"
            ? "Google 登录成功，已同步云端目录。"
            : "云端登录成功，已同步目录。",
        );
        return;
      }

      void refreshAuthenticatedState(
        storedState.session.tenant.id,
        storedState.token,
      )
        .then(() => {
          if (!cancelled) {
            setInfoMessage(
              detail?.provider === "google"
                ? "Google 登录成功，已同步云端目录。"
                : "云端登录成功，已同步目录。",
            );
          }
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }

          if (isAuthExpired(error)) {
            clearCloudState("云端会话已失效，请重新登录。");
            return;
          }
          setErrorMessage(buildErrorMessage(error, "同步云端登录结果失败"));
        });
    };

    window.addEventListener(
      OEM_CLOUD_OAUTH_COMPLETED_EVENT,
      handleOauthCompleted,
    );

    return () => {
      cancelled = true;
      window.removeEventListener(
        OEM_CLOUD_OAUTH_COMPLETED_EVENT,
        handleOauthCompleted,
      );
    };
  }, [applyBootstrap, clearCloudState, refreshAuthenticatedState]);

  const handleRefresh = useCallback(async () => {
    if (!runtime || !session?.tenant.id) {
      return;
    }

    setRefreshing(true);
    try {
      await refreshAuthenticatedState(session.tenant.id, session.token);
      setInfoMessage("已同步最新云端会话、服务目录与服务技能快照。");
      setSelectedOffer(null);
      setSelectedModels([]);
    } catch (error) {
      if (isAuthExpired(error)) {
        clearCloudState("云端会话已失效，请重新登录。");
        return;
      }
      setErrorMessage(buildErrorMessage(error, "刷新云端状态失败"));
    } finally {
      setRefreshing(false);
    }
  }, [clearCloudState, refreshAuthenticatedState, runtime, session]);

  const handleSendEmailCode = useCallback(async () => {
    if (!runtime) {
      setErrorMessage("缺少 OEM 云端配置，请先配置域名与租户。");
      return;
    }

    if (!emailCodeForm.identifier.trim()) {
      setErrorMessage("请输入邮箱或账号后再发送验证码。");
      return;
    }

    setSendingCode(true);
    setErrorMessage(null);
    setInfoMessage(null);
    try {
      const response = await sendClientAuthEmailCode(runtime.tenantId, {
        identifier: emailCodeForm.identifier.trim(),
      });
      setCodeDelivery(response);
      setInfoMessage(
        `验证码已发送至 ${response.maskedEmail}，有效期约 ${Math.max(
          1,
          Math.round(response.expiresInSeconds / 60),
        )} 分钟。`,
      );
    } catch (error) {
      setErrorMessage(buildErrorMessage(error, "发送验证码失败"));
    } finally {
      setSendingCode(false);
    }
  }, [emailCodeForm.identifier, runtime]);

  const handleEmailCodeLogin = useCallback(async () => {
    if (!runtime) {
      setErrorMessage("缺少 OEM 云端配置，请先配置域名与租户。");
      return;
    }

    if (!emailCodeForm.identifier.trim() || !emailCodeForm.code.trim()) {
      setErrorMessage("请先填写邮箱/账号和验证码。");
      return;
    }

    setLoggingIn(true);
    setErrorMessage(null);
    setInfoMessage(null);
    try {
      const nextSession = await verifyClientAuthEmailCode(runtime.tenantId, {
        identifier: emailCodeForm.identifier.trim(),
        code: emailCodeForm.code.trim(),
        displayName: emailCodeForm.displayName?.trim() || undefined,
        username: emailCodeForm.username?.trim() || undefined,
      });
      setStoredOemCloudSessionState(nextSession);
      setSession(nextSession);
      await refreshAuthenticatedState(nextSession.tenant.id, nextSession.token);
      setInfoMessage("验证码登录成功，已同步云端目录。");
      setCodeDelivery(null);
      setEmailCodeForm({
        identifier: nextSession.user.email || emailCodeForm.identifier,
        code: "",
        displayName: "",
        username: "",
      });
    } catch (error) {
      setErrorMessage(buildErrorMessage(error, "验证码登录失败"));
    } finally {
      setLoggingIn(false);
    }
  }, [emailCodeForm, refreshAuthenticatedState, runtime]);

  const handlePasswordLogin = useCallback(async () => {
    if (!runtime) {
      setErrorMessage("缺少 OEM 云端配置，请先配置域名与租户。");
      return;
    }

    if (!passwordForm.identifier.trim() || !passwordForm.password.trim()) {
      setErrorMessage("请输入账号和密码。");
      return;
    }

    setLoggingIn(true);
    setErrorMessage(null);
    setInfoMessage(null);
    try {
      const nextSession = await loginClientByPassword(runtime.tenantId, {
        identifier: passwordForm.identifier.trim(),
        password: passwordForm.password,
      });
      setStoredOemCloudSessionState(nextSession);
      setSession(nextSession);
      await refreshAuthenticatedState(nextSession.tenant.id, nextSession.token);
      setInfoMessage("账号登录成功，已同步云端目录。");
      setPasswordForm((current) => ({
        ...current,
        password: "",
      }));
    } catch (error) {
      setErrorMessage(buildErrorMessage(error, "账号登录失败"));
    } finally {
      setLoggingIn(false);
    }
  }, [passwordForm, refreshAuthenticatedState, runtime]);

  const handleLogout = useCallback(async () => {
    if (!session?.tenant.id) {
      clearCloudState("已清理本地云端会话。");
      return;
    }

    setLoggingOut(true);
    setErrorMessage(null);
    try {
      await logoutClient(session.tenant.id);
      clearCloudState("已退出云端会话。");
    } catch (error) {
      clearCloudState("本地会话已清理，但服务端注销未确认。");
      setErrorMessage(buildErrorMessage(error, "服务端注销失败"));
    } finally {
      setLoggingOut(false);
    }
  }, [clearCloudState, session?.tenant.id]);

  const handleGoogleLogin = useCallback(async () => {
    if (!runtime) {
      setErrorMessage("缺少 OEM 云端配置，请先配置域名与租户。");
      return;
    }

    setOpeningGoogleLogin(true);
    setErrorMessage(null);
    setInfoMessage(null);

    let oauthCompleted = false;
    let disposeCompletionListener = () => undefined;

    try {
      const oauthCompletedPromise =
        typeof window === "undefined"
          ? new Promise<void>(() => undefined)
          : new Promise<void>((resolve) => {
              const handleOauthCompleted = (event: Event) => {
                const detail =
                  event instanceof CustomEvent
                    ? (event.detail as OemCloudDesktopOAuthCompletedDetail)
                    : null;
                if (
                  detail?.provider !== "google" ||
                  detail.tenantId !== runtime.tenantId
                ) {
                  return;
                }

                oauthCompleted = true;
                resolve();
              };

              window.addEventListener(
                OEM_CLOUD_OAUTH_COMPLETED_EVENT,
                handleOauthCompleted,
              );
              disposeCompletionListener = () => {
                window.removeEventListener(
                  OEM_CLOUD_OAUTH_COMPLETED_EVENT,
                  handleOauthCompleted,
                );
              };
            });

      const authSession = await createGoogleDesktopAuthSession(runtime);

      await openExternalUrl(authSession.authorizeUrl);
      setInfoMessage(
        "已打开系统浏览器，请完成 Google 授权；如果浏览器出现确认页，请继续完成，桌面端会自动同步登录结果。",
      );

      const pollPromise = pollGoogleDesktopAuthSession(
        runtime,
        authSession,
        () => oauthCompleted,
      );

      const winner = await Promise.race([
        oauthCompletedPromise.then(() => "event" as const),
        pollPromise.then(() => "poll" as const),
      ]);

      if (winner === "event") {
        void pollPromise.catch(() => undefined);
      }
    } catch (error) {
      if (!oauthCompleted) {
        setErrorMessage(buildErrorMessage(error, "Google 登录失败"));
      }
    } finally {
      disposeCompletionListener();
      setOpeningGoogleLogin(false);
    }
  }, [runtime]);

  const openOfferDetail = useCallback(
    async (providerKey: string) => {
      if (!session?.tenant.id) {
        return;
      }

      setLoadingDetail(true);
      setErrorMessage(null);
      try {
        const [detail, models] = await Promise.all([
          getClientProviderOffer(session.tenant.id, providerKey),
          listClientProviderOfferModels(session.tenant.id, providerKey),
        ]);
        setSelectedOffer(detail);
        setSelectedModels(models);
      } catch (error) {
        if (isAuthExpired(error)) {
          clearCloudState("云端会话已失效，请重新登录。");
          return;
        }
        setErrorMessage(buildErrorMessage(error, "加载云服务详情失败"));
      } finally {
        setLoadingDetail(false);
      }
    },
    [clearCloudState, session?.tenant.id],
  );

  const handleSetDefault = useCallback(
    async (
      offer: OemCloudProviderOfferSummary | OemCloudProviderOfferDetail,
      defaultModel?: string,
    ) => {
      if (!session?.tenant.id) {
        return;
      }

      const nextDefaultModel = defaultModel || offer.defaultModel;
      setSavingDefault(offer.providerKey);
      setErrorMessage(null);
      try {
        const nextPreference = await updateClientProviderPreference(
          session.tenant.id,
          {
            providerSource: "oem_cloud",
            providerKey: offer.providerKey,
            defaultModel: nextDefaultModel,
          },
        );
        setPreference(nextPreference);
        await refreshAuthenticatedState(session.tenant.id, session.token);
        setInfoMessage(`已将 ${offer.displayName} 设为默认云端服务来源。`);
      } catch (error) {
        if (isAuthExpired(error)) {
          clearCloudState("云端会话已失效，请重新登录。");
          return;
        }
        setErrorMessage(buildErrorMessage(error, "设置默认服务商失败"));
      } finally {
        setSavingDefault("");
      }
    },
    [clearCloudState, refreshAuthenticatedState, session],
  );

  const openUserCenter = useCallback(
    async (path = "") => {
      if (!configuredTarget) {
        return;
      }

      await openExternalUrl(buildUserCenterUrl(configuredTarget.baseUrl, path));
    },
    [configuredTarget],
  );

  const hubProviderName = useMemo(
    () => resolveOemLimeHubProviderName(runtime),
    [runtime],
  );

  const defaultCloudOffer = useMemo(() => {
    if (!offers.length) {
      return null;
    }

    if (preference?.providerSource === "oem_cloud") {
      const matchedOffer = offers.find(
        (offer) => offer.providerKey === preference.providerKey,
      );
      if (matchedOffer) {
        return matchedOffer;
      }
    }

    return offers[0] ?? null;
  }, [offers, preference]);

  const activeCloudOffer = selectedOffer ?? defaultCloudOffer;

  const defaultProviderSummary = useMemo(() => {
    if (!preference) {
      return null;
    }

    if (preference.providerSource === "local") {
      return `${LOCAL_PROVIDER_SUMMARY}${
        preference.defaultModel ? ` · ${preference.defaultModel}` : ""
      }`;
    }

    const matchedOffer = offers.find(
      (offer) => offer.providerKey === preference.providerKey,
    );
    if (!matchedOffer) {
      return `${hubProviderName}${
        preference.defaultModel ? ` · ${preference.defaultModel}` : ""
      }`;
    }

    return `${matchedOffer.displayName}${
      preference.defaultModel ? ` · ${preference.defaultModel}` : ""
    }`;
  }, [offers, preference, hubProviderName]);

  const defaultProviderSourceLabel = useMemo(() => {
    if (!preference) {
      return "未设定";
    }

    return preference.providerSource === "local"
      ? LOCAL_PROVIDER_SUMMARY
      : "云端服务";
  }, [preference]);

  const activeAccessModeLabel = useMemo(
    () => formatOemCloudAccessModeLabel(activeCloudOffer?.effectiveAccessMode),
    [activeCloudOffer?.effectiveAccessMode],
  );

  const activeConfigModeLabel = useMemo(
    () => formatOemCloudConfigModeLabel(activeCloudOffer?.configMode),
    [activeCloudOffer?.configMode],
  );

  const activeModelsSourceLabel = useMemo(
    () => formatOemCloudModelsSourceLabel(activeCloudOffer?.modelsSource),
    [activeCloudOffer?.modelsSource],
  );

  const activeDeveloperAccessEnabled = Boolean(
    activeCloudOffer?.apiKeyModeEnabled &&
    activeCloudOffer?.developerAccessVisible,
  );

  const activeDeveloperAccessLabel = useMemo(() => {
    if (!activeCloudOffer) {
      return "未设定";
    }

    if (!activeCloudOffer.apiKeyModeEnabled) {
      return "已关闭";
    }

    return activeCloudOffer.developerAccessVisible ? "可见" : "已隐藏";
  }, [activeCloudOffer]);

  return {
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
    offers,
    preference,
    defaultCloudOffer,
    activeCloudOffer,
    selectedOffer,
    selectedModels,
    initializing,
    refreshing,
    sendingCode,
    loggingIn,
    loggingOut,
    openingGoogleLogin,
    loadingDetail,
    savingDefault,
    errorMessage,
    setErrorMessage,
    infoMessage,
    setInfoMessage,
    defaultProviderSummary,
    defaultProviderSourceLabel,
    activeAccessModeLabel,
    activeConfigModeLabel,
    activeModelsSourceLabel,
    activeDeveloperAccessEnabled,
    activeDeveloperAccessLabel,
    clearCloudState,
    handleRefresh,
    handleSendEmailCode,
    handleEmailCodeLogin,
    handlePasswordLogin,
    handleGoogleLogin,
    handleLogout,
    openOfferDetail,
    handleSetDefault,
    openUserCenter,
  };
}
