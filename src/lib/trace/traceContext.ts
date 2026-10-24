export interface W3cTraceContextCarrier {
  traceparent: string;
  tracestate: string | null;
  traceId: string;
}

function isLowercaseHex(value: string): boolean {
  return /^[0-9a-f]+$/.test(value);
}

function isNonZeroHex(value: string): boolean {
  return isLowercaseHex(value) && !/^0+$/.test(value);
}

function randomUuidHex(): string | null {
  const randomUuid =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : null;
  const hex =
    typeof randomUuid === "string"
      ? randomUuid.replaceAll("-", "").toLowerCase()
      : null;
  return hex && hex.length >= 32 && isLowercaseHex(hex)
    ? hex.slice(0, 32)
    : null;
}

function fallbackRandomHex(length: number): string {
  let value = "";
  while (value.length < length) {
    value += Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, "0");
  }
  return value.slice(0, length);
}

function randomNonZeroHex(length: number): string {
  const uuidHex = randomUuidHex();
  const candidate =
    uuidHex && length <= uuidHex.length
      ? length === 16 && isNonZeroHex(uuidHex.slice(16, 32))
        ? uuidHex.slice(16, 32)
        : uuidHex.slice(0, length)
      : fallbackRandomHex(length);
  if (isNonZeroHex(candidate)) {
    return candidate;
  }
  return `${"0".repeat(Math.max(0, length - 1))}1`;
}

export function createTraceId(prefix = "trace"): string {
  const normalizedPrefix = prefix.trim() || "trace";
  const randomUuid =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replaceAll("-", "")
      : null;

  if (randomUuid) {
    return `${normalizedPrefix}_${randomUuid}`;
  }

  return `${normalizedPrefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export function normalizeW3cTraceContextCarrier(
  value: unknown,
): W3cTraceContextCarrier | null {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const traceparent =
    typeof record?.traceparent === "string"
      ? normalizeW3cTraceparent(record.traceparent)
      : null;
  if (!traceparent) {
    return null;
  }
  const tracestate =
    typeof record?.tracestate === "string"
      ? normalizeW3cTracestate(record.tracestate)
      : null;
  return {
    traceparent: traceparent.traceparent,
    tracestate,
    traceId: traceparent.traceId,
  };
}

export function createW3cTraceContextCarrier(): W3cTraceContextCarrier {
  const traceId = randomNonZeroHex(32);
  const parentId = randomNonZeroHex(16);
  return {
    traceparent: `00-${traceId}-${parentId}-01`,
    tracestate: null,
    traceId,
  };
}

function normalizeW3cTraceparent(
  value: string,
): Pick<W3cTraceContextCarrier, "traceparent" | "traceId"> | null {
  const normalized = value.trim().toLowerCase();
  const parts = normalized.split("-");
  if (parts.length !== 4) {
    return null;
  }
  const [version, traceId, parentId, flags] = parts;
  if (
    version !== "00" ||
    traceId.length !== 32 ||
    parentId.length !== 16 ||
    flags.length !== 2 ||
    !isNonZeroHex(traceId) ||
    !isNonZeroHex(parentId) ||
    !isLowercaseHex(flags)
  ) {
    return null;
  }
  return {
    traceparent: `${version}-${traceId}-${parentId}-${flags}`,
    traceId,
  };
}

function normalizeW3cTracestate(value: string): string | null {
  const normalized = value.trim();
  if (!normalized || normalized.length > 256) {
    return null;
  }
  return /^[\x20-\x7e]+$/.test(normalized) ? normalized : null;
}
