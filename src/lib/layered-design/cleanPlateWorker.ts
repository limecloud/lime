import type {
  LayeredDesignCleanPlateInput,
  LayeredDesignCleanPlateProvider,
  LayeredDesignCleanPlateResult,
} from "./cleanPlate";

export const LAYERED_DESIGN_CLEAN_PLATE_WORKER_REQUEST =
  "lime.layered_design.clean_plate.request" as const;
export const LAYERED_DESIGN_CLEAN_PLATE_WORKER_RESULT =
  "lime.layered_design.clean_plate.result" as const;
export const LAYERED_DESIGN_CLEAN_PLATE_WORKER_ERROR =
  "lime.layered_design.clean_plate.error" as const;

export interface LayeredDesignCleanPlateWorkerRequest {
  type: typeof LAYERED_DESIGN_CLEAN_PLATE_WORKER_REQUEST;
  requestId: string;
  input: LayeredDesignCleanPlateInput;
}

export interface LayeredDesignCleanPlateWorkerResult {
  type: typeof LAYERED_DESIGN_CLEAN_PLATE_WORKER_RESULT;
  requestId: string;
  result: LayeredDesignCleanPlateResult | null;
}

export interface LayeredDesignCleanPlateWorkerError {
  type: typeof LAYERED_DESIGN_CLEAN_PLATE_WORKER_ERROR;
  requestId: string;
  error?: {
    message?: string;
    code?: string;
  };
}

export type LayeredDesignCleanPlateWorkerResponse =
  | LayeredDesignCleanPlateWorkerResult
  | LayeredDesignCleanPlateWorkerError;

export interface LayeredDesignCleanPlateWorkerMessageEvent {
  data: unknown;
}

export type LayeredDesignCleanPlateWorkerMessageListener = (
  event: LayeredDesignCleanPlateWorkerMessageEvent,
) => void;

export interface LayeredDesignCleanPlateWorkerLike {
  postMessage: (message: LayeredDesignCleanPlateWorkerRequest) => void;
  addEventListener: (
    type: "message",
    listener: LayeredDesignCleanPlateWorkerMessageListener,
  ) => void;
  removeEventListener: (
    type: "message",
    listener: LayeredDesignCleanPlateWorkerMessageListener,
  ) => void;
}

export interface LayeredDesignCleanPlateWorkerRuntimeScope {
  postMessage: (message: LayeredDesignCleanPlateWorkerResponse) => void;
  addEventListener: (
    type: "message",
    listener: LayeredDesignCleanPlateWorkerMessageListener,
  ) => void;
  removeEventListener: (
    type: "message",
    listener: LayeredDesignCleanPlateWorkerMessageListener,
  ) => void;
}

export interface CreateLayeredDesignCleanPlateWorkerProviderOptions {
  label?: string;
  requestIdFactory?: () => string;
  timeoutMs?: number;
}

const DEFAULT_WORKER_TIMEOUT_MS = 30_000;

let cleanPlateWorkerRequestSequence = 0;

function createDefaultWorkerRequestId(): string {
  cleanPlateWorkerRequestSequence += 1;
  return `layered-design-clean-plate-${Date.now()}-${cleanPlateWorkerRequestSequence}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCleanPlateInput(value: unknown): value is LayeredDesignCleanPlateInput {
  if (!isRecord(value) || typeof value.createdAt !== "string") {
    return false;
  }

  const image = value.image;
  const subject = value.subject;
  if (!isRecord(image) || !isRecord(subject)) {
    return false;
  }

  const rect = subject.rect;
  const crop = subject.crop;
  return (
    typeof image.src === "string" &&
    isNumber(image.width) &&
    isNumber(image.height) &&
    typeof subject.id === "string" &&
    typeof subject.name === "string" &&
    isRecord(rect) &&
    isNumber(rect.x) &&
    isNumber(rect.y) &&
    isNumber(rect.width) &&
    isNumber(rect.height) &&
    isNumber(subject.confidence) &&
    isNumber(subject.zIndex) &&
    isRecord(crop) &&
    typeof crop.src === "string" &&
    isNumber(crop.width) &&
    isNumber(crop.height) &&
    crop.mimeType === "image/png" &&
    (typeof subject.maskSrc === "undefined" ||
      typeof subject.maskSrc === "string")
  );
}

function isWorkerRequest(
  value: unknown,
): value is LayeredDesignCleanPlateWorkerRequest {
  return (
    isRecord(value) &&
    value.type === LAYERED_DESIGN_CLEAN_PLATE_WORKER_REQUEST &&
    typeof value.requestId === "string" &&
    isCleanPlateInput(value.input)
  );
}

function isWorkerResponseForRequest(
  value: unknown,
  requestId: string,
): value is LayeredDesignCleanPlateWorkerResponse {
  return (
    isRecord(value) &&
    value.requestId === requestId &&
    (value.type === LAYERED_DESIGN_CLEAN_PLATE_WORKER_RESULT ||
      value.type === LAYERED_DESIGN_CLEAN_PLATE_WORKER_ERROR)
  );
}

function createWorkerError(response: LayeredDesignCleanPlateWorkerError): Error {
  const message = response.error?.message ?? "clean plate worker 返回了未知错误";
  const error = new Error(message);
  if (response.error?.code) {
    error.name = response.error.code;
  }
  return error;
}

export function createLayeredDesignCleanPlateWorkerProvider(
  worker: LayeredDesignCleanPlateWorkerLike,
  options: CreateLayeredDesignCleanPlateWorkerProviderOptions = {},
): LayeredDesignCleanPlateProvider {
  const requestIdFactory =
    options.requestIdFactory ?? createDefaultWorkerRequestId;
  const timeoutMs = options.timeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS;

  return {
    label: options.label ?? "Worker clean plate provider",
    createCleanPlate: async (input) => {
      const requestId = requestIdFactory();

      return await new Promise<LayeredDesignCleanPlateResult | null>(
        (resolve, reject) => {
          let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

          const cleanup = () => {
            if (timeoutHandle) {
              clearTimeout(timeoutHandle);
            }
            worker.removeEventListener("message", handleMessage);
          };

          const handleMessage: LayeredDesignCleanPlateWorkerMessageListener = (
            event,
          ) => {
            if (!isWorkerResponseForRequest(event.data, requestId)) {
              return;
            }

            cleanup();
            if (event.data.type === LAYERED_DESIGN_CLEAN_PLATE_WORKER_ERROR) {
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
                new Error(`clean plate worker 在 ${timeoutMs}ms 内没有返回结果`),
              );
            }, timeoutMs);
          }

          try {
            worker.postMessage({
              type: LAYERED_DESIGN_CLEAN_PLATE_WORKER_REQUEST,
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

export function installLayeredDesignCleanPlateWorkerRuntime(
  scope: LayeredDesignCleanPlateWorkerRuntimeScope,
  provider: LayeredDesignCleanPlateProvider,
): () => void {
  const handleMessage: LayeredDesignCleanPlateWorkerMessageListener = (
    event,
  ) => {
    if (!isWorkerRequest(event.data)) {
      return;
    }

    const request = event.data;

    void provider
      .createCleanPlate(request.input)
      .then((result) => {
        scope.postMessage({
          type: LAYERED_DESIGN_CLEAN_PLATE_WORKER_RESULT,
          requestId: request.requestId,
          result,
        });
      })
      .catch((error: unknown) => {
        scope.postMessage({
          type: LAYERED_DESIGN_CLEAN_PLATE_WORKER_ERROR,
          requestId: request.requestId,
          error: {
            message:
              error instanceof Error
                ? error.message
                : "clean plate worker 执行失败",
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
