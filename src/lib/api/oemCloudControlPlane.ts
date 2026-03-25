import { resolveOemCloudRuntimeContext } from "./oemCloudRuntime";
import type { OemCloudCurrentSessionLike } from "@/lib/oemCloudSession";

export type OemCloudProviderSource = "local" | "oem_cloud";
export type OemCloudProviderOfferState =
  | "available_logged_out"
  | "available_subscribe_required"
  | "available_ready"
  | "available_quota_low"
  | "blocked"
  | "unavailable";
export type OemCloudPartnerHubAccessMode = "session" | "hub_token" | "api_key";
export type OemCloudPartnerHubConfigMode = "managed" | "hybrid" | "developer";
export type OemCloudPartnerHubModelsSource = "hub_catalog" | "manual";

export interface OemCloudTenant {
  id: string;
  name: string;
  slug: string;
}

export interface OemCloudUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  username?: string;
  passwordConfigured: boolean;
  roles: string[];
}

export interface OemCloudUserSession {
  id: string;
  tenantId: string;
  userId: string;
  provider: string;
  roles: string[];
  issuedAt: string;
  expiresAt: string;
}

export interface OemCloudCurrentSession extends Omit<
  OemCloudCurrentSessionLike,
  "tenant" | "user" | "session"
> {
  token?: string;
  tenant: OemCloudTenant;
  user: OemCloudUser;
  session: OemCloudUserSession;
}

export interface OemCloudFeatureFlags {
  oauthLoginEnabled: boolean;
  emailCodeLoginEnabled: boolean;
  passwordLoginEnabled: boolean;
  profileEditable: boolean;
  hubTokensEnabled: boolean;
  billingEnabled: boolean;
  referralEnabled: boolean;
  gatewayEnabled: boolean;
}

export interface OemCloudProviderPreference {
  tenantId: string;
  userId: string;
  providerSource: OemCloudProviderSource;
  providerKey: string;
  defaultModel?: string;
  needsValidation: boolean;
  lastValidatedAt?: string;
  updatedAt: string;
}

export interface OemCloudProviderOfferSummary {
  providerKey: string;
  displayName: string;
  source: OemCloudProviderSource;
  state: OemCloudProviderOfferState;
  logoUrl?: string;
  description?: string;
  supportUrl?: string;
  visible: boolean;
  loggedIn: boolean;
  accountStatus: string;
  subscriptionStatus: string;
  quotaStatus: string;
  canInvoke: boolean;
  defaultModel?: string;
  effectiveAccessMode: OemCloudPartnerHubAccessMode;
  apiKeyModeEnabled: boolean;
  tenantOverrideApplied: boolean;
  configMode: OemCloudPartnerHubConfigMode;
  modelsSource: OemCloudPartnerHubModelsSource;
  developerAccessVisible: boolean;
  availableModelCount: number;
  fallbackToLocalAllowed: boolean;
  currentPlan?: string;
  creditsSummary?: string;
  statusReason?: string;
  tags?: string[];
}

export interface OemCloudProviderOfferAccess {
  offerId: string;
  accessMode: OemCloudPartnerHubAccessMode;
  sessionTokenRef?: string;
  hubTokenRef?: string;
  hubTokenEnabled: boolean;
  lastIssuedAt?: string;
}

export interface OemCloudProviderOfferDetail extends OemCloudProviderOfferSummary {
  loginHint?: string;
  subscribeHint?: string;
  unavailableHint?: string;
  access: OemCloudProviderOfferAccess;
}

