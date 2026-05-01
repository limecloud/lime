import registry from "./modalityRuntimeContracts.json";
import {
  resolveModalityExecutionProfileBinding,
  type ModalityExecutionProfileSnapshot,
  type ModalityExecutorAdapterSnapshot,
} from "./modalityExecutionProfiles";

export const IMAGE_GENERATION_CONTRACT_KEY = "image_generation";
export const IMAGE_GENERATION_DEFAULT_ENTRY_SOURCE = "at_image_command";
export const BROWSER_CONTROL_CONTRACT_KEY = "browser_control";
export const BROWSER_CONTROL_DEFAULT_ENTRY_SOURCE = "at_browser_command";
export const PDF_EXTRACT_CONTRACT_KEY = "pdf_extract";
export const PDF_EXTRACT_DEFAULT_ENTRY_SOURCE = "at_pdf_read_command";
export const VOICE_GENERATION_CONTRACT_KEY = "voice_generation";
export const VOICE_GENERATION_DEFAULT_ENTRY_SOURCE = "at_voice_command";
export const AUDIO_TRANSCRIPTION_CONTRACT_KEY = "audio_transcription";
export const AUDIO_TRANSCRIPTION_DEFAULT_ENTRY_SOURCE =
  "at_transcription_command";
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
const FALLBACK_AUDIO_TRANSCRIPTION_REQUIRED_CAPABILITIES = [
  "text_generation",
  "audio_transcription",
] as const;
const FALLBACK_AUDIO_TRANSCRIPTION_ROUTING_SLOT = "audio_transcription_model";
const FALLBACK_AUDIO_TRANSCRIPTION_MODALITY = "audio";
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
const BROWSER_CONTROL_ENTRY_SOURCE_BY_TRIGGER: Record<string, string> = {
  "@浏览器": BROWSER_CONTROL_DEFAULT_ENTRY_SOURCE,
  "@browser": BROWSER_CONTROL_DEFAULT_ENTRY_SOURCE,
  "@browse": BROWSER_CONTROL_DEFAULT_ENTRY_SOURCE,
  "@browser agent": "at_browser_agent_command",
  "@mini tester": "at_mini_tester_command",
  "@web scheduler": "at_web_scheduler_command",
  "@web manage": "at_web_manage_command",
};

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
  limecore_policy_refs?: string[];
  executor_binding?: unknown;
  bound_entries?: ModalityRuntimeContractEntryBinding[];
}

export interface LimeCorePolicySnapshot {
  status: "local_defaults_evaluated" | "policy_inputs_evaluated";
  decision: "allow" | "ask" | "deny";
  source: "modality_runtime_contract";
  decision_source: "local_default_policy" | "policy_input_evaluator";
  decision_scope: "local_defaults_only" | "resolved_policy_inputs";
  decision_reason:
    | "declared_policy_refs_with_no_local_deny_rule"
    | "resolved_policy_inputs_with_no_deny_or_ask_signal"
    | "resolved_policy_inputs_require_user_action"
    | "resolved_policy_inputs_contain_deny_signal";
  refs: string[];
  evaluated_refs: string[];
  unresolved_refs: string[];
  missing_inputs: string[];
  policy_inputs: LimeCorePolicyInput[];
  pending_hit_refs: string[];
  policy_value_hits: LimeCorePolicyValueHit[];
  policy_value_hit_count: number;
  policy_evaluation: LimeCorePolicyEvaluation;
}

type LimeCorePolicySnapshotDecisionReason =
  LimeCorePolicySnapshot["decision_reason"];

export interface LimeCorePolicyEvaluation {
  status: "input_gap" | "evaluated";
  decision: "allow" | "ask" | "deny";
  decision_source: "policy_input_evaluator";
  decision_scope: "pending_policy_inputs" | "resolved_policy_inputs";
  decision_reason:
    | "declared_policy_refs_missing_inputs"
    | "resolved_policy_inputs_with_no_deny_or_ask_signal"
    | "resolved_policy_inputs_require_user_action"
    | "resolved_policy_inputs_contain_deny_signal";
  blocking_refs: string[];
  ask_refs: string[];
  pending_refs: string[];
}

