import { normalizeLegacyToolSurfaceName } from "../agentTextNormalization";
import { normalizeQueuedTurnSnapshots } from "../queuedTurn";
import type {
  AgentRuntimeEvidenceActionCount,
  AgentRuntimeEvidenceArtifact,
  AgentRuntimeEvidenceArtifactKindCount,
  AgentRuntimeEvidenceBackendCount,
  AgentRuntimeEvidenceBrowserActionItem,
  AgentRuntimeEvidenceBrowserActionIndex,
  AgentRuntimeCompletionAuditRequiredEvidence,
  AgentRuntimeCompletionAuditSummary,
  AgentRuntimeEvidenceDecisionCount,
  AgentRuntimeEvidenceLimeCorePolicyEvaluation,
  AgentRuntimeEvidenceLimeCorePolicyIndex,
  AgentRuntimeEvidenceLimeCorePolicyInput,
  AgentRuntimeEvidenceLimeCorePolicyItem,
  AgentRuntimeEvidenceLimeCorePolicyValueHit,
  AgentRuntimeEvidencePack,
  AgentRuntimeEvidenceStatusCount,
  AgentRuntimeEvidenceTaskIndex,
  AgentRuntimeEvidenceTaskIndexItem,
  AgentRuntimeHandoffArtifact,
  AgentRuntimeHandoffBundle,
  AgentRuntimeAnalysisArtifact,
  AgentRuntimeAnalysisHandoff,
  AgentRuntimeReplayArtifact,
  AgentRuntimeReplayCase,
  AgentRuntimeReviewDecision,
  AgentRuntimeReviewDecisionArtifact,
  AgentRuntimeReviewDecisionRiskLevel,
  AgentRuntimeReviewDecisionStatus,
  AgentRuntimeReviewDecisionTemplate,
  AgentRuntimeThreadReadModel,
  AsterSubagentParentContext,
  AsterSubagentSessionInfo,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readStringField(
  record: Record<string, unknown>,
  camelKey: string,
  snakeKey?: string,
): string {
  const value = record[camelKey] ?? (snakeKey ? record[snakeKey] : undefined);
  return typeof value === "string" ? value : "";
}

function readOptionalStringField(
  record: Record<string, unknown>,
  camelKey: string,
  snakeKey?: string,
): string | undefined {
  const value = record[camelKey] ?? (snakeKey ? record[snakeKey] : undefined);
  return typeof value === "string" && value ? value : undefined;
}

function readNumberField(
  record: Record<string, unknown>,
  camelKey: string,
  snakeKey?: string,
): number {
  const value = record[camelKey] ?? (snakeKey ? record[snakeKey] : undefined);
  return typeof value === "number" ? value : 0;
}

function readOptionalNumberField(
  record: Record<string, unknown>,
  camelKey: string,
  snakeKey?: string,
): number | undefined {
  const value = record[camelKey] ?? (snakeKey ? record[snakeKey] : undefined);
  return typeof value === "number" ? value : undefined;
}

function readOptionalBooleanField(
  record: Record<string, unknown>,
  camelKey: string,
  snakeKey?: string,
): boolean | undefined {
  const value = record[camelKey] ?? (snakeKey ? record[snakeKey] : undefined);
  return typeof value === "boolean" ? value : undefined;
}

function readStringListField(
  record: Record<string, unknown>,
  camelKey: string,
  snakeKey?: string,
): string[] {
  const value = record[camelKey] ?? (snakeKey ? record[snakeKey] : undefined);
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readRecordField(
  record: Record<string, unknown>,
  camelKey: string,
  snakeKey?: string,
): Record<string, unknown> | undefined {
  const value = record[camelKey] ?? (snakeKey ? record[snakeKey] : undefined);
  return isRecord(value) ? value : undefined;
}

function readNumberMapField(
  record: Record<string, unknown>,
  camelKey: string,
  snakeKey?: string,
): Record<string, number> {
  const value = readRecordField(record, camelKey, snakeKey);
  if (!value) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number",
    ),
  );
}

function readArrayField(
  record: Record<string, unknown>,
  camelKey: string,
  snakeKey?: string,
): unknown[] {
  const value = record[camelKey] ?? (snakeKey ? record[snakeKey] : undefined);
  return Array.isArray(value) ? value : [];
}

function normalizeEvidenceVerificationOutcome(
  value?: string,
):
  | "success"
  | "blocking_failure"
  | "advisory_failure"
  | "recovered"
  | undefined {
  switch (value) {
    case "success":
    case "blocking_failure":
    case "advisory_failure":
    case "recovered":
      return value;
    default:
      return undefined;
  }
}

function normalizeEvidenceSignalCoverageEntry(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  return {
    signal: readStringField(value, "signal"),
    status: readStringField(value, "status"),
    source: readStringField(value, "source"),
    detail: readStringField(value, "detail"),
  };
}

function normalizeEvidenceStatusCount(
  value: unknown,
): AgentRuntimeEvidenceStatusCount | null {
  if (!isRecord(value)) {
    return null;
  }

  const status = readStringField(value, "status");
  if (!status) {
    return null;
  }

  return {
    status,
    count: readNumberField(value, "count"),
  };
}

function normalizeEvidenceArtifactKindCount(
  value: unknown,
): AgentRuntimeEvidenceArtifactKindCount | null {
  if (!isRecord(value)) {
    return null;
  }

  const artifactKind = readStringField(value, "artifactKind", "artifact_kind");
  if (!artifactKind) {
    return null;
  }

  return {
    artifact_kind: artifactKind,
    count: readNumberField(value, "count"),
  };
}

function normalizeEvidenceActionCount(
  value: unknown,
): AgentRuntimeEvidenceActionCount | null {
  if (!isRecord(value)) {
    return null;
  }

  const action = readStringField(value, "action");
  if (!action) {
    return null;
  }

  return {
    action,
    count: readNumberField(value, "count"),
  };
}

function normalizeEvidenceBackendCount(
  value: unknown,
): AgentRuntimeEvidenceBackendCount | null {
  if (!isRecord(value)) {
    return null;
  }

  const backend = readStringField(value, "backend");
  if (!backend) {
    return null;
  }

  return {
    backend,
    count: readNumberField(value, "count"),
  };
}

function normalizeEvidenceDecisionCount(
  value: unknown,
): AgentRuntimeEvidenceDecisionCount | null {
  if (!isRecord(value)) {
    return null;
  }

  const decision = readStringField(value, "decision");
  if (!decision) {
    return null;
  }

  return {
    decision,
    count: readNumberField(value, "count"),
  };
}

