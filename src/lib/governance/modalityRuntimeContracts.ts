import registry from "./modalityRuntimeContracts.json";

export const IMAGE_GENERATION_CONTRACT_KEY = "image_generation";
export const IMAGE_GENERATION_DEFAULT_ENTRY_SOURCE = "at_image_command";
export const BROWSER_CONTROL_CONTRACT_KEY = "browser_control";
export const BROWSER_CONTROL_DEFAULT_ENTRY_SOURCE = "at_browser_command";
export const PDF_EXTRACT_CONTRACT_KEY = "pdf_extract";
export const PDF_EXTRACT_DEFAULT_ENTRY_SOURCE = "at_pdf_read_command";
export const VOICE_GENERATION_CONTRACT_KEY = "voice_generation";
export const VOICE_GENERATION_DEFAULT_ENTRY_SOURCE = "at_voice_command";
export const WEB_RESEARCH_CONTRACT_KEY = "web_research";
export const WEB_RESEARCH_DEFAULT_ENTRY_SOURCE = "at_search_command";
export const TEXT_TRANSFORM_CONTRACT_KEY = "text_transform";
export const TEXT_TRANSFORM_DEFAULT_ENTRY_SOURCE = "at_summary_command";

const FALLBACK_IMAGE_GENERATION_REQUIRED_CAPABILITIES = [
  "text_generation",
  "image_generation",
  "vision_input",
] as const;
const FALLBACK_IMAGE_GENERATION_ROUTING_SLOT = "image_generation_model";
const FALLBACK_IMAGE_GENERATION_MODALITY = "image";
const FALLBACK_BROWSER_CONTROL_REQUIRED_CAPABILITIES = [
  "text_generation",
  "browser_reasoning",
  "browser_control_planning",
] as const;
const FALLBACK_BROWSER_CONTROL_ROUTING_SLOT = "browser_reasoning_model";
const FALLBACK_BROWSER_CONTROL_MODALITY = "browser";
const FALLBACK_PDF_EXTRACT_REQUIRED_CAPABILITIES = [
  "text_generation",
  "local_file_read",
  "long_context",
] as const;
const FALLBACK_PDF_EXTRACT_ROUTING_SLOT = "base_model";
const FALLBACK_PDF_EXTRACT_MODALITY = "document";
const FALLBACK_VOICE_GENERATION_REQUIRED_CAPABILITIES = [
  "text_generation",
  "voice_generation",
] as const;
const FALLBACK_VOICE_GENERATION_ROUTING_SLOT = "voice_generation_model";
const FALLBACK_VOICE_GENERATION_MODALITY = "audio";
const FALLBACK_WEB_RESEARCH_REQUIRED_CAPABILITIES = [
  "text_generation",
  "web_search",
  "structured_document_generation",
  "long_context",
] as const;
const FALLBACK_WEB_RESEARCH_ROUTING_SLOT = "report_generation_model";
const FALLBACK_WEB_RESEARCH_MODALITY = "mixed";
const FALLBACK_TEXT_TRANSFORM_REQUIRED_CAPABILITIES = [
  "text_generation",
  "local_file_read",
  "long_context",
] as const;
const FALLBACK_TEXT_TRANSFORM_ROUTING_SLOT = "base_model";
const FALLBACK_TEXT_TRANSFORM_MODALITY = "document";

interface ModalityRuntimeContractEntryBinding {
  entry_key?: string;
  entry_kind?: string;
  display_name?: string;
  launch_metadata_path?: string;
  entry_source?: string;
  default_input_mapping?: string[];
  entry_visibility_policy?: string[];
}

interface ModalityRuntimeContractRecord {
  contract_key?: string;
  modality?: string;
  required_capabilities?: string[];
  routing_slot?: string;
  executor_binding?: unknown;
  bound_entries?: ModalityRuntimeContractEntryBinding[];
}

export interface ModalityRuntimeContractBinding {
  contractKey: string;
  modality: string;
  requiredCapabilities: string[];
  routingSlot: string;
  runtimeContract: {
    contract_key: string;
    modality: string;
    routing_slot: string;
    required_capabilities: string[];
    executor_binding?: unknown;
  };
  boundEntrySources: string[];
}

export type ImageGenerationRuntimeContractBinding =
  ModalityRuntimeContractBinding;
export type BrowserControlRuntimeContractBinding =
  ModalityRuntimeContractBinding;
export type PdfExtractRuntimeContractBinding = ModalityRuntimeContractBinding;
export type VoiceGenerationRuntimeContractBinding =
  ModalityRuntimeContractBinding;
export type WebResearchRuntimeContractBinding = ModalityRuntimeContractBinding;
export type TextTransformRuntimeContractBinding =
  ModalityRuntimeContractBinding;

function asContractRecord(
  value: unknown,
): ModalityRuntimeContractRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ModalityRuntimeContractRecord)
    : null;
}

function readTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => readTrimmedString(item))
        .filter((item): item is string => Boolean(item))
    : [];
}

function findRuntimeContract(
  contractKey: string,
): ModalityRuntimeContractRecord | null {
  const contracts = Array.isArray(registry.contracts) ? registry.contracts : [];
  return (
    contracts
      .map(asContractRecord)
      .find((contract) => contract?.contract_key === contractKey) ?? null
  );
}