export interface LimeCorePolicyInput {
  ref_key: string;
  status: "declared_only" | "resolved" | "pending" | "stale" | "error";
  source: string;
  value_source: string;
}

export interface LimeCorePolicyValueHit {
  ref_key: string;
  status: "resolved" | "pending" | "stale" | "error";
  source: string;
  value_source: string;
  value?: unknown;
  summary?: string;
  evidence_ref?: string;
  observed_at?: string;
}

export interface ModalityRuntimeContractBinding {
  contractKey: string;
  modality: string;
  requiredCapabilities: string[];
  routingSlot: string;
  limecorePolicyRefs: string[];
  limecorePolicySnapshot: LimeCorePolicySnapshot;
  executionProfileKey?: string;
  executorAdapterKey?: string;
  executionProfile?: ModalityExecutionProfileSnapshot;
  executorAdapter?: ModalityExecutorAdapterSnapshot;
  runtimeContract: {
    contract_key: string;
    modality: string;
    routing_slot: string;
    required_capabilities: string[];
    limecore_policy_refs: string[];
    limecore_policy_snapshot: LimeCorePolicySnapshot;
    executor_binding?: unknown;
    execution_profile?: ModalityExecutionProfileSnapshot;
    executor_adapter?: ModalityExecutorAdapterSnapshot;
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
export type AudioTranscriptionRuntimeContractBinding =
  ModalityRuntimeContractBinding;
export type WebResearchRuntimeContractBinding = ModalityRuntimeContractBinding;
export type TextTransformRuntimeContractBinding =
  ModalityRuntimeContractBinding;

export interface ResolveModalityRuntimeContractBindingOptions {
  policyValueHits?: LimeCorePolicyValueHit[];
}

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

function normalizePolicyValueHits(
  refs: string[],
  hits: LimeCorePolicyValueHit[] | undefined,
): LimeCorePolicyValueHit[] {
  const refSet = new Set(refs);
  return (hits ?? []).filter(
    (hit) => refSet.has(hit.ref_key) && Boolean(hit.status),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readPolicyHitValue(
  hit: LimeCorePolicyValueHit,
): Record<string, unknown> | null {
  return isRecord(hit.value) ? hit.value : null;
}

function readPolicyHitValueBool(
  hit: LimeCorePolicyValueHit,
  keys: string[],
): boolean | null {
  const value = readPolicyHitValue(hit);
  if (!value) {
    return null;
  }
  const found = keys
    .map((key) => value[key])
    .find((item) => typeof item === "boolean");
  return typeof found === "boolean" ? found : null;
}

function readPolicyHitValueString(
  hit: LimeCorePolicyValueHit,
  keys: string[],
): string | null {
  const value = readPolicyHitValue(hit);
  if (!value) {
    return null;
  }
  return (
    keys
      .map((key) => value[key])
      .find(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      ) ?? null
  );
}

function readPolicyHitFeatureFlag(
  hit: LimeCorePolicyValueHit,
  key: string,
): boolean | null {
  const flags = readPolicyHitValue(hit)?.flags;
  if (!isRecord(flags)) {
    return null;
  }
  const value = flags[key];
  return typeof value === "boolean" ? value : null;
}

function appendUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function collectPolicyHitDenyRefs(
  refs: string[],
  hit: LimeCorePolicyValueHit,
): string[] {
  const denyRefs: string[] = [];
  if (
    hit.ref_key === "model_catalog" &&
    readPolicyHitValueBool(hit, [
      "supports_image_generation",
      "supportsImageGeneration",
    ]) === false
  ) {
    appendUnique(denyRefs, "model_catalog");
  }
  if (
    hit.ref_key === "provider_offer" &&
    readPolicyHitValueString(hit, ["credential_state", "credentialState"]) !==
      null &&
    readPolicyHitValueString(hit, ["credential_state", "credentialState"]) !==
      "configured"
  ) {
    appendUnique(denyRefs, "provider_offer");
  }
  if (hit.ref_key === "gateway_policy") {
    if (readPolicyHitValueBool(hit, ["can_invoke", "canInvoke"]) === false) {
      appendUnique(denyRefs, "gateway_policy");
    }
    if (
      ["blocked", "unavailable"].includes(
        readPolicyHitValueString(hit, ["offer_state", "offerState"]) ?? "",
      )
    ) {
      appendUnique(denyRefs, "gateway_policy");
    }
  }
  if (
    hit.ref_key === "tenant_feature_flags" &&
    refs.includes("gateway_policy") &&
    readPolicyHitFeatureFlag(hit, "gatewayEnabled") === false
  ) {
    appendUnique(denyRefs, "tenant_feature_flags");
  }
  return denyRefs;
}

function collectPolicyHitAskRefs(hit: LimeCorePolicyValueHit): string[] {
  const askRefs: string[] = [];
  if (hit.ref_key !== "gateway_policy") {
    return askRefs;
  }
  const offerState = readPolicyHitValueString(hit, [
    "offer_state",
    "offerState",
  ]);
  if (
    readPolicyHitValueBool(hit, ["quota_low", "quotaLow"]) === true ||
    readPolicyHitValueString(hit, ["quota_status", "quotaStatus"]) === "low" ||
    [
      "available_quota_low",
      "available_subscribe_required",
      "available_logged_out",
    ].includes(offerState ?? "")
  ) {
    appendUnique(askRefs, "gateway_policy");
  }
  return askRefs;
}

function buildLimeCorePolicyEvaluation(
  refs: string[],
  hits: LimeCorePolicyValueHit[],
  pendingHitRefs: string[],
): LimeCorePolicyEvaluation {
  if (pendingHitRefs.length > 0) {
    return {
      status: "input_gap",
      decision: "ask",
      decision_source: "policy_input_evaluator",
      decision_scope: "pending_policy_inputs",
      decision_reason: "declared_policy_refs_missing_inputs",
      blocking_refs: [],
      ask_refs: [...pendingHitRefs],
      pending_refs: [...pendingHitRefs],
    };
  }

  const blockingRefs: string[] = [];
  const askRefs: string[] = [];
  hits.forEach((hit) => {
    collectPolicyHitDenyRefs(refs, hit).forEach((refKey) =>
      appendUnique(blockingRefs, refKey),
    );
    collectPolicyHitAskRefs(hit).forEach((refKey) =>
      appendUnique(askRefs, refKey),
    );
  });

  if (blockingRefs.length > 0) {
    return {
      status: "evaluated",
      decision: "deny",
      decision_source: "policy_input_evaluator",
      decision_scope: "resolved_policy_inputs",
      decision_reason: "resolved_policy_inputs_contain_deny_signal",
      blocking_refs: blockingRefs,
      ask_refs: [],
      pending_refs: [],
    };
  }

  if (askRefs.length > 0) {
    return {
      status: "evaluated",
      decision: "ask",
      decision_source: "policy_input_evaluator",
      decision_scope: "resolved_policy_inputs",
      decision_reason: "resolved_policy_inputs_require_user_action",
      blocking_refs: [],
      ask_refs: askRefs,
      pending_refs: [],
    };
  }

  return {
    status: "evaluated",
    decision: "allow",
    decision_source: "policy_input_evaluator",
    decision_scope: "resolved_policy_inputs",
    decision_reason: "resolved_policy_inputs_with_no_deny_or_ask_signal",
    blocking_refs: [],
    ask_refs: [],
    pending_refs: [],
  };
}

function buildLimeCorePolicySnapshot(
  refs: string[],
  policyValueHits?: LimeCorePolicyValueHit[],
): LimeCorePolicySnapshot {
  const hits = normalizePolicyValueHits(refs, policyValueHits);
  const resolvedRefs = new Set(
    hits.filter((hit) => hit.status === "resolved").map((hit) => hit.ref_key),
  );
  const pendingHitRefs = refs.filter((refKey) => !resolvedRefs.has(refKey));
  const policyEvaluation = buildLimeCorePolicyEvaluation(
    refs,
    hits,
    pendingHitRefs,
  );
  const policyInputsFullyEvaluated = policyEvaluation.status === "evaluated";
  const decisionReason: LimeCorePolicySnapshotDecisionReason =
    policyInputsFullyEvaluated
      ? policyEvaluation.decision_reason ===
        "declared_policy_refs_missing_inputs"
        ? "declared_policy_refs_with_no_local_deny_rule"
        : policyEvaluation.decision_reason
      : "declared_policy_refs_with_no_local_deny_rule";

  return {
    status: policyInputsFullyEvaluated
      ? "policy_inputs_evaluated"
      : "local_defaults_evaluated",
    decision: policyInputsFullyEvaluated ? policyEvaluation.decision : "allow",
    source: "modality_runtime_contract",
    decision_source: policyInputsFullyEvaluated
      ? "policy_input_evaluator"
      : "local_default_policy",
    decision_scope: policyInputsFullyEvaluated
      ? "resolved_policy_inputs"
      : "local_defaults_only",
    decision_reason: decisionReason,
    refs,
    evaluated_refs: refs.filter((refKey) => resolvedRefs.has(refKey)),
    unresolved_refs: [...pendingHitRefs],
    missing_inputs: [...pendingHitRefs],
    policy_inputs: refs.map((refKey) => {
      const hit = hits.find((item) => item.ref_key === refKey);
      return {
        ref_key: refKey,
        status: hit?.status ?? "declared_only",
        source: "modality_runtime_contract",
        value_source:
          hit?.status === "resolved" && hit.value_source
            ? hit.value_source
            : "limecore_pending",
      };
    }),
    pending_hit_refs: [...pendingHitRefs],
    policy_value_hits: hits,
    policy_value_hit_count: hits.length,
    policy_evaluation: policyEvaluation,
  };
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

export function resolveModalityRuntimeContractBinding(
  params: {
    contractKey: string;
    fallbackModality: string;
    fallbackRequiredCapabilities: readonly string[];
    fallbackRoutingSlot: string;
  } & ResolveModalityRuntimeContractBindingOptions,
): ModalityRuntimeContractBinding {
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
  const limecorePolicyRefs = readStringArray(contract?.limecore_policy_refs);
  const limecorePolicySnapshot = buildLimeCorePolicySnapshot(
    limecorePolicyRefs,
    params.policyValueHits,
  );
  const profileBinding = resolveModalityExecutionProfileBinding({
    contractKey,
    executorBinding: contract?.executor_binding,
  });
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
    limecorePolicyRefs,
    limecorePolicySnapshot,
    executionProfileKey: profileBinding?.profileKey,
    executorAdapterKey: profileBinding?.executorAdapterKey ?? undefined,
    executionProfile: profileBinding?.executionProfile,
    executorAdapter: profileBinding?.executorAdapter,
    runtimeContract: {
      contract_key: contractKey,
      modality,
      routing_slot: routingSlot,
      required_capabilities: requiredCapabilities,
      limecore_policy_refs: limecorePolicyRefs,
      limecore_policy_snapshot: limecorePolicySnapshot,
      executor_binding: contract?.executor_binding,
      execution_profile: profileBinding?.executionProfile,
      executor_adapter: profileBinding?.executorAdapter,
    },
    boundEntrySources,
  };
}

export function resolveImageGenerationRuntimeContractBinding(
  options: ResolveModalityRuntimeContractBindingOptions = {},
): ImageGenerationRuntimeContractBinding {
  return resolveModalityRuntimeContractBinding({
    contractKey: IMAGE_GENERATION_CONTRACT_KEY,
    fallbackModality: FALLBACK_IMAGE_GENERATION_MODALITY,
    fallbackRequiredCapabilities:
      FALLBACK_IMAGE_GENERATION_REQUIRED_CAPABILITIES,
    fallbackRoutingSlot: FALLBACK_IMAGE_GENERATION_ROUTING_SLOT,
    ...options,
  });
}

export function resolveBrowserControlRuntimeContractBinding(
  options: ResolveModalityRuntimeContractBindingOptions = {},
): BrowserControlRuntimeContractBinding {
  return resolveModalityRuntimeContractBinding({
    contractKey: BROWSER_CONTROL_CONTRACT_KEY,
    fallbackModality: FALLBACK_BROWSER_CONTROL_MODALITY,
    fallbackRequiredCapabilities:
      FALLBACK_BROWSER_CONTROL_REQUIRED_CAPABILITIES,
    fallbackRoutingSlot: FALLBACK_BROWSER_CONTROL_ROUTING_SLOT,
    ...options,
  });
}

export function resolveBrowserControlEntrySource(
  trigger: string | null | undefined,
): string {
  const normalizedTrigger = trigger?.trim().toLowerCase() || "";
  const candidate =
    BROWSER_CONTROL_ENTRY_SOURCE_BY_TRIGGER[normalizedTrigger] ||
    BROWSER_CONTROL_DEFAULT_ENTRY_SOURCE;
  const boundEntrySources =
    resolveBrowserControlRuntimeContractBinding().boundEntrySources;
  return boundEntrySources.includes(candidate)
    ? candidate
    : BROWSER_CONTROL_DEFAULT_ENTRY_SOURCE;
}

export function resolvePdfExtractRuntimeContractBinding(
  options: ResolveModalityRuntimeContractBindingOptions = {},
): PdfExtractRuntimeContractBinding {
  return resolveModalityRuntimeContractBinding({
    contractKey: PDF_EXTRACT_CONTRACT_KEY,
    fallbackModality: FALLBACK_PDF_EXTRACT_MODALITY,
    fallbackRequiredCapabilities: FALLBACK_PDF_EXTRACT_REQUIRED_CAPABILITIES,
    fallbackRoutingSlot: FALLBACK_PDF_EXTRACT_ROUTING_SLOT,
    ...options,
  });
}

export function resolveVoiceGenerationRuntimeContractBinding(
  options: ResolveModalityRuntimeContractBindingOptions = {},
): VoiceGenerationRuntimeContractBinding {
  return resolveModalityRuntimeContractBinding({
    contractKey: VOICE_GENERATION_CONTRACT_KEY,
    fallbackModality: FALLBACK_VOICE_GENERATION_MODALITY,
    fallbackRequiredCapabilities:
      FALLBACK_VOICE_GENERATION_REQUIRED_CAPABILITIES,
    fallbackRoutingSlot: FALLBACK_VOICE_GENERATION_ROUTING_SLOT,
    ...options,
  });
}

export function resolveAudioTranscriptionRuntimeContractBinding(
  options: ResolveModalityRuntimeContractBindingOptions = {},
): AudioTranscriptionRuntimeContractBinding {
  return resolveModalityRuntimeContractBinding({
    contractKey: AUDIO_TRANSCRIPTION_CONTRACT_KEY,
    fallbackModality: FALLBACK_AUDIO_TRANSCRIPTION_MODALITY,
    fallbackRequiredCapabilities:
      FALLBACK_AUDIO_TRANSCRIPTION_REQUIRED_CAPABILITIES,
    fallbackRoutingSlot: FALLBACK_AUDIO_TRANSCRIPTION_ROUTING_SLOT,
    ...options,
  });
}

export function resolveWebResearchRuntimeContractBinding(
  options: ResolveModalityRuntimeContractBindingOptions = {},
): WebResearchRuntimeContractBinding {
  return resolveModalityRuntimeContractBinding({
    contractKey: WEB_RESEARCH_CONTRACT_KEY,
    fallbackModality: FALLBACK_WEB_RESEARCH_MODALITY,
    fallbackRequiredCapabilities: FALLBACK_WEB_RESEARCH_REQUIRED_CAPABILITIES,
    fallbackRoutingSlot: FALLBACK_WEB_RESEARCH_ROUTING_SLOT,
    ...options,
  });
}

export function resolveTextTransformRuntimeContractBinding(
  options: ResolveModalityRuntimeContractBindingOptions = {},
): TextTransformRuntimeContractBinding {
  return resolveModalityRuntimeContractBinding({
    contractKey: TEXT_TRANSFORM_CONTRACT_KEY,
    fallbackModality: FALLBACK_TEXT_TRANSFORM_MODALITY,
    fallbackRequiredCapabilities: FALLBACK_TEXT_TRANSFORM_REQUIRED_CAPABILITIES,
    fallbackRoutingSlot: FALLBACK_TEXT_TRANSFORM_ROUTING_SLOT,
    ...options,
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
