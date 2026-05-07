import type {
  LayeredDesignFlatImageOcrTextBlock,
  LayeredDesignFlatImageTextOcrProvider,
  LayeredDesignFlatImageTextOcrProviderInput,
} from "./analyzer";
import type { LayeredDesignAnalyzerModelSlotConfigInput } from "./analyzerModelSlotConfig";
import type {
  LayeredDesignAnalyzerModelSlotKind,
  LayeredDesignCleanPlateModelSlot,
  LayeredDesignSubjectMattingModelSlot,
  LayeredDesignTextOcrModelSlot,
} from "./analyzerModelSlots";
import {
  createLayeredDesignCleanPlateModelSlotFromConfig,
  createLayeredDesignSubjectMattingModelSlotFromConfig,
  createLayeredDesignTextOcrModelSlotFromConfig,
  type LayeredDesignAnalyzerModelSlotExecutionContext,
} from "./analyzerModelSlotRuntime";
import type {
  LayeredDesignCleanPlateInput,
  LayeredDesignCleanPlateProvider,
  LayeredDesignCleanPlateResult,
} from "./cleanPlate";
import type {
  LayeredDesignSubjectMattingInput,
  LayeredDesignSubjectMattingProvider,
  LayeredDesignSubjectMattingResult,
} from "./subjectMatting";

export interface LayeredDesignAnalyzerModelSlotTransportRequest<
  TKind extends LayeredDesignAnalyzerModelSlotKind,
  TInput,
> {
  kind: TKind;
  input: TInput;
  context: LayeredDesignAnalyzerModelSlotExecutionContext;
}

export interface LayeredDesignAnalyzerModelSlotTransport {
  executeSubjectMatting?: (
    request: LayeredDesignAnalyzerModelSlotTransportRequest<
      "subject_matting",
      LayeredDesignSubjectMattingInput
    >,
  ) => Promise<LayeredDesignSubjectMattingResult | null>;
  executeCleanPlate?: (
    request: LayeredDesignAnalyzerModelSlotTransportRequest<
      "clean_plate",
      LayeredDesignCleanPlateInput
    >,
  ) => Promise<LayeredDesignCleanPlateResult | null>;
  executeTextOcr?: (
    request: LayeredDesignAnalyzerModelSlotTransportRequest<
      "text_ocr",
      LayeredDesignFlatImageTextOcrProviderInput
    >,
  ) => Promise<LayeredDesignFlatImageOcrTextBlock[]>;
}

export type LayeredDesignAnalyzerModelSlotTransportAnyRequest =
  | LayeredDesignAnalyzerModelSlotTransportRequest<
      "subject_matting",
      LayeredDesignSubjectMattingInput
    >
  | LayeredDesignAnalyzerModelSlotTransportRequest<
      "clean_plate",
      LayeredDesignCleanPlateInput
    >
  | LayeredDesignAnalyzerModelSlotTransportRequest<
      "text_ocr",
      LayeredDesignFlatImageTextOcrProviderInput
    >;

export type LayeredDesignAnalyzerModelSlotTransportHandlerOutput =
  | LayeredDesignSubjectMattingResult
  | LayeredDesignCleanPlateResult
  | LayeredDesignFlatImageOcrTextBlock[]
  | null;

export type LayeredDesignAnalyzerModelSlotTransportHandler = (
  request: LayeredDesignAnalyzerModelSlotTransportAnyRequest,
) => Promise<LayeredDesignAnalyzerModelSlotTransportHandlerOutput>;

export type LayeredDesignAnalyzerModelSlotTransportJsonInput =
  | LayeredDesignSubjectMattingInput
  | LayeredDesignCleanPlateInput
  | LayeredDesignFlatImageTextOcrProviderInput;

export type LayeredDesignAnalyzerModelSlotTransportJsonResult =
  | {
      kind: "subject_matting";
      result: LayeredDesignSubjectMattingResult | null;
    }
  | {
      kind: "clean_plate";
      result: LayeredDesignCleanPlateResult | null;
    }
  | {
      kind: "text_ocr";
      result: LayeredDesignFlatImageOcrTextBlock[];
    };

export interface LayeredDesignAnalyzerModelSlotTransportJsonRequestContext {
  slotId: string;
  slotKind: LayeredDesignAnalyzerModelSlotKind;
  providerLabel: string;
  modelId: string;
  execution: LayeredDesignAnalyzerModelSlotExecutionContext["config"]["execution"];
  attempt: number;
  maxAttempts: number;
  timeoutMs: number;
  fallbackStrategy: LayeredDesignAnalyzerModelSlotExecutionContext["config"]["runtime"]["fallbackStrategy"];
  providerId?: string;
  modelVersion?: string;
  metadata: Record<string, unknown>;
}

