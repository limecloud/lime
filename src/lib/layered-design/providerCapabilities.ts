export type LayeredDesignAnalyzerProviderCapabilityKind =
  | "subject_matting"
  | "clean_plate"
  | "text_ocr";

export type LayeredDesignAnalyzerProviderExecution =
  | "browser_worker"
  | "native_command"
  | "remote_model"
  | "local_heuristic"
  | "deterministic";

export interface LayeredDesignAnalyzerProviderSupportMatrix {
  dataUrlPng?: boolean;
  alphaOutput?: boolean;
  maskInput?: boolean;
  maskOutput?: boolean;
  textGeometry?: boolean;
  cleanPlateOutput?: boolean;
}

export interface LayeredDesignAnalyzerProviderLimits {
  maxWidth?: number;
  maxHeight?: number;
  maxPixels?: number;
  maxBytes?: number;
}

export interface LayeredDesignAnalyzerProviderQuality {
  productionReady?: boolean;
  deterministic?: boolean;
  requiresHumanReview?: boolean;
}

export interface LayeredDesignAnalyzerProviderCapability {
  kind: LayeredDesignAnalyzerProviderCapabilityKind;
  label: string;
  execution: LayeredDesignAnalyzerProviderExecution;
  modelId?: string;
  supports: LayeredDesignAnalyzerProviderSupportMatrix;
  limits?: LayeredDesignAnalyzerProviderLimits;
  quality?: LayeredDesignAnalyzerProviderQuality;
}

export interface LayeredDesignAnalyzerProviderCapabilityRequirement {
  execution?: LayeredDesignAnalyzerProviderExecution;
  supports?: LayeredDesignAnalyzerProviderSupportMatrix;
  limits?: LayeredDesignAnalyzerProviderLimits;
  quality?: LayeredDesignAnalyzerProviderQuality;
}

export interface LayeredDesignAnalyzerProviderCapabilityRegistry {
  capabilities: readonly LayeredDesignAnalyzerProviderCapability[];
}

export type LayeredDesignAnalyzerProviderCapabilityGateStatus =
  | "passed"
  | "failed"
  | "missing";

export interface LayeredDesignAnalyzerProviderCapabilityGateRequirement {
  id: string;
  label: string;
  kind: LayeredDesignAnalyzerProviderCapabilityKind;
  requirement: LayeredDesignAnalyzerProviderCapabilityRequirement;
}

export interface LayeredDesignAnalyzerProviderCapabilityGateCheck {
  requirementId: string;
  label: string;
  kind: LayeredDesignAnalyzerProviderCapabilityKind;
  status: LayeredDesignAnalyzerProviderCapabilityGateStatus;
  capabilityLabel?: string;
  capabilityModelId?: string;
  warnings: string[];
}

export interface LayeredDesignAnalyzerProviderCapabilityGateReport {
  readyForProduction: boolean;
  checks: LayeredDesignAnalyzerProviderCapabilityGateCheck[];
}

export interface CreateLayeredDesignAnalyzerProviderCapabilityGateRequirementsOptions {
  requireSubjectMatting?: boolean;
  requireCleanPlate?: boolean;
  requireTextOcr?: boolean;
  productionReady?: boolean;
}

const SUPPORT_LABELS: Record<
  keyof LayeredDesignAnalyzerProviderSupportMatrix,
  string
> = {
  dataUrlPng: "PNG data URL 输入/输出",
  alphaOutput: "透明 alpha 输出",
  maskInput: "mask 输入",
  maskOutput: "mask 输出",
  textGeometry: "文字几何信息",
  cleanPlateOutput: "clean plate 输出",
};

const QUALITY_LABELS: Record<
  keyof LayeredDesignAnalyzerProviderQuality,
  string
> = {
  productionReady: "生产可用",
  deterministic: "确定性",
  requiresHumanReview: "需要人工复核",
};

const SUPPORT_KEYS: Array<keyof LayeredDesignAnalyzerProviderSupportMatrix> = [
  "dataUrlPng",
  "alphaOutput",
  "maskInput",
  "maskOutput",
  "textGeometry",
  "cleanPlateOutput",
];

