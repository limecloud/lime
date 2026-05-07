import { safeInvoke } from "@/lib/dev-bridge";

export type CapabilityDraftStatus =
  | "unverified"
  | "failed_self_check"
  | "verification_failed"
  | "verified_pending_registration"
  | "registered";

export type CapabilityDraftVerificationRunStatus = "passed" | "failed";

export type CapabilityDraftVerificationCheckStatus = "passed" | "failed";

export type CapabilityDraftSourceKind =
  | "cli"
  | "api"
  | "docs"
  | "website"
  | "mcp"
  | "local_code"
  | "manual";

export interface CapabilityDraftFileInput extends Record<string, unknown> {
  relativePath: string;
  content: string;
}

export interface CapabilityDraftFileSummary {
  relativePath: string;
  byteLength: number;
  sha256: string;
}

export interface CreateCapabilityDraftRequest extends Record<string, unknown> {
  workspaceRoot: string;
  name: string;
  description: string;
  userGoal: string;
  sourceKind?: CapabilityDraftSourceKind | string;
  sourceRefs?: string[];
  permissionSummary?: string[];
  generatedFiles: CapabilityDraftFileInput[];
}

export interface CapabilityDraftLookupRequest extends Record<string, unknown> {
  workspaceRoot: string;
  draftId: string;
}

export interface CapabilityDraftListRequest extends Record<string, unknown> {
  workspaceRoot: string;
}

export interface CapabilityDraftRecord {
  draftId: string;
  name: string;
  description: string;
  userGoal: string;
  sourceKind: string;
  sourceRefs: string[];
  permissionSummary: string[];
  generatedFiles: CapabilityDraftFileSummary[];
  verificationStatus: CapabilityDraftStatus;
  lastVerification?: CapabilityDraftVerificationSummary | null;
  lastRegistration?: CapabilityDraftRegistrationSummary | null;
  createdAt: string;
  updatedAt: string;
  draftRoot: string;
  manifestPath: string;
}

export interface VerifyCapabilityDraftRequest extends Record<string, unknown> {
  workspaceRoot: string;
  draftId: string;
}

export interface CapabilityDraftVerificationCheck {
  id: string;
  label: string;
  status: CapabilityDraftVerificationCheckStatus;
  message: string;
  suggestions: string[];
  canAgentRepair: boolean;
  evidence: CapabilityDraftVerificationEvidence[];
}

export interface CapabilityDraftVerificationEvidence {
  key: string;
  value: string;
}

export interface CapabilityDraftVerificationSummary {
  reportId: string;
  status: CapabilityDraftVerificationRunStatus;
  summary: string;
  checkedAt: string;
  failedCheckCount: number;
}

export interface CapabilityDraftVerificationReport extends CapabilityDraftVerificationSummary {
  draftId: string;
  checks: CapabilityDraftVerificationCheck[];
}

export interface VerifyCapabilityDraftResult {
  draft: CapabilityDraftRecord;
  report: CapabilityDraftVerificationReport;
}

export interface RegisterCapabilityDraftRequest extends Record<string, unknown> {
  workspaceRoot: string;
  draftId: string;
}

export interface CapabilityDraftRegistrationSummary {
  registrationId: string;
  registeredAt: string;
  skillDirectory: string;
  registeredSkillDirectory: string;
  sourceDraftId: string;
  sourceVerificationReportId?: string | null;
  generatedFileCount: number;
  permissionSummary: string[];
  verificationGates?: CapabilityDraftRegistrationVerificationGate[];
  approvalRequests?: CapabilityDraftRegistrationApprovalRequest[];
}

export interface CapabilityDraftRegistrationVerificationGate {
  checkId: string;
  label: string;
  evidence: CapabilityDraftVerificationEvidence[];
}

export interface CapabilityDraftRegistrationApprovalRequest {
  approvalId: string;
  status: "pending";
  sourceCheckId: string;
  skillDirectory: string;
  endpointSource: string;
  method: string;
  credentialReferenceId: string;
  evidenceSchema: string[];
  policyPath: string;
  createdAt: string;
  consumptionGate: CapabilityDraftApprovalConsumptionGate;
  credentialResolver: CapabilityDraftRegistrationCredentialResolver;
  consumptionInputSchema: CapabilityDraftApprovalConsumptionInputSchema;
  sessionInputIntake: CapabilityDraftApprovalConsumptionSessionIntake;
  sessionInputSubmissionContract: CapabilityDraftApprovalSessionSubmissionContract;
}

export interface CapabilityDraftApprovalConsumptionGate {
  status: "awaiting_session_approval";
  requiredInputs: string[];
  runtimeExecutionEnabled: boolean;
  credentialStorageEnabled: boolean;
  blockedReason: string;
  nextAction: string;
}

export interface CapabilityDraftRegistrationCredentialResolver {
  status: "awaiting_session_credential";
  referenceId: string;
  scope: string;
  source: string;
  secretMaterialStatus: string;
  tokenPersisted: boolean;
  runtimeInjectionEnabled: boolean;
  blockedReason: string;
  nextAction: string;
}

export interface CapabilityDraftApprovalConsumptionInputSchema {
  schemaId: string;
  version: number;
  fields: CapabilityDraftApprovalConsumptionInputField[];
  uiSubmissionEnabled: boolean;
  runtimeExecutionEnabled: boolean;
  blockedReason: string;
}

export interface CapabilityDraftApprovalConsumptionInputField {
  key: string;
  label: string;
  kind: string;
  required: boolean;
  source: string;
  secret: boolean;
  description: string;
}

export interface CapabilityDraftApprovalConsumptionSessionIntake {
  status: "awaiting_session_inputs";
  schemaId: string;
  scope: string;
  requiredFieldKeys: string[];
  missingFieldKeys: string[];
  collectedFieldKeys: string[];
  credentialReferenceId: string;
  endpointInputPersisted: boolean;
  secretMaterialStatus: string;
  tokenPersisted: boolean;
  uiSubmissionEnabled: boolean;
  runtimeExecutionEnabled: boolean;
  blockedReason: string;
  nextAction: string;
}

export interface CapabilityDraftApprovalSessionSubmissionContract {
  status: "submission_contract_declared";
  scope: string;
  mode: string;
  acceptedFieldKeys: string[];
  validationRules: CapabilityDraftApprovalSessionSubmissionValidationRule[];
  valueRetention: string;
  endpointInputPersisted: boolean;
  secretMaterialAccepted: boolean;
  tokenPersisted: boolean;
  evidenceCaptureRequired: boolean;
  submissionHandlerEnabled: boolean;
  uiSubmissionEnabled: boolean;
  runtimeExecutionEnabled: boolean;
  blockedReason: string;
  nextAction: string;
}

export interface CapabilityDraftApprovalSessionSubmissionValidationRule {
  fieldKey: string;
  kind: string;
  required: boolean;
  source: string;
  secretAllowed: boolean;
  rule: string;
}

export type CapabilityDraftApprovalSessionSubmissionValidationStatus =
  | "validated_pending_runtime_gate"
  | "rejected";

export interface SubmitCapabilityDraftApprovalSessionInputsRequest
  extends Record<string, unknown> {
  workspaceRoot: string;
  approvalId: string;
  sessionId?: string;
  inputs: Record<string, unknown>;
}

export interface CapabilityDraftApprovalSessionSubmissionFieldResult {
  fieldKey: string;
  accepted: boolean;
  code: string;
  message: string;
}

export type CapabilityDraftReadonlyHttpControlledGetPreflightStatus =
  | "ready_for_controlled_get_preflight"
  | "blocked_by_session_input";