function normalizeBrowserActionItem(
  value: unknown,
): AgentRuntimeEvidenceBrowserActionItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const item: AgentRuntimeEvidenceBrowserActionItem = {
    artifact_path: readOptionalStringField(
      value,
      "artifactPath",
      "artifact_path",
    ),
    contract_key: readOptionalStringField(value, "contractKey", "contract_key"),
    source: readOptionalStringField(value, "source"),
    entry_source: readOptionalStringField(value, "entrySource", "entry_source"),
    artifact_kind: readOptionalStringField(
      value,
      "artifactKind",
      "artifact_kind",
    ),
    tool_name: readOptionalStringField(value, "toolName", "tool_name"),
    action: readOptionalStringField(value, "action"),
    status: readOptionalStringField(value, "status"),
    success: readOptionalBooleanField(value, "success"),
    session_id: readOptionalStringField(value, "sessionId", "session_id"),
    target_id: readOptionalStringField(value, "targetId", "target_id"),
    profile_key: readOptionalStringField(value, "profileKey", "profile_key"),
    backend: readOptionalStringField(value, "backend"),
    request_id: readOptionalStringField(value, "requestId", "request_id"),
    last_url: readOptionalStringField(value, "lastUrl", "last_url"),
    title: readOptionalStringField(value, "title"),
    attempt_count: readOptionalNumberField(
      value,
      "attemptCount",
      "attempt_count",
    ),
    observation_available: readOptionalBooleanField(
      value,
      "observationAvailable",
      "observation_available",
    ),
    screenshot_available: readOptionalBooleanField(
      value,
      "screenshotAvailable",
      "screenshot_available",
    ),
  };

  const hasReadableField = Object.values(item).some(
    (field) => field !== undefined && field !== "",
  );

  return hasReadableField ? item : null;
}

function normalizeBrowserActionIndex(
  value: unknown,
): AgentRuntimeEvidenceBrowserActionIndex | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const rawStatusCounts = readArrayField(
    value,
    "statusCounts",
    "status_counts",
  );
  const rawArtifactKindCounts = readArrayField(
    value,
    "artifactKindCounts",
    "artifact_kind_counts",
  );
  const rawActionCounts = readArrayField(
    value,
    "actionCounts",
    "action_counts",
  );
  const rawBackendCounts = readArrayField(
    value,
    "backendCounts",
    "backend_counts",
  );
  const rawItems = readArrayField(value, "items");

  const index: AgentRuntimeEvidenceBrowserActionIndex = {
    action_count: readNumberField(value, "actionCount", "action_count"),
    session_count: readNumberField(value, "sessionCount", "session_count"),
    observation_count: readNumberField(
      value,
      "observationCount",
      "observation_count",
    ),
    screenshot_count: readNumberField(
      value,
      "screenshotCount",
      "screenshot_count",
    ),
    last_url: readOptionalStringField(value, "lastUrl", "last_url"),
    session_ids: readStringListField(value, "sessionIds", "session_ids"),
    target_ids: readStringListField(value, "targetIds", "target_ids"),
    profile_keys: readStringListField(value, "profileKeys", "profile_keys"),
    status_counts: rawStatusCounts
      .map((entry: unknown) => normalizeEvidenceStatusCount(entry))
      .filter(Boolean) as AgentRuntimeEvidenceStatusCount[],
    artifact_kind_counts: rawArtifactKindCounts
      .map((entry: unknown) => normalizeEvidenceArtifactKindCount(entry))
      .filter(Boolean) as AgentRuntimeEvidenceArtifactKindCount[],
    action_counts: rawActionCounts
      .map((entry: unknown) => normalizeEvidenceActionCount(entry))
      .filter(Boolean) as AgentRuntimeEvidenceActionCount[],
    backend_counts: rawBackendCounts
      .map((entry: unknown) => normalizeEvidenceBackendCount(entry))
      .filter(Boolean) as AgentRuntimeEvidenceBackendCount[],
    items: rawItems
      .map((entry: unknown) => normalizeBrowserActionItem(entry))
      .filter(Boolean) as AgentRuntimeEvidenceBrowserActionItem[],
  };

  if (
    index.action_count === 0 &&
    index.session_count === 0 &&
    index.observation_count === 0 &&
    index.screenshot_count === 0 &&
    !index.last_url &&
    index.items.length === 0
  ) {
    return undefined;
  }

  return index;
}

function normalizeTaskIndexItem(
  value: unknown,
): AgentRuntimeEvidenceTaskIndexItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const item: AgentRuntimeEvidenceTaskIndexItem = {
    artifact_path: readOptionalStringField(
      value,
      "artifactPath",
      "artifact_path",
    ),
    task_id: readOptionalStringField(value, "taskId", "task_id"),
    task_type: readOptionalStringField(value, "taskType", "task_type"),
    contract_key: readOptionalStringField(value, "contractKey", "contract_key"),
    source: readOptionalStringField(value, "source"),
    thread_id: readOptionalStringField(value, "threadId", "thread_id"),
    turn_id: readOptionalStringField(value, "turnId", "turn_id"),
    content_id: readOptionalStringField(value, "contentId", "content_id"),
    entry_key: readOptionalStringField(value, "entryKey", "entry_key"),
    entry_source: readOptionalStringField(value, "entrySource", "entry_source"),
    modality: readOptionalStringField(value, "modality"),
    skill_id: readOptionalStringField(value, "skillId", "skill_id"),
    model_id: readOptionalStringField(value, "modelId", "model_id"),
    executor_kind: readOptionalStringField(
      value,
      "executorKind",
      "executor_kind",
    ),
    executor_binding_key: readOptionalStringField(
      value,
      "executorBindingKey",
      "executor_binding_key",
    ),
    cost_state: readOptionalStringField(value, "costState", "cost_state"),
    limit_state: readOptionalStringField(value, "limitState", "limit_state"),
    estimated_cost_class: readOptionalStringField(
      value,
      "estimatedCostClass",
      "estimated_cost_class",
    ),
    limit_event_kind: readOptionalStringField(
      value,
      "limitEventKind",
      "limit_event_kind",
    ),
    quota_low: readOptionalBooleanField(value, "quotaLow", "quota_low"),
    routing_outcome: readOptionalStringField(
      value,
      "routingOutcome",
      "routing_outcome",
    ),
  };

  const hasReadableField = Object.values(item).some(
    (field) => field !== undefined && field !== "",
  );

  return hasReadableField ? item : null;
}

