import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearSkillCatalogCache } from "@/lib/api/skillCatalog";
import { clearServiceSkillCatalogCache } from "@/lib/api/serviceSkills";
import {
  type ClientPasswordLoginPayload,
  type CreateClientAccessTokenPayload,
  type CreateClientCreditTopupOrderPayload,
  type CreateClientOrderPayload,
  type OemCloudAccessToken,
  type OemCloudActivationResponse,
  type OemCloudActiveAccessTokenResponse,
  type OemCloudBillingDashboard,
  type OemCloudBootstrapResponse,
  type OemCloudCreditAccount,
  type OemCloudCreditTopupOrder,
  type OemCloudCreditsDashboard,
  type OemCloudOrder,
  type OemCloudPaymentAction,
  type OemCloudReadiness,
  type OemCloudCurrentSession,
  type OemCloudEntitlementPlan,
  type OemCloudPaymentConfig,
  type OemCloudPartnerHubAccessMode,
  type OemCloudPartnerHubConfigMode,
  type OemCloudPartnerHubModelsSource,
  type OemCloudProviderModelItem,
  type OemCloudProviderOfferDetail,
  type OemCloudProviderOfferState,
  type OemCloudProviderOfferSummary,
  type OemCloudProviderPreference,
  type OemCloudSubscription,
  type OemCloudTopupPackage,
  type OemCloudUsageDashboard,
  type SendAuthEmailCodeResponse,
  type VerifyClientAuthEmailCodePayload,
  OemCloudControlPlaneError,
  createClientAccessToken,
  createClientCreditTopupOrder,
  createClientCreditTopupOrderCheckout,
  createClientOrder,
  createClientOrderCheckout,
  getClientBootstrap,
  getClientCloudActivation,
  getClientCreditTopupOrder,
  getClientOrder,
  getClientProviderOffer,
  listClientProviderOfferModels,
  loginClientByPassword,
  logoutClient,
  revokeClientAccessToken,
  rotateClientAccessToken,
  sendClientAuthEmailCode,
  updateClientProviderPreference,
  verifyClientAuthEmailCode,
} from "@/lib/api/oemCloudControlPlane";
import { resolveOemCloudRuntimeContext } from "@/lib/api/oemCloudRuntime";
import {
  OEM_CLOUD_OAUTH_COMPLETED_EVENT,
  type OemCloudDesktopOAuthCompletedDetail,
} from "@/lib/oemCloudDesktopAuth";
import {
  buildOemCloudUserCenterUrl,
  openExternalUrl,
  startOemCloudLogin,
} from "@/lib/oemCloudLoginLauncher";
import {
  buildOemCloudPaymentReturnBridgeUrl,
  clearStoredOemCloudPaymentReturn,
  consumeStoredOemCloudPaymentReturn,
  OEM_CLOUD_PAYMENT_RETURN_EVENT,
  type OemCloudPaymentReturnDetail,
} from "@/lib/oemCloudPaymentReturn";
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