export type LayeredDesignAnalyzerModelSlotTransportJsonRequest =
  | {
      kind: "subject_matting";
      input: LayeredDesignSubjectMattingInput;
      context: LayeredDesignAnalyzerModelSlotTransportJsonRequestContext;
    }
  | {
      kind: "clean_plate";
      input: LayeredDesignCleanPlateInput;
      context: LayeredDesignAnalyzerModelSlotTransportJsonRequestContext;
    }
  | {
      kind: "text_ocr";
      input: LayeredDesignFlatImageTextOcrProviderInput;
      context: LayeredDesignAnalyzerModelSlotTransportJsonRequestContext;
    };

export type LayeredDesignAnalyzerModelSlotTransportJsonExecutor = (
  request: LayeredDesignAnalyzerModelSlotTransportJsonRequest,
) => Promise<LayeredDesignAnalyzerModelSlotTransportJsonResult>;

export interface LayeredDesignAnalyzerModelSlotJsonExecutorProviders {
  subjectMattingProvider?: LayeredDesignSubjectMattingProvider | null;
  cleanPlateProvider?: LayeredDesignCleanPlateProvider | null;
  textOcrProvider?: LayeredDesignFlatImageTextOcrProvider | null;
}

export type LayeredDesignAnalyzerModelSlotTransportErrorCode =
  | "missing_handler"
  | "unsupported_input"
  | "invalid_request"
  | "invalid_response"
  | "unauthorized"
  | "rate_limited"
  | "remote_unavailable"
  | "timeout"
  | "cancelled"
  | "safety_blocked"
  | "unknown";