export interface OemCloudProviderModelItem {
  id: string;
  offerId: string;
  modelId: string;
  displayName: string;
  description?: string;
  abilities: string[];
  recommended: boolean;
  status: string;
  sort: number;
  upstreamMapping?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OemCloudBootstrapResponse {
  session: OemCloudCurrentSession;
  app: {
    id: string;
    key: string;
    name: string;
    slug: string;
    category: string;
    description?: string;
    status: string;
    distributionChannels: string[];
  };
  providerOffersSummary: OemCloudProviderOfferSummary[];
  providerPreference: OemCloudProviderPreference;
  serviceSkillCatalog?: unknown;
  siteAdapterCatalog?: unknown;
  sceneCatalog?: Array<{ id: string }>;
  features: OemCloudFeatureFlags;
  gateway?: {
    basePath?: string;
    chatCompletionsPath?: string;
  };
}

export interface SendClientAuthEmailCodePayload {
  identifier: string;
}

export interface SendAuthEmailCodeResponse {
  sent: boolean;
  maskedEmail: string;
  expiresInSeconds: number;
}

export interface VerifyClientAuthEmailCodePayload {
  identifier: string;
  code: string;
  displayName?: string;
  username?: string;
}

export interface ClientPasswordLoginPayload {
  identifier: string;
  password: string;
}

export type OemCloudDesktopAuthSessionStatus =
  | "pending_login"
  | "pending_consent"
  | "approved"
  | "denied"
  | "cancelled"
  | "consumed"
  | "expired";

export interface CreateClientDesktopAuthSessionPayload {
  clientId: string;
  provider?: string;
  desktopRedirectUri?: string;
}

export interface OemCloudDesktopAuthSessionStartResponse {
  authSessionId: string;
  deviceCode: string;
  tenantId: string;
  clientId: string;
  clientName: string;
  provider?: string;
  desktopRedirectUri?: string;
  status: OemCloudDesktopAuthSessionStatus;
  expiresInSeconds: number;
  pollIntervalSeconds: number;
  authorizeUrl: string;
}

export interface OemCloudDesktopAuthSessionStatusResponse {
  deviceCode: string;
  tenantId: string;
  clientId: string;
  clientName: string;
  provider?: string;
  desktopRedirectUri?: string;
  status: OemCloudDesktopAuthSessionStatus;
  expiresInSeconds: number;
  pollIntervalSeconds: number;
  sessionToken?: string;
  sessionExpiresAt?: string;
}

export interface UpdateClientProviderPreferencePayload {
  providerSource: OemCloudProviderSource;
  providerKey: string;
  defaultModel?: string;
}

interface OemCloudEnvelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

export class OemCloudControlPlaneError extends Error {
  status: number;
  code?: number;

