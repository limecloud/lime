import {
  type CreateClientDesktopAuthSessionPayload,
  type OemCloudDesktopAuthSessionStartResponse,
  type OemCloudDesktopAuthSessionStatus,
  OemCloudControlPlaneError,
  createClientDesktopAuthSession,
  pollClientDesktopAuthSession,
} from "@/lib/api/oemCloudControlPlane";
import {
  resolveOemCloudRuntimeContext,
  type OemCloudRuntimeContext,
} from "@/lib/api/oemCloudRuntime";
import {
  completeOemCloudDesktopOAuthLogin,
  OEM_CLOUD_OAUTH_COMPLETED_EVENT,
  type OemCloudDesktopOAuthCompletedDetail,
} from "@/lib/oemCloudDesktopAuth";
import { getStoredOemCloudSessionState } from "@/lib/oemCloudSession";
import {
  hasTauriInvokeCapability,
  hasTauriRuntimeMarkers,
} from "@/lib/tauri-runtime";

const DESKTOP_AUTH_LEGACY_CLIENT_IDS: Record<string, string[]> = {
  "limehub-desktop": ["lobehub-desktop"],
};

export interface OemCloudLoginLaunchResult {
  mode: "desktop_auth" | "login_url";
  openedUrl: string;
}

export interface ExternalBrowserOpenTarget {
  navigate: (url: string) => boolean;
  close: () => void;
}

export interface OpenExternalUrlOptions {
  browserTarget?: ExternalBrowserOpenTarget | null;
}

export interface OemCloudLoginLaunchOptions {
  browserTarget?: ExternalBrowserOpenTarget | null;
}

function buildOpenExternalUrlError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return new Error(`系统浏览器打开失败：${error.message.trim()}`);
  }
  return new Error("系统浏览器打开失败。");
}

function buildPopupBlockedError() {
  return new Error(
    "登录页没有被浏览器打开，可能被弹窗拦截。请点击“重新打开登录页”，或复制登录链接到浏览器打开。",
  );
}

function tryOpenBrowserWindow(url: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const opened = window.open(url, "_blank");
  if (!opened) {
    return false;
  }

  try {
    opened.opener = null;
  } catch {
    // 仅用于降低浏览器 fallback 的 opener 暴露风险，不影响打开结果。
  }

  return !opened.closed;
}

export function createExternalBrowserOpenTarget(): ExternalBrowserOpenTarget | null {
  if (
    hasTauriInvokeCapability() ||
    hasTauriRuntimeMarkers() ||
    typeof window === "undefined"
  ) {
    return null;
  }

  const opened = window.open("about:blank", "_blank");
  if (!opened) {
    return null;
  }

  try {
    opened.opener = null;
    opened.document.title = "正在打开登录页...";
    opened.document.body.innerHTML = "正在打开登录页，请稍候...";
  } catch {
    // 某些浏览器不允许写入预打开窗口，后续仍可尝试导航。
  }

  return {
    navigate: (url) => {
      if (opened.closed) {
        return false;
      }
      try {
        opened.location.assign(url);
        return true;
      } catch {
        return false;
      }
    },
    close: () => {
      try {
        if (!opened.closed) {
          opened.close();
        }
      } catch {
        // 关闭失败不影响后续登录流程。
      }
    },
  };
}

export async function openExternalUrl(
  url: string,
  options: OpenExternalUrlOptions = {},
): Promise<void> {
  const shouldUseTauriShell =
    hasTauriInvokeCapability() || hasTauriRuntimeMarkers();
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
    options.browserTarget?.close();
    return;
  } catch (error) {
    if (shouldUseTauriShell) {
      options.browserTarget?.close();
      throw buildOpenExternalUrlError(error);
    }

    if (typeof window === "undefined") {
      throw new Error("当前环境不支持打开外部浏览器");
    }
  }

  if (options.browserTarget) {
    if (options.browserTarget.navigate(url)) {
      return;
    }
    options.browserTarget.close();
  }

  if (!tryOpenBrowserWindow(url)) {
    throw buildPopupBlockedError();
  }
}

export function buildOemCloudUserCenterUrl(baseUrl: string, path = "") {
  const targetPath = path.trim();
  if (!targetPath) {
    return baseUrl;
  }

  if (/^https?:\/\//i.test(targetPath)) {
    return targetPath;
  }

  return `${baseUrl}${targetPath.startsWith("/") ? targetPath : `/${targetPath}`}`;
}

function setMissingSearchParam(
  searchParams: URLSearchParams,
  key: string,
  value?: string | null,
) {
  const normalized = value?.trim();
  if (!normalized || searchParams.has(key)) {
    return;
  }

  searchParams.set(key, normalized);
}

