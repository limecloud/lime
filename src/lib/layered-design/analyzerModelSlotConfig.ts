import type { LayeredDesignAnalyzerModelSlotKind } from "./analyzerModelSlots";
import type {
  LayeredDesignAnalyzerProviderCapability,
  LayeredDesignAnalyzerProviderCapabilityGateReport,
  LayeredDesignAnalyzerProviderExecution,
  LayeredDesignAnalyzerProviderSupportMatrix,
} from "./providerCapabilities";
import {
  createLayeredDesignAnalyzerProviderCapabilityGateRequirements,
  evaluateLayeredDesignAnalyzerProviderCapabilityGate,
} from "./providerCapabilities";

export type LayeredDesignAnalyzerModelSlotFallbackStrategy =
  | "return_null"
  | "throw"
  | "use_heuristic";

export interface LayeredDesignAnalyzerModelSlotIoConfig {
  dataUrlPng?: boolean;
  alphaOutput?: boolean;
  maskInput?: boolean;
  maskOutput?: boolean;
  textGeometry?: boolean;
  cleanPlateOutput?: boolean;
}

export interface LayeredDesignAnalyzerModelSlotRuntimeConfig {
  timeoutMs?: number;
  maxAttempts?: number;
  fallbackStrategy?: LayeredDesignAnalyzerModelSlotFallbackStrategy;
}

export interface LayeredDesignAnalyzerModelSlotMetadataConfig {
  providerId?: string;
  modelVersion?: string;
  productionReady?: boolean;
  deterministic?: boolean;
  requiresHumanReview?: boolean;
  tags?: string[];
}

export interface LayeredDesignAnalyzerModelSlotConfigInput {
  id: string;
  kind: LayeredDesignAnalyzerModelSlotKind;
  label: string;
  execution?: LayeredDesignAnalyzerProviderExecution;
  modelId: string;
  io?: LayeredDesignAnalyzerModelSlotIoConfig;
  limits?: LayeredDesignAnalyzerProviderCapability["limits"];
  runtime?: LayeredDesignAnalyzerModelSlotRuntimeConfig;
  metadata?: LayeredDesignAnalyzerModelSlotMetadataConfig;
}

export interface LayeredDesignAnalyzerModelSlotConfig {
  id: string;
  kind: LayeredDesignAnalyzerModelSlotKind;
  label: string;
  execution: LayeredDesignAnalyzerProviderExecution;
  modelId: string;
  io: Required<LayeredDesignAnalyzerModelSlotIoConfig>;
  limits?: LayeredDesignAnalyzerProviderCapability["limits"];
  runtime: Required<LayeredDesignAnalyzerModelSlotRuntimeConfig>;
  metadata: Required<
    Pick<
      LayeredDesignAnalyzerModelSlotMetadataConfig,
      "productionReady" | "deterministic" | "requiresHumanReview"
    >
  > &
    Pick<
      LayeredDesignAnalyzerModelSlotMetadataConfig,
      "providerId" | "modelVersion" | "tags"
    >;
}

export interface LayeredDesignAnalyzerModelSlotConfigReadiness {
  valid: boolean;
  warnings: string[];
  capability: LayeredDesignAnalyzerProviderCapability;
  productionGate: LayeredDesignAnalyzerProviderCapabilityGateReport;
}

const DEFAULT_TIMEOUT_MS = 45_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_ATTEMPTS = 1;

function normalizeToken(value: string | undefined): string {
  return value?.trim() ?? "";
}

function normalizeBoolean(value: boolean | undefined, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.round(value ?? fallback));
}

function normalizeTimeoutMs(value: number | undefined): number {
  return Math.min(
    Math.max(normalizePositiveInteger(value, DEFAULT_TIMEOUT_MS), MIN_TIMEOUT_MS),
    MAX_TIMEOUT_MS,
  );
}

function createDefaultIoConfig(
  kind: LayeredDesignAnalyzerModelSlotKind,
  input: LayeredDesignAnalyzerModelSlotIoConfig = {},
): Required<LayeredDesignAnalyzerModelSlotIoConfig> {
  return {
    dataUrlPng: normalizeBoolean(input.dataUrlPng, true),
    alphaOutput: normalizeBoolean(input.alphaOutput, kind === "subject_matting"),
    maskInput: normalizeBoolean(input.maskInput, kind === "clean_plate"),
    maskOutput: normalizeBoolean(input.maskOutput, kind === "subject_matting"),
    textGeometry: normalizeBoolean(input.textGeometry, kind === "text_ocr"),
    cleanPlateOutput: normalizeBoolean(
      input.cleanPlateOutput,
      kind === "clean_plate",
    ),
  };
}

