export const OEM_CLOUD_PAYMENT_RETURN_EVENT = "lime:oem-cloud-payment-return";

const OEM_CLOUD_PAYMENT_RETURN_STORAGE_KEY =
  "lime:oem-cloud-payment-return:last";
const OEM_CLOUD_PAYMENT_RETURN_MAX_AGE_MS = 30 * 60 * 1000;

export type OemCloudPaymentReturnKind =
  | "plan_order"
  | "credit_topup_order"
  | (string & {});

export interface OemCloudPaymentReturnDetail {
  tenantId?: string;
  orderId?: string;
  kind?: OemCloudPaymentReturnKind;
  provider?: string;
  status?: string;
  sourceUrl: string;
  receivedAt: number;
}

export interface BuildOemCloudPaymentReturnUrlInput {
  tenantId: string;
  orderId: string;
  kind: OemCloudPaymentReturnKind;
  status?: string;
}

export interface BuildOemCloudPaymentReturnBridgeUrlInput extends BuildOemCloudPaymentReturnUrlInput {
  controlPlaneBaseUrl: string;
  provider: string;
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

function isFreshPaymentReturn(detail: OemCloudPaymentReturnDetail) {
  return Date.now() - detail.receivedAt <= OEM_CLOUD_PAYMENT_RETURN_MAX_AGE_MS;
}

function toPaymentReturnDetail(
  value: unknown,
): OemCloudPaymentReturnDetail | null {
  if (!isRecord(value)) {
    return null;
  }

  const sourceUrl = normalizeText(value.sourceUrl);
  const receivedAt =
    typeof value.receivedAt === "number" ? value.receivedAt : Number.NaN;
  if (!sourceUrl || !Number.isFinite(receivedAt)) {
    return null;
  }

  const detail: OemCloudPaymentReturnDetail = {
    sourceUrl,
    receivedAt,
  };
  const tenantId = normalizeText(value.tenantId);
  const orderId = normalizeText(value.orderId);
  const kind = normalizeText(value.kind);
  const provider = normalizeText(value.provider);
  const status = normalizeText(value.status);
  if (tenantId) detail.tenantId = tenantId;
  if (orderId) detail.orderId = orderId;
  if (kind) detail.kind = kind;
  if (provider) detail.provider = provider;
  if (status) detail.status = status;
  return detail;
}

export function buildOemCloudPaymentReturnUrl(
  input: BuildOemCloudPaymentReturnUrlInput,
): string {
  const url = new URL("lime://payment/return");
  url.searchParams.set("tenantId", input.tenantId);
  url.searchParams.set("orderId", input.orderId);
  url.searchParams.set("kind", input.kind);
  if (input.status) {
    url.searchParams.set("status", input.status);
  }
  return url.toString();
}

export function buildOemCloudPaymentReturnBridgeUrl(
  input: BuildOemCloudPaymentReturnBridgeUrlInput,
): string {
  const baseUrl = input.controlPlaneBaseUrl.replace(/\/+$/, "");
  const url = new URL(
    `${baseUrl}/v1/public/tenants/${encodeURIComponent(
      input.tenantId,
    )}/payments/${encodeURIComponent(input.provider)}/return`,
  );
  url.searchParams.set("orderId", input.orderId);
  url.searchParams.set("kind", input.kind);
  if (input.status) {
    url.searchParams.set("status", input.status);
  }
  return url.toString();
}

export function parseOemCloudPaymentReturnUrl(
  value: string,
): OemCloudPaymentReturnDetail | null {
  try {
    const parsed = new URL(value);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "") || "/";
    if (
      parsed.protocol !== "lime:" ||
      parsed.hostname !== "payment" ||
      normalizedPath !== "/return"
    ) {
      return null;
    }

    const detail: OemCloudPaymentReturnDetail = {
      sourceUrl: value,
      receivedAt: Date.now(),
    };
    const tenantId = normalizeText(parsed.searchParams.get("tenantId"));
    const orderId = normalizeText(parsed.searchParams.get("orderId"));
    const kind = normalizeText(parsed.searchParams.get("kind"));
    const provider = normalizeText(parsed.searchParams.get("provider"));
    const status = normalizeText(parsed.searchParams.get("status"));
    if (tenantId) detail.tenantId = tenantId;
    if (orderId) detail.orderId = orderId;
    if (kind) detail.kind = kind;
    if (provider) detail.provider = provider;
    if (status) detail.status = status;
    return detail;
  } catch {
    return null;
  }
}

export function storeOemCloudPaymentReturn(
  detail: OemCloudPaymentReturnDetail,
): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    OEM_CLOUD_PAYMENT_RETURN_STORAGE_KEY,
    JSON.stringify(detail),
  );
}

export function readStoredOemCloudPaymentReturn(): OemCloudPaymentReturnDetail | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const detail = toPaymentReturnDetail(
      JSON.parse(
        window.localStorage.getItem(OEM_CLOUD_PAYMENT_RETURN_STORAGE_KEY) ||
          "null",
      ),
    );
    if (!detail) {
      return null;
    }
    if (!isFreshPaymentReturn(detail)) {
      window.localStorage.removeItem(OEM_CLOUD_PAYMENT_RETURN_STORAGE_KEY);
      return null;
    }
    return detail;
  } catch {
    window.localStorage.removeItem(OEM_CLOUD_PAYMENT_RETURN_STORAGE_KEY);
    return null;
  }
}

export function clearStoredOemCloudPaymentReturn(sourceUrl?: string): void {
  if (typeof window === "undefined") {
    return;
  }

  if (sourceUrl) {
    const detail = readStoredOemCloudPaymentReturn();
    if (detail?.sourceUrl && detail.sourceUrl !== sourceUrl) {
      return;
    }
  }

  window.localStorage.removeItem(OEM_CLOUD_PAYMENT_RETURN_STORAGE_KEY);
}

export function consumeStoredOemCloudPaymentReturn(
  tenantId?: string,
): OemCloudPaymentReturnDetail | null {
  const detail = readStoredOemCloudPaymentReturn();
  if (!detail) {
    return null;
  }

  if (tenantId && detail.tenantId && detail.tenantId !== tenantId) {
    return null;
  }

  clearStoredOemCloudPaymentReturn(detail.sourceUrl);
  return detail;
}

export function dispatchOemCloudPaymentReturn(
  detail: OemCloudPaymentReturnDetail,
): void {
  if (typeof window === "undefined") {
    return;
  }

  storeOemCloudPaymentReturn(detail);
  window.dispatchEvent(
    new CustomEvent<OemCloudPaymentReturnDetail>(
      OEM_CLOUD_PAYMENT_RETURN_EVENT,
      {
        detail,
      },
    ),
  );
}