const LIMIT_KEYS: Array<keyof LayeredDesignAnalyzerProviderLimits> = [
  "maxWidth",
  "maxHeight",
  "maxPixels",
  "maxBytes",
];

const QUALITY_KEYS: Array<keyof LayeredDesignAnalyzerProviderQuality> = [
  "productionReady",
  "deterministic",
  "requiresHumanReview",
];

export const LAYERED_DESIGN_BUILT_IN_PROVIDER_CAPABILITIES: readonly LayeredDesignAnalyzerProviderCapability[] =
  [
    {
      kind: "subject_matting",
      label: "Simple browser subject matting provider",
      execution: "browser_worker",
      modelId: "simple_subject_matting_v1",
      supports: {
        dataUrlPng: true,
        alphaOutput: true,
        maskOutput: true,
      },
      quality: {
        productionReady: false,
        deterministic: true,
        requiresHumanReview: true,
      },
    },
    {
      kind: "subject_matting",
      label: "Deterministic subject matting placeholder",
      execution: "deterministic",
      modelId: "deterministic_subject_matting_placeholder_v1",
      supports: {
        dataUrlPng: true,
        alphaOutput: true,
        maskOutput: true,
      },
      quality: {
        productionReady: false,
        deterministic: true,
        requiresHumanReview: true,
      },
    },
    {
      kind: "clean_plate",
      label: "Simple browser clean plate provider",
      execution: "browser_worker",
      modelId: "simple_neighbor_inpaint_v1",
      supports: {
        dataUrlPng: true,
        maskInput: true,
        cleanPlateOutput: true,
      },
      quality: {
        productionReady: false,
        deterministic: true,
        requiresHumanReview: true,
      },
    },
    {
      kind: "clean_plate",
      label: "Deterministic clean plate placeholder",
      execution: "deterministic",
      modelId: "deterministic_clean_plate_placeholder_v1",
      supports: {
        dataUrlPng: true,
        cleanPlateOutput: true,
      },
      quality: {
        productionReady: false,
        deterministic: true,
        requiresHumanReview: true,
      },
    },
    {
      kind: "text_ocr",
      label: "Worker OCR deterministic provider",
      execution: "browser_worker",
      modelId: "deterministic_text_ocr_placeholder_v1",
      supports: {
        dataUrlPng: true,
        textGeometry: true,
      },
      quality: {
        productionReady: false,
        deterministic: true,
        requiresHumanReview: true,
      },
    },
    {
      kind: "text_ocr",
      label: "Tauri native OCR provider",
      execution: "native_command",
      modelId: "tauri_native_ocr",
      supports: {
        dataUrlPng: true,
        textGeometry: true,
      },
      quality: {
        productionReady: false,
        deterministic: false,
        requiresHumanReview: true,
      },
    },
    {
      kind: "text_ocr",
      label: "Browser TextDetector OCR provider",
      execution: "local_heuristic",
      modelId: "browser_text_detector",
      supports: {
        dataUrlPng: true,
        textGeometry: true,
      },
      quality: {
        productionReady: false,
        deterministic: false,
        requiresHumanReview: true,
      },
    },
    {
      kind: "clean_plate",
      label: "Local heuristic clean plate fallback",
      execution: "local_heuristic",
      modelId: "local_heuristic_clean_plate_fallback_v1",
      supports: {
        dataUrlPng: true,
        cleanPlateOutput: true,
      },
      quality: {
        productionReady: false,
        deterministic: true,
        requiresHumanReview: true,
      },
    },
  ];

function formatBoolean(value: boolean): string {
  return value ? "是" : "否";
}

function formatCapabilityKind(
  kind: LayeredDesignAnalyzerProviderCapabilityKind,
): string {
  switch (kind) {
    case "subject_matting":
      return "主体 matting";
    case "clean_plate":
      return "clean plate";
    case "text_ocr":
      return "文字 OCR";
  }
}