export interface CapabilityDraftReadonlyHttpControlledGetPreflight {
  status: CapabilityDraftReadonlyHttpControlledGetPreflightStatus;
  gateId: string;
  approvalId: string;
  method: string;
  methodAllowed: boolean;
  endpointSource: string;
  endpointValidated: boolean;
  endpointValueReturned: boolean;
  credentialReferenceId: string;
  credentialResolutionRequired: boolean;
  credentialResolved: boolean;
  evidenceSchema: string[];
  policyPath: string;
  requestExecutionEnabled: boolean;
  runtimeExecutionEnabled: boolean;
  blockedReason: string;
  nextAction: string;
}

export type CapabilityDraftReadonlyHttpDryPreflightPlanStatus =
  | "planned_without_execution"
  | "blocked_by_session_input";

export interface CapabilityDraftReadonlyHttpDryPreflightPlan {
  status: CapabilityDraftReadonlyHttpDryPreflightPlanStatus;
  planId: string;
  gateId: string;
  approvalId: string;
  method: string;
  methodAllowed: boolean;
  requestUrlHash?: string | null;
  requestUrlHashAlgorithm: string;
  endpointValueReturned: boolean;
  endpointInputPersisted: boolean;
  credentialReferenceId: string;
  credentialResolutionStage: string;
  credentialResolved: boolean;
  evidenceSchema: string[];
  plannedEvidenceKeys: string[];
  policyPath: string;
  networkRequestSent: boolean;
  responseCaptured: boolean;
  requestExecutionEnabled: boolean;
  runtimeExecutionEnabled: boolean;
  valueRetention: string;
  blockedReason: string;
  nextAction: string;
}

export interface SubmitCapabilityDraftApprovalSessionInputsResult {
  approvalId: string;
  sessionId?: string | null;
  status: CapabilityDraftApprovalSessionSubmissionValidationStatus;
  scope: string;
  acceptedFieldKeys: string[];
  missingFieldKeys: string[];
  rejectedFieldKeys: string[];
  fieldResults: CapabilityDraftApprovalSessionSubmissionFieldResult[];
  endpointInputPersisted: boolean;
  secretMaterialAccepted: boolean;
  tokenPersisted: boolean;
  credentialResolved: boolean;
  valueRetention: string;
  evidenceCaptureRequired: boolean;
  runtimeExecutionEnabled: boolean;
  nextGate: string;
  controlledGetPreflight: CapabilityDraftReadonlyHttpControlledGetPreflight;
  dryPreflightPlan: CapabilityDraftReadonlyHttpDryPreflightPlan;
  blockedReason: string;
}

export interface ExecuteCapabilityDraftControlledGetRequest
  extends Record<string, unknown> {
  workspaceRoot: string;
  approvalId: string;
  sessionId?: string;
  inputs: Record<string, unknown>;
}

export type CapabilityDraftControlledGetExecutionStatus =
  | "executed"
  | "blocked"
  | "request_failed";

export interface ExecuteCapabilityDraftControlledGetResult {
  approvalId: string;
  sessionId?: string | null;
  status: CapabilityDraftControlledGetExecutionStatus;
  scope: string;
  gateId: string;
  method: string;
  methodAllowed: boolean;
  requestUrlHash?: string | null;
  requestUrlHashAlgorithm: string;
  responseStatus?: number | null;
  responseSha256?: string | null;
  responseBytes: number;
  responsePreview?: string | null;
  responsePreviewTruncated: boolean;
  executedAt?: string | null;
  networkRequestSent: boolean;
  responseCaptured: boolean;
  endpointValueReturned: boolean;
  endpointInputPersisted: boolean;
  credentialReferenceId: string;
  credentialResolved: boolean;
  tokenPersisted: boolean;
  requestExecutionEnabled: boolean;
  runtimeExecutionEnabled: boolean;
  valueRetention: string;
  sessionInputStatus: CapabilityDraftApprovalSessionSubmissionValidationStatus;
  fieldResults: CapabilityDraftApprovalSessionSubmissionFieldResult[];
  evidence: CapabilityDraftVerificationEvidence[];
  evidenceArtifact?: CapabilityDraftControlledGetEvidenceArtifact | null;
  blockedReason: string;
  nextAction: string;
}

export interface CapabilityDraftControlledGetEvidenceArtifact {
  artifactId: string;
  relativePath: string;
  absolutePath: string;
  contentSha256: string;
  persisted: boolean;
  containsEndpointValue: boolean;
  containsTokenValue: boolean;
  containsResponsePreview: boolean;
}

export interface RegisterCapabilityDraftResult {
  draft: CapabilityDraftRecord;
  registration: CapabilityDraftRegistrationSummary;
}

export interface ListWorkspaceRegisteredSkillsRequest
  extends Record<string, unknown> {
  workspaceRoot: string;
}

export interface SkillResourceSummary {
  hasScripts: boolean;
  hasReferences: boolean;
  hasAssets: boolean;
}

export interface SkillStandardCompliance {
  isStandard: boolean;
  validationErrors: string[];
  deprecatedFields: string[];
}

export interface WorkspaceRegisteredSkillRecord {
  key: string;
  name: string;
  description: string;
  directory: string;
  registeredSkillDirectory: string;
  registration: CapabilityDraftRegistrationSummary;
  permissionSummary: string[];
  metadata: Record<string, string>;
  allowedTools: string[];
  resourceSummary: SkillResourceSummary;
  standardCompliance: SkillStandardCompliance;
  launchEnabled: boolean;
  runtimeGate: string;
}

type RawCapabilityDraftFileSummary = Partial<CapabilityDraftFileSummary> & {
  relative_path?: string;
  byte_length?: number;
};

type RawCapabilityDraftRecord = Partial<CapabilityDraftRecord> & {
  draft_id?: string;
  user_goal?: string;
  source_kind?: string;
  source_refs?: string[];
  permission_summary?: string[];
  generated_files?: RawCapabilityDraftFileSummary[];
  verification_status?: CapabilityDraftStatus;
  last_verification?: RawCapabilityDraftVerificationSummary | null;
  last_registration?: RawCapabilityDraftRegistrationSummary | null;
  created_at?: string;
  updated_at?: string;
  draft_root?: string;
  manifest_path?: string;
};

type RawCapabilityDraftVerificationSummary =
  Partial<CapabilityDraftVerificationSummary> & {
    report_id?: string;
    checked_at?: string;
    failed_check_count?: number;
  };

type RawCapabilityDraftVerificationCheck =
  Partial<CapabilityDraftVerificationCheck> & {
    can_agent_repair?: boolean;
    evidence?: RawCapabilityDraftVerificationEvidence[];
  };

type RawCapabilityDraftVerificationEvidence =
  Partial<CapabilityDraftVerificationEvidence>;

type RawCapabilityDraftVerificationReport =
  Partial<CapabilityDraftVerificationReport> &
    RawCapabilityDraftVerificationSummary & {
      draft_id?: string;
      checks?: RawCapabilityDraftVerificationCheck[];
    };

type RawVerifyCapabilityDraftResult = {
  draft?: RawCapabilityDraftRecord;
  report?: RawCapabilityDraftVerificationReport;
};

type RawCapabilityDraftRegistrationSummary =
  Partial<CapabilityDraftRegistrationSummary> & {
    registration_id?: string;
    registered_at?: string;
    skill_directory?: string;
    registered_skill_directory?: string;
    source_draft_id?: string;
    source_verification_report_id?: string | null;
    generated_file_count?: number;
    permission_summary?: string[];
    verification_gates?: RawCapabilityDraftRegistrationVerificationGate[];
    approval_requests?: RawCapabilityDraftRegistrationApprovalRequest[];
  };