  constructor(message: string, options?: { status?: number; code?: number }) {
    super(message);
    this.name = "OemCloudControlPlaneError";
    this.status = options?.status ?? 0;
    this.code = options?.code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeText(item))
    .filter((item): item is string => Boolean(item));
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

const PARTNER_HUB_ACCESS_MODE_SET = new Set<OemCloudPartnerHubAccessMode>([
  "session",
  "hub_token",
  "api_key",
]);

const PARTNER_HUB_CONFIG_MODE_SET = new Set<OemCloudPartnerHubConfigMode>([
  "managed",
  "hybrid",
  "developer",
]);

const PARTNER_HUB_MODELS_SOURCE_SET = new Set<OemCloudPartnerHubModelsSource>([
  "hub_catalog",
  "manual",
]);

function parsePartnerHubAccessMode(
  value: unknown,
  fallback?: OemCloudPartnerHubAccessMode,
): OemCloudPartnerHubAccessMode {
  const accessMode = normalizeText(value) as
    | OemCloudPartnerHubAccessMode
    | undefined;
  if (accessMode && PARTNER_HUB_ACCESS_MODE_SET.has(accessMode)) {
    return accessMode;
  }

  if (fallback) {
    return fallback;
  }

  throw new OemCloudControlPlaneError("服务商接入模式格式非法");
}

function parsePartnerHubConfigMode(
  value: unknown,
  fallback?: OemCloudPartnerHubConfigMode,
): OemCloudPartnerHubConfigMode {
  const configMode = normalizeText(value) as
    | OemCloudPartnerHubConfigMode
    | undefined;
  if (configMode && PARTNER_HUB_CONFIG_MODE_SET.has(configMode)) {
    return configMode;
  }

  if (fallback) {
    return fallback;
  }

  throw new OemCloudControlPlaneError("服务商配置模式格式非法");
}

function parsePartnerHubModelsSource(
  value: unknown,
  fallback?: OemCloudPartnerHubModelsSource,
): OemCloudPartnerHubModelsSource {
  const modelsSource = normalizeText(value) as
    | OemCloudPartnerHubModelsSource
    | undefined;
  if (modelsSource && PARTNER_HUB_MODELS_SOURCE_SET.has(modelsSource)) {
    return modelsSource;
  }

  if (fallback) {
    return fallback;
  }

  throw new OemCloudControlPlaneError("服务商模型来源格式非法");
}

function unwrapEnvelope<T>(payload: unknown): {
  data: T | undefined;
  message: string;
  code: number | undefined;
} {
  if (isRecord(payload)) {
    const code = typeof payload.code === "number" ? payload.code : undefined;
    const message = normalizeText(payload.message) ?? "";
    const data = payload.data as T | undefined;
    return {
      data,
      message,
      code,
    };
  }

  return {
    data: payload as T,
    message: "",
    code: undefined,
  };
}

function ensureRuntime() {
  const runtime = resolveOemCloudRuntimeContext();
  if (!runtime) {
    throw new OemCloudControlPlaneError(
      "缺少 OEM 云端配置，请先配置域名与租户。",
    );
  }
  return runtime;
}

async function requestControlPlane<T>(
  path: string,
  options?: {
    method?: "GET" | "POST" | "PUT";
    payload?: unknown;
    auth?: boolean;
  },
): Promise<T> {
  const runtime = ensureRuntime();
  const method = options?.method ?? "GET";
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (options?.payload !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (options?.auth) {
    const token = normalizeText(runtime.sessionToken);
    if (!token) {
      throw new OemCloudControlPlaneError(
        "缺少 OEM 云端 Session Token，请先完成登录。",
      );
    }
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${runtime.controlPlaneBaseUrl}${path}`, {
    method,
    headers,
    body:
      options?.payload === undefined
        ? undefined
        : JSON.stringify(options.payload),
  });

  let payload: OemCloudEnvelope<T> | unknown = null;
  try {
    payload = (await response.json()) as OemCloudEnvelope<T>;
  } catch {
    payload = null;
  }

  const { data, message, code } = unwrapEnvelope<T>(payload);
  if (!response.ok) {
    throw new OemCloudControlPlaneError(
      message || `请求失败 (${response.status})`,
      {
        status: response.status,
        code,
      },
    );
  }

  if (data === undefined) {
    throw new OemCloudControlPlaneError(message || "服务端返回格式非法", {
      status: response.status,
      code,
    });
  }

  return data;
}

function parseCurrentSession(value: unknown): OemCloudCurrentSession {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("当前会话格式非法");
  }

  const tenant = isRecord(value.tenant) ? value.tenant : null;
  const user = isRecord(value.user) ? value.user : null;
  const session = isRecord(value.session) ? value.session : null;
  const tenantId = normalizeText(tenant?.id);
  const userId = normalizeText(user?.id);
  const sessionId = normalizeText(session?.id);

  if (!tenantId || !userId || !sessionId) {
    throw new OemCloudControlPlaneError("当前会话格式非法");
  }

  return {
    token: normalizeText(value.token),
    tenant: {
      id: tenantId,
      name: normalizeText(tenant?.name) ?? tenantId,
      slug: normalizeText(tenant?.slug) ?? tenantId,
    },
    user: {
      id: userId,
      email: normalizeText(user?.email) ?? "",
      displayName: normalizeText(user?.displayName) ?? userId,
      avatarUrl: normalizeText(user?.avatarUrl),
      username: normalizeText(user?.username),
      passwordConfigured: normalizeBoolean(user?.passwordConfigured),
      roles: normalizeStringArray(user?.roles),
    },
    session: {
      id: sessionId,
      tenantId: normalizeText(session?.tenantId) ?? tenantId,
      userId: normalizeText(session?.userId) ?? userId,
      provider: normalizeText(session?.provider) ?? "password",
      roles: normalizeStringArray(session?.roles),
      issuedAt: normalizeText(session?.issuedAt) ?? "",
      expiresAt: normalizeText(session?.expiresAt) ?? "",
    },
  };
}

function parseProviderOfferSummary(
  value: unknown,
): OemCloudProviderOfferSummary {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("服务商摘要格式非法");
  }

  const providerKey = normalizeText(value.providerKey);
  const displayName = normalizeText(value.displayName);
  const source = normalizeText(value.source) as
    | OemCloudProviderSource
    | undefined;
  const state = normalizeText(value.state) as
    | OemCloudProviderOfferState
    | undefined;

  if (!providerKey || !displayName || !source || !state) {
    throw new OemCloudControlPlaneError("服务商摘要格式非法");
  }

  return {
    providerKey,
    displayName,
    source,
    state,
    logoUrl: normalizeText(value.logoUrl),
    description: normalizeText(value.description),
    supportUrl: normalizeText(value.supportUrl),
    visible: normalizeBoolean(value.visible),
    loggedIn: normalizeBoolean(value.loggedIn),
    accountStatus: normalizeText(value.accountStatus) ?? "anonymous",
    subscriptionStatus: normalizeText(value.subscriptionStatus) ?? "none",
    quotaStatus: normalizeText(value.quotaStatus) ?? "ok",
    canInvoke: normalizeBoolean(value.canInvoke),
    defaultModel: normalizeText(value.defaultModel),
    effectiveAccessMode: parsePartnerHubAccessMode(
      value.effectiveAccessMode,
      "session",
    ),
    apiKeyModeEnabled: normalizeBoolean(value.apiKeyModeEnabled),
    tenantOverrideApplied: normalizeBoolean(value.tenantOverrideApplied),
    configMode: parsePartnerHubConfigMode(value.configMode, "managed"),
    modelsSource: parsePartnerHubModelsSource(
      value.modelsSource,
      "hub_catalog",
    ),
    developerAccessVisible: normalizeBoolean(value.developerAccessVisible),
    availableModelCount:
      typeof value.availableModelCount === "number"
        ? value.availableModelCount
        : 0,
    fallbackToLocalAllowed: normalizeBoolean(value.fallbackToLocalAllowed),
    currentPlan: normalizeText(value.currentPlan),
    creditsSummary: normalizeText(value.creditsSummary),
    statusReason: normalizeText(value.statusReason),
    tags: normalizeStringArray(value.tags),
  };
}

function parseProviderOfferDetail(value: unknown): OemCloudProviderOfferDetail {
  const summary = parseProviderOfferSummary(value);
  const access = isRecord((value as Record<string, unknown>).access)
    ? ((value as Record<string, unknown>).access as Record<string, unknown>)
    : null;
  if (!access) {
    throw new OemCloudControlPlaneError("服务商详情格式非法");
  }

  const offerId = normalizeText(access.offerId);
  if (!offerId) {
    throw new OemCloudControlPlaneError("服务商详情格式非法");
  }

  return {
    ...summary,
    loginHint: normalizeText((value as Record<string, unknown>).loginHint),
    subscribeHint: normalizeText(
      (value as Record<string, unknown>).subscribeHint,
    ),
    unavailableHint: normalizeText(
      (value as Record<string, unknown>).unavailableHint,
    ),
    access: {
      offerId,
      accessMode: parsePartnerHubAccessMode(
        access.accessMode,
        summary.effectiveAccessMode,
      ),
      sessionTokenRef: normalizeText(access.sessionTokenRef),
      hubTokenRef: normalizeText(access.hubTokenRef),
      hubTokenEnabled: normalizeBoolean(access.hubTokenEnabled),
      lastIssuedAt: normalizeText(access.lastIssuedAt),
    },
  };
}

function parseProviderModelItem(value: unknown): OemCloudProviderModelItem {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("服务商模型格式非法");
  }

  const id = normalizeText(value.id);
  const offerId = normalizeText(value.offerId);
  const modelId = normalizeText(value.modelId);
  const displayName = normalizeText(value.displayName);
  if (!id || !offerId || !modelId || !displayName) {
    throw new OemCloudControlPlaneError("服务商模型格式非法");
  }

  return {
    id,
    offerId,
    modelId,
    displayName,
    description: normalizeText(value.description),
    abilities: normalizeStringArray(value.abilities),
    recommended: normalizeBoolean(value.recommended),
    status: normalizeText(value.status) ?? "active",
    sort: typeof value.sort === "number" ? value.sort : 0,
    upstreamMapping: normalizeText(value.upstreamMapping),
    createdAt: normalizeText(value.createdAt) ?? "",
    updatedAt: normalizeText(value.updatedAt) ?? "",
  };
}

function parseProviderPreference(value: unknown): OemCloudProviderPreference {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("默认服务商配置格式非法");
  }

  const tenantId = normalizeText(value.tenantId);
  const userId = normalizeText(value.userId);
  const providerSource = normalizeText(value.providerSource) as
    | OemCloudProviderSource
    | undefined;
  const providerKey = normalizeText(value.providerKey);
  if (!tenantId || !userId || !providerSource || !providerKey) {
    throw new OemCloudControlPlaneError("默认服务商配置格式非法");
  }

  return {
    tenantId,
    userId,
    providerSource,
    providerKey,
    defaultModel: normalizeText(value.defaultModel),
    needsValidation: normalizeBoolean(value.needsValidation),
    lastValidatedAt: normalizeText(value.lastValidatedAt),
    updatedAt: normalizeText(value.updatedAt) ?? "",
  };
}

function parseFeatureFlags(value: unknown): OemCloudFeatureFlags {
  const record = isRecord(value) ? value : {};
  return {
    oauthLoginEnabled: normalizeBoolean(record.oauthLoginEnabled),
    emailCodeLoginEnabled: normalizeBoolean(record.emailCodeLoginEnabled),
    passwordLoginEnabled: normalizeBoolean(record.passwordLoginEnabled, true),
    profileEditable: normalizeBoolean(record.profileEditable),
    hubTokensEnabled: normalizeBoolean(record.hubTokensEnabled),
    billingEnabled: normalizeBoolean(record.billingEnabled),
    referralEnabled: normalizeBoolean(record.referralEnabled),
    gatewayEnabled: normalizeBoolean(record.gatewayEnabled),
  };
}

const DESKTOP_AUTH_SESSION_STATUS_SET =
  new Set<OemCloudDesktopAuthSessionStatus>([
    "pending_login",
    "pending_consent",
    "approved",
    "denied",
    "cancelled",
    "consumed",
    "expired",
  ]);

function parseDesktopAuthSessionStatus(
  value: unknown,
): OemCloudDesktopAuthSessionStatus {
  const status = normalizeText(value) as
    | OemCloudDesktopAuthSessionStatus
    | undefined;
  if (!status || !DESKTOP_AUTH_SESSION_STATUS_SET.has(status)) {
    throw new OemCloudControlPlaneError("桌面授权状态格式非法");
  }

  return status;
}

function parseDesktopAuthDuration(value: unknown, fieldName: string): number {
  const duration = normalizeNumber(value);
  if (duration === undefined) {
    throw new OemCloudControlPlaneError(`${fieldName} 格式非法`);
  }

  return duration;
}

function parseDesktopAuthSessionStartResponse(
  value: unknown,
): OemCloudDesktopAuthSessionStartResponse {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("桌面授权会话创建结果格式非法");
  }

  const authSessionId = normalizeText(value.authSessionId);
  const deviceCode = normalizeText(value.deviceCode);
  const tenantId = normalizeText(value.tenantId);
  const clientId = normalizeText(value.clientId);
  const clientName = normalizeText(value.clientName);
  const authorizeUrl = normalizeText(value.authorizeUrl);

  if (
    !authSessionId ||
    !deviceCode ||
    !tenantId ||
    !clientId ||
    !clientName ||
    !authorizeUrl
  ) {
    throw new OemCloudControlPlaneError("桌面授权会话创建结果格式非法");
  }

  return {
    authSessionId,
    deviceCode,
    tenantId,
    clientId,
    clientName,
    provider: normalizeText(value.provider),
    desktopRedirectUri: normalizeText(value.desktopRedirectUri),
    status: parseDesktopAuthSessionStatus(value.status),
    expiresInSeconds: parseDesktopAuthDuration(
      value.expiresInSeconds,
      "桌面授权会话过期时间",
    ),
    pollIntervalSeconds: parseDesktopAuthDuration(
      value.pollIntervalSeconds,
      "桌面授权轮询间隔",
    ),
    authorizeUrl,
  };
}

function parseDesktopAuthSessionStatusResponse(
  value: unknown,
): OemCloudDesktopAuthSessionStatusResponse {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("桌面授权状态格式非法");
  }

  const deviceCode = normalizeText(value.deviceCode);
  const tenantId = normalizeText(value.tenantId);
  const clientId = normalizeText(value.clientId);
  const clientName = normalizeText(value.clientName);

  if (!deviceCode || !tenantId || !clientId || !clientName) {
    throw new OemCloudControlPlaneError("桌面授权状态格式非法");
  }

  return {
    deviceCode,
    tenantId,
    clientId,
    clientName,
    provider: normalizeText(value.provider),
    desktopRedirectUri: normalizeText(value.desktopRedirectUri),
    status: parseDesktopAuthSessionStatus(value.status),
    expiresInSeconds: parseDesktopAuthDuration(
      value.expiresInSeconds,
      "桌面授权状态过期时间",
    ),
    pollIntervalSeconds: parseDesktopAuthDuration(
      value.pollIntervalSeconds,
      "桌面授权轮询间隔",
    ),
    sessionToken: normalizeText(value.sessionToken),
    sessionExpiresAt: normalizeText(value.sessionExpiresAt),
  };
}

function parseBootstrap(value: unknown): OemCloudBootstrapResponse {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("bootstrap 格式非法");
  }

  return {
    session: parseCurrentSession(value.session),
    app: {
      id:
        normalizeText(value.app && isRecord(value.app) ? value.app.id : "") ??
        "",
      key:
        normalizeText(value.app && isRecord(value.app) ? value.app.key : "") ??
        "",
      name:
        normalizeText(value.app && isRecord(value.app) ? value.app.name : "") ??
        "",
      slug:
        normalizeText(value.app && isRecord(value.app) ? value.app.slug : "") ??
        "",
      category:
        normalizeText(
          value.app && isRecord(value.app) ? value.app.category : "",
        ) ?? "",
      description:
        normalizeText(
          value.app && isRecord(value.app) ? value.app.description : "",
        ) ?? undefined,
      status:
        normalizeText(
          value.app && isRecord(value.app) ? value.app.status : "",
        ) ?? "",
      distributionChannels: normalizeStringArray(
        value.app && isRecord(value.app) ? value.app.distributionChannels : [],
      ),
    },
    providerOffersSummary: Array.isArray(value.providerOffersSummary)
      ? value.providerOffersSummary.map(parseProviderOfferSummary)
      : [],
    providerPreference: parseProviderPreference(value.providerPreference),
    serviceSkillCatalog: value.serviceSkillCatalog,
    siteAdapterCatalog: value.siteAdapterCatalog ?? value.site_adapter_catalog,
    sceneCatalog: Array.isArray(value.sceneCatalog)
      ? value.sceneCatalog
          .filter((item) => isRecord(item) && normalizeText(item.id))
          .map((item) => ({
            id: normalizeText((item as Record<string, unknown>).id) ?? "",
          }))
      : [],
    features: parseFeatureFlags(value.features),
    gateway:
      value.gateway && isRecord(value.gateway)
        ? {
            basePath: normalizeText(value.gateway.basePath),
            chatCompletionsPath: normalizeText(
              value.gateway.chatCompletionsPath,
            ),
          }
        : undefined,
  };
}

export function getConfiguredOemCloudTarget() {
  const runtime = ensureRuntime();
  return {
    baseUrl: runtime.baseUrl,
    tenantId: runtime.tenantId,
  };
}

export async function sendClientAuthEmailCode(
  tenantId: string,
  payload: SendClientAuthEmailCodePayload,
): Promise<SendAuthEmailCodeResponse> {
  return requestControlPlane<SendAuthEmailCodeResponse>(
    `/v1/public/tenants/${encodeURIComponent(tenantId)}/auth/email-code/send`,
    {
      method: "POST",
      payload,
    },
  );
}

export async function createClientDesktopAuthSession(
  tenantId: string,
  payload: CreateClientDesktopAuthSessionPayload,
): Promise<OemCloudDesktopAuthSessionStartResponse> {
  return parseDesktopAuthSessionStartResponse(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/desktop/auth-sessions`,
      {
        method: "POST",
        payload,
      },
    ),
  );
}

export async function pollClientDesktopAuthSession(
  deviceCode: string,
): Promise<OemCloudDesktopAuthSessionStatusResponse> {
  return parseDesktopAuthSessionStatusResponse(
    await requestControlPlane<unknown>(
      `/v1/public/desktop/auth-sessions/${encodeURIComponent(deviceCode)}/poll`,
      {
        method: "POST",
      },
    ),
  );
}

export async function verifyClientAuthEmailCode(
  tenantId: string,
  payload: VerifyClientAuthEmailCodePayload,
): Promise<OemCloudCurrentSession> {
  return parseCurrentSession(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/auth/email-code/verify`,
      {
        method: "POST",
        payload,
      },
    ),
  );
}

export async function loginClientByPassword(
  tenantId: string,
  payload: ClientPasswordLoginPayload,
): Promise<OemCloudCurrentSession> {
  return parseCurrentSession(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/auth/password/login`,
      {
        method: "POST",
        payload,
      },
    ),
  );
}

export async function getClientBootstrap(
  tenantId: string,
): Promise<OemCloudBootstrapResponse> {
  return parseBootstrap(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/bootstrap`,
      {
        auth: true,
      },
    ),
  );
}

export async function getClientSession(
  tenantId: string,
): Promise<OemCloudCurrentSession> {
  return parseCurrentSession(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/session`,
      {
        auth: true,
      },
    ),
  );
}