export function resolveModalityRuntimeContractBinding(params: {
  contractKey: string;
  fallbackModality: string;
  fallbackRequiredCapabilities: readonly string[];
  fallbackRoutingSlot: string;
}): ModalityRuntimeContractBinding {
  const contract = findRuntimeContract(params.contractKey);
  const contractKey =
    readTrimmedString(contract?.contract_key) ?? params.contractKey;
  const modality =
    readTrimmedString(contract?.modality) ?? params.fallbackModality;
  const registryRequiredCapabilities = readStringArray(
    contract?.required_capabilities,
  );
  const requiredCapabilities =
    registryRequiredCapabilities.length > 0
      ? registryRequiredCapabilities
      : [...params.fallbackRequiredCapabilities];
  const routingSlot =
    readTrimmedString(contract?.routing_slot) ?? params.fallbackRoutingSlot;
  const boundEntrySources = Array.from(
    new Set(
      (contract?.bound_entries ?? [])
        .map((entry) => readTrimmedString(entry.entry_source))
        .filter((entrySource): entrySource is string => Boolean(entrySource)),
    ),
  );

  return {
    contractKey,
    modality,
    requiredCapabilities,
    routingSlot,
    runtimeContract: {
      contract_key: contractKey,
      modality,
      routing_slot: routingSlot,
      required_capabilities: requiredCapabilities,
      executor_binding: contract?.executor_binding,
    },
    boundEntrySources,
  };
}

export function resolveImageGenerationRuntimeContractBinding(): ImageGenerationRuntimeContractBinding {
  return resolveModalityRuntimeContractBinding({
    contractKey: IMAGE_GENERATION_CONTRACT_KEY,
    fallbackModality: FALLBACK_IMAGE_GENERATION_MODALITY,
    fallbackRequiredCapabilities:
      FALLBACK_IMAGE_GENERATION_REQUIRED_CAPABILITIES,
    fallbackRoutingSlot: FALLBACK_IMAGE_GENERATION_ROUTING_SLOT,
  });
}

export function resolveBrowserControlRuntimeContractBinding(): BrowserControlRuntimeContractBinding {
  return resolveModalityRuntimeContractBinding({
    contractKey: BROWSER_CONTROL_CONTRACT_KEY,
    fallbackModality: FALLBACK_BROWSER_CONTROL_MODALITY,
    fallbackRequiredCapabilities:
      FALLBACK_BROWSER_CONTROL_REQUIRED_CAPABILITIES,
    fallbackRoutingSlot: FALLBACK_BROWSER_CONTROL_ROUTING_SLOT,
  });
}

export function resolvePdfExtractRuntimeContractBinding(): PdfExtractRuntimeContractBinding {
  return resolveModalityRuntimeContractBinding({
    contractKey: PDF_EXTRACT_CONTRACT_KEY,
    fallbackModality: FALLBACK_PDF_EXTRACT_MODALITY,
    fallbackRequiredCapabilities: FALLBACK_PDF_EXTRACT_REQUIRED_CAPABILITIES,
    fallbackRoutingSlot: FALLBACK_PDF_EXTRACT_ROUTING_SLOT,
  });
}

export function resolveVoiceGenerationRuntimeContractBinding(): VoiceGenerationRuntimeContractBinding {
  return resolveModalityRuntimeContractBinding({
    contractKey: VOICE_GENERATION_CONTRACT_KEY,
    fallbackModality: FALLBACK_VOICE_GENERATION_MODALITY,
    fallbackRequiredCapabilities:
      FALLBACK_VOICE_GENERATION_REQUIRED_CAPABILITIES,
    fallbackRoutingSlot: FALLBACK_VOICE_GENERATION_ROUTING_SLOT,
  });
}

export function resolveWebResearchRuntimeContractBinding(): WebResearchRuntimeContractBinding {
  return resolveModalityRuntimeContractBinding({
    contractKey: WEB_RESEARCH_CONTRACT_KEY,
    fallbackModality: FALLBACK_WEB_RESEARCH_MODALITY,
    fallbackRequiredCapabilities: FALLBACK_WEB_RESEARCH_REQUIRED_CAPABILITIES,
    fallbackRoutingSlot: FALLBACK_WEB_RESEARCH_ROUTING_SLOT,
  });
}

export function resolveTextTransformRuntimeContractBinding(): TextTransformRuntimeContractBinding {
  return resolveModalityRuntimeContractBinding({
    contractKey: TEXT_TRANSFORM_CONTRACT_KEY,
    fallbackModality: FALLBACK_TEXT_TRANSFORM_MODALITY,
    fallbackRequiredCapabilities: FALLBACK_TEXT_TRANSFORM_REQUIRED_CAPABILITIES,
    fallbackRoutingSlot: FALLBACK_TEXT_TRANSFORM_ROUTING_SLOT,
  });
}

export function isImageGenerationBoundEntrySource(
  entrySource: string | null | undefined,
): boolean {
  const normalized = entrySource?.trim();
  if (!normalized) {
    return false;
  }
  return resolveImageGenerationRuntimeContractBinding().boundEntrySources.includes(
    normalized,
  );
}