type RawCapabilityDraftRegistrationVerificationGate =
  Partial<CapabilityDraftRegistrationVerificationGate> & {
    check_id?: string;
    evidence?: RawCapabilityDraftVerificationEvidence[];
  };

type RawCapabilityDraftRegistrationApprovalRequest =
  Partial<CapabilityDraftRegistrationApprovalRequest> & {
    approval_id?: string;
    source_check_id?: string;
    skill_directory?: string;
    endpoint_source?: string;
    credential_reference_id?: string;
    evidence_schema?: string[];
    policy_path?: string;
    created_at?: string;
    consumption_gate?: RawCapabilityDraftApprovalConsumptionGate;
    credential_resolver?: RawCapabilityDraftRegistrationCredentialResolver;
    consumption_input_schema?: RawCapabilityDraftApprovalConsumptionInputSchema;
    session_input_intake?: RawCapabilityDraftApprovalConsumptionSessionIntake;
    session_input_submission_contract?: RawCapabilityDraftApprovalSessionSubmissionContract;
  };

type RawCapabilityDraftApprovalConsumptionGate =
  Partial<CapabilityDraftApprovalConsumptionGate> & {
    required_inputs?: string[];
    runtime_execution_enabled?: boolean;
    credential_storage_enabled?: boolean;
    blocked_reason?: string;
    next_action?: string;
  };

type RawCapabilityDraftApprovalConsumptionInputSchema =
  Partial<CapabilityDraftApprovalConsumptionInputSchema> & {
    schema_id?: string;
    ui_submission_enabled?: boolean;
    runtime_execution_enabled?: boolean;
    blocked_reason?: string;
    fields?: RawCapabilityDraftApprovalConsumptionInputField[];
  };

type RawCapabilityDraftApprovalConsumptionInputField =
  Partial<CapabilityDraftApprovalConsumptionInputField>;

type RawCapabilityDraftApprovalConsumptionSessionIntake =
  Partial<CapabilityDraftApprovalConsumptionSessionIntake> & {
    schema_id?: string;
    required_field_keys?: string[];
    missing_field_keys?: string[];
    collected_field_keys?: string[];
    credential_reference_id?: string;
    endpoint_input_persisted?: boolean;
    secret_material_status?: string;
    token_persisted?: boolean;
    ui_submission_enabled?: boolean;
    runtime_execution_enabled?: boolean;
    blocked_reason?: string;
    next_action?: string;
  };

type RawCapabilityDraftApprovalSessionSubmissionContract =
  Partial<CapabilityDraftApprovalSessionSubmissionContract> & {
    accepted_field_keys?: string[];
    validation_rules?: RawCapabilityDraftApprovalSessionSubmissionValidationRule[];
    value_retention?: string;
    endpoint_input_persisted?: boolean;
    secret_material_accepted?: boolean;
    token_persisted?: boolean;
    evidence_capture_required?: boolean;
    submission_handler_enabled?: boolean;
    ui_submission_enabled?: boolean;
    runtime_execution_enabled?: boolean;
    blocked_reason?: string;
    next_action?: string;
  };

type RawCapabilityDraftApprovalSessionSubmissionValidationRule =
  Partial<CapabilityDraftApprovalSessionSubmissionValidationRule> & {
    field_key?: string;
    secret_allowed?: boolean;
  };

type RawCapabilityDraftApprovalSessionSubmissionFieldResult =
  Partial<CapabilityDraftApprovalSessionSubmissionFieldResult> & {
    field_key?: string;
  };

type RawCapabilityDraftReadonlyHttpControlledGetPreflight =
  Partial<CapabilityDraftReadonlyHttpControlledGetPreflight> & {
    gate_id?: string;
    method_allowed?: boolean;
    endpoint_source?: string;
    endpoint_validated?: boolean;
    endpoint_value_returned?: boolean;
    credential_reference_id?: string;
    credential_resolution_required?: boolean;
    credential_resolved?: boolean;
    evidence_schema?: string[];
    policy_path?: string;
    request_execution_enabled?: boolean;
    runtime_execution_enabled?: boolean;
    blocked_reason?: string;
    next_action?: string;
  };

type RawCapabilityDraftReadonlyHttpDryPreflightPlan =
  Partial<CapabilityDraftReadonlyHttpDryPreflightPlan> & {
    plan_id?: string;
    gate_id?: string;
    approval_id?: string;
    method_allowed?: boolean;
    request_url_hash?: string | null;
    request_url_hash_algorithm?: string;
    endpoint_value_returned?: boolean;
    endpoint_input_persisted?: boolean;
    credential_reference_id?: string;
    credential_resolution_stage?: string;
    credential_resolved?: boolean;
    evidence_schema?: string[];
    planned_evidence_keys?: string[];
    policy_path?: string;
    network_request_sent?: boolean;
    response_captured?: boolean;
    request_execution_enabled?: boolean;
    runtime_execution_enabled?: boolean;
    value_retention?: string;
    blocked_reason?: string;
    next_action?: string;
  };

type RawCapabilityDraftRegistrationCredentialResolver =
  Partial<CapabilityDraftRegistrationCredentialResolver> & {
    reference_id?: string;
    secret_material_status?: string;
    token_persisted?: boolean;
    runtime_injection_enabled?: boolean;
    blocked_reason?: string;
    next_action?: string;
  };

type RawRegisterCapabilityDraftResult = {
  draft?: RawCapabilityDraftRecord;
  registration?: RawCapabilityDraftRegistrationSummary;
};

type RawSubmitCapabilityDraftApprovalSessionInputsResult =
  Partial<SubmitCapabilityDraftApprovalSessionInputsResult> & {
    approval_id?: string;
    session_id?: string | null;
    accepted_field_keys?: string[];
    missing_field_keys?: string[];
    rejected_field_keys?: string[];
    field_results?: RawCapabilityDraftApprovalSessionSubmissionFieldResult[];
    endpoint_input_persisted?: boolean;
    secret_material_accepted?: boolean;
    token_persisted?: boolean;
    credential_resolved?: boolean;
    value_retention?: string;
    evidence_capture_required?: boolean;
    runtime_execution_enabled?: boolean;
    next_gate?: string;
    controlled_get_preflight?: RawCapabilityDraftReadonlyHttpControlledGetPreflight;
    dry_preflight_plan?: RawCapabilityDraftReadonlyHttpDryPreflightPlan;
    blocked_reason?: string;
  };

type RawExecuteCapabilityDraftControlledGetResult =
  Partial<ExecuteCapabilityDraftControlledGetResult> & {
    approval_id?: string;
    session_id?: string | null;
    gate_id?: string;
    method_allowed?: boolean;
    request_url_hash?: string | null;
    request_url_hash_algorithm?: string;
    response_status?: number | null;
    response_sha256?: string | null;
    response_bytes?: number;
    response_preview?: string | null;
    response_preview_truncated?: boolean;
    executed_at?: string | null;
    network_request_sent?: boolean;
    response_captured?: boolean;
    endpoint_value_returned?: boolean;
    endpoint_input_persisted?: boolean;
    credential_reference_id?: string;
    credential_resolved?: boolean;
    token_persisted?: boolean;
    request_execution_enabled?: boolean;
    runtime_execution_enabled?: boolean;
    value_retention?: string;
    session_input_status?: CapabilityDraftApprovalSessionSubmissionValidationStatus;
    field_results?: RawCapabilityDraftApprovalSessionSubmissionFieldResult[];
    evidence?: RawCapabilityDraftVerificationEvidence[];
    evidence_artifact?: RawCapabilityDraftControlledGetEvidenceArtifact | null;
    blocked_reason?: string;
    next_action?: string;
  };