export async function listClientProviderOffers(
  tenantId: string,
): Promise<OemCloudProviderOfferSummary[]> {
  const payload = await requestControlPlane<{ items?: unknown[] }>(
    `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/provider-offers`,
    {
      auth: true,
    },
  );
  return Array.isArray(payload.items)
    ? payload.items.map(parseProviderOfferSummary)
    : [];
}

export async function getClientProviderOffer(
  tenantId: string,
  providerKey: string,
): Promise<OemCloudProviderOfferDetail> {
  return parseProviderOfferDetail(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/provider-offers/${encodeURIComponent(providerKey)}`,
      {
        auth: true,
      },
    ),
  );
}

export async function listClientProviderOfferModels(
  tenantId: string,
  providerKey: string,
): Promise<OemCloudProviderModelItem[]> {
  const payload = await requestControlPlane<{ items?: unknown[] }>(
    `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/provider-offers/${encodeURIComponent(providerKey)}/models`,
    {
      auth: true,
    },
  );
  return Array.isArray(payload.items)
    ? payload.items.map(parseProviderModelItem)
    : [];
}

export async function getClientProviderPreference(
  tenantId: string,
): Promise<OemCloudProviderPreference> {
  return parseProviderPreference(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/provider-preferences`,
      {
        auth: true,
      },
    ),
  );
}

export async function updateClientProviderPreference(
  tenantId: string,
  payload: UpdateClientProviderPreferencePayload,
): Promise<OemCloudProviderPreference> {
  return parseProviderPreference(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/provider-preferences`,
      {
        method: "PUT",
        payload,
        auth: true,
      },
    ),
  );
}

export async function logoutClient(tenantId: string): Promise<void> {
  await requestControlPlane<unknown>(
    `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/logout`,
    {
      method: "POST",
      auth: true,
    },
  );
}