export interface LayeredDesignAnalyzerModelSlotTransportErrorInput {
  code: LayeredDesignAnalyzerModelSlotTransportErrorCode;
  message: string;
  retryable?: boolean;
  statusCode?: number;
  providerErrorCode?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class LayeredDesignAnalyzerModelSlotTransportError extends Error {
  readonly code: LayeredDesignAnalyzerModelSlotTransportErrorCode;
  readonly retryable: boolean;
  readonly statusCode?: number;
  readonly providerErrorCode?: string;
  readonly details?: Record<string, unknown>;
  readonly cause?: unknown;

  constructor(input: LayeredDesignAnalyzerModelSlotTransportErrorInput) {
    super(input.message);
    this.name = "LayeredDesignAnalyzerModelSlotTransportError";
    this.code = input.code;
    this.retryable = input.retryable ?? false;
    this.statusCode = input.statusCode;
    this.providerErrorCode = input.providerErrorCode;
    this.details = input.details ? { ...input.details } : undefined;
    this.cause = input.cause;
  }
}

export function createLayeredDesignAnalyzerModelSlotTransportError(
  input: LayeredDesignAnalyzerModelSlotTransportErrorInput,
): LayeredDesignAnalyzerModelSlotTransportError {
  return new LayeredDesignAnalyzerModelSlotTransportError(input);
}

export function isLayeredDesignAnalyzerModelSlotTransportError(
  error: unknown,
): error is LayeredDesignAnalyzerModelSlotTransportError {
  return error instanceof LayeredDesignAnalyzerModelSlotTransportError;
}

export function normalizeLayeredDesignAnalyzerModelSlotTransportError(
  error: unknown,
  fallback: Pick<
    LayeredDesignAnalyzerModelSlotTransportErrorInput,
    "code" | "message" | "retryable"
  > = {
    code: "unknown",
    message: "Layered design analyzer model slot transport failed",
    retryable: false,
  },
): LayeredDesignAnalyzerModelSlotTransportError {
  if (isLayeredDesignAnalyzerModelSlotTransportError(error)) {
    return error;
  }

  return createLayeredDesignAnalyzerModelSlotTransportError({
    ...fallback,
    message: error instanceof Error ? error.message : fallback.message,
    cause: error,
  });
}

function createMissingTransportHandlerError(
  kind: LayeredDesignAnalyzerModelSlotKind,
  context: LayeredDesignAnalyzerModelSlotExecutionContext,
): Error {
  return createLayeredDesignAnalyzerModelSlotTransportError({
    code: "missing_handler",
    message: `Layered design analyzer model slot transport handler missing: ${kind}/${context.config.id}`,
    retryable: false,
    details: {
      kind,
      slotId: context.config.id,
      modelId: context.config.modelId,
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createInvalidTransportResponseError(
  request: LayeredDesignAnalyzerModelSlotTransportAnyRequest,
  message: string,
  details: Record<string, unknown> = {},
): Error {
  return createLayeredDesignAnalyzerModelSlotTransportError({
    code: "invalid_response",
    message,
    retryable: false,
    details: {
      kind: request.kind,
      slotId: request.context.config.id,
      modelId: request.context.config.modelId,
      ...details,
    },
  });
}

function createMissingJsonExecutorProviderError(
  request: LayeredDesignAnalyzerModelSlotTransportJsonRequest,
): Error {
  return createLayeredDesignAnalyzerModelSlotTransportError({
    code: "missing_handler",
    message: `Layered design analyzer model slot JSON executor provider missing: ${request.kind}/${request.context.slotId}`,
    retryable: false,
    details: {
      kind: request.kind,
      slotId: request.context.slotId,
      modelId: request.context.modelId,
    },
  });
}

function createJsonRequestContextFromTransportRequest(
  request: LayeredDesignAnalyzerModelSlotTransportAnyRequest,
): LayeredDesignAnalyzerModelSlotTransportJsonRequestContext {
  const { config } = request.context;

  return {
    slotId: config.id,
    slotKind: config.kind,
    providerLabel: config.label,
    modelId: config.modelId,
    execution: config.execution,
    attempt: request.context.attempt,
    maxAttempts: config.runtime.maxAttempts,
    timeoutMs: config.runtime.timeoutMs,
    fallbackStrategy: config.runtime.fallbackStrategy,
    ...(config.metadata.providerId
      ? { providerId: config.metadata.providerId }
      : {}),
    ...(config.metadata.modelVersion
      ? { modelVersion: config.metadata.modelVersion }
      : {}),
    metadata: { ...request.context.metadata },
  };
}

function createJsonRequestFromTransportRequest(
  request: LayeredDesignAnalyzerModelSlotTransportAnyRequest,
): LayeredDesignAnalyzerModelSlotTransportJsonRequest {
  const context = createJsonRequestContextFromTransportRequest(request);

  if (request.kind === "subject_matting") {
    return {
      kind: "subject_matting",
      input: request.input,
      context,
    };
  }

  if (request.kind === "clean_plate") {
    return {
      kind: "clean_plate",
      input: request.input,
      context,
    };
  }

  return {
    kind: "text_ocr",
    input: request.input,
    context,
  };
}

function normalizeJsonExecutorResult(
  request: LayeredDesignAnalyzerModelSlotTransportAnyRequest,
  response: LayeredDesignAnalyzerModelSlotTransportJsonResult,
): LayeredDesignAnalyzerModelSlotTransportHandlerOutput {
  if (!isRecord(response) || typeof response.kind !== "string") {
    throw createInvalidTransportResponseError(
      request,
      "Layered design analyzer model slot JSON executor must return kind and result",
    );
  }

  if (response.kind !== request.kind) {
    throw createInvalidTransportResponseError(
      request,
      `Layered design analyzer model slot JSON executor kind mismatch: expected ${request.kind}, got ${response.kind}`,
      {
        expectedKind: request.kind,
        receivedKind: response.kind,
      },
    );
  }

  return (
    response as {
      result?: LayeredDesignAnalyzerModelSlotTransportHandlerOutput;
    }
  ).result as LayeredDesignAnalyzerModelSlotTransportHandlerOutput;
}

function normalizeSubjectMattingTransportOutput(
  output: LayeredDesignAnalyzerModelSlotTransportHandlerOutput,
  request: LayeredDesignAnalyzerModelSlotTransportAnyRequest,
): LayeredDesignSubjectMattingResult | null {
  if (output === null) {
    return null;
  }

  if (
    !isRecord(output) ||
    typeof output.imageSrc !== "string" ||
    typeof output.maskSrc !== "string"
  ) {
    throw createInvalidTransportResponseError(
      request,
      "Layered design subject matting transport must return imageSrc and maskSrc",
    );
  }

  return output as unknown as LayeredDesignSubjectMattingResult;
}

function normalizeCleanPlateTransportOutput(
  output: LayeredDesignAnalyzerModelSlotTransportHandlerOutput,
  request: LayeredDesignAnalyzerModelSlotTransportAnyRequest,
): LayeredDesignCleanPlateResult | null {
  if (output === null) {
    return null;
  }

  if (!isRecord(output) || typeof output.src !== "string") {
    throw createInvalidTransportResponseError(
      request,
      "Layered design clean plate transport must return src",
    );
  }

  return output as unknown as LayeredDesignCleanPlateResult;
}

function normalizeTextOcrTransportOutput(
  output: LayeredDesignAnalyzerModelSlotTransportHandlerOutput,
  request: LayeredDesignAnalyzerModelSlotTransportAnyRequest,
): LayeredDesignFlatImageOcrTextBlock[] {
  if (!Array.isArray(output)) {
    throw createInvalidTransportResponseError(
      request,
      "Layered design text OCR transport must return text block array",
    );
  }

  return output.map((block) => {
    if (!isRecord(block) || typeof block.text !== "string") {
      throw createInvalidTransportResponseError(
        request,
        "Layered design text OCR transport block must include text",
      );
    }

    return block as unknown as LayeredDesignFlatImageOcrTextBlock;
  });
}

async function executeTransportHandler<TOutput>(
  handler: LayeredDesignAnalyzerModelSlotTransportHandler,
  request: LayeredDesignAnalyzerModelSlotTransportAnyRequest,
  normalize: (
    output: LayeredDesignAnalyzerModelSlotTransportHandlerOutput,
    request: LayeredDesignAnalyzerModelSlotTransportAnyRequest,
  ) => TOutput,
): Promise<TOutput> {
  try {
    return normalize(await handler(request), request);
  } catch (error) {
    throw normalizeLayeredDesignAnalyzerModelSlotTransportError(error);
  }
}

export function createLayeredDesignAnalyzerModelSlotTransportFromHandler(
  handler: LayeredDesignAnalyzerModelSlotTransportHandler,
): LayeredDesignAnalyzerModelSlotTransport {
  return {
    executeSubjectMatting: async (request) =>
      await executeTransportHandler(
        handler,
        request,
        normalizeSubjectMattingTransportOutput,
      ),
    executeCleanPlate: async (request) =>
      await executeTransportHandler(
        handler,
        request,
        normalizeCleanPlateTransportOutput,
      ),
    executeTextOcr: async (request) =>
      await executeTransportHandler(
        handler,
        request,
        normalizeTextOcrTransportOutput,
      ),
  };
}

export function createLayeredDesignAnalyzerModelSlotTransportFromJsonExecutor(
  executor: LayeredDesignAnalyzerModelSlotTransportJsonExecutor,
): LayeredDesignAnalyzerModelSlotTransport {
  return createLayeredDesignAnalyzerModelSlotTransportFromHandler(
    async (request) => {
      const response = await executor(
        createJsonRequestFromTransportRequest(request),
      );

      return normalizeJsonExecutorResult(request, response);
    },
  );
}

export function createLayeredDesignAnalyzerModelSlotJsonExecutorFromProviders(
  providers: LayeredDesignAnalyzerModelSlotJsonExecutorProviders,
): LayeredDesignAnalyzerModelSlotTransportJsonExecutor {
  return async (request) => {
    if (request.kind === "subject_matting") {
      if (!providers.subjectMattingProvider) {
        throw createMissingJsonExecutorProviderError(request);
      }

      return {
        kind: "subject_matting",
        result: await providers.subjectMattingProvider.matteSubject(
          request.input,
        ),
      };
    }

    if (request.kind === "clean_plate") {
      if (!providers.cleanPlateProvider) {
        throw createMissingJsonExecutorProviderError(request);
      }

      return {
        kind: "clean_plate",
        result: await providers.cleanPlateProvider.createCleanPlate(
          request.input,
        ),
      };
    }

    if (!providers.textOcrProvider) {
      throw createMissingJsonExecutorProviderError(request);
    }

    return {
      kind: "text_ocr",
      result: await providers.textOcrProvider.detectText(request.input),
    };
  };
}

export function createLayeredDesignSubjectMattingModelSlotFromTransport(
  input: LayeredDesignAnalyzerModelSlotConfigInput,
  transport: LayeredDesignAnalyzerModelSlotTransport,
): LayeredDesignSubjectMattingModelSlot {
  return createLayeredDesignSubjectMattingModelSlotFromConfig(input, {
    execute: async (slotInput, context) => {
      if (!transport.executeSubjectMatting) {
        throw createMissingTransportHandlerError("subject_matting", context);
      }

      return await transport.executeSubjectMatting({
        kind: "subject_matting",
        input: slotInput,
        context,
      });
    },
  });
}

export function createLayeredDesignCleanPlateModelSlotFromTransport(
  input: LayeredDesignAnalyzerModelSlotConfigInput,
  transport: LayeredDesignAnalyzerModelSlotTransport,
): LayeredDesignCleanPlateModelSlot {
  return createLayeredDesignCleanPlateModelSlotFromConfig(input, {
    execute: async (slotInput, context) => {
      if (!transport.executeCleanPlate) {
        throw createMissingTransportHandlerError("clean_plate", context);
      }

      return await transport.executeCleanPlate({
        kind: "clean_plate",
        input: slotInput,
        context,
      });
    },
  });
}

export function createLayeredDesignTextOcrModelSlotFromTransport(
  input: LayeredDesignAnalyzerModelSlotConfigInput,
  transport: LayeredDesignAnalyzerModelSlotTransport,
): LayeredDesignTextOcrModelSlot {
  return createLayeredDesignTextOcrModelSlotFromConfig(input, {
    execute: async (slotInput, context) => {
      if (!transport.executeTextOcr) {
        throw createMissingTransportHandlerError("text_ocr", context);
      }

      return await transport.executeTextOcr({
        kind: "text_ocr",
        input: slotInput,
        context,
      });
    },
  });
}