type RawCapabilityDraftControlledGetEvidenceArtifact =
  Partial<CapabilityDraftControlledGetEvidenceArtifact> & {
    artifact_id?: string;
    relative_path?: string;
    absolute_path?: string;
    content_sha256?: string;
    contains_endpoint_value?: boolean;
    contains_token_value?: boolean;
    contains_response_preview?: boolean;
  };

type RawSkillResourceSummary = Partial<SkillResourceSummary> & {
  has_scripts?: boolean;
  has_references?: boolean;
  has_assets?: boolean;
};

type RawSkillStandardCompliance = Partial<SkillStandardCompliance> & {
  is_standard?: boolean;
  validation_errors?: string[];
  deprecated_fields?: string[];
};

type RawWorkspaceRegisteredSkillRecord =
  Partial<WorkspaceRegisteredSkillRecord> & {
    registered_skill_directory?: string;
    permission_summary?: string[];
    allowed_tools?: string[];
    resource_summary?: RawSkillResourceSummary;
    standard_compliance?: RawSkillStandardCompliance;
    launch_enabled?: boolean;
    runtime_gate?: string;
  };

function readString(value: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string") {
      return candidate;
    }
  }
  return "";
}

function readBoolean(
  value: Record<string, unknown>,
  defaultValue: boolean,
  ...keys: string[]
): boolean {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "boolean") {
      return candidate;
    }
  }
  return defaultValue;
}

function readNumber(
  value: Record<string, unknown>,
  defaultValue: number,
  ...keys: string[]
): number {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return defaultValue;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeGeneratedFiles(value: unknown): CapabilityDraftFileSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is RawCapabilityDraftFileSummary =>
      Boolean(item && typeof item === "object"),
    )
    .map((item) => ({
      relativePath: item.relativePath ?? item.relative_path ?? "",
      byteLength:
        typeof item.byteLength === "number"
          ? item.byteLength
          : typeof item.byte_length === "number"
            ? item.byte_length
            : 0,
      sha256: typeof item.sha256 === "string" ? item.sha256 : "",
    }))
    .filter((item) => item.relativePath.length > 0);
}

function normalizeStatus(value: unknown): CapabilityDraftStatus {
  if (
    value === "failed_self_check" ||
    value === "verification_failed" ||
    value === "verified_pending_registration" ||
    value === "registered"
  ) {
    return value;
  }
  return "unverified";
}

function normalizeVerificationRunStatus(
  value: unknown,
): CapabilityDraftVerificationRunStatus {
  return value === "passed" ? "passed" : "failed";
}

function normalizeVerificationSummary(
  raw: RawCapabilityDraftVerificationSummary | null | undefined,
): CapabilityDraftVerificationSummary | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  return {
    reportId: readString(record, "reportId", "report_id"),
    status: normalizeVerificationRunStatus(raw.status),
    summary: readString(record, "summary"),
    checkedAt: readString(record, "checkedAt", "checked_at"),
    failedCheckCount:
      typeof raw.failedCheckCount === "number"
        ? raw.failedCheckCount
        : typeof raw.failed_check_count === "number"
          ? raw.failed_check_count
          : 0,
  };
}

function normalizeVerificationChecks(
  value: unknown,
): CapabilityDraftVerificationCheck[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is RawCapabilityDraftVerificationCheck =>
      Boolean(item && typeof item === "object"),
    )
    .map((item): CapabilityDraftVerificationCheck => {
      const record = item as Record<string, unknown>;
      return {
        id: readString(record, "id"),
        label: readString(record, "label"),
        status: item.status === "passed" ? "passed" : "failed",
        message: readString(record, "message"),
        suggestions: normalizeStringArray(item.suggestions),
        canAgentRepair:
          typeof item.canAgentRepair === "boolean"
            ? item.canAgentRepair
            : typeof item.can_agent_repair === "boolean"
              ? item.can_agent_repair
              : item.status !== "passed",
        evidence: normalizeVerificationEvidence(item.evidence),
      };
    })
    .filter((item) => item.id.length > 0);
}

function normalizeVerificationEvidence(
  value: unknown,
): CapabilityDraftVerificationEvidence[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is RawCapabilityDraftVerificationEvidence =>
      Boolean(item && typeof item === "object"),
    )
    .map((item): CapabilityDraftVerificationEvidence => {
      const record = item as Record<string, unknown>;
      return {
        key: readString(record, "key"),
        value: readString(record, "value"),
      };
    })
    .filter((item) => item.key.length > 0);
}

function normalizeRegistrationVerificationGates(
  value: unknown,
): CapabilityDraftRegistrationVerificationGate[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is RawCapabilityDraftRegistrationVerificationGate =>
      Boolean(item && typeof item === "object"),
    )
    .map((item): CapabilityDraftRegistrationVerificationGate => {
      const record = item as Record<string, unknown>;
      return {
        checkId: readString(record, "checkId", "check_id"),
        label: readString(record, "label"),
        evidence: normalizeVerificationEvidence(item.evidence),
      };
    })
    .filter((item) => item.checkId.length > 0);
}

function normalizeApprovalConsumptionGate(
  value: unknown,
): CapabilityDraftApprovalConsumptionGate {
  const record: RawCapabilityDraftApprovalConsumptionGate &
    Record<string, unknown> =
    value && typeof value === "object"
      ? (value as RawCapabilityDraftApprovalConsumptionGate &
          Record<string, unknown>)
      : {};
  return {
    status: "awaiting_session_approval",
    requiredInputs: normalizeStringArray(
      record.requiredInputs ?? record.required_inputs,
    ),
    runtimeExecutionEnabled: readBoolean(
      record,
      false,
      "runtimeExecutionEnabled",
      "runtime_execution_enabled",
    ),
    credentialStorageEnabled: readBoolean(
      record,
      false,
      "credentialStorageEnabled",
      "credential_storage_enabled",
    ),
    blockedReason: readString(record, "blockedReason", "blocked_reason"),
    nextAction: readString(record, "nextAction", "next_action"),
  };
}

function normalizeCredentialResolver(
  value: unknown,
): CapabilityDraftRegistrationCredentialResolver {
  const record: RawCapabilityDraftRegistrationCredentialResolver &
    Record<string, unknown> =
    value && typeof value === "object"
      ? (value as RawCapabilityDraftRegistrationCredentialResolver &
          Record<string, unknown>)
      : {};
  return {
    status: "awaiting_session_credential",
    referenceId: readString(record, "referenceId", "reference_id"),
    scope: readString(record, "scope"),
    source: readString(record, "source"),
    secretMaterialStatus: readString(
      record,
      "secretMaterialStatus",
      "secret_material_status",
    ),
    tokenPersisted: readBoolean(
      record,
      false,
      "tokenPersisted",
      "token_persisted",
    ),
    runtimeInjectionEnabled: readBoolean(
      record,
      false,
      "runtimeInjectionEnabled",
      "runtime_injection_enabled",
    ),
    blockedReason: readString(record, "blockedReason", "blocked_reason"),
    nextAction: readString(record, "nextAction", "next_action"),
  };
}

function normalizeConsumptionInputFields(
  value: unknown,
): CapabilityDraftApprovalConsumptionInputField[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is RawCapabilityDraftApprovalConsumptionInputField =>
      Boolean(item && typeof item === "object"),
    )
    .map((item): CapabilityDraftApprovalConsumptionInputField => {
      const record = item as Record<string, unknown>;
      return {
        key: readString(record, "key"),
        label: readString(record, "label"),
        kind: readString(record, "kind"),
        required: readBoolean(record, false, "required"),
        source: readString(record, "source"),
        secret: readBoolean(record, false, "secret"),
        description: readString(record, "description"),
      };
    })
    .filter((item) => item.key.length > 0);
}

