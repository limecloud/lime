import type {
  LayeredDesignFlatImageOcrTextBlock,
  LayeredDesignFlatImageTextOcrProviderInput,
} from "./analyzer";
import type {
  LayeredDesignAnalyzerModelSlotConfig,
  LayeredDesignAnalyzerModelSlotConfigInput,
} from "./analyzerModelSlotConfig";
import {
  createLayeredDesignAnalyzerModelSlotMetadata,
  createLayeredDesignAnalyzerProviderCapabilityFromModelSlotConfig,
  normalizeLayeredDesignAnalyzerModelSlotConfig,
  validateLayeredDesignAnalyzerModelSlotConfig,
} from "./analyzerModelSlotConfig";
import type {
  LayeredDesignAnalyzerModelSlotKind,
  LayeredDesignCleanPlateModelSlot,
  LayeredDesignSubjectMattingModelSlot,
  LayeredDesignTextOcrModelSlot,
} from "./analyzerModelSlots";
import type {
  LayeredDesignCleanPlateInput,
  LayeredDesignCleanPlateResult,
} from "./cleanPlate";
import type {
  LayeredDesignSubjectMattingInput,
  LayeredDesignSubjectMattingResult,
} from "./subjectMatting";

export interface LayeredDesignAnalyzerModelSlotExecutionContext {
  config: LayeredDesignAnalyzerModelSlotConfig;
  metadata: Record<string, unknown>;
  attempt: number;
  signal: AbortSignal;
}

export type LayeredDesignAnalyzerModelSlotExecutionStatus =
  | "succeeded"
  | "fallback_succeeded";

export interface LayeredDesignAnalyzerModelSlotExecutionEvidence {
  slotId: string;
  slotKind: LayeredDesignAnalyzerModelSlotKind;
  providerLabel: string;
  modelId: string;
  execution: LayeredDesignAnalyzerModelSlotConfig["execution"];
  attempt: number;
  maxAttempts: number;
  timeoutMs: number;
  fallbackStrategy: LayeredDesignAnalyzerModelSlotConfig["runtime"]["fallbackStrategy"];
  fallbackUsed: boolean;
  status: LayeredDesignAnalyzerModelSlotExecutionStatus;
  providerId?: string;
  modelVersion?: string;
}

export type LayeredDesignAnalyzerModelSlotExecutor<TInput, TOutput> = (
  input: TInput,
  context: LayeredDesignAnalyzerModelSlotExecutionContext,
) => Promise<TOutput>;

export type LayeredDesignAnalyzerModelSlotFallback<TInput, TOutput> = (
  input: TInput,
  context: LayeredDesignAnalyzerModelSlotExecutionContext,
  error: unknown,
) => Promise<TOutput>;

export interface CreateLayeredDesignAnalyzerModelSlotRuntimeOptions<
  TInput,
  TOutput,
> {
  execute: LayeredDesignAnalyzerModelSlotExecutor<TInput, TOutput>;
  fallback?: LayeredDesignAnalyzerModelSlotFallback<TInput, TOutput>;
}

function createExecutionContext(
  config: LayeredDesignAnalyzerModelSlotConfig,
  attempt: number,
  signal: AbortSignal,
): LayeredDesignAnalyzerModelSlotExecutionContext {
  return {
    config,
    metadata: createLayeredDesignAnalyzerModelSlotMetadata(config),
    attempt,
    signal,
  };
}

function assertExecutableModelSlotConfig(
  config: LayeredDesignAnalyzerModelSlotConfig,
  expectedKind: LayeredDesignAnalyzerModelSlotKind,
): void {
  if (config.kind !== expectedKind) {
    throw new Error(
      `Layered design analyzer model slot config kind mismatch: expected ${expectedKind}, got ${config.kind}`,
    );
  }

  const warnings = validateLayeredDesignAnalyzerModelSlotConfig(config);
  if (warnings.length > 0) {
    throw new Error(
      `Layered design analyzer model slot config is not executable: ${warnings.join(
        "; ",
      )}`,
    );
  }
}

function normalizeExecutableModelSlotConfig(
  input: LayeredDesignAnalyzerModelSlotConfigInput,
  expectedKind: LayeredDesignAnalyzerModelSlotKind,
): LayeredDesignAnalyzerModelSlotConfig {
  const config = normalizeLayeredDesignAnalyzerModelSlotConfig(input);
  assertExecutableModelSlotConfig(config, expectedKind);
  return config;
}