function normalizeTaskIndex(
  value: unknown,
): AgentRuntimeEvidenceTaskIndex | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const rawItems = readArrayField(value, "items");
  const index: AgentRuntimeEvidenceTaskIndex = {
    snapshot_count: readNumberField(value, "snapshotCount", "snapshot_count"),
    thread_ids: readStringListField(value, "threadIds", "thread_ids"),
    turn_ids: readStringListField(value, "turnIds", "turn_ids"),
    content_ids: readStringListField(value, "contentIds", "content_ids"),
    entry_keys: readStringListField(value, "entryKeys", "entry_keys"),
    modalities: readStringListField(value, "modalities"),
    skill_ids: readStringListField(value, "skillIds", "skill_ids"),
    model_ids: readStringListField(value, "modelIds", "model_ids"),
    executor_kinds: readStringListField(
      value,
      "executorKinds",
      "executor_kinds",
    ),
    executor_binding_keys: readStringListField(
      value,
      "executorBindingKeys",
      "executor_binding_keys",
    ),
    cost_states: readStringListField(value, "costStates", "cost_states"),
    limit_states: readStringListField(value, "limitStates", "limit_states"),
    estimated_cost_classes: readStringListField(
      value,
      "estimatedCostClasses",
      "estimated_cost_classes",
    ),
    limit_event_kinds: readStringListField(
      value,
      "limitEventKinds",
      "limit_event_kinds",
    ),
    quota_low_count: readNumberField(
      value,
      "quotaLowCount",
      "quota_low_count",
    ),
    items: rawItems
      .map((entry: unknown) => normalizeTaskIndexItem(entry))
      .filter(Boolean) as AgentRuntimeEvidenceTaskIndexItem[],
  };

  if (
    index.snapshot_count === 0 &&
    index.thread_ids.length === 0 &&
    index.turn_ids.length === 0 &&
    index.content_ids.length === 0 &&
    index.entry_keys.length === 0 &&
    index.modalities.length === 0 &&
    index.skill_ids.length === 0 &&
    index.model_ids.length === 0 &&
    index.executor_kinds.length === 0 &&
    index.executor_binding_keys.length === 0 &&
    index.cost_states.length === 0 &&
    index.limit_states.length === 0 &&
    index.estimated_cost_classes.length === 0 &&
    index.limit_event_kinds.length === 0 &&
    index.quota_low_count === 0 &&
    index.items.length === 0
  ) {
    return undefined;
  }

  return index;
}

function normalizeLimeCorePolicyItem(
  value: unknown,
): AgentRuntimeEvidenceLimeCorePolicyItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const refs = readStringListField(value, "refs");
  const evaluatedRefs = readStringListField(
    value,
    "evaluatedRefs",
    "evaluated_refs",
  );
  const unresolvedRefs = readStringListField(
    value,
    "unresolvedRefs",
    "unresolved_refs",
  );
  const missingInputs = readStringListField(
    value,
    "missingInputs",
    "missing_inputs",
  );
  const policyInputs = readArrayField(value, "policyInputs", "policy_inputs")
    .map((entry: unknown) => normalizeLimeCorePolicyInput(entry))
    .filter(Boolean) as AgentRuntimeEvidenceLimeCorePolicyInput[];
  const pendingHitRefs = readStringListField(
    value,
    "pendingHitRefs",
    "pending_hit_refs",
  );
  const policyValueHits = readArrayField(
    value,
    "policyValueHits",
    "policy_value_hits",
  )
    .map((entry: unknown) => normalizeLimeCorePolicyValueHit(entry))
    .filter(Boolean) as AgentRuntimeEvidenceLimeCorePolicyValueHit[];
  const hasPolicyValueHitsField =
    "policyValueHits" in value || "policy_value_hits" in value;
  const policyValueHitCount =
    readOptionalNumberField(
      value,
      "policyValueHitCount",
      "policy_value_hit_count",
    ) ?? (hasPolicyValueHitsField ? policyValueHits.length : undefined);
  const policyEvaluation = normalizeLimeCorePolicyEvaluation(
    value.policyEvaluation ?? value.policy_evaluation,
  );
  const item: AgentRuntimeEvidenceLimeCorePolicyItem = {
    artifact_path: readOptionalStringField(
      value,
      "artifactPath",
      "artifact_path",
    ),
    contract_key: readOptionalStringField(value, "contractKey", "contract_key"),
    execution_profile_key: readOptionalStringField(
      value,
      "executionProfileKey",
      "execution_profile_key",
    ),
    executor_adapter_key: readOptionalStringField(
      value,
      "executorAdapterKey",
      "executor_adapter_key",
    ),
    refs,
    status: readOptionalStringField(value, "status"),
    decision: readOptionalStringField(value, "decision"),
    decision_source: readOptionalStringField(
      value,
      "decisionSource",
      "decision_source",
    ),
    decision_scope: readOptionalStringField(
      value,
      "decisionScope",
      "decision_scope",
    ),
    decision_reason: readOptionalStringField(
      value,
      "decisionReason",
      "decision_reason",
    ),
    ...(evaluatedRefs.length > 0 ? { evaluated_refs: evaluatedRefs } : {}),
    ...(unresolvedRefs.length > 0 ? { unresolved_refs: unresolvedRefs } : {}),
    ...(missingInputs.length > 0 ? { missing_inputs: missingInputs } : {}),
    ...(policyInputs.length > 0 ? { policy_inputs: policyInputs } : {}),
    ...(pendingHitRefs.length > 0 ? { pending_hit_refs: pendingHitRefs } : {}),
    ...(hasPolicyValueHitsField ? { policy_value_hits: policyValueHits } : {}),
    ...(policyValueHitCount !== undefined
      ? { policy_value_hit_count: policyValueHitCount }
      : {}),
    ...(policyEvaluation ? { policy_evaluation: policyEvaluation } : {}),
    source: readOptionalStringField(value, "source"),
  };

  const hasReadableField =
    refs.length > 0 ||
    Object.entries(item).some(
      ([key, field]) => key !== "refs" && field !== undefined && field !== "",
    );

  return hasReadableField ? item : null;
}