function normalizeConsumptionInputSchema(
  value: unknown,
): CapabilityDraftApprovalConsumptionInputSchema {
  const record: RawCapabilityDraftApprovalConsumptionInputSchema &
    Record<string, unknown> =
    value && typeof value === "object"
      ? (value as RawCapabilityDraftApprovalConsumptionInputSchema &
          Record<string, unknown>)
      : {};
  return {
    schemaId: readString(record, "schemaId", "schema_id"),
    version: typeof record.version === "number" ? record.version : 0,
    fields: normalizeConsumptionInputFields(record.fields),
    uiSubmissionEnabled: readBoolean(
      record,
      false,
      "uiSubmissionEnabled",
      "ui_submission_enabled",
    ),
    runtimeExecutionEnabled: readBoolean(
      record,
      false,
      "runtimeExecutionEnabled",
      "runtime_execution_enabled",
    ),
    blockedReason: readString(record, "blockedReason", "blocked_reason"),
  };
}

function normalizeSessionInputIntake(
  value: unknown,
): CapabilityDraftApprovalConsumptionSessionIntake {
  const record: RawCapabilityDraftApprovalConsumptionSessionIntake &
    Record<string, unknown> =
    value && typeof value === "object"
      ? (value as RawCapabilityDraftApprovalConsumptionSessionIntake &
          Record<string, unknown>)
      : {};
  return {
    status: "awaiting_session_inputs",
    schemaId: readString(record, "schemaId", "schema_id"),
    scope: readString(record, "scope"),
    requiredFieldKeys: normalizeStringArray(
      record.requiredFieldKeys ?? record.required_field_keys,
    ),
    missingFieldKeys: normalizeStringArray(
      record.missingFieldKeys ?? record.missing_field_keys,
    ),
    collectedFieldKeys: normalizeStringArray(
      record.collectedFieldKeys ?? record.collected_field_keys,
    ),
    credentialReferenceId: readString(
      record,
      "credentialReferenceId",
      "credential_reference_id",
    ),
    endpointInputPersisted: readBoolean(
      record,
      false,
      "endpointInputPersisted",
      "endpoint_input_persisted",
    ),
    secretMaterialStatus: readString(
      record,
      "secretMaterialStatus",
      "secret_material_status",
    ),
    tokenPersisted: readBoolean(
      record,
      false,
      "tokenPersisted",
      "token_persisted",
    ),
    uiSubmissionEnabled: readBoolean(
      record,
      false,
      "uiSubmissionEnabled",
      "ui_submission_enabled",
    ),
    runtimeExecutionEnabled: readBoolean(
      record,
      false,
      "runtimeExecutionEnabled",
      "runtime_execution_enabled",
    ),
    blockedReason: readString(record, "blockedReason", "blocked_reason"),
    nextAction: readString(record, "nextAction", "next_action"),
  };
}

function normalizeSessionSubmissionValidationRules(
  value: unknown,
): CapabilityDraftApprovalSessionSubmissionValidationRule[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(
      (
        item,
      ): item is RawCapabilityDraftApprovalSessionSubmissionValidationRule =>
        Boolean(item && typeof item === "object"),
    )
    .map((item): CapabilityDraftApprovalSessionSubmissionValidationRule => {
      const record = item as Record<string, unknown>;
      return {
        fieldKey: readString(record, "fieldKey", "field_key"),
        kind: readString(record, "kind"),
        required: readBoolean(record, false, "required"),
        source: readString(record, "source"),
        secretAllowed: readBoolean(
          record,
          false,
          "secretAllowed",
          "secret_allowed",
        ),
        rule: readString(record, "rule"),
      };
    })
    .filter((item) => item.fieldKey.length > 0);
}

function normalizeSessionSubmissionContract(
  value: unknown,
): CapabilityDraftApprovalSessionSubmissionContract {
  const record: RawCapabilityDraftApprovalSessionSubmissionContract &
    Record<string, unknown> =
    value && typeof value === "object"
      ? (value as RawCapabilityDraftApprovalSessionSubmissionContract &
          Record<string, unknown>)
      : {};
  return {
    status: "submission_contract_declared",
    scope: readString(record, "scope"),
    mode: readString(record, "mode"),
    acceptedFieldKeys: normalizeStringArray(
      record.acceptedFieldKeys ?? record.accepted_field_keys,
    ),
    validationRules: normalizeSessionSubmissionValidationRules(
      record.validationRules ?? record.validation_rules,
    ),
    valueRetention: readString(record, "valueRetention", "value_retention"),
    endpointInputPersisted: readBoolean(
      record,
      false,
      "endpointInputPersisted",
      "endpoint_input_persisted",
    ),
    secretMaterialAccepted: readBoolean(
      record,
      false,
      "secretMaterialAccepted",
      "secret_material_accepted",
    ),
    tokenPersisted: readBoolean(
      record,
      false,
      "tokenPersisted",
      "token_persisted",
    ),
    evidenceCaptureRequired: readBoolean(
      record,
      false,
      "evidenceCaptureRequired",
      "evidence_capture_required",
    ),
    submissionHandlerEnabled: readBoolean(
      record,
      false,
      "submissionHandlerEnabled",
      "submission_handler_enabled",
    ),
    uiSubmissionEnabled: readBoolean(
      record,
      false,
      "uiSubmissionEnabled",
      "ui_submission_enabled",
    ),
    runtimeExecutionEnabled: readBoolean(
      record,
      false,
      "runtimeExecutionEnabled",
      "runtime_execution_enabled",
    ),
    blockedReason: readString(record, "blockedReason", "blocked_reason"),
    nextAction: readString(record, "nextAction", "next_action"),
  };
}

function normalizeSessionSubmissionFieldResults(
  value: unknown,
): CapabilityDraftApprovalSessionSubmissionFieldResult[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(
      (
        item,
      ): item is RawCapabilityDraftApprovalSessionSubmissionFieldResult =>
        Boolean(item && typeof item === "object"),
    )
    .map((item): CapabilityDraftApprovalSessionSubmissionFieldResult => {
      const record = item as Record<string, unknown>;
      return {
        fieldKey: readString(record, "fieldKey", "field_key"),
        accepted: readBoolean(record, false, "accepted"),
        code: readString(record, "code"),
        message: readString(record, "message"),
      };
    })
    .filter((item) => item.fieldKey.length > 0);
}

function normalizeControlledGetPreflight(
  value: unknown,
): CapabilityDraftReadonlyHttpControlledGetPreflight {
  const record: RawCapabilityDraftReadonlyHttpControlledGetPreflight &
    Record<string, unknown> =
    value && typeof value === "object"
      ? (value as RawCapabilityDraftReadonlyHttpControlledGetPreflight &
          Record<string, unknown>)
      : {};
  const status = readString(
    record,
    "status",
  ) as CapabilityDraftReadonlyHttpControlledGetPreflightStatus;
  return {
    status:
      status === "ready_for_controlled_get_preflight"
        ? status
        : "blocked_by_session_input",
    gateId: readString(record, "gateId", "gate_id"),
    approvalId: readString(record, "approvalId", "approval_id"),
    method: readString(record, "method"),
    methodAllowed: readBoolean(record, false, "methodAllowed", "method_allowed"),
    endpointSource: readString(record, "endpointSource", "endpoint_source"),
    endpointValidated: readBoolean(
      record,
      false,
      "endpointValidated",
      "endpoint_validated",
    ),
    endpointValueReturned: readBoolean(
      record,
      false,
      "endpointValueReturned",
      "endpoint_value_returned",
    ),
    credentialReferenceId: readString(
      record,
      "credentialReferenceId",
      "credential_reference_id",
    ),
    credentialResolutionRequired: readBoolean(
      record,
      false,
      "credentialResolutionRequired",
      "credential_resolution_required",
    ),
    credentialResolved: readBoolean(
      record,
      false,
      "credentialResolved",
      "credential_resolved",
    ),
    evidenceSchema: normalizeStringArray(
      record.evidenceSchema ?? record.evidence_schema,
    ),
    policyPath: readString(record, "policyPath", "policy_path"),
    requestExecutionEnabled: readBoolean(
      record,
      false,
      "requestExecutionEnabled",
      "request_execution_enabled",
    ),
    runtimeExecutionEnabled: readBoolean(
      record,
      false,
      "runtimeExecutionEnabled",
      "runtime_execution_enabled",
    ),
    blockedReason: readString(record, "blockedReason", "blocked_reason"),
    nextAction: readString(record, "nextAction", "next_action"),
  };
}

