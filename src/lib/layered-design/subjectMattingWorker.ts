import type {
  LayeredDesignSubjectMattingInput,
  LayeredDesignSubjectMattingProvider,
  LayeredDesignSubjectMattingResult,
} from "./subjectMatting";

export const LAYERED_DESIGN_SUBJECT_MATTING_WORKER_REQUEST =
  "lime.layered_design.subject_matting.request" as const;
export const LAYERED_DESIGN_SUBJECT_MATTING_WORKER_RESULT =
  "lime.layered_design.subject_matting.result" as const;
export const LAYERED_DESIGN_SUBJECT_MATTING_WORKER_ERROR =
  "lime.layered_design.subject_matting.error" as const;

export interface LayeredDesignSubjectMattingWorkerRequest {
  type: typeof LAYERED_DESIGN_SUBJECT_MATTING_WORKER_REQUEST;
  requestId: string;
  input: LayeredDesignSubjectMattingInput;
}

export interface LayeredDesignSubjectMattingWorkerResult {
  type: typeof LAYERED_DESIGN_SUBJECT_MATTING_WORKER_RESULT;
  requestId: string;
  result: LayeredDesignSubjectMattingResult | null;
}

export interface LayeredDesignSubjectMattingWorkerError {
  type: typeof LAYERED_DESIGN_SUBJECT_MATTING_WORKER_ERROR;
  requestId: string;
  error?: {
    message?: string;
    code?: string;
  };
}

export type LayeredDesignSubjectMattingWorkerResponse =
  | LayeredDesignSubjectMattingWorkerResult
  | LayeredDesignSubjectMattingWorkerError;

export interface LayeredDesignSubjectMattingWorkerMessageEvent {
  data: unknown;
}

export type LayeredDesignSubjectMattingWorkerMessageListener = (
  event: LayeredDesignSubjectMattingWorkerMessageEvent,
) => void;

export interface LayeredDesignSubjectMattingWorkerLike {
  postMessage: (message: LayeredDesignSubjectMattingWorkerRequest) => void;
  addEventListener: (
    type: "message",
    listener: LayeredDesignSubjectMattingWorkerMessageListener,
  ) => void;
  removeEventListener: (
    type: "message",
    listener: LayeredDesignSubjectMattingWorkerMessageListener,
  ) => void;
}

export interface LayeredDesignSubjectMattingWorkerRuntimeScope {
  postMessage: (message: LayeredDesignSubjectMattingWorkerResponse) => void;
  addEventListener: (
    type: "message",
    listener: LayeredDesignSubjectMattingWorkerMessageListener,
  ) => void;
  removeEventListener: (
    type: "message",
    listener: LayeredDesignSubjectMattingWorkerMessageListener,
  ) => void;
}

export interface CreateLayeredDesignSubjectMattingWorkerProviderOptions {
  label?: string;
  requestIdFactory?: () => string;
  timeoutMs?: number;
}

const DEFAULT_WORKER_TIMEOUT_MS = 30_000;

let subjectMattingWorkerRequestSequence = 0;

function createDefaultWorkerRequestId(): string {
  subjectMattingWorkerRequestSequence += 1;
  return `layered-design-subject-matting-${Date.now()}-${subjectMattingWorkerRequestSequence}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSubjectMattingInput(
  value: unknown,
): value is LayeredDesignSubjectMattingInput {
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
    crop.mimeType === "image/png"
  );
}

function isWorkerRequest(
  value: unknown,
): value is LayeredDesignSubjectMattingWorkerRequest {
  return (
    isRecord(value) &&
    value.type === LAYERED_DESIGN_SUBJECT_MATTING_WORKER_REQUEST &&
    typeof value.requestId === "string" &&
    isSubjectMattingInput(value.input)
  );
}

function isWorkerResponseForRequest(
  value: unknown,
  requestId: string,
): value is LayeredDesignSubjectMattingWorkerResponse {
  return (
    isRecord(value) &&
    value.requestId === requestId &&
    (value.type === LAYERED_DESIGN_SUBJECT_MATTING_WORKER_RESULT ||
      value.type === LAYERED_DESIGN_SUBJECT_MATTING_WORKER_ERROR)
  );
}

function createWorkerError(
  response: LayeredDesignSubjectMattingWorkerError,
): Error {
  const message =
    response.error?.message ?? "主体 matting worker 返回了未知错误";
  const error = new Error(message);
  if (response.error?.code) {
    error.name = response.error.code;
  }
  return error;
}

export function createLayeredDesignSubjectMattingWorkerProvider(
  worker: LayeredDesignSubjectMattingWorkerLike,
  options: CreateLayeredDesignSubjectMattingWorkerProviderOptions = {},
): LayeredDesignSubjectMattingProvider {
  const requestIdFactory =
    options.requestIdFactory ?? createDefaultWorkerRequestId;
  const timeoutMs = options.timeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS;

  return {
    label: options.label ?? "Worker subject matting provider",
    matteSubject: async (input) => {
      const requestId = requestIdFactory();

      return await new Promise<LayeredDesignSubjectMattingResult | null>(
        (resolve, reject) => {
          let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

          const cleanup = () => {
            if (timeoutHandle) {
              clearTimeout(timeoutHandle);
            }
            worker.removeEventListener("message", handleMessage);
          };

          const handleMessage: LayeredDesignSubjectMattingWorkerMessageListener =
            (event) => {
              if (!isWorkerResponseForRequest(event.data, requestId)) {
                return;
              }

              cleanup();
              if (
                event.data.type ===
                LAYERED_DESIGN_SUBJECT_MATTING_WORKER_ERROR
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
                  `主体 matting worker 在 ${timeoutMs}ms 内没有返回结果`,
                ),
              );
            }, timeoutMs);
          }

          try {
            worker.postMessage({
              type: LAYERED_DESIGN_SUBJECT_MATTING_WORKER_REQUEST,
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

export function installLayeredDesignSubjectMattingWorkerRuntime(
  scope: LayeredDesignSubjectMattingWorkerRuntimeScope,
  provider: LayeredDesignSubjectMattingProvider,
): () => void {
  const handleMessage: LayeredDesignSubjectMattingWorkerMessageListener = (
    event,
  ) => {
    if (!isWorkerRequest(event.data)) {
      return;
    }

    const request = event.data;

    void provider
      .matteSubject(request.input)
      .then((result) => {
        scope.postMessage({
          type: LAYERED_DESIGN_SUBJECT_MATTING_WORKER_RESULT,
          requestId: request.requestId,
          result,
        });
      })
      .catch((error: unknown) => {
        scope.postMessage({
          type: LAYERED_DESIGN_SUBJECT_MATTING_WORKER_ERROR,
          requestId: request.requestId,
          error: {
            message:
              error instanceof Error
                ? error.message
                : "主体 matting worker 执行失败",
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
