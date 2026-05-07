import {
  createLayeredDesignNativeTextOcrProvider,
  createLayeredDesignFlatImageAnalyzerFromStructuredProvider,
  type LayeredDesignFlatImageTextOcrProvider,
  type AnalyzeLayeredDesignFlatImage,
  type CreateLayeredDesignFlatImageAnalyzerFromStructuredProviderOptions,
} from "./analyzer";
import type { LayeredDesignAnalyzerModelSlotConfigInput } from "./analyzerModelSlotConfig";
import type {
  LayeredDesignCleanPlateModelSlot,
  LayeredDesignSubjectMattingModelSlot,
  LayeredDesignTextOcrModelSlot,
} from "./analyzerModelSlots";
import {
  createLayeredDesignWorkerHeuristicModelSlotOptions,
} from "./analyzerModelSlots";
import {
  createLayeredDesignAnalyzerModelSlotJsonExecutorFromProviders,
  createLayeredDesignAnalyzerModelSlotTransportFromJsonExecutor,
  createLayeredDesignCleanPlateModelSlotFromTransport,
  createLayeredDesignSubjectMattingModelSlotFromTransport,
  createLayeredDesignTextOcrModelSlotFromTransport,
  type LayeredDesignAnalyzerModelSlotTransport,
  type LayeredDesignAnalyzerModelSlotTransportJsonExecutor,
} from "./analyzerModelSlotTransport";
import {
  createLayeredDesignWorkerCleanPlateProvider,
  type CreateLayeredDesignWorkerCleanPlateProviderOptions,
} from "./cleanPlateWorkerClient";
import { createLayeredDesignPrioritizedTextOcrProvider } from "./textOcr";
import {
  createLayeredDesignWorkerSubjectMattingProvider,
  type CreateLayeredDesignWorkerSubjectMattingProviderOptions,
} from "./subjectMattingWorkerClient";
import {
  createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider,
  type LayeredDesignWorkerHeuristicRasterizerFactory,
} from "./structuredAnalyzerWorkerHeuristic";
import type { LayeredDesignCleanPlateProvider } from "./cleanPlate";
import type { LayeredDesignSubjectMattingProvider } from "./subjectMatting";
import {
  createLayeredDesignWorkerTextOcrProvider,
  type CreateLayeredDesignWorkerTextOcrProviderOptions,
} from "./textOcrWorkerClient";

export const LAYERED_DESIGN_DEFAULT_MODEL_SLOT_TEXT_OCR_PRIORITY_LABEL =
  "OCR priority: Tauri native OCR -> Worker OCR provider via model slot JSON executor";

export interface LayeredDesignAnalyzerModelSlotsFromTransport {
  subjectMattingSlot?: LayeredDesignSubjectMattingModelSlot;
  cleanPlateSlot?: LayeredDesignCleanPlateModelSlot;
  textOcrSlot?: LayeredDesignTextOcrModelSlot;
}

export interface CreateLayeredDesignFlatImageAnalyzerFromModelSlotTransportOptions
  extends CreateLayeredDesignFlatImageAnalyzerFromStructuredProviderOptions {
  rasterizerFactory?: LayeredDesignWorkerHeuristicRasterizerFactory;
}

export interface CreateLayeredDesignDefaultAnalyzerModelSlotJsonExecutorOptions {
  subjectMattingProvider?: LayeredDesignSubjectMattingProvider | null;
  cleanPlateProvider?: LayeredDesignCleanPlateProvider | null;
  modelSlotTextOcrProvider?: LayeredDesignFlatImageTextOcrProvider | null;
  nativeTextOcrProvider?: LayeredDesignFlatImageTextOcrProvider | null;
  workerTextOcrProvider?: LayeredDesignFlatImageTextOcrProvider | null;
  subjectMattingWorkerOptions?: CreateLayeredDesignWorkerSubjectMattingProviderOptions;
  cleanPlateWorkerOptions?: CreateLayeredDesignWorkerCleanPlateProviderOptions;
  textOcrWorkerOptions?: CreateLayeredDesignWorkerTextOcrProviderOptions;
  textOcrPriorityLabel?: string;
}

export interface CreateLayeredDesignFlatImageAnalyzerFromDefaultModelSlotProvidersOptions
  extends CreateLayeredDesignFlatImageAnalyzerFromModelSlotTransportOptions,
    CreateLayeredDesignDefaultAnalyzerModelSlotJsonExecutorOptions {}

function findModelSlotConfig(
  configs: readonly LayeredDesignAnalyzerModelSlotConfigInput[],
  kind: LayeredDesignAnalyzerModelSlotConfigInput["kind"],
): LayeredDesignAnalyzerModelSlotConfigInput | undefined {
  return configs.find((config) => config.kind === kind);
}