function normalizeDryPreflightPlan(
  value: unknown,
): CapabilityDraftReadonlyHttpDryPreflightPlan {
  const record: RawCapabilityDraftReadonlyHttpDryPreflightPlan &
    Record<string, unknown> =
    value && typeof value === "object"
      ? (value as RawCapabilityDraftReadonlyHttpDryPreflightPlan &
          Record<string, unknown>)
      : {};
  const status = readString(
    record,
    "status",
  ) as CapabilityDraftReadonlyHttpDryPreflightPlanStatus;
  return {
    status:
      status === "planned_without_execution"
        ? status
        : "blocked_by_session_input",
    planId: readString(record, "planId", "plan_id"),
    gateId: readString(record, "gateId", "gate_id"),
    approvalId: readString(record, "approvalId", "approval_id"),
    method: readString(record, "method"),
    methodAllowed: readBoolean(record, false, "methodAllowed", "method_allowed"),
    requestUrlHash:
      typeof record.requestUrlHash === "string"
        ? record.requestUrlHash
        : typeof record.request_url_hash === "string"
          ? record.request_url_hash
          : null,
    requestUrlHashAlgorithm: readString(
      record,
      "requestUrlHashAlgorithm",
      "request_url_hash_algorithm",
    ),
    endpointValueReturned: readBoolean(
      record,
      false,
      "endpointValueReturned",
      "endpoint_value_returned",
    ),
    endpointInputPersisted: readBoolean(
      record,
      false,
      "endpointInputPersisted",
      "endpoint_input_persisted",
    ),
    credentialReferenceId: readString(
      record,
      "credentialReferenceId",
      "credential_reference_id",
    ),
    credentialResolutionStage: readString(
      record,
      "credentialResolutionStage",
      "credential_resolution_stage",
    ),
    credentialResolved: readBoolean(
      record,
      false,
      "credentialResolved",
      "credential_resolved",
    ),
    evidenceSchema: normalizeStringArray(
      record.evidenceSchema ?? record.evidence_schema,
    ),
    plannedEvidenceKeys: normalizeStringArray(
      record.plannedEvidenceKeys ?? record.planned_evidence_keys,
    ),
    policyPath: readString(record, "policyPath", "policy_path"),
    networkRequestSent: readBoolean(
      record,
      false,
      "networkRequestSent",
      "network_request_sent",
    ),
    responseCaptured: readBoolean(
      record,
      false,
      "responseCaptured",
      "response_captured",
    ),
    requestExecutionEnabled: readBoolean(
      record,
      false,
      "requestExecutionEnabled",
      "request_execution_enabled",
    ),
    runtimeExecutionEnabled: readBoolean(
      record,
      false,
      "runtimeExecutionEnabled",
      "runtime_execution_enabled",
    ),
    valueRetention: readString(record, "valueRetention", "value_retention"),
    blockedReason: readString(record, "blockedReason", "blocked_reason"),
    nextAction: readString(record, "nextAction", "next_action"),
  };
}

function normalizeApprovalSessionSubmissionResult(
  raw: RawSubmitCapabilityDraftApprovalSessionInputsResult,
): SubmitCapabilityDraftApprovalSessionInputsResult {
  const record = raw as RawSubmitCapabilityDraftApprovalSessionInputsResult &
    Record<string, unknown>;
  const status = readString(
    record,
    "status",
  ) as CapabilityDraftApprovalSessionSubmissionValidationStatus;
  return {
    approvalId: readString(record, "approvalId", "approval_id"),
    sessionId:
      typeof record.sessionId === "string"
        ? record.sessionId
        : typeof record.session_id === "string"
          ? record.session_id
          : null,
    status:
      status === "validated_pending_runtime_gate" ? status : "rejected",
    scope: readString(record, "scope"),
    acceptedFieldKeys: normalizeStringArray(
      record.acceptedFieldKeys ?? record.accepted_field_keys,
    ),
    missingFieldKeys: normalizeStringArray(
      record.missingFieldKeys ?? record.missing_field_keys,
    ),
    rejectedFieldKeys: normalizeStringArray(
      record.rejectedFieldKeys ?? record.rejected_field_keys,
    ),
    fieldResults: normalizeSessionSubmissionFieldResults(
      record.fieldResults ?? record.field_results,
    ),
    endpointInputPersisted: readBoolean(
      record,
      false,
      "endpointInputPersisted",
      "endpoint_input_persisted",
    ),
    secretMaterialAccepted: readBoolean(
      record,
      false,
      "secretMaterialAccepted",
      "secret_material_accepted",
    ),
    tokenPersisted: readBoolean(
      record,
      false,
      "tokenPersisted",
      "token_persisted",
    ),
    credentialResolved: readBoolean(
      record,
      false,
      "credentialResolved",
      "credential_resolved",
    ),
    valueRetention: readString(record, "valueRetention", "value_retention"),
    evidenceCaptureRequired: readBoolean(
      record,
      false,
      "evidenceCaptureRequired",
      "evidence_capture_required",
    ),
    runtimeExecutionEnabled: readBoolean(
      record,
      false,
      "runtimeExecutionEnabled",
      "runtime_execution_enabled",
    ),
    nextGate: readString(record, "nextGate", "next_gate"),
    controlledGetPreflight: normalizeControlledGetPreflight(
      record.controlledGetPreflight ?? record.controlled_get_preflight,
    ),
    dryPreflightPlan: normalizeDryPreflightPlan(
      record.dryPreflightPlan ?? record.dry_preflight_plan,
    ),
    blockedReason: readString(record, "blockedReason", "blocked_reason"),
  };
}

function normalizeControlledGetEvidenceArtifact(
  value: unknown,
): CapabilityDraftControlledGetEvidenceArtifact | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as RawCapabilityDraftControlledGetEvidenceArtifact &
    Record<string, unknown>;
  const artifactId = readString(record, "artifactId", "artifact_id");
  if (!artifactId) {
    return null;
  }
  return {
    artifactId,
    relativePath: readString(record, "relativePath", "relative_path"),
    absolutePath: readString(record, "absolutePath", "absolute_path"),
    contentSha256: readString(record, "contentSha256", "content_sha256"),
    persisted: readBoolean(record, false, "persisted"),
    containsEndpointValue: readBoolean(
      record,
      false,
      "containsEndpointValue",
      "contains_endpoint_value",
    ),
    containsTokenValue: readBoolean(
      record,
      false,
      "containsTokenValue",
      "contains_token_value",
    ),
    containsResponsePreview: readBoolean(
      record,
      false,
      "containsResponsePreview",
      "contains_response_preview",
    ),
  };
}