function normalizeTags(tags: string[] | undefined): string[] | undefined {
  const normalized = (tags ?? [])
    .map((tag) => tag.trim())
    .filter((tag, index, all) => tag.length > 0 && all.indexOf(tag) === index);

  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeLayeredDesignAnalyzerModelSlotConfig(
  input: LayeredDesignAnalyzerModelSlotConfigInput,
): LayeredDesignAnalyzerModelSlotConfig {
  const productionReady = input.metadata?.productionReady ?? false;

  return {
    id: normalizeToken(input.id),
    kind: input.kind,
    label: normalizeToken(input.label),
    execution: input.execution ?? "remote_model",
    modelId: normalizeToken(input.modelId),
    io: createDefaultIoConfig(input.kind, input.io),
    ...(input.limits ? { limits: { ...input.limits } } : {}),
    runtime: {
      timeoutMs: normalizeTimeoutMs(input.runtime?.timeoutMs),
      maxAttempts: normalizePositiveInteger(
        input.runtime?.maxAttempts,
        DEFAULT_MAX_ATTEMPTS,
      ),
      fallbackStrategy: input.runtime?.fallbackStrategy ?? "return_null",
    },
    metadata: {
      ...(input.metadata?.providerId
        ? { providerId: normalizeToken(input.metadata.providerId) }
        : {}),
      ...(input.metadata?.modelVersion
        ? { modelVersion: normalizeToken(input.metadata.modelVersion) }
        : {}),
      ...(normalizeTags(input.metadata?.tags)
        ? { tags: normalizeTags(input.metadata?.tags) }
        : {}),
      productionReady,
      deterministic: input.metadata?.deterministic ?? false,
      requiresHumanReview:
        input.metadata?.requiresHumanReview ?? !productionReady,
    },
  };
}

export function createLayeredDesignAnalyzerProviderCapabilityFromModelSlotConfig(
  config: LayeredDesignAnalyzerModelSlotConfig,
): LayeredDesignAnalyzerProviderCapability {
  const supports: LayeredDesignAnalyzerProviderSupportMatrix = {
    dataUrlPng: config.io.dataUrlPng,
    alphaOutput: config.io.alphaOutput,
    maskInput: config.io.maskInput,
    maskOutput: config.io.maskOutput,
    textGeometry: config.io.textGeometry,
    cleanPlateOutput: config.io.cleanPlateOutput,
  };

  return {
    kind: config.kind,
    label: config.label,
    execution: config.execution,
    modelId: config.modelId,
    supports,
    ...(config.limits ? { limits: { ...config.limits } } : {}),
    quality: {
      productionReady: config.metadata.productionReady,
      deterministic: config.metadata.deterministic,
      requiresHumanReview: config.metadata.requiresHumanReview,
    },
  };
}

export function createLayeredDesignAnalyzerModelSlotMetadata(
  config: LayeredDesignAnalyzerModelSlotConfig,
): Record<string, unknown> {
  return {
    slotId: config.id,
    slotKind: config.kind,
    providerLabel: config.label,
    modelId: config.modelId,
    execution: config.execution,
    timeoutMs: config.runtime.timeoutMs,
    maxAttempts: config.runtime.maxAttempts,
    fallbackStrategy: config.runtime.fallbackStrategy,
    productionReady: config.metadata.productionReady,
    requiresHumanReview: config.metadata.requiresHumanReview,
    ...(config.metadata.providerId
      ? { providerId: config.metadata.providerId }
      : {}),
    ...(config.metadata.modelVersion
      ? { modelVersion: config.metadata.modelVersion }
      : {}),
    ...(config.metadata.tags ? { tags: [...config.metadata.tags] } : {}),
  };
}

export function validateLayeredDesignAnalyzerModelSlotConfig(
  config: LayeredDesignAnalyzerModelSlotConfig,
): string[] {
  const warnings: string[] = [];

  if (!config.id) {
    warnings.push("model slot id 不能为空");
  }
  if (!config.label) {
    warnings.push("model slot label 不能为空");
  }
  if (!config.modelId) {
    warnings.push("model slot modelId 不能为空");
  }
  if (config.runtime.timeoutMs < MIN_TIMEOUT_MS) {
    warnings.push(`timeoutMs 不能小于 ${MIN_TIMEOUT_MS}`);
  }
  if (config.runtime.timeoutMs > MAX_TIMEOUT_MS) {
    warnings.push(`timeoutMs 不能大于 ${MAX_TIMEOUT_MS}`);
  }

  if (!config.io.dataUrlPng) {
    warnings.push("model slot 必须支持 PNG data URL 输入/输出");
  }
  if (config.kind === "subject_matting") {
    if (!config.io.alphaOutput) {
      warnings.push("subject matting slot 必须输出 alpha");
    }
    if (!config.io.maskOutput) {
      warnings.push("subject matting slot 必须输出 mask");
    }
  }
  if (config.kind === "clean_plate") {
    if (!config.io.maskInput) {
      warnings.push("clean plate slot 必须支持 mask 输入");
    }
    if (!config.io.cleanPlateOutput) {
      warnings.push("clean plate slot 必须输出 clean plate");
    }
  }
  if (config.kind === "text_ocr" && !config.io.textGeometry) {
    warnings.push("text OCR slot 必须输出文字几何信息");
  }

  return warnings;
}

export function evaluateLayeredDesignAnalyzerModelSlotConfigReadiness(
  input: LayeredDesignAnalyzerModelSlotConfigInput,
): LayeredDesignAnalyzerModelSlotConfigReadiness {
  const config = normalizeLayeredDesignAnalyzerModelSlotConfig(input);
  const capability =
    createLayeredDesignAnalyzerProviderCapabilityFromModelSlotConfig(config);
  const productionGate = evaluateLayeredDesignAnalyzerProviderCapabilityGate(
    [capability],
    createLayeredDesignAnalyzerProviderCapabilityGateRequirements({
      requireSubjectMatting: config.kind === "subject_matting",
      requireCleanPlate: config.kind === "clean_plate",
      requireTextOcr: config.kind === "text_ocr",
    }),
  );
  const warnings = [
    ...validateLayeredDesignAnalyzerModelSlotConfig(config),
    ...productionGate.checks.flatMap((check) => check.warnings),
  ];

  return {
    valid: warnings.length === 0,
    warnings,
    capability,
    productionGate,
  };
}
