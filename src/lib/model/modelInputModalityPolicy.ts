export const LIME_DEFAULT_INPUT_MODALITIES = ["text", "image"] as const;

export const MODEL_INPUT_MODALITIES = [
  "text",
  "image",
  "audio",
  "video",
  "file",
  "embedding",
  "json",
  "pdf",
] as const;

export const MODEL_INPUT_GATE_MODALITIES = [
  "text",
  "image",
  "audio",
  "video",
  "file",
] as const;

export type ModelInputModality = (typeof MODEL_INPUT_MODALITIES)[number];
export type ModelInputGateModality =
  (typeof MODEL_INPUT_GATE_MODALITIES)[number];
export type ModelInputModalityPolicySource = "lime_default" | "explicit";

export interface ModelInputModalityPolicyInput {
  input_modalities?: unknown;
  inputModalities?: unknown;
  modalities?: unknown;
}

export interface ModelInputModalityPolicy {
  input_modalities: ModelInputModality[];
  send_gate_modalities: ModelInputGateModality[];
  unknown_input_modalities: string[];
  supports_text_input: boolean;
  supports_media_input: boolean;
  supports_image_input: boolean;
  source: ModelInputModalityPolicySource;
}

const MODEL_INPUT_MODALITY_SET = new Set<string>(MODEL_INPUT_MODALITIES);
const MEDIA_INPUT_MODALITY_SET = new Set<ModelInputModality>([
  "image",
  "audio",
  "video",
  "file",
  "pdf",
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstPresent<T>(
  input: ModelInputModalityPolicyInput,
  keys: Array<keyof ModelInputModalityPolicyInput>,
): T | undefined {
  for (const key of keys) {
    const value = input[key];
    if (value !== undefined && value !== null) {
      return value as T;
    }
  }
  return undefined;
}

function inputModalitiesFromNestedSource(
  input: ModelInputModalityPolicyInput,
): unknown {
  const modalities = firstPresent(input, ["modalities"]);
  if (!isPlainRecord(modalities)) {
    return undefined;
  }
  return modalities.input;
}

function normalizeToken(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replaceAll("-", "_").toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function modalityTokensFromValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const token = normalizeToken(item);
      return token ? [token] : [];
    });
  }

  const token = normalizeToken(value);
  if (token) {
    return [token];
  }

  if (!isPlainRecord(value)) {
    return [];
  }

  return Object.entries(value).flatMap(([key, enabled]) => {
    if (enabled !== true) {
      return [];
    }
    const normalized = normalizeToken(key);
    return normalized ? [normalized] : [];
  });
}

function normalizeInputModalities(value: unknown): {
  inputModalities: ModelInputModality[];
  unknownInputModalities: string[];
} {
  const known = new Set<ModelInputModality>();
  const unknown: string[] = [];
  const seenUnknown = new Set<string>();

  for (const token of modalityTokensFromValue(value)) {
    if (MODEL_INPUT_MODALITY_SET.has(token)) {
      known.add(token as ModelInputModality);
      continue;
    }
    if (!seenUnknown.has(token)) {
      seenUnknown.add(token);
      unknown.push(token);
    }
  }

  return {
    inputModalities: MODEL_INPUT_MODALITIES.filter((modality) =>
      known.has(modality),
    ),
    unknownInputModalities: unknown,
  };
}

function toSendGateModality(
  modality: ModelInputModality,
): ModelInputGateModality | null {
  if (modality === "pdf") {
    return "file";
  }
  return MODEL_INPUT_GATE_MODALITIES.includes(
    modality as ModelInputGateModality,
  )
    ? (modality as ModelInputGateModality)
    : null;
}

function toSendGateModalities(
  inputModalities: readonly ModelInputModality[],
): ModelInputGateModality[] {
  const mapped = new Set<ModelInputGateModality>();
  for (const modality of inputModalities) {
    const gateModality = toSendGateModality(modality);
    if (gateModality) {
      mapped.add(gateModality);
    }
  }
  return MODEL_INPUT_GATE_MODALITIES.filter((modality) => mapped.has(modality));
}

function resolveInputModalitiesSource(input: ModelInputModalityPolicyInput): {
  value: unknown;
  source: ModelInputModalityPolicySource;
} {
  const direct = firstPresent(input, ["input_modalities", "inputModalities"]);
  if (direct !== undefined) {
    return {
      value: direct,
      source: "explicit",
    };
  }

  const nested = inputModalitiesFromNestedSource(input);
  if (nested !== undefined && nested !== null) {
    return {
      value: nested,
      source: "explicit",
    };
  }

  return {
    value: [...LIME_DEFAULT_INPUT_MODALITIES],
    source: "lime_default",
  };
}

export function normalizeModelInputModality(
  value: unknown,
): ModelInputModality | null {
  const normalized = normalizeToken(value);
  if (!normalized || !MODEL_INPUT_MODALITY_SET.has(normalized)) {
    return null;
  }
  return normalized as ModelInputModality;
}

export function buildModelInputModalityPolicy(
  input: ModelInputModalityPolicyInput | null | undefined,
): ModelInputModalityPolicy {
  const source = input ?? {};
  const resolved = resolveInputModalitiesSource(source);
  const { inputModalities, unknownInputModalities } = normalizeInputModalities(
    resolved.value,
  );

  return {
    input_modalities: inputModalities,
    send_gate_modalities: toSendGateModalities(inputModalities),
    unknown_input_modalities: unknownInputModalities,
    supports_text_input: inputModalities.includes("text"),
    supports_media_input: inputModalities.some((modality) =>
      MEDIA_INPUT_MODALITY_SET.has(modality),
    ),
    supports_image_input: inputModalities.includes("image"),
    source: resolved.source,
  };
}
