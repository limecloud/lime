import {
  getPublicAuthCatalog,
  type OemCloudPublicOAuthProvider,
} from "@/lib/api/oemCloudControlPlane";
import {
  resolveOemCloudRuntimeContext,
  type OemCloudRuntimeContext,
} from "@/lib/api/oemCloudRuntime";
import { getStoredOemCloudSessionState } from "@/lib/oemCloudSession";
import { startOemCloudLogin } from "@/lib/oemCloudLoginLauncher";

const STARTUP_LOGIN_ATTEMPT_PREFIX = "lime:oem-cloud-startup-login:v1";

export type OemCloudStartupLoginStatus =
  | "not_configured"
  | "has_session"
  | "already_attempted"
  | "not_required"
  | "no_google_provider"
  | "unsupported_policy"
  | "started"
  | "failed";

export interface OemCloudStartupLoginResult {
  status: OemCloudStartupLoginStatus;
  reason?: string;
}

function normalizeProvider(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function hasGoogleOAuthProvider(
  providers: OemCloudPublicOAuthProvider[],
): boolean {
  return providers.some(
    (provider) =>
      provider.enabled !== false &&
      normalizeProvider(provider.provider) === "google",
  );
}

function shouldStartGoogleOauth(
  catalog: Awaited<ReturnType<typeof getPublicAuthCatalog>>,
): OemCloudStartupLoginResult | null {
  if (!catalog.authPolicy.required) {
    return { status: "not_required" };
  }

  if (
    catalog.authPolicy.startupTrigger !== "oauth" ||
    normalizeProvider(catalog.authPolicy.primaryProvider) !== "google"
  ) {
    return { status: "unsupported_policy" };
  }

  if (!hasGoogleOAuthProvider(catalog.providers)) {
    return { status: "no_google_provider" };
  }

  return null;
}

function hasCurrentTenantSession(runtime: OemCloudRuntimeContext): boolean {
  const storedSession = getStoredOemCloudSessionState();
  return Boolean(
    storedSession?.token &&
    storedSession.session.tenant.id === runtime.tenantId,
  );
}

function getStartupLoginAttemptKey(runtime: OemCloudRuntimeContext): string {
  return `${STARTUP_LOGIN_ATTEMPT_PREFIX}:${runtime.tenantId}:${runtime.baseUrl}`;
}

function readStartupAttempt(runtime: OemCloudRuntimeContext): boolean {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return false;
  }

  return (
    window.sessionStorage.getItem(getStartupLoginAttemptKey(runtime)) === "1"
  );
}

function markStartupAttempt(runtime: OemCloudRuntimeContext): void {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return;
  }

  window.sessionStorage.setItem(getStartupLoginAttemptKey(runtime), "1");
}

export async function startOemCloudStartupLoginIfRequired(
  runtime = resolveOemCloudRuntimeContext(),
): Promise<OemCloudStartupLoginResult> {
  if (!runtime) {
    return { status: "not_configured" };
  }

  if (hasCurrentTenantSession(runtime)) {
    return { status: "has_session" };
  }

  if (readStartupAttempt(runtime)) {
    return { status: "already_attempted" };
  }

  let startupDecision: OemCloudStartupLoginResult | null;
  try {
    startupDecision = shouldStartGoogleOauth(
      await getPublicAuthCatalog(runtime.tenantId),
    );
  } catch (error) {
    const reason =
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "读取云端登录配置失败";
    console.warn("读取启动期云端登录配置失败:", error);
    return { status: "failed", reason };
  }

  if (startupDecision) {
    return startupDecision;
  }

  markStartupAttempt(runtime);
  try {
    await startOemCloudLogin(runtime);
    return { status: "started" };
  } catch (error) {
    const reason =
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "启动云端登录失败";
    console.warn("启动期云端登录失败:", error);
    return { status: "failed", reason };
  }
}