function normalizeLimeCorePolicyEvaluation(
  value: unknown,
): AgentRuntimeEvidenceLimeCorePolicyEvaluation | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const evaluation: AgentRuntimeEvidenceLimeCorePolicyEvaluation = {
    status: readOptionalStringField(value, "status"),
    decision: readOptionalStringField(value, "decision"),
    decision_source: readOptionalStringField(
      value,
      "decisionSource",
      "decision_source",
    ),
    decision_scope: readOptionalStringField(
      value,
      "decisionScope",
      "decision_scope",
    ),
    decision_reason: readOptionalStringField(
      value,
      "decisionReason",
      "decision_reason",
    ),
    blocking_refs: readStringListField(value, "blockingRefs", "blocking_refs"),
    ask_refs: readStringListField(value, "askRefs", "ask_refs"),
    pending_refs: readStringListField(value, "pendingRefs", "pending_refs"),
  };

  return Object.values(evaluation).some((field) =>
    Array.isArray(field) ? field.length > 0 : Boolean(field),
  )
    ? evaluation
    : undefined;
}

function normalizeLimeCorePolicyInput(
  value: unknown,
): AgentRuntimeEvidenceLimeCorePolicyInput | null {
  if (!isRecord(value)) {
    return null;
  }

  const refKey =
    readOptionalStringField(value, "refKey", "ref_key") ??
    readOptionalStringField(value, "ref");
  if (!refKey) {
    return null;
  }

  return {
    ref_key: refKey,
    status: readOptionalStringField(value, "status"),
    source: readOptionalStringField(value, "source"),
    value_source: readOptionalStringField(value, "valueSource", "value_source"),
  };
}

function normalizeLimeCorePolicyValueHit(
  value: unknown,
): AgentRuntimeEvidenceLimeCorePolicyValueHit | null {
  if (!isRecord(value)) {
    return null;
  }

  const refKey =
    readOptionalStringField(value, "refKey", "ref_key") ??
    readOptionalStringField(value, "ref");
  if (!refKey) {
    return null;
  }

  return {
    ref_key: refKey,
    status: readOptionalStringField(value, "status"),
    source: readOptionalStringField(value, "source"),
    value_source: readOptionalStringField(value, "valueSource", "value_source"),
    value:
      value.value !== undefined
        ? value.value
        : value.policyValue !== undefined
          ? value.policyValue
          : value.policy_value,
    summary: readOptionalStringField(value, "summary"),
    evidence_ref: readOptionalStringField(value, "evidenceRef", "evidence_ref"),
    observed_at: readOptionalStringField(value, "observedAt", "observed_at"),
  };
}

function normalizeLimeCorePolicyIndex(
  value: unknown,
): AgentRuntimeEvidenceLimeCorePolicyIndex | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const rawStatusCounts = readArrayField(
    value,
    "statusCounts",
    "status_counts",
  );
  const rawDecisionCounts = readArrayField(
    value,
    "decisionCounts",
    "decision_counts",
  );
  const rawItems = readArrayField(value, "items");
  const index: AgentRuntimeEvidenceLimeCorePolicyIndex = {
    snapshot_count: readNumberField(value, "snapshotCount", "snapshot_count"),
    ref_keys: readStringListField(value, "refKeys", "ref_keys"),
    missing_inputs: readStringListField(
      value,
      "missingInputs",
      "missing_inputs",
    ),
    pending_hit_refs: readStringListField(
      value,
      "pendingHitRefs",
      "pending_hit_refs",
    ),
    policy_value_hit_count: readNumberField(
      value,
      "policyValueHitCount",
      "policy_value_hit_count",
    ),
    status_counts: rawStatusCounts
      .map((entry: unknown) => normalizeEvidenceStatusCount(entry))
      .filter(Boolean) as AgentRuntimeEvidenceStatusCount[],
    decision_counts: rawDecisionCounts
      .map((entry: unknown) => normalizeEvidenceDecisionCount(entry))
      .filter(Boolean) as AgentRuntimeEvidenceDecisionCount[],
    items: rawItems
      .map((entry: unknown) => normalizeLimeCorePolicyItem(entry))
      .filter(Boolean) as AgentRuntimeEvidenceLimeCorePolicyItem[],
  };

  if (
    index.snapshot_count === 0 &&
    index.ref_keys.length === 0 &&
    (index.missing_inputs?.length ?? 0) === 0 &&
    (index.pending_hit_refs?.length ?? 0) === 0 &&
    (index.policy_value_hit_count ?? 0) === 0 &&
    index.status_counts.length === 0 &&
    index.decision_counts.length === 0 &&
    index.items.length === 0
  ) {
    return undefined;
  }

  return index;
}

function normalizeEvidenceModalityRuntimeContracts(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }

  const snapshotIndexRecord = readRecordField(
    value,
    "snapshotIndex",
    "snapshot_index",
  );
  const taskIndex = normalizeTaskIndex(
    snapshotIndexRecord
      ? readRecordField(snapshotIndexRecord, "taskIndex", "task_index")
      : undefined,
  );
  const browserActionIndex = normalizeBrowserActionIndex(
    snapshotIndexRecord
      ? readRecordField(
          snapshotIndexRecord,
          "browserActionIndex",
          "browser_action_index",
        )
      : undefined,
  );
  const limeCorePolicyIndex = normalizeLimeCorePolicyIndex(
    snapshotIndexRecord
      ? readRecordField(
          snapshotIndexRecord,
          "limecorePolicyIndex",
          "limecore_policy_index",
        )
      : undefined,
  );
  const snapshotCount = readNumberField(
    value,
    "snapshotCount",
    "snapshot_count",
  );

  if (
    snapshotCount === 0 &&
    !taskIndex &&
    !browserActionIndex &&
    !limeCorePolicyIndex
  ) {
    return undefined;
  }
  const snapshotIndex =
    taskIndex || browserActionIndex || limeCorePolicyIndex
      ? {
          ...(taskIndex ? { task_index: taskIndex } : {}),
          ...(browserActionIndex
            ? { browser_action_index: browserActionIndex }
            : {}),
          ...(limeCorePolicyIndex
            ? { limecore_policy_index: limeCorePolicyIndex }
            : {}),
        }
      : undefined;

  return {
    snapshot_count: snapshotCount,
    snapshot_index: snapshotIndex,
  };
}

function normalizeArtifactValidatorVerificationSummary(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    applicable: readOptionalBooleanField(value, "applicable") ?? false,
    record_count: readNumberField(value, "recordCount", "record_count"),
    issue_count: readNumberField(value, "issueCount", "issue_count"),
    repaired_count: readNumberField(value, "repairedCount", "repaired_count"),
    fallback_used_count: readNumberField(
      value,
      "fallbackUsedCount",
      "fallback_used_count",
    ),
    outcome: normalizeEvidenceVerificationOutcome(
      readOptionalStringField(value, "outcome"),
    ),
  };
}