function formatExecution(
  execution: LayeredDesignAnalyzerProviderExecution,
): string {
  switch (execution) {
    case "browser_worker":
      return "Browser Worker";
    case "native_command":
      return "Tauri native command";
    case "remote_model":
      return "Remote model";
    case "local_heuristic":
      return "Local heuristic";
    case "deterministic":
      return "Deterministic";
  }
}

export function createLayeredDesignProviderCapabilityRegistry(
  capabilities: readonly LayeredDesignAnalyzerProviderCapability[] =
    LAYERED_DESIGN_BUILT_IN_PROVIDER_CAPABILITIES,
): LayeredDesignAnalyzerProviderCapabilityRegistry {
  return {
    capabilities: capabilities.map((capability) => ({
      ...capability,
      supports: { ...capability.supports },
      ...(capability.limits ? { limits: { ...capability.limits } } : {}),
      ...(capability.quality ? { quality: { ...capability.quality } } : {}),
    })),
  };
}

export function findLayeredDesignProviderCapabilities(
  registry: LayeredDesignAnalyzerProviderCapabilityRegistry,
  kind: LayeredDesignAnalyzerProviderCapabilityKind,
): LayeredDesignAnalyzerProviderCapability[] {
  return registry.capabilities.filter((capability) => capability.kind === kind);
}

export function getLayeredDesignProviderCapabilityWarnings(
  capability: LayeredDesignAnalyzerProviderCapability,
  requirement: LayeredDesignAnalyzerProviderCapabilityRequirement = {},
): string[] {
  const warnings: string[] = [];

  if (requirement.execution && capability.execution !== requirement.execution) {
    warnings.push(
      `execution 需要 ${requirement.execution}，实际为 ${capability.execution}`,
    );
  }

  for (const key of SUPPORT_KEYS) {
    const expected = requirement.supports?.[key];
    const actual = capability.supports[key];
    if (typeof expected === "boolean" && actual !== expected) {
      warnings.push(
        `${SUPPORT_LABELS[key]} 需要 ${formatBoolean(expected)}，实际为 ${
          typeof actual === "boolean" ? formatBoolean(actual) : "未知"
        }`,
      );
    }
  }

  for (const key of LIMIT_KEYS) {
    const required = requirement.limits?.[key];
    const actual = capability.limits?.[key];
    if (
      typeof required === "number" &&
      typeof actual === "number" &&
      actual < required
    ) {
      warnings.push(`${key} 需要至少 ${required}，实际为 ${actual}`);
    }
  }

  for (const key of QUALITY_KEYS) {
    const expected = requirement.quality?.[key];
    const actual = capability.quality?.[key];
    if (typeof expected === "boolean" && actual !== expected) {
      warnings.push(
        `${QUALITY_LABELS[key]} 需要 ${formatBoolean(expected)}，实际为 ${
          typeof actual === "boolean" ? formatBoolean(actual) : "未知"
        }`,
      );
    }
  }

  return warnings;
}

export function layeredDesignProviderCapabilitySatisfiesRequirement(
  capability: LayeredDesignAnalyzerProviderCapability,
  requirement: LayeredDesignAnalyzerProviderCapabilityRequirement = {},
): boolean {
  return (
    getLayeredDesignProviderCapabilityWarnings(capability, requirement)
      .length === 0
  );
}

export function chooseLayeredDesignProviderCapability(
  registry: LayeredDesignAnalyzerProviderCapabilityRegistry,
  kind: LayeredDesignAnalyzerProviderCapabilityKind,
  requirement: LayeredDesignAnalyzerProviderCapabilityRequirement = {},
): LayeredDesignAnalyzerProviderCapability | null {
  return (
    findLayeredDesignProviderCapabilities(registry, kind).find((capability) =>
      layeredDesignProviderCapabilitySatisfiesRequirement(
        capability,
        requirement,
      ),
    ) ?? null
  );
}