function normalizeControlledGetExecutionResult(
  raw: RawExecuteCapabilityDraftControlledGetResult,
): ExecuteCapabilityDraftControlledGetResult {
  const record = raw as RawExecuteCapabilityDraftControlledGetResult &
    Record<string, unknown>;
  const status = readString(
    record,
    "status",
  ) as CapabilityDraftControlledGetExecutionStatus;
  const sessionInputStatus = readString(
    record,
    "sessionInputStatus",
    "session_input_status",
  ) as CapabilityDraftApprovalSessionSubmissionValidationStatus;
  return {
    approvalId: readString(record, "approvalId", "approval_id"),
    sessionId:
      typeof record.sessionId === "string"
        ? record.sessionId
        : typeof record.session_id === "string"
          ? record.session_id
          : null,
    status:
      status === "executed" || status === "request_failed"
        ? status
        : "blocked",
    scope: readString(record, "scope"),
    gateId: readString(record, "gateId", "gate_id"),
    method: readString(record, "method"),
    methodAllowed: readBoolean(record, false, "methodAllowed", "method_allowed"),
    requestUrlHash:
      typeof record.requestUrlHash === "string"
        ? record.requestUrlHash
        : typeof record.request_url_hash === "string"
          ? record.request_url_hash
          : null,
    requestUrlHashAlgorithm: readString(
      record,
      "requestUrlHashAlgorithm",
      "request_url_hash_algorithm",
    ),
    responseStatus:
      typeof record.responseStatus === "number"
        ? record.responseStatus
        : typeof record.response_status === "number"
          ? record.response_status
          : null,
    responseSha256:
      typeof record.responseSha256 === "string"
        ? record.responseSha256
        : typeof record.response_sha256 === "string"
          ? record.response_sha256
          : null,
    responseBytes: readNumber(record, 0, "responseBytes", "response_bytes"),
    responsePreview:
      typeof record.responsePreview === "string"
        ? record.responsePreview
        : typeof record.response_preview === "string"
          ? record.response_preview
          : null,
    responsePreviewTruncated: readBoolean(
      record,
      false,
      "responsePreviewTruncated",
      "response_preview_truncated",
    ),
    executedAt:
      typeof record.executedAt === "string"
        ? record.executedAt
        : typeof record.executed_at === "string"
          ? record.executed_at
          : null,
    networkRequestSent: readBoolean(
      record,
      false,
      "networkRequestSent",
      "network_request_sent",
    ),
    responseCaptured: readBoolean(
      record,
      false,
      "responseCaptured",
      "response_captured",
    ),
    endpointValueReturned: readBoolean(
      record,
      false,
      "endpointValueReturned",
      "endpoint_value_returned",
    ),
    endpointInputPersisted: readBoolean(
      record,
      false,
      "endpointInputPersisted",
      "endpoint_input_persisted",
    ),
    credentialReferenceId: readString(
      record,
      "credentialReferenceId",
      "credential_reference_id",
    ),
    credentialResolved: readBoolean(
      record,
      false,
      "credentialResolved",
      "credential_resolved",
    ),
    tokenPersisted: readBoolean(record, false, "tokenPersisted", "token_persisted"),
    requestExecutionEnabled: readBoolean(
      record,
      false,
      "requestExecutionEnabled",
      "request_execution_enabled",
    ),
    runtimeExecutionEnabled: readBoolean(
      record,
      false,
      "runtimeExecutionEnabled",
      "runtime_execution_enabled",
    ),
    valueRetention: readString(record, "valueRetention", "value_retention"),
    sessionInputStatus:
      sessionInputStatus === "validated_pending_runtime_gate"
        ? sessionInputStatus
        : "rejected",
    fieldResults: normalizeSessionSubmissionFieldResults(
      record.fieldResults ?? record.field_results,
    ),
    evidence: normalizeVerificationEvidence(record.evidence),
    evidenceArtifact: normalizeControlledGetEvidenceArtifact(
      record.evidenceArtifact ?? record.evidence_artifact,
    ),
    blockedReason: readString(record, "blockedReason", "blocked_reason"),
    nextAction: readString(record, "nextAction", "next_action"),
  };
}

function normalizeRegistrationApprovalRequests(
  value: unknown,
): CapabilityDraftRegistrationApprovalRequest[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is RawCapabilityDraftRegistrationApprovalRequest =>
      Boolean(item && typeof item === "object"),
    )
    .map((item): CapabilityDraftRegistrationApprovalRequest => {
      const record = item as Record<string, unknown>;
      return {
        approvalId: readString(record, "approvalId", "approval_id"),
        status: "pending",
        sourceCheckId: readString(record, "sourceCheckId", "source_check_id"),
        skillDirectory: readString(record, "skillDirectory", "skill_directory"),
        endpointSource: readString(record, "endpointSource", "endpoint_source"),
        method: readString(record, "method"),
        credentialReferenceId: readString(
          record,
          "credentialReferenceId",
          "credential_reference_id",
        ),
        evidenceSchema: normalizeStringArray(
          item.evidenceSchema ?? item.evidence_schema,
        ),
        policyPath: readString(record, "policyPath", "policy_path"),
        createdAt: readString(record, "createdAt", "created_at"),
        consumptionGate: normalizeApprovalConsumptionGate(
          item.consumptionGate ?? item.consumption_gate,
        ),
        credentialResolver: normalizeCredentialResolver(
          item.credentialResolver ?? item.credential_resolver,
        ),
        consumptionInputSchema: normalizeConsumptionInputSchema(
          item.consumptionInputSchema ?? item.consumption_input_schema,
        ),
        sessionInputIntake: normalizeSessionInputIntake(
          item.sessionInputIntake ?? item.session_input_intake,
        ),
        sessionInputSubmissionContract: normalizeSessionSubmissionContract(
          item.sessionInputSubmissionContract ??
            item.session_input_submission_contract,
        ),
      };
    })
    .filter(
      (item) =>
        item.approvalId.length > 0 &&
        item.sourceCheckId.length > 0 &&
        item.method.length > 0,
    );
}

function normalizeVerificationReport(
  raw: RawCapabilityDraftVerificationReport,
): CapabilityDraftVerificationReport {
  const summary = normalizeVerificationSummary(raw) ?? {
    reportId: "",
    status: "failed" as const,
    summary: "",
    checkedAt: "",
    failedCheckCount: 0,
  };
  const record = raw as Record<string, unknown>;
  return {
    ...summary,
    draftId: readString(record, "draftId", "draft_id"),
    checks: normalizeVerificationChecks(raw.checks),
  };
}

function normalizeRegistrationSummary(
  raw: RawCapabilityDraftRegistrationSummary | null | undefined,
): CapabilityDraftRegistrationSummary | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const rawSourceVerificationReportId =
    raw.sourceVerificationReportId ?? raw.source_verification_report_id;
  return {
    registrationId: readString(record, "registrationId", "registration_id"),
    registeredAt: readString(record, "registeredAt", "registered_at"),
    skillDirectory: readString(record, "skillDirectory", "skill_directory"),
    registeredSkillDirectory: readString(
      record,
      "registeredSkillDirectory",
      "registered_skill_directory",
    ),
    sourceDraftId: readString(record, "sourceDraftId", "source_draft_id"),
    sourceVerificationReportId:
      typeof rawSourceVerificationReportId === "string"
        ? rawSourceVerificationReportId
        : null,
    generatedFileCount:
      typeof raw.generatedFileCount === "number"
        ? raw.generatedFileCount
        : typeof raw.generated_file_count === "number"
          ? raw.generated_file_count
          : 0,
    permissionSummary: normalizeStringArray(
      raw.permissionSummary ?? raw.permission_summary,
    ),
    verificationGates: normalizeRegistrationVerificationGates(
      raw.verificationGates ?? raw.verification_gates,
    ),
    approvalRequests: normalizeRegistrationApprovalRequests(
      raw.approvalRequests ?? raw.approval_requests,
    ),
  };
}

function normalizeRecordStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, item]) => [key, item.trim()])
      .filter(([, item]) => item.length > 0),
  );
}