export function createLayeredDesignAnalyzerModelSlotsFromTransport(
  configs: readonly LayeredDesignAnalyzerModelSlotConfigInput[],
  transport: LayeredDesignAnalyzerModelSlotTransport,
): LayeredDesignAnalyzerModelSlotsFromTransport {
  const subjectMattingConfig = findModelSlotConfig(configs, "subject_matting");
  const cleanPlateConfig = findModelSlotConfig(configs, "clean_plate");
  const textOcrConfig = findModelSlotConfig(configs, "text_ocr");

  return {
    ...(subjectMattingConfig
      ? {
          subjectMattingSlot:
            createLayeredDesignSubjectMattingModelSlotFromTransport(
              subjectMattingConfig,
              transport,
            ),
        }
      : {}),
    ...(cleanPlateConfig
      ? {
          cleanPlateSlot: createLayeredDesignCleanPlateModelSlotFromTransport(
            cleanPlateConfig,
            transport,
          ),
        }
      : {}),
    ...(textOcrConfig
      ? {
          textOcrSlot: createLayeredDesignTextOcrModelSlotFromTransport(
            textOcrConfig,
            transport,
          ),
        }
      : {}),
  };
}

export function createLayeredDesignFlatImageAnalyzerFromModelSlotTransport(
  configs: readonly LayeredDesignAnalyzerModelSlotConfigInput[],
  transport: LayeredDesignAnalyzerModelSlotTransport,
  options: CreateLayeredDesignFlatImageAnalyzerFromModelSlotTransportOptions = {},
): AnalyzeLayeredDesignFlatImage {
  const modelSlots = createLayeredDesignAnalyzerModelSlotsFromTransport(
    configs,
    transport,
  );
  const structuredProvider =
    createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider({
      ...createLayeredDesignWorkerHeuristicModelSlotOptions(modelSlots),
      ...(options.rasterizerFactory
        ? { rasterizerFactory: options.rasterizerFactory }
        : {}),
    });

  return createLayeredDesignFlatImageAnalyzerFromStructuredProvider(
    structuredProvider,
    {
      fallbackAnalyzer: options.fallbackAnalyzer,
      textOcrProvider: options.textOcrProvider,
    },
  );
}

export function createLayeredDesignFlatImageAnalyzerFromModelSlotJsonExecutor(
  configs: readonly LayeredDesignAnalyzerModelSlotConfigInput[],
  executor: LayeredDesignAnalyzerModelSlotTransportJsonExecutor,
  options: CreateLayeredDesignFlatImageAnalyzerFromModelSlotTransportOptions = {},
): AnalyzeLayeredDesignFlatImage {
  return createLayeredDesignFlatImageAnalyzerFromModelSlotTransport(
    configs,
    createLayeredDesignAnalyzerModelSlotTransportFromJsonExecutor(executor),
    options,
  );
}

function createDefaultModelSlotTextOcrProvider(
  options: CreateLayeredDesignDefaultAnalyzerModelSlotJsonExecutorOptions,
): LayeredDesignFlatImageTextOcrProvider | null {
  if (options.modelSlotTextOcrProvider !== undefined) {
    return options.modelSlotTextOcrProvider;
  }

  return createLayeredDesignPrioritizedTextOcrProvider(
    [
      options.nativeTextOcrProvider === undefined
        ? createLayeredDesignNativeTextOcrProvider()
        : options.nativeTextOcrProvider,
      options.workerTextOcrProvider === undefined
        ? createLayeredDesignWorkerTextOcrProvider({
            label: "Worker OCR provider via model slot JSON executor",
            fallbackProvider: null,
            ...(options.textOcrWorkerOptions ?? {}),
          })
        : options.workerTextOcrProvider,
    ],
    {
      label:
        options.textOcrPriorityLabel ??
        LAYERED_DESIGN_DEFAULT_MODEL_SLOT_TEXT_OCR_PRIORITY_LABEL,
    },
  );
}

export function createLayeredDesignDefaultAnalyzerModelSlotJsonExecutor(
  options: CreateLayeredDesignDefaultAnalyzerModelSlotJsonExecutorOptions = {},
): LayeredDesignAnalyzerModelSlotTransportJsonExecutor {
  return createLayeredDesignAnalyzerModelSlotJsonExecutorFromProviders({
    subjectMattingProvider:
      options.subjectMattingProvider === undefined
        ? createLayeredDesignWorkerSubjectMattingProvider({
            label: "Worker subject matting provider via model slot JSON executor",
            fallbackProvider: null,
            ...(options.subjectMattingWorkerOptions ?? {}),
          })
        : options.subjectMattingProvider,
    cleanPlateProvider:
      options.cleanPlateProvider === undefined
        ? createLayeredDesignWorkerCleanPlateProvider({
            label: "Worker clean plate provider via model slot JSON executor",
            fallbackProvider: null,
            ...(options.cleanPlateWorkerOptions ?? {}),
          })
        : options.cleanPlateProvider,
    textOcrProvider: createDefaultModelSlotTextOcrProvider(options),
  });
}

export function createLayeredDesignFlatImageAnalyzerFromDefaultModelSlotProviders(
  configs: readonly LayeredDesignAnalyzerModelSlotConfigInput[],
  options: CreateLayeredDesignFlatImageAnalyzerFromDefaultModelSlotProvidersOptions = {},
): AnalyzeLayeredDesignFlatImage {
  return createLayeredDesignFlatImageAnalyzerFromModelSlotJsonExecutor(
    configs,
    createLayeredDesignDefaultAnalyzerModelSlotJsonExecutor(options),
    {
      fallbackAnalyzer: options.fallbackAnalyzer,
      textOcrProvider: options.textOcrProvider,
      rasterizerFactory: options.rasterizerFactory,
    },
  );
}