export function buildOemCloudLoginUrl(
  runtime: Pick<
    OemCloudRuntimeContext,
    | "baseUrl"
    | "loginPath"
    | "tenantId"
    | "desktopOauthRedirectUrl"
    | "desktopOauthNextPath"
  >,
) {
  const loginUrl = buildOemCloudUserCenterUrl(
    runtime.baseUrl,
    runtime.loginPath,
  );

  try {
    const parsedUrl = new URL(loginUrl);
    setMissingSearchParam(parsedUrl.searchParams, "tenant", runtime.tenantId);
    setMissingSearchParam(parsedUrl.searchParams, "tenantId", runtime.tenantId);
    setMissingSearchParam(
      parsedUrl.searchParams,
      "redirectUrl",
      runtime.desktopOauthRedirectUrl,
    );
    setMissingSearchParam(
      parsedUrl.searchParams,
      "redirect",
      runtime.desktopOauthNextPath,
    );
    setMissingSearchParam(
      parsedUrl.searchParams,
      "next",
      runtime.desktopOauthNextPath,
    );
    return parsedUrl.toString();
  } catch {
    return loginUrl;
  }
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

function isLoopbackDesktopOauthRedirectUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function resolveDesktopClientIdCandidates(clientId: string) {
  const primaryClientId = clientId.trim();
  const fallbackClientIds =
    DESKTOP_AUTH_LEGACY_CLIENT_IDS[primaryClientId] ?? [];
  return [primaryClientId, ...fallbackClientIds];
}

async function createGoogleDesktopAuthSession(
  runtime: OemCloudRuntimeContext,
): Promise<OemCloudDesktopAuthSessionStartResponse> {
  if (isLoopbackDesktopOauthRedirectUrl(runtime.desktopOauthRedirectUrl)) {
    throw new Error(
      "桌面登录回跳地址仍是 localhost 本地回调，请改为 lime://oauth/callback。",
    );
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
  runtime: OemCloudRuntimeContext,
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

function subscribeOauthCompleted(
  runtime: OemCloudRuntimeContext,
  onComplete: () => void,
) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleOauthCompleted = (event: Event) => {
    const detail =
      event instanceof CustomEvent
        ? (event.detail as OemCloudDesktopOAuthCompletedDetail)
        : null;
    if (!isGoogleOauthCompletionForRuntime(detail, runtime)) {
      return;
    }

    onComplete();
  };

  window.addEventListener(
    OEM_CLOUD_OAUTH_COMPLETED_EVENT,
    handleOauthCompleted,
  );
  return () => {
    window.removeEventListener(
      OEM_CLOUD_OAUTH_COMPLETED_EVENT,
      handleOauthCompleted,
    );
  };
}

function isGoogleOauthCompletionForRuntime(
  detail: OemCloudDesktopOAuthCompletedDetail | null,
  runtime: OemCloudRuntimeContext,
) {
  if (detail?.provider !== "google") {
    return false;
  }

  const callbackTenantId = detail.tenantId.trim();
  const runtimeTenantId = runtime.tenantId.trim();
  if (callbackTenantId === "" || runtimeTenantId === "") {
    return false;
  }
  if (callbackTenantId === runtimeTenantId) {
    return true;
  }

  const storedSession = getStoredOemCloudSessionState();
  const sessionTenantId = storedSession?.session.tenant.id?.trim();
  const sessionTenantSlug = storedSession?.session.tenant.slug?.trim();
  return Boolean(
    sessionTenantId === callbackTenantId &&
    (sessionTenantId === runtimeTenantId ||
      sessionTenantSlug === runtimeTenantId),
  );
}

export async function openConfiguredOemCloudLoginUrl(
  runtime: OemCloudRuntimeContext,
  options: OemCloudLoginLaunchOptions = {},
): Promise<OemCloudLoginLaunchResult> {
  const loginUrl = buildOemCloudLoginUrl(runtime);
  await openExternalUrl(loginUrl, {
    browserTarget: options.browserTarget,
  });
  return {
    mode: "login_url",
    openedUrl: loginUrl,
  };
}

export async function startOemCloudLogin(
  runtime = resolveOemCloudRuntimeContext(),
  options: OemCloudLoginLaunchOptions = {},
): Promise<OemCloudLoginLaunchResult> {
  if (!runtime) {
    throw new Error("当前版本未配置云端登录入口。");
  }

  let oauthCompleted = false;
  let disposeOauthCompletedListener: () => void = () => undefined;
  const oauthCompletedPromise =
    typeof window === "undefined"
      ? new Promise<void>(() => undefined)
      : new Promise<void>((resolve) => {
          disposeOauthCompletedListener = subscribeOauthCompleted(
            runtime,
            () => {
              oauthCompleted = true;
              disposeOauthCompletedListener();
              resolve();
            },
          );
        });

  let authSession: OemCloudDesktopAuthSessionStartResponse | null = null;
  try {
    authSession = await createGoogleDesktopAuthSession(runtime);
  } catch (error) {
    disposeOauthCompletedListener();
    if (error instanceof Error && /localhost 本地回调/.test(error.message)) {
      options.browserTarget?.close();
      throw error;
    }
    return openConfiguredOemCloudLoginUrl(runtime, options);
  }

  await openExternalUrl(authSession.authorizeUrl, {
    browserTarget: options.browserTarget,
  });

  const pollPromise = pollGoogleDesktopAuthSession(
    runtime,
    authSession,
    () => oauthCompleted,
  );

  let winner: "event" | "poll";
  try {
    winner = await Promise.race([
      oauthCompletedPromise.then(() => "event" as const),
      pollPromise.then(() => "poll" as const),
    ]);
  } finally {
    disposeOauthCompletedListener();
  }

  if (winner === "event") {
    void pollPromise.catch(() => undefined);
  }

  return {
    mode: "desktop_auth",
    openedUrl: authSession.authorizeUrl,
  };
}
