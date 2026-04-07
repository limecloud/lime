const OEM_CLOUD_SESSION_STORAGE_KEY = "lime:oem-cloud-session:v1";
export const OEM_CLOUD_SESSION_CHANGED_EVENT = "lime:oem-cloud-session-changed";
export const OEM_CLOUD_BOOTSTRAP_CHANGED_EVENT =
  "lime:oem-cloud-bootstrap-changed";

export interface OemCloudTenantLike {
  id: string;
  name?: string;
  slug?: string;
}

export interface OemCloudUserLike {
  id: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  username?: string;
  passwordConfigured?: boolean;
  roles?: string[];
}

export interface OemCloudUserSessionLike {
  id: string;
  tenantId?: string;
  userId?: string;
  provider?: string;
  roles?: string[];
  issuedAt?: string;
  expiresAt?: string;
}

export interface OemCloudCurrentSessionLike {
  token?: string;
  tenant: OemCloudTenantLike;
  user: OemCloudUserLike;
  session: OemCloudUserSessionLike;
}

export interface OemCloudStoredSessionState {
  token: string;
  session: OemCloudCurrentSessionLike;
  savedAt: string;
}

declare global {
  interface Window {
    __LIME_BOOTSTRAP__?: unknown;
    __LIME_OEM_CLOUD__?: unknown;
    __LIME_SESSION_TOKEN__?: unknown;
  }
}

function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeAccessToken(value: unknown): string | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return normalized;
  }

  return normalizeText(match[1]);
}

function normalizeSessionLike(
  value: unknown,
): OemCloudCurrentSessionLike | null {
  if (!isRecord(value)) {
    return null;
  }

  const tenant = isRecord(value.tenant) ? value.tenant : null;
  const user = isRecord(value.user) ? value.user : null;
  const session = isRecord(value.session) ? value.session : null;

  const tenantId = normalizeText(tenant?.id);
  const userId = normalizeText(user?.id);
  const sessionId = normalizeText(session?.id);
  if (!tenantId || !userId || !sessionId) {
    return null;
  }

  return {
    token: normalizeAccessToken(value.token) ?? undefined,
    tenant: {
      id: tenantId,
      name: normalizeText(tenant?.name) ?? undefined,
      slug: normalizeText(tenant?.slug) ?? undefined,
    },
    user: {
      id: userId,
      email: normalizeText(user?.email) ?? undefined,
      displayName: normalizeText(user?.displayName) ?? undefined,
      avatarUrl: normalizeText(user?.avatarUrl) ?? undefined,
      username: normalizeText(user?.username) ?? undefined,
      passwordConfigured:
        typeof user?.passwordConfigured === "boolean"
          ? user.passwordConfigured
          : undefined,
      roles: Array.isArray(user?.roles)
        ? user.roles
            .map((item) => normalizeText(item))
            .filter((item): item is string => Boolean(item))
        : undefined,
    },
    session: {
      id: sessionId,
      tenantId: normalizeText(session?.tenantId) ?? tenantId,
      userId: normalizeText(session?.userId) ?? userId,
      provider: normalizeText(session?.provider) ?? undefined,
      roles: Array.isArray(session?.roles)
        ? session.roles
            .map((item) => normalizeText(item))
            .filter((item): item is string => Boolean(item))
        : undefined,
      issuedAt: normalizeText(session?.issuedAt) ?? undefined,
      expiresAt: normalizeText(session?.expiresAt) ?? undefined,
    },
  };
}

function normalizeStoredSessionState(
  value: unknown,
): OemCloudStoredSessionState | null {
  if (!isRecord(value)) {
    return null;
  }

  const session = normalizeSessionLike(value.session);
  const token =
    normalizeAccessToken(value.token) ?? normalizeAccessToken(session?.token);
  if (!session || !token) {
    return null;
  }

  return {
    token,
    session: {
      ...session,
      token,
    },
    savedAt: normalizeText(value.savedAt) ?? new Date().toISOString(),
  };
}

function emitSessionChanged(state: OemCloudStoredSessionState | null) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(OEM_CLOUD_SESSION_CHANGED_EVENT, {
      detail: {
        hasSession: Boolean(state),
        tenantId: state?.session.tenant.id ?? null,
        sessionId: state?.session.session.id ?? null,
      },
    }),
  );
}

function emitBootstrapChanged(payload: unknown): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(OEM_CLOUD_BOOTSTRAP_CHANGED_EVENT, {
      detail: {
        hasBootstrap: payload !== undefined && payload !== null,
      },
    }),
  );
}

