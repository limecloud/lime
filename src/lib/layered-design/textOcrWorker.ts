import type {
  LayeredDesignFlatImageOcrTextBlock,
  LayeredDesignFlatImageTextOcrProvider,
  LayeredDesignFlatImageTextOcrProviderInput,
} from "./analyzer";

export const LAYERED_DESIGN_TEXT_OCR_WORKER_REQUEST =
  "lime.layered_design.text_ocr.request" as const;
export const LAYERED_DESIGN_TEXT_OCR_WORKER_RESULT =
  "lime.layered_design.text_ocr.result" as const;
export const LAYERED_DESIGN_TEXT_OCR_WORKER_ERROR =
  "lime.layered_design.text_ocr.error" as const;

export interface LayeredDesignTextOcrWorkerRequest {
  type: typeof LAYERED_DESIGN_TEXT_OCR_WORKER_REQUEST;
  requestId: string;
  input: LayeredDesignFlatImageTextOcrProviderInput;
}

export interface LayeredDesignTextOcrWorkerResult {
  type: typeof LAYERED_DESIGN_TEXT_OCR_WORKER_RESULT;
  requestId: string;
  blocks: LayeredDesignFlatImageOcrTextBlock[];
}

export interface LayeredDesignTextOcrWorkerError {
  type: typeof LAYERED_DESIGN_TEXT_OCR_WORKER_ERROR;
  requestId: string;
  error?: {
    message?: string;
    code?: string;
  };
}

export type LayeredDesignTextOcrWorkerResponse =
  | LayeredDesignTextOcrWorkerResult
  | LayeredDesignTextOcrWorkerError;

export interface LayeredDesignTextOcrWorkerMessageEvent {
  data: unknown;
}

export type LayeredDesignTextOcrWorkerMessageListener = (
  event: LayeredDesignTextOcrWorkerMessageEvent,
) => void;

export interface LayeredDesignTextOcrWorkerLike {
  postMessage: (message: LayeredDesignTextOcrWorkerRequest) => void;
  addEventListener: (
    type: "message",
    listener: LayeredDesignTextOcrWorkerMessageListener,
  ) => void;
  removeEventListener: (
    type: "message",
    listener: LayeredDesignTextOcrWorkerMessageListener,
  ) => void;
}

export interface LayeredDesignTextOcrWorkerRuntimeScope {
  postMessage: (message: LayeredDesignTextOcrWorkerResponse) => void;
  addEventListener: (
    type: "message",
    listener: LayeredDesignTextOcrWorkerMessageListener,
  ) => void;
  removeEventListener: (
    type: "message",
    listener: LayeredDesignTextOcrWorkerMessageListener,
  ) => void;
}

export interface CreateLayeredDesignTextOcrWorkerProviderOptions {
  label?: string;
  requestIdFactory?: () => string;
  timeoutMs?: number;
}

const DEFAULT_WORKER_TIMEOUT_MS = 30_000;

let textOcrWorkerRequestSequence = 0;

