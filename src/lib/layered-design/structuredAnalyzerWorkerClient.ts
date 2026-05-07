import {
  analyzeLayeredDesignFlatImage,
  createLayeredDesignFlatImageAnalyzerFromStructuredProvider,
  type AnalyzeLayeredDesignFlatImage,
  type CreateLayeredDesignFlatImageAnalyzerFromStructuredProviderOptions,
  type LayeredDesignFlatImageAnalysisResult,
} from "./analyzer";
import {
  createLayeredDesignStructuredAnalyzerWorkerProvider,
  type CreateLayeredDesignStructuredAnalyzerWorkerProviderOptions,
  type LayeredDesignStructuredAnalyzerWorkerLike,
} from "./structuredAnalyzerWorker";
import type { LayeredDesignAnalyzerProviderCapability } from "./providerCapabilities";
import type { LayeredDesignExtractionCandidateInput } from "./types";

export interface LayeredDesignStructuredAnalyzerWorkerHandle
  extends LayeredDesignStructuredAnalyzerWorkerLike {
  terminate?: () => void;
}

export type LayeredDesignStructuredAnalyzerWorkerFactory =
  () => LayeredDesignStructuredAnalyzerWorkerHandle;

export interface CreateLayeredDesignWorkerHeuristicAnalyzerOptions
  extends CreateLayeredDesignFlatImageAnalyzerFromStructuredProviderOptions,
    CreateLayeredDesignStructuredAnalyzerWorkerProviderOptions {
  workerFactory?: LayeredDesignStructuredAnalyzerWorkerFactory;
}

export interface CreateLayeredDesignWorkerFirstFlatImageAnalyzerOptions
  extends CreateLayeredDesignWorkerHeuristicAnalyzerOptions {
  mergeTextOcrFromFallback?: boolean;
}

function isTextLayerCandidate(
  candidate: LayeredDesignExtractionCandidateInput,
): boolean {
  return candidate.role === "text" && candidate.layer.type === "text";
}

function mergeProviderCapabilities(
  left: readonly LayeredDesignAnalyzerProviderCapability[] | undefined,
  right: readonly LayeredDesignAnalyzerProviderCapability[] | undefined,
): LayeredDesignAnalyzerProviderCapability[] | undefined {
  const merged = new Map<string, LayeredDesignAnalyzerProviderCapability>();

  for (const capability of [...(left ?? []), ...(right ?? [])]) {
    merged.set(
      `${capability.kind}:${capability.execution}:${capability.modelId}:${capability.label}`,
      capability,
    );
  }

  return merged.size > 0 ? Array.from(merged.values()) : undefined;
}

function mergeWorkerAnalysisWithTextOcrResult(params: {
  workerResult: LayeredDesignFlatImageAnalysisResult;
  textOcrResult: LayeredDesignFlatImageAnalysisResult;
}): LayeredDesignFlatImageAnalysisResult {
  const textCandidates = params.textOcrResult.candidates.filter(
    isTextLayerCandidate,
  );
  if (textCandidates.length === 0) {
    return params.workerResult;
  }

  const providerCapabilities = mergeProviderCapabilities(
    params.workerResult.analysis.providerCapabilities,
    params.textOcrResult.analysis.providerCapabilities,
  );

  return {
    analysis: {
      ...params.workerResult.analysis,
      analyzer: {
        kind: "structured_pipeline",
        label: `${params.workerResult.analysis.analyzer.label} + OCR TextLayer merge`,
      },
      outputs: {
        ...(params.workerResult.analysis.outputs ?? {}),
        ocrText: true,
      },
      ...(providerCapabilities ? { providerCapabilities } : {}),
      generatedAt:
        params.workerResult.analysis.generatedAt ??
        params.textOcrResult.analysis.generatedAt,
    },
    candidates: [
      ...params.workerResult.candidates.filter(
        (candidate) => candidate.role !== "text",
      ),
      ...textCandidates,
    ],
    cleanPlate: params.workerResult.cleanPlate,
  };
}

export function createDefaultLayeredDesignStructuredAnalyzerWorker(): Worker {
  if (typeof Worker !== "function") {
    throw new Error("当前环境不支持图层拆分 Worker");
  }

  return new Worker(new URL("./structuredAnalyzer.worker.ts", import.meta.url), {
    name: "lime-layered-design-structured-analyzer",
    type: "module",
  });
}

export function createLayeredDesignWorkerHeuristicAnalyzer(
  options: CreateLayeredDesignWorkerHeuristicAnalyzerOptions = {},
): AnalyzeLayeredDesignFlatImage {
  const workerFactory =
    options.workerFactory ?? createDefaultLayeredDesignStructuredAnalyzerWorker;

  return async (params) => {
    let worker: LayeredDesignStructuredAnalyzerWorkerHandle | null = null;

    try {
      worker = workerFactory();
      const provider = createLayeredDesignStructuredAnalyzerWorkerProvider(
        worker,
        {
          requestIdFactory: options.requestIdFactory,
          timeoutMs: options.timeoutMs,
        },
      );
      const analyzer =
        createLayeredDesignFlatImageAnalyzerFromStructuredProvider(provider, {
          fallbackAnalyzer: options.fallbackAnalyzer,
          textOcrProvider: options.textOcrProvider,
        });
      return await analyzer(params);
    } catch (error) {
      if (options.fallbackAnalyzer === null) {
        throw error;
      }

      const fallbackAnalyzer =
        options.fallbackAnalyzer ?? analyzeLayeredDesignFlatImage;
      const textOcrProvider =
        params.textOcrProvider === undefined
          ? options.textOcrProvider
          : params.textOcrProvider;

      return await fallbackAnalyzer({
        ...params,
        structuredAnalyzerProvider: null,
        textOcrProvider,
      });
    } finally {
      worker?.terminate?.();
    }
  };
}

export function createLayeredDesignWorkerFirstFlatImageAnalyzer(
  options: CreateLayeredDesignWorkerFirstFlatImageAnalyzerOptions = {},
): AnalyzeLayeredDesignFlatImage {
  const workerAnalyzer = createLayeredDesignWorkerHeuristicAnalyzer(options);
  const shouldMergeTextOcr = options.mergeTextOcrFromFallback ?? true;

  return async (params) => {
    const workerResult = await workerAnalyzer(params);
    if (
      !shouldMergeTextOcr ||
      params.textOcrProvider === null ||
      workerResult.analysis.outputs?.ocrText
    ) {
      return workerResult;
    }

    try {
      if (options.fallbackAnalyzer === null) {
        return workerResult;
      }

      const fallbackAnalyzer =
        options.fallbackAnalyzer ?? analyzeLayeredDesignFlatImage;
      const textOcrProvider =
        params.textOcrProvider === undefined
          ? options.textOcrProvider
          : params.textOcrProvider;
      const textOcrResult = await fallbackAnalyzer({
        ...params,
        structuredAnalyzerProvider: null,
        textOcrProvider,
      });

      return mergeWorkerAnalysisWithTextOcrResult({
        workerResult,
        textOcrResult,
      });
    } catch {
      return workerResult;
    }
  };
}
