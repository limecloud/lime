import {
  createLayeredDesignFlatImageAnalyzerFromModelSlotJsonExecutor,
  type CreateLayeredDesignFlatImageAnalyzerFromModelSlotTransportOptions,
} from "./analyzerModelSlotAnalyzer";
import type { LayeredDesignAnalyzerModelSlotConfigInput } from "./analyzerModelSlotConfig";
import {
  createLayeredDesignAnalyzerModelSlotTransportError,
  type LayeredDesignAnalyzerModelSlotTransportJsonExecutor,
  type LayeredDesignAnalyzerModelSlotTransportJsonRequest,
  type LayeredDesignAnalyzerModelSlotTransportJsonResult,
} from "./analyzerModelSlotTransport";
import type { AnalyzeLayeredDesignFlatImage } from "./analyzer";

export interface LayeredDesignAnalyzerModelSlotHttpJsonExecutorResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  json: () => Promise<unknown>;
}

export type LayeredDesignAnalyzerModelSlotHttpJsonExecutorFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<LayeredDesignAnalyzerModelSlotHttpJsonExecutorResponse>;

export interface CreateLayeredDesignAnalyzerModelSlotHttpJsonExecutorOptions {
  endpointUrl: string;
  fetchImpl?: LayeredDesignAnalyzerModelSlotHttpJsonExecutorFetch;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveHttpErrorCode(status: number) {
  if (status === 401 || status === 403) {
    return { code: "unauthorized" as const, retryable: false };
  }
  if (status === 429) {
    return { code: "rate_limited" as const, retryable: true };
  }
  if (status === 408 || status === 504) {
    return { code: "timeout" as const, retryable: true };
  }
  if (status >= 500) {
    return { code: "remote_unavailable" as const, retryable: true };
  }

  return { code: "invalid_response" as const, retryable: false };
}

function createHttpExecutorDetails(
  endpointUrl: string,
  request: LayeredDesignAnalyzerModelSlotTransportJsonRequest,
  extra: Record<string, unknown> = {},
) {
  return {
    endpointUrl,
    kind: request.kind,
    slotId: request.context.slotId,
    modelId: request.context.modelId,
    ...extra,
  };
}

function resolveFetch(
  fetchImpl: LayeredDesignAnalyzerModelSlotHttpJsonExecutorFetch | undefined,
): LayeredDesignAnalyzerModelSlotHttpJsonExecutorFetch {
  if (fetchImpl) {
    return fetchImpl;
  }
  if (typeof fetch === "function") {
    return fetch as unknown as LayeredDesignAnalyzerModelSlotHttpJsonExecutorFetch;
  }

  throw createLayeredDesignAnalyzerModelSlotTransportError({
    code: "remote_unavailable",
    message:
      "Layered design analyzer model slot HTTP JSON executor requires fetch",
    retryable: false,
  });
}

export function createLayeredDesignAnalyzerModelSlotHttpJsonExecutor(
  options: CreateLayeredDesignAnalyzerModelSlotHttpJsonExecutorOptions,
): LayeredDesignAnalyzerModelSlotTransportJsonExecutor {
  const endpointUrl = options.endpointUrl.trim();
  const timeoutMs = options.timeoutMs ?? 60_000;
  const fetchImpl = resolveFetch(options.fetchImpl);

  return async (request) => {
    const controller = timeoutMs > 0 ? new AbortController() : undefined;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;

    try {
      const response = await fetchImpl(endpointUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          ...(options.headers ?? {}),
        },
        body: JSON.stringify(request),
        ...(controller ? { signal: controller.signal } : {}),
      });

      if (!response.ok) {
        const { code, retryable } = resolveHttpErrorCode(response.status);
        throw createLayeredDesignAnalyzerModelSlotTransportError({
          code,
          message: `Layered design analyzer model slot HTTP JSON executor failed: ${response.status} ${response.statusText ?? ""}`.trim(),
          retryable,
          statusCode: response.status,
          details: createHttpExecutorDetails(endpointUrl, request, {
            status: response.status,
            statusText: response.statusText ?? "",
          }),
        });
      }

      const json = await response.json();
      if (!isRecord(json)) {
        throw createLayeredDesignAnalyzerModelSlotTransportError({
          code: "invalid_response",
          message:
            "Layered design analyzer model slot HTTP JSON executor must return a JSON object",
          retryable: false,
          details: createHttpExecutorDetails(endpointUrl, request),
        });
      }

      return json as LayeredDesignAnalyzerModelSlotTransportJsonResult;
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "AbortError" &&
        controller?.signal.aborted
      ) {
        throw createLayeredDesignAnalyzerModelSlotTransportError({
          code: "timeout",
          message: `Layered design analyzer model slot HTTP JSON executor timed out after ${timeoutMs}ms`,
          retryable: true,
          details: createHttpExecutorDetails(endpointUrl, request, {
            timeoutMs,
          }),
          cause: error,
        });
      }

      throw error;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  };
}

export function createLayeredDesignFlatImageAnalyzerFromModelSlotHttpJsonExecutor(
  configs: readonly LayeredDesignAnalyzerModelSlotConfigInput[],
  executorOptions: CreateLayeredDesignAnalyzerModelSlotHttpJsonExecutorOptions,
  analyzerOptions: CreateLayeredDesignFlatImageAnalyzerFromModelSlotTransportOptions = {},
): AnalyzeLayeredDesignFlatImage {
  return createLayeredDesignFlatImageAnalyzerFromModelSlotJsonExecutor(
    configs,
    createLayeredDesignAnalyzerModelSlotHttpJsonExecutor(executorOptions),
    analyzerOptions,
  );
}
