import type {
  LayeredDesignFlatImageOcrTextBlock,
  LayeredDesignFlatImageTextOcrProvider,
  LayeredDesignFlatImageTextOcrProviderInput,
} from "./analyzer";
import {
  createLayeredDesignWorkerCleanPlateRefinerFromProvider,
  type LayeredDesignCleanPlateInput,
  type LayeredDesignCleanPlateProvider,
  type LayeredDesignCleanPlateResult,
} from "./cleanPlate";
import {
  createLayeredDesignAnalyzerProviderCapabilityGateRequirements,
  evaluateLayeredDesignAnalyzerProviderCapabilityGate,
  type LayeredDesignAnalyzerProviderCapability,
  type LayeredDesignAnalyzerProviderCapabilityGateReport,
} from "./providerCapabilities";
import type {
  CreateLayeredDesignWorkerHeuristicStructuredAnalyzerProviderOptions,
} from "./structuredAnalyzerWorkerHeuristic";
import {
  createLayeredDesignWorkerTextCandidateExtractorFromOcrProvider,
} from "./textOcr";
import {
  createLayeredDesignSubjectMaskRefinerFromMattingProvider,
  type LayeredDesignSubjectMattingInput,
  type LayeredDesignSubjectMattingProvider,
  type LayeredDesignSubjectMattingResult,
} from "./subjectMatting";

export type LayeredDesignAnalyzerModelSlotKind =
  | "subject_matting"
  | "clean_plate"
  | "text_ocr";

export interface LayeredDesignSubjectMattingModelSlot {
  kind: "subject_matting";
  capability: LayeredDesignAnalyzerProviderCapability;
  execute: (
    input: LayeredDesignSubjectMattingInput,
  ) => Promise<LayeredDesignSubjectMattingResult | null>;
}

export interface LayeredDesignCleanPlateModelSlot {
  kind: "clean_plate";
  capability: LayeredDesignAnalyzerProviderCapability;
  execute: (
    input: LayeredDesignCleanPlateInput,
  ) => Promise<LayeredDesignCleanPlateResult | null>;
}

export interface LayeredDesignTextOcrModelSlot {
  kind: "text_ocr";
  capability: LayeredDesignAnalyzerProviderCapability;
  execute: (
    input: LayeredDesignFlatImageTextOcrProviderInput,
  ) => Promise<LayeredDesignFlatImageOcrTextBlock[]>;
}

export type LayeredDesignAnalyzerModelSlot =
  | LayeredDesignSubjectMattingModelSlot
  | LayeredDesignCleanPlateModelSlot
  | LayeredDesignTextOcrModelSlot;

export interface CreateLayeredDesignWorkerHeuristicModelSlotOptions {
  subjectMattingSlot?: LayeredDesignSubjectMattingModelSlot;
  cleanPlateSlot?: LayeredDesignCleanPlateModelSlot;
  textOcrSlot?: LayeredDesignTextOcrModelSlot;
}

function assertModelSlotKind(
  slot: LayeredDesignAnalyzerModelSlot,
  expectedKind: LayeredDesignAnalyzerModelSlotKind,
): void {
  if (slot.kind !== expectedKind || slot.capability.kind !== expectedKind) {
    throw new Error(
      `Layered design analyzer model slot kind mismatch: expected ${expectedKind}, got ${slot.kind}/${slot.capability.kind}`,
    );
  }
}

export function evaluateLayeredDesignAnalyzerModelSlotProductionGate(
  slot: LayeredDesignAnalyzerModelSlot,
): LayeredDesignAnalyzerProviderCapabilityGateReport {
  const requirements =
    createLayeredDesignAnalyzerProviderCapabilityGateRequirements({
      requireSubjectMatting: slot.kind === "subject_matting",
      requireCleanPlate: slot.kind === "clean_plate",
      requireTextOcr: slot.kind === "text_ocr",
    });

  return evaluateLayeredDesignAnalyzerProviderCapabilityGate(
    [slot.capability],
    requirements,
  );
}

export function createLayeredDesignSubjectMattingProviderFromModelSlot(
  slot: LayeredDesignSubjectMattingModelSlot,
): LayeredDesignSubjectMattingProvider {
  assertModelSlotKind(slot, "subject_matting");

  return {
    label: slot.capability.label,
    matteSubject: async (input) => await slot.execute(input),
  };
}

export function createLayeredDesignCleanPlateProviderFromModelSlot(
  slot: LayeredDesignCleanPlateModelSlot,
): LayeredDesignCleanPlateProvider {
  assertModelSlotKind(slot, "clean_plate");

  return {
    label: slot.capability.label,
    createCleanPlate: async (input) => await slot.execute(input),
  };
}

export function createLayeredDesignTextOcrProviderFromModelSlot(
  slot: LayeredDesignTextOcrModelSlot,
): LayeredDesignFlatImageTextOcrProvider {
  assertModelSlotKind(slot, "text_ocr");

  return {
    label: slot.capability.label,
    detectText: async (input) => await slot.execute(input),
  };
}

export function createLayeredDesignWorkerHeuristicModelSlotOptions(
  options: CreateLayeredDesignWorkerHeuristicModelSlotOptions,
): Pick<
  CreateLayeredDesignWorkerHeuristicStructuredAnalyzerProviderOptions,
  | "subjectMaskRefiner"
  | "cleanPlateRefiner"
  | "textCandidateExtractor"
  | "providerCapabilities"
> {
  const providerCapabilities: LayeredDesignAnalyzerProviderCapability[] = [];
  const workerOptions: Pick<
    CreateLayeredDesignWorkerHeuristicStructuredAnalyzerProviderOptions,
    | "subjectMaskRefiner"
    | "cleanPlateRefiner"
    | "textCandidateExtractor"
    | "providerCapabilities"
  > = {};

  if (options.subjectMattingSlot) {
    const provider = createLayeredDesignSubjectMattingProviderFromModelSlot(
      options.subjectMattingSlot,
    );
    workerOptions.subjectMaskRefiner =
      createLayeredDesignSubjectMaskRefinerFromMattingProvider(provider);
    providerCapabilities.push(options.subjectMattingSlot.capability);
  }

  if (options.cleanPlateSlot) {
    const provider = createLayeredDesignCleanPlateProviderFromModelSlot(
      options.cleanPlateSlot,
    );
    workerOptions.cleanPlateRefiner =
      createLayeredDesignWorkerCleanPlateRefinerFromProvider(provider);
    providerCapabilities.push(options.cleanPlateSlot.capability);
  }

  if (options.textOcrSlot) {
    const provider = createLayeredDesignTextOcrProviderFromModelSlot(
      options.textOcrSlot,
    );
    workerOptions.textCandidateExtractor =
      createLayeredDesignWorkerTextCandidateExtractorFromOcrProvider(provider);
    providerCapabilities.push(options.textOcrSlot.capability);
  }

  if (providerCapabilities.length > 0) {
    workerOptions.providerCapabilities = providerCapabilities;
  }

  return workerOptions;
}