function normalizeBrowserVerificationSummary(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    record_count: readNumberField(value, "recordCount", "record_count"),
    success_count: readNumberField(value, "successCount", "success_count"),
    failure_count: readNumberField(value, "failureCount", "failure_count"),
    unknown_count: readNumberField(value, "unknownCount", "unknown_count"),
    latest_updated_at: readOptionalStringField(
      value,
      "latestUpdatedAt",
      "latest_updated_at",
    ),
    outcome: normalizeEvidenceVerificationOutcome(
      readOptionalStringField(value, "outcome"),
    ),
  };
}

function normalizeGuiSmokeVerificationSummary(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    status: readOptionalStringField(value, "status"),
    exit_code: readOptionalNumberField(value, "exitCode", "exit_code"),
    passed: readOptionalBooleanField(value, "passed") ?? false,
    updated_at: readOptionalStringField(value, "updatedAt", "updated_at"),
    has_output_preview:
      readOptionalBooleanField(
        value,
        "hasOutputPreview",
        "has_output_preview",
      ) ?? false,
    outcome: normalizeEvidenceVerificationOutcome(
      readOptionalStringField(value, "outcome"),
    ),
  };
}

function normalizeEvidenceObservabilityVerificationOutcomes(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    blocking_failure: readStringListField(
      value,
      "blockingFailure",
      "blocking_failure",
    ),
    advisory_failure: readStringListField(
      value,
      "advisoryFailure",
      "advisory_failure",
    ),
    recovered: readStringListField(value, "recovered"),
  };
}

function normalizeEvidenceVerificationSummary(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    artifact_validator: normalizeArtifactValidatorVerificationSummary(
      readRecordField(value, "artifactValidator", "artifact_validator"),
    ),
    browser_verification: normalizeBrowserVerificationSummary(
      readRecordField(value, "browserVerification", "browser_verification"),
    ),
    gui_smoke: normalizeGuiSmokeVerificationSummary(
      readRecordField(value, "guiSmoke", "gui_smoke"),
    ),
    observability_verification_outcomes:
      normalizeEvidenceObservabilityVerificationOutcomes(
        readRecordField(
          value,
          "observabilityVerificationOutcomes",
          "observability_verification_outcomes",
        ),
      ),
    focus_verification_failure_outcomes: readStringListField(
      value,
      "focusVerificationFailureOutcomes",
      "focus_verification_failure_outcomes",
    ),
    focus_verification_recovered_outcomes: readStringListField(
      value,
      "focusVerificationRecoveredOutcomes",
      "focus_verification_recovered_outcomes",
    ),
  };
}

function normalizeEvidenceObservabilitySummary(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }

  const rawSignalCoverage = value.signalCoverage ?? value.signal_coverage;
  const signalCoverage = Array.isArray(rawSignalCoverage)
    ? rawSignalCoverage
        .map((entry: unknown) => normalizeEvidenceSignalCoverageEntry(entry))
        .filter(
          (
            entry,
          ): entry is NonNullable<
            ReturnType<typeof normalizeEvidenceSignalCoverageEntry>
          > => entry !== null,
        )
    : [];
  const verificationSummary = normalizeEvidenceVerificationSummary(
    value.verificationSummary ?? value.verification_summary,
  );
  const schemaVersion = readOptionalStringField(
    value,
    "schemaVersion",
    "schema_version",
  );
  const knownGaps = readStringListField(value, "knownGaps", "known_gaps");
  const modalityRuntimeContracts = normalizeEvidenceModalityRuntimeContracts(
    readRecordField(
      value,
      "modalityRuntimeContracts",
      "modality_runtime_contracts",
    ),
  );

  if (
    !schemaVersion &&
    signalCoverage.length === 0 &&
    knownGaps.length === 0 &&
    !verificationSummary &&
    !modalityRuntimeContracts
  ) {
    return undefined;
  }

  return {
    schema_version: schemaVersion,
    known_gaps: knownGaps,
    signal_coverage: signalCoverage,
    verification_summary: verificationSummary,
    modality_runtime_contracts: modalityRuntimeContracts,
  };
}

function normalizeAnalysisArtifact(
  value: unknown,
): AgentRuntimeAnalysisArtifact | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    kind:
      readStringField(value, "kind") === "analysis_context"
        ? "analysis_context"
        : "analysis_brief",
    title: readStringField(value, "title"),
    relative_path: readStringField(value, "relativePath", "relative_path"),
    absolute_path: readStringField(value, "absolutePath", "absolute_path"),
    bytes: readNumberField(value, "bytes"),
  };
}

function normalizeHandoffArtifact(
  value: unknown,
): AgentRuntimeHandoffArtifact | null {
  if (!isRecord(value)) {
    return null;
  }

  const kind = readStringField(value, "kind");

  return {
    kind:
      kind === "progress"
        ? "progress"
        : kind === "handoff"
          ? "handoff"
          : kind === "review_summary"
            ? "review_summary"
            : "plan",
    title: readStringField(value, "title"),
    relative_path: readStringField(value, "relativePath", "relative_path"),
    absolute_path: readStringField(value, "absolutePath", "absolute_path"),
    bytes: readNumberField(value, "bytes"),
  };
}

function normalizeEvidenceArtifact(
  value: unknown,
): AgentRuntimeEvidenceArtifact | null {
  if (!isRecord(value)) {
    return null;
  }

  const kind = readStringField(value, "kind");

  return {
    kind:
      kind === "runtime"
        ? "runtime"
        : kind === "timeline"
          ? "timeline"
          : kind === "artifacts"
            ? "artifacts"
            : "summary",
    title: readStringField(value, "title"),
    relative_path: readStringField(value, "relativePath", "relative_path"),
    absolute_path: readStringField(value, "absolutePath", "absolute_path"),
    bytes: readNumberField(value, "bytes"),
  };
}

function normalizeReplayArtifact(
  value: unknown,
): AgentRuntimeReplayArtifact | null {
  if (!isRecord(value)) {
    return null;
  }

  const kind = readStringField(value, "kind");

  return {
    kind:
      kind === "expected"
        ? "expected"
        : kind === "grader"
          ? "grader"
          : kind === "evidence_links"
            ? "evidence_links"
            : "input",
    title: readStringField(value, "title"),
    relative_path: readStringField(value, "relativePath", "relative_path"),
    absolute_path: readStringField(value, "absolutePath", "absolute_path"),
    bytes: readNumberField(value, "bytes"),
  };
}

