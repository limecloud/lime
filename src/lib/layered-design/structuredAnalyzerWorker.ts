import type {
  LayeredDesignFlatImageStructuredAnalyzerProvider,
  LayeredDesignFlatImageStructuredAnalyzerProviderInput,
  LayeredDesignFlatImageStructuredAnalyzerResult,
} from "./analyzer";

export const LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_REQUEST =
  "lime.layered_design.structured_analyzer.request" as const;
export const LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_RESULT =
  "lime.layered_design.structured_analyzer.result" as const;
export const LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_ERROR =
  "lime.layered_design.structured_analyzer.error" as const;

export interface LayeredDesignStructuredAnalyzerWorkerRequest {
  type: typeof LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_REQUEST;
  requestId: string;
  input: Omit<
    LayeredDesignFlatImageStructuredAnalyzerProviderInput,
    "textOcrProvider"
  >;
}

export interface LayeredDesignStructuredAnalyzerWorkerResult {
  type: typeof LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_RESULT;
  requestId: string;
  result: LayeredDesignFlatImageStructuredAnalyzerResult;
}

export interface LayeredDesignStructuredAnalyzerWorkerError {
  type: typeof LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_ERROR;
  requestId: string;
  error?: {
    message?: string;
    code?: string;
  };
}

export type LayeredDesignStructuredAnalyzerWorkerResponse =
  | LayeredDesignStructuredAnalyzerWorkerResult
  | LayeredDesignStructuredAnalyzerWorkerError;

export interface LayeredDesignStructuredAnalyzerWorkerMessageEvent {
  data: unknown;
}

export type LayeredDesignStructuredAnalyzerWorkerMessageListener = (
  event: LayeredDesignStructuredAnalyzerWorkerMessageEvent,
) => void;

export interface LayeredDesignStructuredAnalyzerWorkerLike {
  postMessage: (message: LayeredDesignStructuredAnalyzerWorkerRequest) => void;
  addEventListener: (
    type: "message",
    listener: LayeredDesignStructuredAnalyzerWorkerMessageListener,
  ) => void;
  removeEventListener: (
    type: "message",
    listener: LayeredDesignStructuredAnalyzerWorkerMessageListener,
  ) => void;
}

export interface LayeredDesignStructuredAnalyzerWorkerRuntimeScope {
  postMessage: (message: LayeredDesignStructuredAnalyzerWorkerResponse) => void;
  addEventListener: (
    type: "message",
    listener: LayeredDesignStructuredAnalyzerWorkerMessageListener,
  ) => void;
  removeEventListener: (
    type: "message",
    listener: LayeredDesignStructuredAnalyzerWorkerMessageListener,
  ) => void;
}

export interface CreateLayeredDesignStructuredAnalyzerWorkerProviderOptions {
  requestIdFactory?: () => string;
  timeoutMs?: number;
}

const DEFAULT_WORKER_TIMEOUT_MS = 30_000;

let workerRequestSequence = 0;

function createDefaultWorkerRequestId(): string {
  workerRequestSequence += 1;
  return `layered-design-analyzer-${Date.now()}-${workerRequestSequence}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isWorkerResponseForRequest(
  value: unknown,
  requestId: string,
): value is LayeredDesignStructuredAnalyzerWorkerResponse {
  return (
    isRecord(value) &&
    value.requestId === requestId &&
    (value.type === LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_RESULT ||
      value.type === LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_ERROR)
  );
}

function isWorkerRequest(
  value: unknown,
): value is LayeredDesignStructuredAnalyzerWorkerRequest {
  if (
    !isRecord(value) ||
    value.type !== LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_REQUEST ||
    typeof value.requestId !== "string" ||
    !isRecord(value.input)
  ) {
    return false;
  }

  const image = value.input.image;
  return (
    isRecord(image) &&
    typeof image.src === "string" &&
    typeof image.width === "number" &&
    typeof image.height === "number" &&
    typeof value.input.createdAt === "string"
  );
}

function createWorkerError(
  response: LayeredDesignStructuredAnalyzerWorkerError,
): Error {
  const message =
    response.error?.message ?? "图层拆分 worker 返回了未知错误";
  const error = new Error(message);
  if (response.error?.code) {
    error.name = response.error.code;
  }
  return error;
}

export function createLayeredDesignStructuredAnalyzerWorkerProvider(
  worker: LayeredDesignStructuredAnalyzerWorkerLike,
  options: CreateLayeredDesignStructuredAnalyzerWorkerProviderOptions = {},
): LayeredDesignFlatImageStructuredAnalyzerProvider {
  const requestIdFactory =
    options.requestIdFactory ?? createDefaultWorkerRequestId;
  const timeoutMs = options.timeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS;

  return {
    analyze: async (input) => {
      const requestId = requestIdFactory();
      const workerInput: LayeredDesignStructuredAnalyzerWorkerRequest["input"] =
        {
          image: input.image,
          createdAt: input.createdAt,
        };

      return await new Promise<LayeredDesignFlatImageStructuredAnalyzerResult>(
        (resolve, reject) => {
          let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

          const cleanup = () => {
            if (timeoutHandle) {
              clearTimeout(timeoutHandle);
            }
            worker.removeEventListener("message", handleMessage);
          };

          const handleMessage: LayeredDesignStructuredAnalyzerWorkerMessageListener =
            (event) => {
              if (!isWorkerResponseForRequest(event.data, requestId)) {
                return;
              }

              cleanup();
              if (
                event.data.type ===
                LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_ERROR
              ) {
                reject(createWorkerError(event.data));
                return;
              }

              resolve(event.data.result);
            };

          worker.addEventListener("message", handleMessage);

          if (timeoutMs > 0) {
            timeoutHandle = setTimeout(() => {
              cleanup();
              reject(
                new Error(
                  `图层拆分 worker 在 ${timeoutMs}ms 内没有返回结果`,
                ),
              );
            }, timeoutMs);
          }

          try {
            worker.postMessage({
              type: LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_REQUEST,
              requestId,
              input: workerInput,
            });
          } catch (error) {
            cleanup();
            reject(error);
          }
        },
      );
    },
  };
}

export function installLayeredDesignStructuredAnalyzerWorkerRuntime(
  scope: LayeredDesignStructuredAnalyzerWorkerRuntimeScope,
  provider: LayeredDesignFlatImageStructuredAnalyzerProvider,
): () => void {
  const handleMessage: LayeredDesignStructuredAnalyzerWorkerMessageListener = (
    event,
  ) => {
    if (!isWorkerRequest(event.data)) {
      return;
    }

    const request = event.data;

    void provider
      .analyze(request.input)
      .then((result) => {
        scope.postMessage({
          type: LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_RESULT,
          requestId: request.requestId,
          result,
        });
      })
      .catch((error: unknown) => {
        scope.postMessage({
          type: LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_ERROR,
          requestId: request.requestId,
          error: {
            message:
              error instanceof Error
                ? error.message
                : "图层拆分 worker 执行失败",
            ...(error instanceof Error && error.name
              ? { code: error.name }
              : {}),
          },
        });
      });
  };

  scope.addEventListener("message", handleMessage);
  return () => scope.removeEventListener("message", handleMessage);
}