function applySessionGlobals(state: OemCloudStoredSessionState | null) {
  if (typeof window === "undefined") {
    return;
  }

  if (!state) {
    delete window.__LIME_SESSION_TOKEN__;
    delete window.__LIME_BOOTSTRAP__;
    return;
  }

  window.__LIME_SESSION_TOKEN__ = state.token;

  const currentRuntime = isRecord(window.__LIME_OEM_CLOUD__)
    ? window.__LIME_OEM_CLOUD__
    : {};
  window.__LIME_OEM_CLOUD__ = {
    ...currentRuntime,
    tenantId: state.session.tenant.id,
  };
}

export function getStoredOemCloudSessionState(): OemCloudStoredSessionState | null {
  if (!canUseStorage()) {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(OEM_CLOUD_SESSION_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue);
    const normalized = normalizeStoredSessionState(parsed);
    if (!normalized) {
      window.localStorage.removeItem(OEM_CLOUD_SESSION_STORAGE_KEY);
      return null;
    }
    return normalized;
  } catch {
    window.localStorage.removeItem(OEM_CLOUD_SESSION_STORAGE_KEY);
    return null;
  }
}

export function getStoredOemCloudAccessToken(): string | null {
  return getStoredOemCloudSessionState()?.token ?? null;
}

export function getStoredOemCloudTenantId(): string | null {
  return getStoredOemCloudSessionState()?.session.tenant.id ?? null;
}

export function setStoredOemCloudSessionState(
  session: OemCloudCurrentSessionLike,
): OemCloudStoredSessionState {
  const normalizedSession = normalizeSessionLike(session);
  const token =
    normalizeAccessToken(session.token) ??
    normalizeAccessToken(normalizedSession?.token);
  if (!normalizedSession || !token) {
    throw new Error("缺少有效的 OEM 云端 Session Token");
  }

  const nextState: OemCloudStoredSessionState = {
    token,
    session: {
      ...normalizedSession,
      token,
    },
    savedAt: new Date().toISOString(),
  };

  if (canUseStorage()) {
    window.localStorage.setItem(
      OEM_CLOUD_SESSION_STORAGE_KEY,
      JSON.stringify(nextState),
    );
  }
  applySessionGlobals(nextState);
  emitSessionChanged(nextState);
  return nextState;
}

export function clearStoredOemCloudSessionState(): void {
  if (canUseStorage()) {
    window.localStorage.removeItem(OEM_CLOUD_SESSION_STORAGE_KEY);
  }
  applySessionGlobals(null);
  emitSessionChanged(null);
}

export function applyStoredOemCloudSessionToWindow(): OemCloudStoredSessionState | null {
  const current = getStoredOemCloudSessionState();
  applySessionGlobals(current);
  return current;
}

export function setOemCloudBootstrapSnapshot(payload: unknown): void {
  if (typeof window === "undefined") {
    return;
  }

  window.__LIME_BOOTSTRAP__ = payload;
  emitBootstrapChanged(payload);
}

export function getOemCloudBootstrapSnapshot<T = unknown>(): T | null {
  if (
    typeof window === "undefined" ||
    window.__LIME_BOOTSTRAP__ === undefined
  ) {
    return null;
  }

  return window.__LIME_BOOTSTRAP__ as T;
}

export function clearOemCloudBootstrapSnapshot(): void {
  if (typeof window === "undefined") {
    return;
  }

  delete window.__LIME_BOOTSTRAP__;
  emitBootstrapChanged(null);
}

export function subscribeOemCloudSessionChanged(
  listener: (state: OemCloudStoredSessionState | null) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleCustomEvent = () => {
    listener(getStoredOemCloudSessionState());
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== OEM_CLOUD_SESSION_STORAGE_KEY) {
      return;
    }
    listener(getStoredOemCloudSessionState());
  };

  window.addEventListener(OEM_CLOUD_SESSION_CHANGED_EVENT, handleCustomEvent);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(
      OEM_CLOUD_SESSION_CHANGED_EVENT,
      handleCustomEvent,
    );
    window.removeEventListener("storage", handleStorage);
  };
}

export function subscribeOemCloudBootstrapChanged(
  listener: (payload: unknown) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleCustomEvent = () => {
    listener(getOemCloudBootstrapSnapshot());
  };

  window.addEventListener(OEM_CLOUD_BOOTSTRAP_CHANGED_EVENT, handleCustomEvent);

  return () => {
    window.removeEventListener(
      OEM_CLOUD_BOOTSTRAP_CHANGED_EVENT,
      handleCustomEvent,
    );
  };
}