function normalizeReviewDecisionArtifact(
  value: unknown,
): AgentRuntimeReviewDecisionArtifact | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    kind:
      readStringField(value, "kind") === "review_decision_json"
        ? "review_decision_json"
        : "review_decision_markdown",
    title: readStringField(value, "title"),
    relative_path: readStringField(value, "relativePath", "relative_path"),
    absolute_path: readStringField(value, "absolutePath", "absolute_path"),
    bytes: readNumberField(value, "bytes"),
  };
}

function normalizeCompletionAuditRequiredEvidence(
  value: unknown,
): AgentRuntimeCompletionAuditRequiredEvidence {
  const record = isRecord(value) ? value : {};
  return {
    automation_owner:
      readOptionalBooleanField(record, "automationOwner", "automation_owner") ??
      false,
    workspace_skill_tool_call:
      readOptionalBooleanField(
        record,
        "workspaceSkillToolCall",
        "workspace_skill_tool_call",
      ) ?? false,
    artifact_or_timeline:
      readOptionalBooleanField(
        record,
        "artifactOrTimeline",
        "artifact_or_timeline",
      ) ?? false,
    controlled_get_evidence:
      readOptionalBooleanField(
        record,
        "controlledGetEvidence",
        "controlled_get_evidence",
      ) ?? false,
  };
}

function normalizeCompletionAuditSummary(
  value: unknown,
): AgentRuntimeCompletionAuditSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    source: readStringField(value, "source"),
    decision: readStringField(value, "decision"),
    owner_run_count: readNumberField(value, "ownerRunCount", "owner_run_count"),
    successful_owner_run_count: readNumberField(
      value,
      "successfulOwnerRunCount",
      "successful_owner_run_count",
    ),
    workspace_skill_tool_call_count: readNumberField(
      value,
      "workspaceSkillToolCallCount",
      "workspace_skill_tool_call_count",
    ),
    artifact_count: readNumberField(value, "artifactCount", "artifact_count"),
    controlled_get_evidence_artifact_count: readNumberField(
      value,
      "controlledGetEvidenceArtifactCount",
      "controlled_get_evidence_artifact_count",
    ),
    controlled_get_evidence_executed_count: readNumberField(
      value,
      "controlledGetEvidenceExecutedCount",
      "controlled_get_evidence_executed_count",
    ),
    controlled_get_evidence_scanned_artifact_count: readNumberField(
      value,
      "controlledGetEvidenceScannedArtifactCount",
      "controlled_get_evidence_scanned_artifact_count",
    ),
    controlled_get_evidence_skipped_unsafe_artifact_count: readNumberField(
      value,
      "controlledGetEvidenceSkippedUnsafeArtifactCount",
      "controlled_get_evidence_skipped_unsafe_artifact_count",
    ),
    controlled_get_evidence_status_counts: readNumberMapField(
      value,
      "controlledGetEvidenceStatusCounts",
      "controlled_get_evidence_status_counts",
    ),
    controlled_get_evidence_required:
      readOptionalBooleanField(
        value,
        "controlledGetEvidenceRequired",
        "controlled_get_evidence_required",
      ) ?? false,
    owner_audit_statuses: readStringListField(
      value,
      "ownerAuditStatuses",
      "owner_audit_statuses",
    ),
    required_evidence: normalizeCompletionAuditRequiredEvidence(
      value.requiredEvidence ?? value.required_evidence,
    ),
    blocking_reasons: readStringListField(
      value,
      "blockingReasons",
      "blocking_reasons",
    ),
    notes: readStringListField(value, "notes"),
  };
}

function normalizeReviewDecisionStatus(
  value: string,
): AgentRuntimeReviewDecisionStatus {
  switch (value) {
    case "accepted":
    case "deferred":
    case "rejected":
    case "needs_more_evidence":
    case "pending_review":
      return value;
    default:
      return "pending_review";
  }
}

function normalizeReviewDecisionRiskLevel(
  value: string,
): AgentRuntimeReviewDecisionRiskLevel {
  switch (value) {
    case "low":
    case "medium":
    case "high":
    case "unknown":
      return value;
    default:
      return "unknown";
  }
}

function normalizeReviewDecision(value: unknown): AgentRuntimeReviewDecision {
  const record = isRecord(value) ? value : {};

  return {
    decision_status: normalizeReviewDecisionStatus(
      readStringField(record, "decisionStatus", "decision_status"),
    ),
    decision_summary: readStringField(
      record,
      "decisionSummary",
      "decision_summary",
    ),
    chosen_fix_strategy: readStringField(
      record,
      "chosenFixStrategy",
      "chosen_fix_strategy",
    ),
    risk_level: normalizeReviewDecisionRiskLevel(
      readStringField(record, "riskLevel", "risk_level"),
    ),
    risk_tags: readStringListField(record, "riskTags", "risk_tags"),
    human_reviewer: readStringField(record, "humanReviewer", "human_reviewer"),
    reviewed_at: readOptionalStringField(record, "reviewedAt", "reviewed_at"),
    followup_actions: readStringListField(
      record,
      "followupActions",
      "followup_actions",
    ),
    regression_requirements: readStringListField(
      record,
      "regressionRequirements",
      "regression_requirements",
    ),
    notes: readStringField(record, "notes"),
  };
}

export function normalizeSubagentSessionInfo(
  session: AsterSubagentSessionInfo,
): AsterSubagentSessionInfo {
  return {
    ...session,
    origin_tool: normalizeLegacyToolSurfaceName(session.origin_tool),
  };
}

export function normalizeSubagentParentContext(
  context?: AsterSubagentParentContext | null,
): AsterSubagentParentContext | undefined {
  if (!context) {
    return undefined;
  }

  return {
    ...context,
    origin_tool: normalizeLegacyToolSurfaceName(context.origin_tool),
    sibling_subagent_sessions: Array.isArray(context.sibling_subagent_sessions)
      ? context.sibling_subagent_sessions.map(normalizeSubagentSessionInfo)
      : context.sibling_subagent_sessions,
  };
}

