import { claimClientReferral } from "@/lib/api/oemCloudControlPlane";
import { getStoredOemCloudSessionState } from "@/lib/oemCloudSession";

const OEM_CLOUD_REFERRAL_PENDING_STORAGE_KEY =
  "lime:oem-cloud-referral:pending";
const OEM_CLOUD_REFERRAL_PENDING_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type OemCloudReferralClaimStatus =
  | "claimed"
  | "pending_login"
  | "tenant_mismatch"
  | "ignored";

export interface OemCloudReferralInviteDetail {
  code: string;
  tenantId?: string;
  sourceUrl: string;
  landingPath: string;
  capturedAt: string;
  receivedAt: number;
}

export interface OemCloudReferralClaimResult {
  status: OemCloudReferralClaimStatus;
  detail?: OemCloudReferralInviteDetail;
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function normalizeInviteCode(value: unknown): string | undefined {
  return normalizeText(value)?.toUpperCase();
}

function isFreshReferralInvite(detail: OemCloudReferralInviteDetail): boolean {
  return (
    Date.now() - detail.receivedAt <= OEM_CLOUD_REFERRAL_PENDING_MAX_AGE_MS
  );
}

function toReferralInviteDetail(
  value: unknown,
): OemCloudReferralInviteDetail | null {
  if (!isRecord(value)) {
    return null;
  }

  const code = normalizeInviteCode(value.code);
  const sourceUrl = normalizeText(value.sourceUrl);
  const landingPath = normalizeText(value.landingPath);
  const capturedAt = normalizeText(value.capturedAt);
  const receivedAt =
    typeof value.receivedAt === "number" ? value.receivedAt : Number.NaN;
  if (
    !code ||
    !sourceUrl ||
    !landingPath ||
    !capturedAt ||
    !Number.isFinite(receivedAt)
  ) {
    return null;
  }

  return {
    code,
    tenantId: normalizeText(value.tenantId),
    sourceUrl,
    landingPath,
    capturedAt,
    receivedAt,
  };
}

export function parseOemCloudReferralInviteUrl(
  value: string,
): OemCloudReferralInviteDetail | null {
  try {
    const parsed = new URL(value);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "") || "/";
    const isLimeInvite =
      parsed.protocol === "lime:" &&
      ["invite", "referral"].includes(parsed.hostname);
    const isWebInvite =
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      /(^|\/)(invite|referral)(\/|$)/i.test(normalizedPath);

    if (!isLimeInvite && !isWebInvite) {
      return null;
    }

    const code = normalizeInviteCode(
      parsed.searchParams.get("code") ??
        parsed.searchParams.get("inviteCode") ??
        parsed.searchParams.get("referralCode"),
    );
    if (!code) {
      return null;
    }

    return {
      code,
      tenantId: normalizeText(parsed.searchParams.get("tenantId")),
      sourceUrl: value,
      landingPath: isLimeInvite
        ? `/${parsed.hostname}${parsed.pathname}${parsed.search}${parsed.hash}`
        : `${parsed.pathname}${parsed.search}${parsed.hash}`,
      capturedAt: new Date().toISOString(),
      receivedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

export function storeOemCloudReferralInvite(
  detail: OemCloudReferralInviteDetail,
): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    OEM_CLOUD_REFERRAL_PENDING_STORAGE_KEY,
    JSON.stringify(detail),
  );
}

export function readStoredOemCloudReferralInvite(): OemCloudReferralInviteDetail | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const detail = toReferralInviteDetail(
      JSON.parse(
        window.localStorage.getItem(OEM_CLOUD_REFERRAL_PENDING_STORAGE_KEY) ||
          "null",
      ),
    );
    if (!detail) {
      return null;
    }
    if (!isFreshReferralInvite(detail)) {
      window.localStorage.removeItem(OEM_CLOUD_REFERRAL_PENDING_STORAGE_KEY);
      return null;
    }
    return detail;
  } catch {
    window.localStorage.removeItem(OEM_CLOUD_REFERRAL_PENDING_STORAGE_KEY);
    return null;
  }
}

export function clearStoredOemCloudReferralInvite(code?: string): void {
  if (typeof window === "undefined") {
    return;
  }

  if (code) {
    const detail = readStoredOemCloudReferralInvite();
    if (detail?.code && detail.code !== normalizeInviteCode(code)) {
      return;
    }
  }

  window.localStorage.removeItem(OEM_CLOUD_REFERRAL_PENDING_STORAGE_KEY);
}

export async function claimOemCloudReferralInvite(
  detail: OemCloudReferralInviteDetail,
): Promise<OemCloudReferralClaimResult> {
  const sessionState = getStoredOemCloudSessionState();
  if (!sessionState) {
    storeOemCloudReferralInvite(detail);
    return {
      status: "pending_login",
      detail,
    };
  }

  const tenantId = sessionState.session.tenant.id;
  if (detail.tenantId && detail.tenantId !== tenantId) {
    return {
      status: "tenant_mismatch",
      detail,
    };
  }

  await claimClientReferral(tenantId, {
    code: detail.code,
    claimMethod: "auto",
    entrySource: "link",
    landingPath: detail.landingPath,
    capturedAt: detail.capturedAt,
  });
  clearStoredOemCloudReferralInvite(detail.code);
  return {
    status: "claimed",
    detail,
  };
}

export async function claimStoredOemCloudReferralInvite(): Promise<OemCloudReferralClaimResult> {
  const detail = readStoredOemCloudReferralInvite();
  if (!detail) {
    return { status: "ignored" };
  }

  return claimOemCloudReferralInvite(detail);
}

export async function handleOemCloudReferralInviteUrl(
  value: string,
): Promise<OemCloudReferralClaimResult> {
  const detail = parseOemCloudReferralInviteUrl(value);
  if (!detail) {
    return { status: "ignored" };
  }

  return claimOemCloudReferralInvite(detail);
}