function createDefaultWorkerRequestId(): string {
  textOcrWorkerRequestSequence += 1;
  return `layered-design-text-ocr-${Date.now()}-${textOcrWorkerRequestSequence}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRectLike(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNumber(value.x) &&
    isNumber(value.y) &&
    isNumber(value.width) &&
    isNumber(value.height)
  );
}

function isTextOcrInput(
  value: unknown,
): value is LayeredDesignFlatImageTextOcrProviderInput {
  if (!isRecord(value)) {
    return false;
  }

  const image = value.image;
  const candidate = value.candidate;
  if (!isRecord(image) || !isRecord(candidate)) {
    return false;
  }

  const asset = candidate.asset;
  return (
    typeof image.src === "string" &&
    isNumber(image.width) &&
    isNumber(image.height) &&
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    candidate.role === "text" &&
    isRectLike(candidate.rect) &&
    isRecord(asset) &&
    typeof asset.id === "string" &&
    typeof asset.kind === "string" &&
    typeof asset.src === "string" &&
    isNumber(asset.width) &&
    isNumber(asset.height) &&
    typeof asset.hasAlpha === "boolean" &&
    typeof asset.createdAt === "string"
  );
}

function isWorkerRequest(
  value: unknown,
): value is LayeredDesignTextOcrWorkerRequest {
  return (
    isRecord(value) &&
    value.type === LAYERED_DESIGN_TEXT_OCR_WORKER_REQUEST &&
    typeof value.requestId === "string" &&
    isTextOcrInput(value.input)
  );
}

function isWorkerResponseForRequest(
  value: unknown,
  requestId: string,
): value is LayeredDesignTextOcrWorkerResponse {
  return (
    isRecord(value) &&
    value.requestId === requestId &&
    (value.type === LAYERED_DESIGN_TEXT_OCR_WORKER_RESULT ||
      value.type === LAYERED_DESIGN_TEXT_OCR_WORKER_ERROR)
  );
}

function createWorkerError(response: LayeredDesignTextOcrWorkerError): Error {
  const message = response.error?.message ?? "文字 OCR worker 返回了未知错误";
  const error = new Error(message);
  if (response.error?.code) {
    error.name = response.error.code;
  }
  return error;
}

export function createLayeredDesignTextOcrWorkerProvider(
  worker: LayeredDesignTextOcrWorkerLike,
  options: CreateLayeredDesignTextOcrWorkerProviderOptions = {},
): LayeredDesignFlatImageTextOcrProvider {
  const requestIdFactory =
    options.requestIdFactory ?? createDefaultWorkerRequestId;
  const timeoutMs = options.timeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS;

  return {
    label: options.label ?? "Worker text OCR provider",
    detectText: async (input) => {
      const requestId = requestIdFactory();

      return await new Promise<LayeredDesignFlatImageOcrTextBlock[]>(
        (resolve, reject) => {
          let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

          const cleanup = () => {
            if (timeoutHandle) {
              clearTimeout(timeoutHandle);
            }
            worker.removeEventListener("message", handleMessage);
          };

          const handleMessage: LayeredDesignTextOcrWorkerMessageListener = (
            event,
          ) => {
            if (!isWorkerResponseForRequest(event.data, requestId)) {
              return;
            }

            cleanup();
            if (event.data.type === LAYERED_DESIGN_TEXT_OCR_WORKER_ERROR) {
              reject(createWorkerError(event.data));
              return;
            }

            resolve(event.data.blocks);
          };

          worker.addEventListener("message", handleMessage);

          if (timeoutMs > 0) {
            timeoutHandle = setTimeout(() => {
              cleanup();
              reject(
                new Error(`文字 OCR worker 在 ${timeoutMs}ms 内没有返回结果`),
              );
            }, timeoutMs);
          }

          try {
            worker.postMessage({
              type: LAYERED_DESIGN_TEXT_OCR_WORKER_REQUEST,
              requestId,
              input,
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

export function installLayeredDesignTextOcrWorkerRuntime(
  scope: LayeredDesignTextOcrWorkerRuntimeScope,
  provider: LayeredDesignFlatImageTextOcrProvider,
): () => void {
  const handleMessage: LayeredDesignTextOcrWorkerMessageListener = (event) => {
    if (!isWorkerRequest(event.data)) {
      return;
    }

    const request = event.data;

    void provider
      .detectText(request.input)
      .then((blocks) => {
        scope.postMessage({
          type: LAYERED_DESIGN_TEXT_OCR_WORKER_RESULT,
          requestId: request.requestId,
          blocks,
        });
      })
      .catch((error: unknown) => {
        scope.postMessage({
          type: LAYERED_DESIGN_TEXT_OCR_WORKER_ERROR,
          requestId: request.requestId,
          error: {
            message:
              error instanceof Error
                ? error.message
                : "文字 OCR worker 执行失败",
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
