import type {
  OemCloudBootstrapResponse,
  OemCloudReferralDashboard,
} from "@/lib/api/oemCloudControlPlane";

const OEM_CLOUD_REFERRAL_CACHE_KEY = "lime:oem-cloud-referral:cache:v1";

export interface OemCloudReferralCachedState {
  tenantId: string;
  referralEnabled: boolean;
  dashboard?: OemCloudReferralDashboard;
  cachedAt: string;
}

type ReferralCacheStore = Record<string, OemCloudReferralCachedState>;

function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
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

function isReferralDashboard(value: unknown): value is OemCloudReferralDashboard {
  if (!isRecord(value) || !isRecord(value.share) || !isRecord(value.code)) {
    return false;
  }

  return Boolean(normalizeText(value.share.code) || normalizeText(value.code.code));
}

function readStore(): ReferralCacheStore {
  if (!canUseStorage()) {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(OEM_CLOUD_REFERRAL_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return isRecord(parsed) ? (parsed as ReferralCacheStore) : {};
  } catch {
    window.localStorage.removeItem(OEM_CLOUD_REFERRAL_CACHE_KEY);
    return {};
  }
}

function writeStore(store: ReferralCacheStore): void {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(
    OEM_CLOUD_REFERRAL_CACHE_KEY,
    JSON.stringify(store),
  );
}

function normalizeCachedState(
  value: unknown,
): OemCloudReferralCachedState | null {
  if (!isRecord(value)) {
    return null;
  }

  const tenantId = normalizeText(value.tenantId);
  if (!tenantId) {
    return null;
  }

  const dashboard = isReferralDashboard(value.dashboard)
    ? value.dashboard
    : undefined;

  return {
    tenantId,
    referralEnabled:
      typeof value.referralEnabled === "boolean"
        ? value.referralEnabled
        : dashboard?.policy.enabled !== false,
    dashboard,
    cachedAt: normalizeText(value.cachedAt) ?? new Date(0).toISOString(),
  };
}

export function readCachedOemCloudReferralState(
  tenantId?: string | null,
): OemCloudReferralCachedState | null {
  const store = readStore();
  const normalizedTenantId = normalizeText(tenantId);
  if (normalizedTenantId) {
    return normalizeCachedState(store[normalizedTenantId]);
  }

  return Object.values(store)
    .map(normalizeCachedState)
    .filter((item): item is OemCloudReferralCachedState => Boolean(item))
    .sort((left, right) => right.cachedAt.localeCompare(left.cachedAt))[0] ?? null;
}

export function cacheOemCloudReferralState(
  state: Omit<OemCloudReferralCachedState, "cachedAt">,
): OemCloudReferralCachedState {
  const nextState: OemCloudReferralCachedState = {
    ...state,
    dashboard: state.referralEnabled ? state.dashboard : undefined,
    cachedAt: new Date().toISOString(),
  };
  const store = readStore();
  store[nextState.tenantId] = nextState;
  writeStore(store);
  return nextState;
}

export function cacheOemCloudReferralStateFromBootstrap(
  bootstrap: OemCloudBootstrapResponse | unknown,
): OemCloudReferralCachedState | null {
  if (!isRecord(bootstrap)) {
    return null;
  }

  const session = isRecord(bootstrap.session) ? bootstrap.session : {};
  const tenant = isRecord(session.tenant) ? session.tenant : {};
  const features = isRecord(bootstrap.features) ? bootstrap.features : {};
  const tenantId = normalizeText(tenant.id);
  if (!tenantId) {
    return null;
  }

  const referralEnabled = features.referralEnabled !== false;
  const dashboard = isReferralDashboard(bootstrap.referral)
    ? bootstrap.referral
    : undefined;
  return cacheOemCloudReferralState({
    tenantId,
    referralEnabled,
    dashboard: referralEnabled ? dashboard : undefined,
  });
}

export function cacheOemCloudReferralDashboard(
  tenantId: string,
  dashboard: OemCloudReferralDashboard,
): OemCloudReferralCachedState {
  return cacheOemCloudReferralState({
    tenantId,
    referralEnabled: dashboard.policy.enabled !== false,
    dashboard,
  });
}
