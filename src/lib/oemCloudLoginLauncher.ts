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

const DESKTOP_AUTH_LEGACY_CLIENT_IDS: Record<string, string[]> = {
  "limehub-desktop": ["lobehub-desktop"],
};

export interface OemCloudLoginLaunchResult {
  mode: "desktop_auth" | "login_url";
  openedUrl: string;
}

export async function openExternalUrl(url: string): Promise<void> {
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

export function buildOemCloudLoginUrl(
  runtime: Pick<OemCloudRuntimeContext, "baseUrl" | "loginPath">,
) {
  return buildOemCloudUserCenterUrl(runtime.baseUrl, runtime.loginPath);
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
    if (detail?.provider !== "google" || detail.tenantId !== runtime.tenantId) {
      return;
    }

    onComplete();
  };

  window.addEventListener(OEM_CLOUD_OAUTH_COMPLETED_EVENT, handleOauthCompleted);
  return () => {
    window.removeEventListener(
      OEM_CLOUD_OAUTH_COMPLETED_EVENT,
      handleOauthCompleted,
    );
  };
}

export async function openConfiguredOemCloudLoginUrl(
  runtime: OemCloudRuntimeContext,
): Promise<OemCloudLoginLaunchResult> {
  const loginUrl = buildOemCloudLoginUrl(runtime);
  await openExternalUrl(loginUrl);
  return {
    mode: "login_url",
    openedUrl: loginUrl,
  };
}

export async function startOemCloudLogin(
  runtime = resolveOemCloudRuntimeContext(),
): Promise<OemCloudLoginLaunchResult> {
  if (!runtime) {
    throw new Error("缺少 OEM 云端配置，请先配置域名与租户。");
  }

  let oauthCompleted = false;
  const oauthCompletedPromise =
    typeof window === "undefined"
      ? new Promise<void>(() => undefined)
      : new Promise<void>((resolve) => {
          const dispose = subscribeOauthCompleted(runtime, () => {
            oauthCompleted = true;
            dispose();
            resolve();
          });
        });

  let authSession: OemCloudDesktopAuthSessionStartResponse | null = null;
  try {
    authSession = await createGoogleDesktopAuthSession(runtime);
  } catch (error) {
    if (
      error instanceof Error &&
      /localhost 本地回调/.test(error.message)
    ) {
      throw error;
    }
    return openConfiguredOemCloudLoginUrl(runtime);
  }

  await openExternalUrl(authSession.authorizeUrl);

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

  return {
    mode: "desktop_auth",
    openedUrl: authSession.authorizeUrl,
  };
}