export function normalizeAnalysisHandoff(
  value: unknown,
): AgentRuntimeAnalysisHandoff {
  const record = isRecord(value) ? value : {};
  const rawArtifacts = Array.isArray(record.artifacts) ? record.artifacts : [];

  return {
    session_id: readStringField(record, "sessionId", "session_id"),
    thread_id: readStringField(record, "threadId", "thread_id"),
    workspace_id: readOptionalStringField(
      record,
      "workspaceId",
      "workspace_id",
    ),
    workspace_root: readStringField(record, "workspaceRoot", "workspace_root"),
    analysis_relative_root: readStringField(
      record,
      "analysisRelativeRoot",
      "analysis_relative_root",
    ),
    analysis_absolute_root: readStringField(
      record,
      "analysisAbsoluteRoot",
      "analysis_absolute_root",
    ),
    handoff_bundle_relative_root: readStringField(
      record,
      "handoffBundleRelativeRoot",
      "handoff_bundle_relative_root",
    ),
    evidence_pack_relative_root: readStringField(
      record,
      "evidencePackRelativeRoot",
      "evidence_pack_relative_root",
    ),
    replay_case_relative_root: readStringField(
      record,
      "replayCaseRelativeRoot",
      "replay_case_relative_root",
    ),
    exported_at: readStringField(record, "exportedAt", "exported_at"),
    title: readStringField(record, "title"),
    thread_status: readStringField(record, "threadStatus", "thread_status"),
    latest_turn_status: readOptionalStringField(
      record,
      "latestTurnStatus",
      "latest_turn_status",
    ),
    pending_request_count: readNumberField(
      record,
      "pendingRequestCount",
      "pending_request_count",
    ),
    queued_turn_count: readNumberField(
      record,
      "queuedTurnCount",
      "queued_turn_count",
    ),
    sanitized_workspace_root: readStringField(
      record,
      "sanitizedWorkspaceRoot",
      "sanitized_workspace_root",
    ),
    copy_prompt: readStringField(record, "copyPrompt", "copy_prompt"),
    artifacts: rawArtifacts
      .map((artifact) => normalizeAnalysisArtifact(artifact))
      .filter(Boolean) as AgentRuntimeAnalysisArtifact[],
  };
}

export function normalizeHandoffBundle(
  value: unknown,
): AgentRuntimeHandoffBundle {
  const record = isRecord(value) ? value : {};
  const rawArtifacts = Array.isArray(record.artifacts) ? record.artifacts : [];

  return {
    session_id: readStringField(record, "sessionId", "session_id"),
    thread_id: readStringField(record, "threadId", "thread_id"),
    workspace_id: readOptionalStringField(
      record,
      "workspaceId",
      "workspace_id",
    ),
    workspace_root: readStringField(record, "workspaceRoot", "workspace_root"),
    bundle_relative_root: readStringField(
      record,
      "bundleRelativeRoot",
      "bundle_relative_root",
    ),
    bundle_absolute_root: readStringField(
      record,
      "bundleAbsoluteRoot",
      "bundle_absolute_root",
    ),
    exported_at: readStringField(record, "exportedAt", "exported_at"),
    thread_status: readStringField(record, "threadStatus", "thread_status"),
    latest_turn_status: readOptionalStringField(
      record,
      "latestTurnStatus",
      "latest_turn_status",
    ),
    pending_request_count: readNumberField(
      record,
      "pendingRequestCount",
      "pending_request_count",
    ),
    queued_turn_count: readNumberField(
      record,
      "queuedTurnCount",
      "queued_turn_count",
    ),
    active_subagent_count: readNumberField(
      record,
      "activeSubagentCount",
      "active_subagent_count",
    ),
    todo_total: readNumberField(record, "todoTotal", "todo_total"),
    todo_pending: readNumberField(record, "todoPending", "todo_pending"),
    todo_in_progress: readNumberField(
      record,
      "todoInProgress",
      "todo_in_progress",
    ),
    todo_completed: readNumberField(record, "todoCompleted", "todo_completed"),
    artifacts: rawArtifacts
      .map((artifact) => normalizeHandoffArtifact(artifact))
      .filter(Boolean) as AgentRuntimeHandoffArtifact[],
  };
}

export function normalizeEvidencePack(
  value: unknown,
): AgentRuntimeEvidencePack {
  const record = isRecord(value) ? value : {};
  const rawArtifacts = Array.isArray(record.artifacts) ? record.artifacts : [];

  return {
    session_id: readStringField(record, "sessionId", "session_id"),
    thread_id: readStringField(record, "threadId", "thread_id"),
    workspace_id: readOptionalStringField(
      record,
      "workspaceId",
      "workspace_id",
    ),
    workspace_root: readStringField(record, "workspaceRoot", "workspace_root"),
    pack_relative_root: readStringField(
      record,
      "packRelativeRoot",
      "pack_relative_root",
    ),
    pack_absolute_root: readStringField(
      record,
      "packAbsoluteRoot",
      "pack_absolute_root",
    ),
    exported_at: readStringField(record, "exportedAt", "exported_at"),
    thread_status: readStringField(record, "threadStatus", "thread_status"),
    latest_turn_status: readOptionalStringField(
      record,
      "latestTurnStatus",
      "latest_turn_status",
    ),
    turn_count: readNumberField(record, "turnCount", "turn_count"),
    item_count: readNumberField(record, "itemCount", "item_count"),
    pending_request_count: readNumberField(
      record,
      "pendingRequestCount",
      "pending_request_count",
    ),
    queued_turn_count: readNumberField(
      record,
      "queuedTurnCount",
      "queued_turn_count",
    ),
    recent_artifact_count: readNumberField(
      record,
      "recentArtifactCount",
      "recent_artifact_count",
    ),
    known_gaps: readStringListField(record, "knownGaps", "known_gaps"),
    observability_summary: normalizeEvidenceObservabilitySummary(
      record.observabilitySummary ?? record.observability_summary,
    ),
    completion_audit_summary: normalizeCompletionAuditSummary(
      record.completionAuditSummary ?? record.completion_audit_summary,
    ),
    artifacts: rawArtifacts
      .map((artifact) => normalizeEvidenceArtifact(artifact))
      .filter(Boolean) as AgentRuntimeEvidenceArtifact[],
  };
}