function normalizeResourceSummary(value: unknown): SkillResourceSummary {
  const raw =
    value && typeof value === "object"
      ? (value as RawSkillResourceSummary)
      : {};
  return {
    hasScripts: Boolean(raw.hasScripts ?? raw.has_scripts),
    hasReferences: Boolean(raw.hasReferences ?? raw.has_references),
    hasAssets: Boolean(raw.hasAssets ?? raw.has_assets),
  };
}

function normalizeStandardCompliance(value: unknown): SkillStandardCompliance {
  const raw =
    value && typeof value === "object"
      ? (value as RawSkillStandardCompliance)
      : {};
  return {
    isStandard: Boolean(raw.isStandard ?? raw.is_standard),
    validationErrors: normalizeStringArray(
      raw.validationErrors ?? raw.validation_errors,
    ),
    deprecatedFields: normalizeStringArray(
      raw.deprecatedFields ?? raw.deprecated_fields,
    ),
  };
}

function normalizeWorkspaceRegisteredSkill(
  raw: RawWorkspaceRegisteredSkillRecord,
): WorkspaceRegisteredSkillRecord {
  const record = raw as Record<string, unknown>;
  return {
    key: readString(record, "key"),
    name: readString(record, "name"),
    description: readString(record, "description"),
    directory: readString(record, "directory"),
    registeredSkillDirectory: readString(
      record,
      "registeredSkillDirectory",
      "registered_skill_directory",
    ),
    registration: normalizeRegistrationSummary(raw.registration) ?? {
      registrationId: "",
      registeredAt: "",
      skillDirectory: "",
      registeredSkillDirectory: "",
      sourceDraftId: "",
      sourceVerificationReportId: null,
      generatedFileCount: 0,
      permissionSummary: [],
      verificationGates: [],
    },
    permissionSummary: normalizeStringArray(
      raw.permissionSummary ?? raw.permission_summary,
    ),
    metadata: normalizeRecordStringMap(raw.metadata),
    allowedTools: normalizeStringArray(raw.allowedTools ?? raw.allowed_tools),
    resourceSummary: normalizeResourceSummary(
      raw.resourceSummary ?? raw.resource_summary,
    ),
    standardCompliance: normalizeStandardCompliance(
      raw.standardCompliance ?? raw.standard_compliance,
    ),
    launchEnabled:
      typeof raw.launchEnabled === "boolean"
        ? raw.launchEnabled
        : typeof raw.launch_enabled === "boolean"
          ? raw.launch_enabled
          : false,
    runtimeGate: readString(record, "runtimeGate", "runtime_gate"),
  };
}

function normalizeDraft(raw: RawCapabilityDraftRecord): CapabilityDraftRecord {
  const record = raw as Record<string, unknown>;
  return {
    draftId: readString(record, "draftId", "draft_id"),
    name: readString(record, "name"),
    description: readString(record, "description"),
    userGoal: readString(record, "userGoal", "user_goal"),
    sourceKind: readString(record, "sourceKind", "source_kind") || "manual",
    sourceRefs: normalizeStringArray(raw.sourceRefs ?? raw.source_refs),
    permissionSummary: normalizeStringArray(
      raw.permissionSummary ?? raw.permission_summary,
    ),
    generatedFiles: normalizeGeneratedFiles(
      raw.generatedFiles ?? raw.generated_files,
    ),
    verificationStatus: normalizeStatus(
      raw.verificationStatus ?? raw.verification_status,
    ),
    lastVerification: normalizeVerificationSummary(
      raw.lastVerification ?? raw.last_verification,
    ),
    lastRegistration: normalizeRegistrationSummary(
      raw.lastRegistration ?? raw.last_registration,
    ),
    createdAt: readString(record, "createdAt", "created_at"),
    updatedAt: readString(record, "updatedAt", "updated_at"),
    draftRoot: readString(record, "draftRoot", "draft_root"),
    manifestPath: readString(record, "manifestPath", "manifest_path"),
  };
}

export const capabilityDraftsApi = {
  async create(
    request: CreateCapabilityDraftRequest,
  ): Promise<CapabilityDraftRecord> {
    const draft = await safeInvoke<RawCapabilityDraftRecord>(
      "capability_draft_create",
      { request },
    );
    return normalizeDraft(draft);
  },

  async list(
    request: CapabilityDraftListRequest,
  ): Promise<CapabilityDraftRecord[]> {
    const drafts = await safeInvoke<RawCapabilityDraftRecord[]>(
      "capability_draft_list",
      { request },
    );
    if (!Array.isArray(drafts)) {
      return [];
    }
    return drafts.map(normalizeDraft);
  },

  async get(
    request: CapabilityDraftLookupRequest,
  ): Promise<CapabilityDraftRecord | null> {
    const draft = await safeInvoke<RawCapabilityDraftRecord | null>(
      "capability_draft_get",
      { request },
    );
    return draft ? normalizeDraft(draft) : null;
  },

  async verify(
    request: VerifyCapabilityDraftRequest,
  ): Promise<VerifyCapabilityDraftResult> {
    const result = await safeInvoke<RawVerifyCapabilityDraftResult>(
      "capability_draft_verify",
      { request },
    );
    return {
      draft: normalizeDraft(result.draft ?? {}),
      report: normalizeVerificationReport(result.report ?? {}),
    };
  },

  async register(
    request: RegisterCapabilityDraftRequest,
  ): Promise<RegisterCapabilityDraftResult> {
    const result = await safeInvoke<RawRegisterCapabilityDraftResult>(
      "capability_draft_register",
      { request },
    );
    return {
      draft: normalizeDraft(result.draft ?? {}),
      registration: normalizeRegistrationSummary(result.registration) ?? {
        registrationId: "",
        registeredAt: "",
        skillDirectory: "",
        registeredSkillDirectory: "",
        sourceDraftId: "",
        sourceVerificationReportId: null,
        generatedFileCount: 0,
        permissionSummary: [],
        verificationGates: [],
      },
    };
  },

  async listRegisteredSkills(
    request: ListWorkspaceRegisteredSkillsRequest,
  ): Promise<WorkspaceRegisteredSkillRecord[]> {
    const skills = await safeInvoke<RawWorkspaceRegisteredSkillRecord[]>(
      "capability_draft_list_registered_skills",
      { request },
    );
    if (!Array.isArray(skills)) {
      return [];
    }
    return skills.map(normalizeWorkspaceRegisteredSkill);
  },

  async submitApprovalSessionInputs(
    request: SubmitCapabilityDraftApprovalSessionInputsRequest,
  ): Promise<SubmitCapabilityDraftApprovalSessionInputsResult> {
    const result =
      await safeInvoke<RawSubmitCapabilityDraftApprovalSessionInputsResult>(
        "capability_draft_submit_approval_session_inputs",
        { request },
      );
    return normalizeApprovalSessionSubmissionResult(result ?? {});
  },

  async executeControlledGet(
    request: ExecuteCapabilityDraftControlledGetRequest,
  ): Promise<ExecuteCapabilityDraftControlledGetResult> {
    const result = await safeInvoke<RawExecuteCapabilityDraftControlledGetResult>(
      "capability_draft_execute_controlled_get",
      { request },
    );
    return normalizeControlledGetExecutionResult(result ?? {});
  },
};

export const __capabilityDraftsApiTestUtils = {
  normalizeDraft,
  normalizeGeneratedFiles,
  normalizeVerificationReport,
  normalizeRegistrationSummary,
  normalizeWorkspaceRegisteredSkill,
  normalizeApprovalSessionSubmissionResult,
  normalizeControlledGetEvidenceArtifact,
  normalizeControlledGetExecutionResult,
};