async function openPaymentReferenceIfUrl(reference?: string) {
  const target = reference?.trim();
  if (!target || !/^https?:\/\//i.test(target)) {
    return false;
  }

  await openExternalUrl(target);
  return true;
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
const PAYMENT_STATUS_WATCH_INTERVAL_MS = 2500;
const PAYMENT_STATUS_WATCH_MAX_ATTEMPTS = 72;

type OemCloudPaymentWatchKind = "plan_order" | "credit_topup_order";

export interface OemCloudPaymentWatcher {
  kind: OemCloudPaymentWatchKind;
  orderId: string;
  title: string;
  status: "waiting" | "confirmed" | "stopped";
  attempts: number;
  message?: string;
}

function normalizePaymentStatus(value?: string) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isPaidPaymentStatus(value?: string) {
  return [
    "paid",
    "completed",
    "complete",
    "succeeded",
    "success",
    "active",
  ].includes(normalizePaymentStatus(value));
}

function isTerminalUnpaidPaymentStatus(value?: string) {
  return [
    "cancelled",
    "canceled",
    "closed",
    "expired",
    "failed",
    "failure",
    "refunded",
  ].includes(normalizePaymentStatus(value));
}

function resolveOrderTitle(
  kind: OemCloudPaymentWatchKind,
  order: OemCloudOrder | OemCloudCreditTopupOrder,
) {
  if (kind === "plan_order") {
    return (order as OemCloudOrder).planName || "套餐订单";
  }
  return (order as OemCloudCreditTopupOrder).packageName || "充值订单";
}

function normalizePaymentWatchKind(
  value?: string,
): OemCloudPaymentWatchKind | null {
  if (value === "plan_order" || value === "credit_topup_order") {
    return value;
  }
  return null;
}

function resolvePaymentReturnTitle(kind: OemCloudPaymentWatchKind) {
  return kind === "plan_order" ? "套餐订单" : "充值订单";
}

interface OemCloudCommerceSnapshot {
  cloudActivation: OemCloudActivationResponse | null;
  cloudReadiness: OemCloudReadiness | null;
  pendingPayment: OemCloudPaymentAction | null;
  paymentConfigs: OemCloudPaymentConfig[];
  plans: OemCloudEntitlementPlan[];
  subscription: OemCloudSubscription | null;
  creditAccount: OemCloudCreditAccount | null;
  creditsDashboard: OemCloudCreditsDashboard | null;
  topupPackages: OemCloudTopupPackage[];
  usageDashboard: OemCloudUsageDashboard | null;
  billingDashboard: OemCloudBillingDashboard | null;
  orders: OemCloudOrder[];
  creditTopupOrders: OemCloudCreditTopupOrder[];
  accessTokens: OemCloudAccessToken[];
  activeAccessToken: OemCloudActiveAccessTokenResponse | null;
}

function buildEmptyCommerceSnapshot(): OemCloudCommerceSnapshot {
  return {
    cloudActivation: null,
    cloudReadiness: null,
    pendingPayment: null,
    paymentConfigs: [],
    plans: [],
    subscription: null,
    creditAccount: null,
    creditsDashboard: null,
    topupPackages: [],
    usageDashboard: null,
    billingDashboard: null,
    orders: [],
    creditTopupOrders: [],
    accessTokens: [],
    activeAccessToken: null,
  };
}

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
  const [cloudActivation, setCloudActivation] =
    useState<OemCloudActivationResponse | null>(null);
  const [cloudReadiness, setCloudReadiness] =
    useState<OemCloudReadiness | null>(null);
  const [pendingPayment, setPendingPayment] =
    useState<OemCloudPaymentAction | null>(null);
  const [paymentConfigs, setPaymentConfigs] = useState<OemCloudPaymentConfig[]>(
    [],
  );
  const [plans, setPlans] = useState<OemCloudEntitlementPlan[]>([]);
  const [subscription, setSubscription] = useState<OemCloudSubscription | null>(
    null,
  );
  const [creditAccount, setCreditAccount] =
    useState<OemCloudCreditAccount | null>(null);
  const [creditsDashboard, setCreditsDashboard] =
    useState<OemCloudCreditsDashboard | null>(null);
  const [topupPackages, setTopupPackages] = useState<OemCloudTopupPackage[]>(
    [],
  );
  const [usageDashboard, setUsageDashboard] =
    useState<OemCloudUsageDashboard | null>(null);
  const [billingDashboard, setBillingDashboard] =
    useState<OemCloudBillingDashboard | null>(null);
  const [orders, setOrders] = useState<OemCloudOrder[]>([]);
  const [creditTopupOrders, setCreditTopupOrders] = useState<
    OemCloudCreditTopupOrder[]
  >([]);
  const [accessTokens, setAccessTokens] = useState<OemCloudAccessToken[]>([]);
  const [activeAccessToken, setActiveAccessToken] =
    useState<OemCloudActiveAccessTokenResponse | null>(null);
  const [lastIssuedRawToken, setLastIssuedRawToken] = useState<string | null>(
    null,
  );
  const [paymentWatcher, setPaymentWatcher] =
    useState<OemCloudPaymentWatcher | null>(null);
  const [commerceErrorMessage, setCommerceErrorMessage] = useState<
    string | null
  >(null);
  const [initializing, setInitializing] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingCommerce, setLoadingCommerce] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [openingGoogleLogin, setOpeningGoogleLogin] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [savingDefault, setSavingDefault] = useState<string>("");
  const [orderingPlanId, setOrderingPlanId] = useState<string>("");
  const [creatingTopupPackageId, setCreatingTopupPackageId] =
    useState<string>("");
  const [managingToken, setManagingToken] = useState<string>("");
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

  const applyCommerceSnapshot = useCallback(
    (snapshot: OemCloudCommerceSnapshot) => {
      setCloudActivation(snapshot.cloudActivation);
      setCloudReadiness(snapshot.cloudReadiness);
      setPendingPayment(snapshot.pendingPayment);
      setPaymentConfigs(snapshot.paymentConfigs);
      setPlans(snapshot.plans);
      setSubscription(snapshot.subscription);
      setCreditAccount(snapshot.creditAccount);
      setCreditsDashboard(snapshot.creditsDashboard);
      setTopupPackages(snapshot.topupPackages);
      setUsageDashboard(snapshot.usageDashboard);
      setBillingDashboard(snapshot.billingDashboard);
      setOrders(snapshot.orders);
      setCreditTopupOrders(snapshot.creditTopupOrders);
      setAccessTokens(snapshot.accessTokens);
      setActiveAccessToken(snapshot.activeAccessToken);
    },
    [],
  );

  const clearCloudState = useCallback(
    (message?: string) => {
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
      applyCommerceSnapshot(buildEmptyCommerceSnapshot());
      setLastIssuedRawToken(null);
      setCommerceErrorMessage(null);
      setCodeDelivery(null);
      if (message) {
        setInfoMessage(message);
      }
    },
    [applyCommerceSnapshot],
  );

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

  const loadCommerceState = useCallback(
    async (tenantId: string) => {
      setLoadingCommerce(true);
      const currentSnapshot: OemCloudCommerceSnapshot = {
        cloudActivation,
        cloudReadiness,
        pendingPayment,
        paymentConfigs,
        plans,
        subscription,
        creditAccount,
        creditsDashboard,
        topupPackages,
        usageDashboard,
        billingDashboard,
        orders,
        creditTopupOrders,
        accessTokens,
        activeAccessToken,
      };

      try {
        const activation = await getClientCloudActivation(tenantId);
        const snapshot: OemCloudCommerceSnapshot = {
          cloudActivation: activation,
          cloudReadiness: activation.readiness,
          pendingPayment: activation.pendingPayment,
          paymentConfigs: activation.paymentConfigs.filter(
            (item) => item.enabled,
          ),
          plans: activation.plans,
          subscription:
            activation.subscription ??
            activation.creditsDashboard?.subscription ??
            activation.billingDashboard?.subscription ??
            null,
          creditAccount:
            activation.creditAccount ??
            activation.creditsDashboard?.creditAccount ??
            null,
          creditsDashboard: activation.creditsDashboard,
          topupPackages:
            activation.topupPackages.length > 0
              ? activation.topupPackages
              : (activation.creditsDashboard?.topupPackages ?? []),
          usageDashboard: activation.usageDashboard,
          billingDashboard: activation.billingDashboard,
          orders: activation.orders,
          creditTopupOrders: activation.creditTopupOrders,
          accessTokens: activation.accessTokens,
          activeAccessToken: activation.activeAccessToken,
        };

        applyCommerceSnapshot(snapshot);
        setOffers(activation.providerOffers);
        setPreference(activation.providerPreference);
        setSelectedOffer(activation.selectedOffer);
        setSelectedModels(activation.providerModels);
        setCommerceErrorMessage(null);
        return snapshot;
      } catch (error) {
        const message = buildErrorMessage(error, "同步云端激活状态失败");
        setCommerceErrorMessage(message);
        applyCommerceSnapshot(currentSnapshot);
        return currentSnapshot;
      } finally {
        setLoadingCommerce(false);
      }
    },
    [
      accessTokens,
      activeAccessToken,
      applyCommerceSnapshot,
      billingDashboard,
      cloudActivation,
      cloudReadiness,
      creditAccount,
      creditTopupOrders,
      creditsDashboard,
      orders,
      paymentConfigs,
      pendingPayment,
      plans,
      subscription,
      topupPackages,
      usageDashboard,
    ],
  );

  const refreshAuthenticatedState = useCallback(
    async (tenantIdOverride?: string, fallbackToken?: string) => {
      const targetTenantId =
        tenantIdOverride ?? session?.tenant.id ?? runtime?.tenantId;
      if (!runtime || !targetTenantId) {
        return null;
      }

      const nextBootstrap = await getClientBootstrap(targetTenantId);
      applyBootstrap(nextBootstrap, fallbackToken);
      await loadCommerceState(targetTenantId);
      return nextBootstrap;
    },
    [applyBootstrap, loadCommerceState, runtime, session?.tenant.id],
  );

  const runtimeRef = useRef(runtime);
  const sessionRef = useRef(session);
  const clearCloudStateRef = useRef(clearCloudState);
  const refreshAuthenticatedStateRef = useRef(refreshAuthenticatedState);
  const paymentWatchRef = useRef<{
    runId: number;
    timer: number | null;
  }>({
    runId: 0,
    timer: null,
  });

  useEffect(() => {
    runtimeRef.current = runtime;
  }, [runtime]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    clearCloudStateRef.current = clearCloudState;
  }, [clearCloudState]);

  useEffect(() => {
    refreshAuthenticatedStateRef.current = refreshAuthenticatedState;
  }, [refreshAuthenticatedState]);

  const cancelPaymentWatcher = useCallback((clearState = true) => {
    paymentWatchRef.current.runId += 1;
    if (paymentWatchRef.current.timer !== null) {
      window.clearTimeout(paymentWatchRef.current.timer);
      paymentWatchRef.current.timer = null;
    }
    if (clearState) {
      setPaymentWatcher(null);
    }
  }, []);

  useEffect(() => {
    return () => {
      cancelPaymentWatcher(false);
    };
  }, [cancelPaymentWatcher]);

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
        void loadCommerceState(storedState.session.tenant.id);
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
  }, [
    applyBootstrap,
    clearCloudState,
    loadCommerceState,
    refreshAuthenticatedState,
  ]);

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
      setLastIssuedRawToken(null);
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

  const startPaymentStatusWatcher = useCallback(
    (target: {
      kind: OemCloudPaymentWatchKind;
      orderId: string;
      title: string;
    }) => {
      if (
        !session?.tenant.id ||
        !target.orderId ||
        typeof window === "undefined"
      ) {
        return;
      }

      cancelPaymentWatcher(false);

      const tenantId = session.tenant.id;
      const fallbackToken = session.token;
      const runId = paymentWatchRef.current.runId + 1;
      paymentWatchRef.current.runId = runId;
      paymentWatchRef.current.timer = null;

      const baseWatcher: OemCloudPaymentWatcher = {
        kind: target.kind,
        orderId: target.orderId,
        title: target.title,
        status: "waiting",
        attempts: 0,
        message: "已打开支付页，正在等待支付渠道回调。",
      };
      setPaymentWatcher(baseWatcher);

      const schedule = (attempt: number) => {
        if (paymentWatchRef.current.runId !== runId) {
          return;
        }

        paymentWatchRef.current.timer = window.setTimeout(() => {
          void tick(attempt);
        }, PAYMENT_STATUS_WATCH_INTERVAL_MS);
      };

      const tick = async (attempt: number) => {
        if (paymentWatchRef.current.runId !== runId) {
          return;
        }

        setPaymentWatcher({
          ...baseWatcher,
          attempts: attempt,
        });

        try {
          const order =
            target.kind === "plan_order"
              ? await getClientOrder(tenantId, target.orderId)
              : await getClientCreditTopupOrder(tenantId, target.orderId);
          const status = normalizePaymentStatus(order.status);
          const title = resolveOrderTitle(target.kind, order) || target.title;

          if (isPaidPaymentStatus(status)) {
            await refreshAuthenticatedState(tenantId, fallbackToken);
            if (paymentWatchRef.current.runId !== runId) {
              return;
            }
            setPaymentWatcher({
              ...baseWatcher,
              title,
              status: "confirmed",
              attempts: attempt,
              message:
                target.kind === "plan_order"
                  ? "支付已确认，套餐权益已同步到客户端。"
                  : "支付已确认，Token 积分余额已同步到客户端。",
            });
            setInfoMessage(
              target.kind === "plan_order"
                ? "支付已确认，套餐权益已同步，可以继续使用云端模型。"
                : "支付已确认，Token 积分余额已同步。",
            );
            return;
          }

          if (isTerminalUnpaidPaymentStatus(status)) {
            await refreshAuthenticatedState(tenantId, fallbackToken);
            if (paymentWatchRef.current.runId !== runId) {
              return;
            }
            setPaymentWatcher({
              ...baseWatcher,
              title,
              status: "stopped",
              attempts: attempt,
              message: "支付渠道返回未完成终态，请重新发起支付或刷新状态。",
            });
            setErrorMessage("支付未完成，请重新发起支付或刷新云端状态。");
            return;
          }

          if (attempt >= PAYMENT_STATUS_WATCH_MAX_ATTEMPTS) {
            await refreshAuthenticatedState(tenantId, fallbackToken);
            if (paymentWatchRef.current.runId !== runId) {
              return;
            }
            setPaymentWatcher({
              ...baseWatcher,
              title,
              status: "stopped",
              attempts: attempt,
              message: "仍未收到支付回调，请稍后手动刷新云端状态。",
            });
            setInfoMessage("仍在等待支付渠道回调，请稍后点击“刷新云端状态”。");
            return;
          }

          schedule(attempt + 1);
        } catch (error) {
          if (paymentWatchRef.current.runId !== runId) {
            return;
          }

          if (isAuthExpired(error)) {
            clearCloudState("云端会话已失效，请重新登录。");
            return;
          }

          if (attempt >= PAYMENT_STATUS_WATCH_MAX_ATTEMPTS) {
            setPaymentWatcher({
              ...baseWatcher,
              status: "stopped",
              attempts: attempt,
              message: buildErrorMessage(error, "确认支付结果失败"),
            });
            return;
          }

          schedule(attempt + 1);
        }
      };

      schedule(1);
    },
    [
      cancelPaymentWatcher,
      clearCloudState,
      refreshAuthenticatedState,
      session?.tenant.id,
      session?.token,
    ],
  );
  const startPaymentStatusWatcherRef = useRef(startPaymentStatusWatcher);

  useEffect(() => {
    startPaymentStatusWatcherRef.current = startPaymentStatusWatcher;
  }, [startPaymentStatusWatcher]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return () => undefined;
    }

    let cancelled = false;

    const handlePaymentReturn = async (
      detail: OemCloudPaymentReturnDetail,
    ) => {
      const currentSession = sessionRef.current;
      if (cancelled || !currentSession?.tenant.id) {
        return;
      }

      if (
        detail.tenantId &&
        detail.tenantId !== currentSession.tenant.id
      ) {
        return;
      }

      clearStoredOemCloudPaymentReturn(detail.sourceUrl);
      setInfoMessage("已回到 Lime，正在同步支付状态、权益与账本。");
      setErrorMessage(null);

      try {
        await refreshAuthenticatedStateRef.current(
          currentSession.tenant.id,
          currentSession.token,
        );
        if (cancelled) {
          return;
        }

        const kind = normalizePaymentWatchKind(detail.kind);
        if (!kind || !detail.orderId) {
          setInfoMessage("已同步最新云端权益、积分余额与账本状态。");
          return;
        }

        if (isTerminalUnpaidPaymentStatus(detail.status)) {
          cancelPaymentWatcher(false);
          setPaymentWatcher({
            kind,
            orderId: detail.orderId,
            title: resolvePaymentReturnTitle(kind),
            status: "stopped",
            attempts: 0,
            message: "支付页已返回未完成状态，请重新发起支付或刷新云端状态。",
          });
          setInfoMessage("支付页已返回未完成状态，云端状态已同步。");
          return;
        }

        startPaymentStatusWatcherRef.current({
          kind,
          orderId: detail.orderId,
          title: resolvePaymentReturnTitle(kind),
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (isAuthExpired(error)) {
          clearCloudStateRef.current("云端会话已失效，请重新登录。");
          return;
        }
        setErrorMessage(buildErrorMessage(error, "同步支付回跳结果失败"));
      }
    };

    const handlePaymentReturnEvent = (event: Event) => {
      const detail =
        event instanceof CustomEvent
          ? (event.detail as OemCloudPaymentReturnDetail)
          : null;
      if (!detail) {
        return;
      }
      void handlePaymentReturn(detail);
    };

    window.addEventListener(
      OEM_CLOUD_PAYMENT_RETURN_EVENT,
      handlePaymentReturnEvent,
    );

    const pendingReturn = session?.tenant.id
      ? consumeStoredOemCloudPaymentReturn(session.tenant.id)
      : null;
    if (pendingReturn) {
      void handlePaymentReturn(pendingReturn);
    }

    return () => {
      cancelled = true;
      window.removeEventListener(
        OEM_CLOUD_PAYMENT_RETURN_EVENT,
        handlePaymentReturnEvent,
      );
    };
  }, [
    cancelPaymentWatcher,
    session?.tenant.id,
  ]);

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

  const handlePurchasePlan = useCallback(
    async (payload: CreateClientOrderPayload) => {
      if (!runtime || !session?.tenant.id) {
        return;
      }

      setOrderingPlanId(payload.planId);
      setErrorMessage(null);
      setInfoMessage(null);
      try {
        const order = await createClientOrder(session.tenant.id, payload);
        const successUrl = buildOemCloudPaymentReturnBridgeUrl({
          controlPlaneBaseUrl: runtime.controlPlaneBaseUrl,
          tenantId: session.tenant.id,
          provider: payload.paymentChannel,
          orderId: order.id,
          kind: "plan_order",
          status: "success",
        });
        const cancelUrl = buildOemCloudPaymentReturnBridgeUrl({
          controlPlaneBaseUrl: runtime.controlPlaneBaseUrl,
          tenantId: session.tenant.id,
          provider: payload.paymentChannel,
          orderId: order.id,
          kind: "plan_order",
          status: "cancelled",
        });
        const checkout = await createClientOrderCheckout(
          session.tenant.id,
          order.id,
          {
            paymentMethod: payload.paymentMethod,
            successUrl,
            cancelUrl,
          },
        );
        const openedPayment = await openPaymentReferenceIfUrl(
          checkout.checkoutUrl || checkout.paymentReference,
        );
        await refreshAuthenticatedState(session.tenant.id, session.token);
        startPaymentStatusWatcher({
          kind: "plan_order",
          orderId: order.id,
          title: order.planName || "套餐订单",
        });
        setInfoMessage(
          openedPayment
            ? "已创建套餐订单并打开真实支付页，Lime 会等待支付回调并自动同步权益。"
            : "已创建套餐订单，但支付渠道没有返回可打开的 checkoutUrl；Lime 会继续等待服务端回调。",
        );
      } catch (error) {
        if (isAuthExpired(error)) {
          clearCloudState("云端会话已失效，请重新登录。");
          return;
        }
        setErrorMessage(buildErrorMessage(error, "购买套餐失败"));
      } finally {
        setOrderingPlanId("");
      }
    },
    [
      clearCloudState,
      refreshAuthenticatedState,
      runtime,
      session,
      startPaymentStatusWatcher,
    ],
  );

  const handleTopupCredits = useCallback(
    async (payload: CreateClientCreditTopupOrderPayload) => {
      if (!runtime || !session?.tenant.id) {
        return;
      }

      setCreatingTopupPackageId(payload.packageId || "custom");
      setErrorMessage(null);
      setInfoMessage(null);
      try {
        const order = await createClientCreditTopupOrder(
          session.tenant.id,
          payload,
        );
        const successUrl = buildOemCloudPaymentReturnBridgeUrl({
          controlPlaneBaseUrl: runtime.controlPlaneBaseUrl,
          tenantId: session.tenant.id,
          provider: payload.paymentChannel,
          orderId: order.id,
          kind: "credit_topup_order",
          status: "success",
        });
        const cancelUrl = buildOemCloudPaymentReturnBridgeUrl({
          controlPlaneBaseUrl: runtime.controlPlaneBaseUrl,
          tenantId: session.tenant.id,
          provider: payload.paymentChannel,
          orderId: order.id,
          kind: "credit_topup_order",
          status: "cancelled",
        });
        const checkout = await createClientCreditTopupOrderCheckout(
          session.tenant.id,
          order.id,
          {
            paymentMethod: payload.paymentMethod,
            successUrl,
            cancelUrl,
          },
        );
        const openedPayment = await openPaymentReferenceIfUrl(
          checkout.checkoutUrl || checkout.paymentReference,
        );
        await refreshAuthenticatedState(session.tenant.id, session.token);
        startPaymentStatusWatcher({
          kind: "credit_topup_order",
          orderId: order.id,
          title: order.packageName || "充值订单",
        });
        setInfoMessage(
          openedPayment
            ? "已创建充值订单并打开真实支付页，Lime 会等待支付回调并自动同步余额。"
            : "已创建充值订单，但支付渠道没有返回可打开的 checkoutUrl；Lime 会继续等待服务端回调。",
        );
      } catch (error) {
        if (isAuthExpired(error)) {
          clearCloudState("云端会话已失效，请重新登录。");
          return;
        }
        setErrorMessage(buildErrorMessage(error, "充值积分失败"));
      } finally {
        setCreatingTopupPackageId("");
      }
    },
    [
      clearCloudState,
      refreshAuthenticatedState,
      runtime,
      session,
      startPaymentStatusWatcher,
    ],
  );

  const handleCreateAccessToken = useCallback(
    async (payload?: Partial<CreateClientAccessTokenPayload>) => {
      if (!session?.tenant.id) {
        return;
      }

      setManagingToken("create");
      setErrorMessage(null);
      setInfoMessage(null);
      try {
        const response = await createClientAccessToken(session.tenant.id, {
          name: payload?.name?.trim() || "Lime Desktop API Key",
          scopes: payload?.scopes ?? ["llm:invoke"],
          allowedModels: payload?.allowedModels,
          maxTokensPerRequest: payload?.maxTokensPerRequest,
          requestsPerMinute: payload?.requestsPerMinute,
          tokensPerMinute: payload?.tokensPerMinute,
          monthlyCreditLimit: payload?.monthlyCreditLimit,
        });
        setLastIssuedRawToken(response.apiKey || response.rawToken || null);
        await loadCommerceState(session.tenant.id);
        setInfoMessage("已创建 Lime API Key，明文只会在当前页面显示一次。");
      } catch (error) {
        if (isAuthExpired(error)) {
          clearCloudState("云端会话已失效，请重新登录。");
          return;
        }
        setErrorMessage(buildErrorMessage(error, "创建 API Key 失败"));
      } finally {
        setManagingToken("");
      }
    },
    [clearCloudState, loadCommerceState, session?.tenant.id],
  );

  const handleRotateAccessToken = useCallback(
    async (tokenId: string) => {
      if (!session?.tenant.id) {
        return;
      }

      setManagingToken(tokenId);
      setErrorMessage(null);
      setInfoMessage(null);
      try {
        const response = await rotateClientAccessToken(
          session.tenant.id,
          tokenId,
        );
        setLastIssuedRawToken(response.apiKey || response.rawToken || null);
        await loadCommerceState(session.tenant.id);
        setInfoMessage("已轮换 Lime API Key，旧 Key 已撤销。");
      } catch (error) {
        if (isAuthExpired(error)) {
          clearCloudState("云端会话已失效，请重新登录。");
          return;
        }
        setErrorMessage(buildErrorMessage(error, "轮换 API Key 失败"));
      } finally {
        setManagingToken("");
      }
    },
    [clearCloudState, loadCommerceState, session?.tenant.id],
  );

  const handleRevokeAccessToken = useCallback(
    async (tokenId: string) => {
      if (!session?.tenant.id) {
        return;
      }

      setManagingToken(tokenId);
      setErrorMessage(null);
      setInfoMessage(null);
      try {
        await revokeClientAccessToken(session.tenant.id, tokenId);
        setLastIssuedRawToken(null);
        await loadCommerceState(session.tenant.id);
        setInfoMessage("已撤销 Lime API Key。");
      } catch (error) {
        if (isAuthExpired(error)) {
          clearCloudState("云端会话已失效，请重新登录。");
          return;
        }
        setErrorMessage(buildErrorMessage(error, "撤销 API Key 失败"));
      } finally {
        setManagingToken("");
      }
    },
    [clearCloudState, loadCommerceState, session?.tenant.id],
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
    cloudActivation,
    cloudReadiness,
    pendingPayment,
    paymentConfigs,
    plans,
    subscription,
    creditAccount,
    creditsDashboard,
    topupPackages,
    usageDashboard,
    billingDashboard,
    orders,
    creditTopupOrders,
    accessTokens,
    activeAccessToken,
    lastIssuedRawToken,
    paymentWatcher,
    commerceErrorMessage,
    defaultCloudOffer,
    activeCloudOffer,
    selectedOffer,
    selectedModels,
    initializing,
    refreshing,
    loadingCommerce,
    sendingCode,
    loggingIn,
    loggingOut,
    openingGoogleLogin,
    loadingDetail,
    savingDefault,
    orderingPlanId,
    creatingTopupPackageId,
    managingToken,
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
    handlePurchasePlan,
    handleTopupCredits,
    handleCreateAccessToken,
    handleRotateAccessToken,
    handleRevokeAccessToken,
    handleDismissIssuedToken: () => setLastIssuedRawToken(null),
    openUserCenter,
  };
}