export function normalizeReplayCase(value: unknown): AgentRuntimeReplayCase {
  const record = isRecord(value) ? value : {};
  const rawArtifacts = Array.isArray(record.artifacts) ? record.artifacts : [];

  return {
    session_id: readStringField(record, "sessionId", "session_id"),
    thread_id: readStringField(record, "threadId", "thread_id"),
    workspace_id: readOptionalStringField(
      record,
      "workspaceId",
      "workspace_id",
    ),
    workspace_root: readStringField(record, "workspaceRoot", "workspace_root"),
    replay_relative_root: readStringField(
      record,
      "replayRelativeRoot",
      "replay_relative_root",
    ),
    replay_absolute_root: readStringField(
      record,
      "replayAbsoluteRoot",
      "replay_absolute_root",
    ),
    handoff_bundle_relative_root: readStringField(
      record,
      "handoffBundleRelativeRoot",
      "handoff_bundle_relative_root",
    ),
    evidence_pack_relative_root: readStringField(
      record,
      "evidencePackRelativeRoot",
      "evidence_pack_relative_root",
    ),
    exported_at: readStringField(record, "exportedAt", "exported_at"),
    thread_status: readStringField(record, "threadStatus", "thread_status"),
    latest_turn_status: readOptionalStringField(
      record,
      "latestTurnStatus",
      "latest_turn_status",
    ),
    pending_request_count: readNumberField(
      record,
      "pendingRequestCount",
      "pending_request_count",
    ),
    queued_turn_count: readNumberField(
      record,
      "queuedTurnCount",
      "queued_turn_count",
    ),
    linked_handoff_artifact_count: readNumberField(
      record,
      "linkedHandoffArtifactCount",
      "linked_handoff_artifact_count",
    ),
    linked_evidence_artifact_count: readNumberField(
      record,
      "linkedEvidenceArtifactCount",
      "linked_evidence_artifact_count",
    ),
    recent_artifact_count: readNumberField(
      record,
      "recentArtifactCount",
      "recent_artifact_count",
    ),
    artifacts: rawArtifacts
      .map((artifact) => normalizeReplayArtifact(artifact))
      .filter(Boolean) as AgentRuntimeReplayArtifact[],
  };
}

export function normalizeReviewDecisionTemplate(
  value: unknown,
): AgentRuntimeReviewDecisionTemplate {
  const record = isRecord(value) ? value : {};
  const rawArtifacts = Array.isArray(record.artifacts) ? record.artifacts : [];
  const rawAnalysisArtifacts = Array.isArray(record.analysisArtifacts)
    ? record.analysisArtifacts
    : Array.isArray(record.analysis_artifacts)
      ? record.analysis_artifacts
      : [];

  return {
    session_id: readStringField(record, "sessionId", "session_id"),
    thread_id: readStringField(record, "threadId", "thread_id"),
    workspace_id: readOptionalStringField(
      record,
      "workspaceId",
      "workspace_id",
    ),
    workspace_root: readStringField(record, "workspaceRoot", "workspace_root"),
    review_relative_root: readStringField(
      record,
      "reviewRelativeRoot",
      "review_relative_root",
    ),
    review_absolute_root: readStringField(
      record,
      "reviewAbsoluteRoot",
      "review_absolute_root",
    ),
    analysis_relative_root: readStringField(
      record,
      "analysisRelativeRoot",
      "analysis_relative_root",
    ),
    analysis_absolute_root: readStringField(
      record,
      "analysisAbsoluteRoot",
      "analysis_absolute_root",
    ),
    handoff_bundle_relative_root: readStringField(
      record,
      "handoffBundleRelativeRoot",
      "handoff_bundle_relative_root",
    ),
    evidence_pack_relative_root: readStringField(
      record,
      "evidencePackRelativeRoot",
      "evidence_pack_relative_root",
    ),
    replay_case_relative_root: readStringField(
      record,
      "replayCaseRelativeRoot",
      "replay_case_relative_root",
    ),
    exported_at: readStringField(record, "exportedAt", "exported_at"),
    title: readStringField(record, "title"),
    thread_status: readStringField(record, "threadStatus", "thread_status"),
    latest_turn_status: readOptionalStringField(
      record,
      "latestTurnStatus",
      "latest_turn_status",
    ),
    pending_request_count: readNumberField(
      record,
      "pendingRequestCount",
      "pending_request_count",
    ),
    queued_turn_count: readNumberField(
      record,
      "queuedTurnCount",
      "queued_turn_count",
    ),
    default_decision_status: readStringField(
      record,
      "defaultDecisionStatus",
      "default_decision_status",
    ),
    verification_summary: normalizeEvidenceVerificationSummary(
      record.verificationSummary ?? record.verification_summary,
    ),
    limit_status: readOptionalStringField(
      record,
      "limitStatus",
      "limit_status",
    ),
    capability_gap: readOptionalStringField(
      record,
      "capabilityGap",
      "capability_gap",
    ),
    user_locked_capability_summary: readOptionalStringField(
      record,
      "userLockedCapabilitySummary",
      "user_locked_capability_summary",
    ),
    permission_status: readOptionalStringField(
      record,
      "permissionStatus",
      "permission_status",
    ),
    permission_confirmation_status: readOptionalStringField(
      record,
      "permissionConfirmationStatus",
      "permission_confirmation_status",
    ),
    permission_confirmation_request_id: readOptionalStringField(
      record,
      "permissionConfirmationRequestId",
      "permission_confirmation_request_id",
    ),
    permission_confirmation_source: readOptionalStringField(
      record,
      "permissionConfirmationSource",
      "permission_confirmation_source",
    ),
    permission_confirmation_summary: readOptionalStringField(
      record,
      "permissionConfirmationSummary",
      "permission_confirmation_summary",
    ),
    decision: normalizeReviewDecision(record.decision),
    decision_status_options: readStringListField(
      record,
      "decisionStatusOptions",
      "decision_status_options",
    ).map((status) => normalizeReviewDecisionStatus(status)),
    risk_level_options: readStringListField(
      record,
      "riskLevelOptions",
      "risk_level_options",
    ).map((riskLevel) => normalizeReviewDecisionRiskLevel(riskLevel)),
    review_checklist: readStringListField(
      record,
      "reviewChecklist",
      "review_checklist",
    ),
    analysis_artifacts: rawAnalysisArtifacts
      .map((artifact) => normalizeAnalysisArtifact(artifact))
      .filter(Boolean) as AgentRuntimeAnalysisArtifact[],
    artifacts: rawArtifacts
      .map((artifact) => normalizeReviewDecisionArtifact(artifact))
      .filter(Boolean) as AgentRuntimeReviewDecisionArtifact[],
  };
}

export function normalizeThreadReadModel(
  threadRead?: AgentRuntimeThreadReadModel | null,
): AgentRuntimeThreadReadModel | null | undefined {
  if (!threadRead) {
    return threadRead;
  }

  return {
    ...threadRead,
    queued_turns: normalizeQueuedTurnSnapshots(threadRead.queued_turns),
  };
}
