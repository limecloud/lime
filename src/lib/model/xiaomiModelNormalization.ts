function normalizeText(value?: string | null): string {
  return (value || "").trim().toLowerCase();
}

const XIAOMI_HOST_KEYWORDS = ["xiaomimimo.com"];

const XIAOMI_MODEL_ID_ALIASES: Record<string, string> = {
  "mimo-v2-pro": "mimo-v2.5-pro",
  "mimo-v2.5": "mimo-v2.5-pro",
  "mimo-v2.5-pro": "mimo-v2.5-pro",
};

export function isXiaomiLikeProvider(options: {
  providerId?: string | null;
  providerType?: string | null;
  apiHost?: string | null;
}): boolean {
  const providerId = normalizeText(options.providerId);
  const providerType = normalizeText(options.providerType);
  const apiHost = normalizeText(options.apiHost);

  return (
    providerId === "xiaomi" ||
    providerId === "mimo" ||
    providerId === "xiaomimimo" ||
    providerType === "xiaomi" ||
    providerType === "mimo" ||
    providerType === "xiaomimimo" ||
    XIAOMI_HOST_KEYWORDS.some((keyword) => apiHost.includes(keyword))
  );
}

export function canonicalizeXiaomiModelId(modelId?: string | null): string {
  const trimmed = (modelId || "").trim();
  if (!trimmed) {
    return "";
  }

  const normalized = normalizeText(trimmed);
  return XIAOMI_MODEL_ID_ALIASES[normalized] || trimmed;
}

export function canonicalizeKnownProviderModelId(options: {
  providerId?: string | null;
  providerType?: string | null;
  apiHost?: string | null;
  modelId?: string | null;
}): string {
  const trimmed = (options.modelId || "").trim();
  if (!trimmed) {
    return "";
  }

  if (
    isXiaomiLikeProvider({
      providerId: options.providerId,
      providerType: options.providerType,
      apiHost: options.apiHost,
    })
  ) {
    return canonicalizeXiaomiModelId(trimmed);
  }

  return trimmed;
}