function createExecutionEvidence(
  config: LayeredDesignAnalyzerModelSlotConfig,
  attempt: number,
  status: LayeredDesignAnalyzerModelSlotExecutionStatus,
): LayeredDesignAnalyzerModelSlotExecutionEvidence {
  return {
    slotId: config.id,
    slotKind: config.kind,
    providerLabel: config.label,
    modelId: config.modelId,
    execution: config.execution,
    attempt,
    maxAttempts: config.runtime.maxAttempts,
    timeoutMs: config.runtime.timeoutMs,
    fallbackStrategy: config.runtime.fallbackStrategy,
    fallbackUsed: status === "fallback_succeeded",
    status,
    ...(config.metadata.providerId
      ? { providerId: config.metadata.providerId }
      : {}),
    ...(config.metadata.modelVersion
      ? { modelVersion: config.metadata.modelVersion }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function decorateModelSlotOutputWithEvidence<TOutput>(
  output: TOutput,
  evidence: LayeredDesignAnalyzerModelSlotExecutionEvidence,
): TOutput {
  if (output === null || output === undefined) {
    return output;
  }

  if (Array.isArray(output)) {
    return output.map((item) =>
      decorateModelSlotOutputWithEvidence(item, evidence),
    ) as TOutput;
  }

  if (!isRecord(output)) {
    return output;
  }

  const existingParams = isRecord(output.params) ? output.params : {};
  return {
    ...output,
    params: {
      ...existingParams,
      modelSlotExecution: evidence,
    },
  } as TOutput;
}

async function runAttemptWithTimeout<TInput, TOutput>(
  config: LayeredDesignAnalyzerModelSlotConfig,
  attempt: number,
  input: TInput,
  execute: LayeredDesignAnalyzerModelSlotExecutor<TInput, TOutput>,
): Promise<TOutput> {
  const controller = new AbortController();
  const context = createExecutionContext(config, attempt, controller.signal);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      execute(input, context),
      new Promise<TOutput>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(
            new Error(
              `Layered design analyzer model slot timed out after ${config.runtime.timeoutMs}ms: ${config.id}`,
            ),
          );
        }, config.runtime.timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function executeModelSlotRuntime<TInput, TOutput>(
  config: LayeredDesignAnalyzerModelSlotConfig,
  input: TInput,
  options: CreateLayeredDesignAnalyzerModelSlotRuntimeOptions<
    TInput,
    TOutput
  >,
  emptyResult: () => TOutput,
): Promise<TOutput> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= config.runtime.maxAttempts; attempt += 1) {
    try {
      const output = await runAttemptWithTimeout(
        config,
        attempt,
        input,
        options.execute,
      );
      return decorateModelSlotOutputWithEvidence(
        output,
        createExecutionEvidence(config, attempt, "succeeded"),
      );
    } catch (error) {
      lastError = error;
    }
  }

  const fallbackSignal = new AbortController().signal;
  const fallbackContext = createExecutionContext(
    config,
    config.runtime.maxAttempts,
    fallbackSignal,
  );

  if (config.runtime.fallbackStrategy === "throw") {
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  if (
    config.runtime.fallbackStrategy === "use_heuristic" &&
    options.fallback
  ) {
    const output = await options.fallback(input, fallbackContext, lastError);
    return decorateModelSlotOutputWithEvidence(
      output,
      createExecutionEvidence(
        config,
        config.runtime.maxAttempts,
        "fallback_succeeded",
      ),
    );
  }

  return emptyResult();
}

export function createLayeredDesignSubjectMattingModelSlotFromConfig(
  input: LayeredDesignAnalyzerModelSlotConfigInput,
  options: CreateLayeredDesignAnalyzerModelSlotRuntimeOptions<
    LayeredDesignSubjectMattingInput,
    LayeredDesignSubjectMattingResult | null
  >,
): LayeredDesignSubjectMattingModelSlot {
  const config = normalizeExecutableModelSlotConfig(input, "subject_matting");

  return {
    kind: "subject_matting",
    capability:
      createLayeredDesignAnalyzerProviderCapabilityFromModelSlotConfig(config),
    execute: async (slotInput) =>
      await executeModelSlotRuntime(config, slotInput, options, () => null),
  };
}

export function createLayeredDesignCleanPlateModelSlotFromConfig(
  input: LayeredDesignAnalyzerModelSlotConfigInput,
  options: CreateLayeredDesignAnalyzerModelSlotRuntimeOptions<
    LayeredDesignCleanPlateInput,
    LayeredDesignCleanPlateResult | null
  >,
): LayeredDesignCleanPlateModelSlot {
  const config = normalizeExecutableModelSlotConfig(input, "clean_plate");

  return {
    kind: "clean_plate",
    capability:
      createLayeredDesignAnalyzerProviderCapabilityFromModelSlotConfig(config),
    execute: async (slotInput) =>
      await executeModelSlotRuntime(config, slotInput, options, () => null),
  };
}

export function createLayeredDesignTextOcrModelSlotFromConfig(
  input: LayeredDesignAnalyzerModelSlotConfigInput,
  options: CreateLayeredDesignAnalyzerModelSlotRuntimeOptions<
    LayeredDesignFlatImageTextOcrProviderInput,
    LayeredDesignFlatImageOcrTextBlock[]
  >,
): LayeredDesignTextOcrModelSlot {
  const config = normalizeExecutableModelSlotConfig(input, "text_ocr");

  return {
    kind: "text_ocr",
    capability:
      createLayeredDesignAnalyzerProviderCapabilityFromModelSlotConfig(config),
    execute: async (slotInput) =>
      await executeModelSlotRuntime(config, slotInput, options, () => []),
  };
}