export function buildLayeredDesignProviderCapabilitySummary(
  capability: LayeredDesignAnalyzerProviderCapability,
): string {
  const supports = Object.entries(capability.supports)
    .filter(([, supported]) => supported === true)
    .map(([key]) => SUPPORT_LABELS[key as keyof typeof SUPPORT_LABELS])
    .join("、");
  const quality = capability.quality?.productionReady
    ? "生产可用"
    : "实验/占位，需人工复核";

  return [
    `${capability.label}：${formatCapabilityKind(capability.kind)}`,
    `执行=${formatExecution(capability.execution)}`,
    capability.modelId ? `模型/算法=${capability.modelId}` : null,
    supports ? `IO=${supports}` : null,
    `质量=${quality}`,
  ]
    .filter((part): part is string => Boolean(part))
    .join("；");
}

export function createLayeredDesignAnalyzerProviderCapabilityGateRequirements(
  options: CreateLayeredDesignAnalyzerProviderCapabilityGateRequirementsOptions,
): LayeredDesignAnalyzerProviderCapabilityGateRequirement[] {
  const productionReady = options.productionReady ?? true;
  const quality = productionReady ? { productionReady: true } : undefined;
  const requirements: LayeredDesignAnalyzerProviderCapabilityGateRequirement[] =
    [];

  if (options.requireSubjectMatting) {
    requirements.push({
      id: "subject_matting_alpha_mask",
      label: "主体 matting 需要透明主体和 mask 输出",
      kind: "subject_matting",
      requirement: {
        supports: {
          dataUrlPng: true,
          alphaOutput: true,
          maskOutput: true,
        },
        ...(quality ? { quality } : {}),
      },
    });
  }

  if (options.requireCleanPlate) {
    requirements.push({
      id: "clean_plate_masked_output",
      label: "clean plate 需要支持 mask 输入和背景修补输出",
      kind: "clean_plate",
      requirement: {
        supports: {
          dataUrlPng: true,
          maskInput: true,
          cleanPlateOutput: true,
        },
        ...(quality ? { quality } : {}),
      },
    });
  }

  if (options.requireTextOcr) {
    requirements.push({
      id: "text_ocr_geometry",
      label: "文字 OCR 需要返回可编辑文字几何",
      kind: "text_ocr",
      requirement: {
        supports: {
          dataUrlPng: true,
          textGeometry: true,
        },
        ...(quality ? { quality } : {}),
      },
    });
  }

  return requirements;
}

export function evaluateLayeredDesignAnalyzerProviderCapabilityGate(
  capabilities: readonly LayeredDesignAnalyzerProviderCapability[] = [],
  requirements: readonly LayeredDesignAnalyzerProviderCapabilityGateRequirement[] = [],
): LayeredDesignAnalyzerProviderCapabilityGateReport {
  const checks = requirements.map((requirement) => {
    const candidates = capabilities.filter(
      (capability) => capability.kind === requirement.kind,
    );
    const passed = candidates.find((capability) =>
      layeredDesignProviderCapabilitySatisfiesRequirement(
        capability,
        requirement.requirement,
      ),
    );

    if (passed) {
      return {
        requirementId: requirement.id,
        label: requirement.label,
        kind: requirement.kind,
        status: "passed" as const,
        capabilityLabel: passed.label,
        ...(passed.modelId ? { capabilityModelId: passed.modelId } : {}),
        warnings: [],
      };
    }

    if (candidates.length === 0) {
      return {
        requirementId: requirement.id,
        label: requirement.label,
        kind: requirement.kind,
        status: "missing" as const,
        warnings: [`未找到 ${formatCapabilityKind(requirement.kind)} provider capability`],
      };
    }

    const bestCandidate = candidates
      .map((capability) => ({
        capability,
        warnings: getLayeredDesignProviderCapabilityWarnings(
          capability,
          requirement.requirement,
        ),
      }))
      .sort((left, right) => left.warnings.length - right.warnings.length)[0];

    return {
      requirementId: requirement.id,
      label: requirement.label,
      kind: requirement.kind,
      status: "failed" as const,
      capabilityLabel: bestCandidate.capability.label,
      ...(bestCandidate.capability.modelId
        ? { capabilityModelId: bestCandidate.capability.modelId }
        : {}),
      warnings: bestCandidate.warnings,
    };
  });

  return {
    readyForProduction:
      checks.length > 0 && checks.every((check) => check.status === "passed"),
    checks,
  };
}
