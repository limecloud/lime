import type {
  ImageCommandNextAction,
  ImageCommandRunSnapshot,
  ImageCommandRunStep,
  ImageGenerationBranch,
  ImageRuntimeContractSnapshot,
  ImageStoryboardSlot,
  MessageImageWorkbenchPreview,
} from "../types";
import { sanitizeImageWorkbenchPresentationText } from "../utils/imageWorkbenchPresentation";

const IMAGE_GENERATION_CONTRACT_KEY = "image_generation";
const IMAGE_GENERATION_CONTRACT_ROUTING_FAILURE_CODES = new Set([
  "image_generation_contract_mismatch",
  "image_generation_capability_gap",
  "image_generation_routing_slot_mismatch",
  "image_generation_model_capability_gap",
]);

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function readString(
  candidates: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
): string | undefined {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    for (const key of keys) {
      const value = candidate[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return undefined;
}

export function readImageTaskPresentationText(
  candidates: Array<Record<string, unknown> | null | undefined>,
  languageSource?: string | null,
): string | undefined {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const presentation = asRecord(candidate.presentation) || candidate;
    const value = readString(
      [presentation],
      [
        "assistant_intro",
        "assistantIntro",
        "opening_text",
        "openingText",
        "intro",
      ],
    );
    if (value) {
      return sanitizeImageWorkbenchPresentationText(value, { languageSource });
    }
  }
  return undefined;
}

function readNestedPresentationCaption(
  presentation: Record<string, unknown> | null | undefined,
  status: MessageImageWorkbenchPreview["status"],
  languageSource?: string | null,
): string | undefined {
  if (!presentation) {
    return undefined;
  }

  const resultCaptions = asRecord(presentation.result_captions);
  const statusSpecificKeys: string[] = (() => {
    switch (status) {
      case "complete":
        return ["completion_caption", "completionCaption", "complete"];
      case "partial":
        return ["partial_caption", "partialCaption", "partial"];
      case "failed":
        return [
          "failed_caption",
          "failedCaption",
          "failure_caption",
          "failureCaption",
          "failed",
          "failure",
        ];
      case "cancelled":
        return ["cancelled_caption", "cancelledCaption", "cancelled"];
      case "running":
      default:
        return [];
    }
  })();

  return sanitizeImageWorkbenchPresentationText(
    readString(
      [presentation, resultCaptions],
      [...statusSpecificKeys, "result_caption", "resultCaption"],
    ),
    { languageSource },
  );
}

export function readImageTaskPresentationCaption(
  candidates: Array<Record<string, unknown> | null | undefined>,
  status: MessageImageWorkbenchPreview["status"],
  languageSource?: string | null,
): string | undefined {
  if (status === "running") {
    return undefined;
  }

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const value = readNestedPresentationCaption(
      asRecord(candidate.presentation) || candidate,
      status,
      languageSource,
    );
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function readPositiveNumber(
  candidates: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
): number | undefined {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    for (const key of keys) {
      const value = candidate[key];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return value;
      }
      if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
          return parsed;
        }
      }
    }
  }
  return undefined;
}

export function readBoolean(
  candidates: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
): boolean | undefined {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    for (const key of keys) {
      const value = candidate[key];
      if (typeof value === "boolean") {
        return value;
      }
      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true") {
          return true;
        }
        if (normalized === "false") {
          return false;
        }
      }
    }
  }
  return undefined;
}

export function readStringArray(
  candidates: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
): string[] {
  const values: string[] = [];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    for (const key of keys) {
      const value = candidate[key];
      if (!Array.isArray(value)) {
        continue;
      }
      for (const item of value) {
        if (typeof item !== "string") {
          continue;
        }
        const trimmed = item.trim();
        if (!trimmed || values.includes(trimmed)) {
          continue;
        }
        values.push(trimmed);
      }
      if (values.length > 0) {
        return values;
      }
    }
  }
  return values;
}

function readRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
}

function normalizeRunStatus(value?: string): ImageCommandRunSnapshot["status"] {
  switch (value?.trim()) {
    case "requires_parameters":
    case "queued":
    case "running":
    case "succeeded":
    case "partial":
    case "failed":
      return value.trim() as ImageCommandRunSnapshot["status"];
    default:
      return "queued";
  }
}

function normalizeRunStepStatus(value?: string): ImageCommandRunStep["status"] {
  switch (value?.trim()) {
    case "pending":
    case "running":
    case "succeeded":
    case "failed":
      return value.trim() as ImageCommandRunStep["status"];
    default:
      return "pending";
  }
}

function normalizeBranchStatus(
  value?: string,
): ImageGenerationBranch["status"] {
  switch (value?.trim()) {
    case "queued":
    case "running":
    case "succeeded":
    case "failed":
    case "retryable":
      return value.trim() as ImageGenerationBranch["status"];
    default:
      return "queued";
  }
}

function readImageCommandRunSteps(
  records: Record<string, unknown>[],
): ImageCommandRunStep[] {
  return records
    .map((record): ImageCommandRunStep | null => {
      const id = readString([record], ["id", "step_id", "stepId"]);
      const title = readString([record], ["title"]);
      if (!id || !title) {
        return null;
      }
      return {
        id,
        title,
        status: normalizeRunStepStatus(readString([record], ["status"])),
        detail: readString([record], ["detail"]) || null,
      };
    })
    .filter((step): step is ImageCommandRunStep => Boolean(step));
}

function readImageGenerationBranches(
  records: Record<string, unknown>[],
): ImageGenerationBranch[] {
  return records
    .map((record): ImageGenerationBranch | null => {
      const branchId = readString([record], ["branch_id", "branchId", "id"]);
      const title = readString([record], ["title"]);
      const prompt = readString([record], ["prompt"]);
      if (!branchId || !title || !prompt) {
        return null;
      }
      return {
        branchId,
        title,
        prompt,
        taskId: readString([record], ["task_id", "taskId"]) || null,
        artifactPath:
          readString([record], ["artifact_path", "artifactPath"]) || null,
        status: normalizeBranchStatus(readString([record], ["status"])),
        previewUrl:
          readString([record], ["preview_url", "previewUrl", "image_url"]) ||
          null,
        failureReason:
          readString([record], ["failure_reason", "failureReason"]) || null,
        slotId: readString([record], ["slot_id", "slotId"]) || null,
        shotType: readString([record], ["shot_type", "shotType"]) || null,
      };
    })
    .filter((branch): branch is ImageGenerationBranch => Boolean(branch));
}

function readImageCommandNextActions(
  records: Record<string, unknown>[],
): ImageCommandNextAction[] {
  return records
    .map((record): ImageCommandNextAction | null => {
      const type = readString([record], ["type"]);
      switch (type) {
        case "retry_branch": {
          const branchId = readString([record], ["branch_id", "branchId"]);
          return branchId ? { type, branchId } : null;
        }
        case "generate_more":
          return {
            type,
            branchId: readString([record], ["branch_id", "branchId"]) || null,
          };
        case "open_workbench":
          return {
            type,
            taskId: readString([record], ["task_id", "taskId"]) || null,
          };
        case "apply_to_document": {
          const slotId = readString([record], ["slot_id", "slotId"]);
          return slotId ? { type, slotId } : null;
        }
        default:
          return null;
      }
    })
    .filter((action): action is ImageCommandNextAction => Boolean(action));
}

export function readImageCommandRunSnapshot(
  candidates: Array<Record<string, unknown> | null | undefined>,
): ImageCommandRunSnapshot | null {
  for (const candidate of candidates) {
    const record =
      asRecord(candidate?.image_command_run) ||
      asRecord(candidate?.imageCommandRun);
    if (!record) {
      continue;
    }
    const runId = readString([record], ["run_id", "runId"]);
    const title = readString([record], ["title"]);
    const summary = readString([record], ["summary"]);
    const requestedCount = readPositiveNumber(
      [record],
      ["requested_count", "requestedCount"],
    );
    const steps = readImageCommandRunSteps(readRecordArray(record.steps));
    const branches = readImageGenerationBranches(
      readRecordArray(record.branches),
    );
    if (!runId || !title || !summary || !requestedCount) {
      continue;
    }
    return {
      runId,
      sessionId: readString([record], ["session_id", "sessionId"]) || null,
      threadId: readString([record], ["thread_id", "threadId"]) || null,
      turnId: readString([record], ["turn_id", "turnId"]) || null,
      workflowKey:
        readString([record], ["workflow_key", "workflowKey"]) || null,
      title,
      summary,
      requestedCount,
      status: normalizeRunStatus(readString([record], ["status"])),
      steps,
      branches,
      nextActions: readImageCommandNextActions(
        readRecordArray(record.next_actions).length > 0
          ? readRecordArray(record.next_actions)
          : readRecordArray(record.nextActions),
      ),
    };
  }
  return null;
}

function isImageGenerationContractRoutingFailureCode(
  value?: string | null,
): boolean {
  return Boolean(
    value && IMAGE_GENERATION_CONTRACT_ROUTING_FAILURE_CODES.has(value.trim()),
  );
}

export function resolveImageRuntimeContractSnapshot(params: {
  taskRecord: Record<string, unknown>;
  normalizedStatus: string;
}): ImageRuntimeContractSnapshot | null {
  const payload = asRecord(params.taskRecord.payload);
  const runtimeContract = asRecord(payload?.runtime_contract);
  const limecorePolicySnapshot =
    asRecord(runtimeContract?.limecore_policy_snapshot) ||
    asRecord(runtimeContract?.limecorePolicySnapshot) ||
    asRecord(payload?.limecore_policy_snapshot) ||
    asRecord(payload?.limecorePolicySnapshot);
  const limecorePolicyEvaluation =
    asRecord(limecorePolicySnapshot?.policy_evaluation) ||
    asRecord(limecorePolicySnapshot?.policyEvaluation);
  const modelCapabilityAssessment = asRecord(
    payload?.model_capability_assessment,
  );
  const lastErrorRecord = asRecord(params.taskRecord.last_error);
  const failureCode = readString([lastErrorRecord], ["code"]);
  const requiredCapabilities = readStringArray(
    [payload],
    ["required_capabilities", "requiredCapabilities"],
  );
  const contractKey =
    readString([payload], ["modality_contract_key", "modalityContractKey"]) ||
    readString([runtimeContract], ["contract_key", "contractKey"]) ||
    null;
  const routingSlot =
    readString([payload, runtimeContract], ["routing_slot", "routingSlot"]) ||
    null;
  const modelCapabilityAssessmentSource =
    readString([modelCapabilityAssessment], ["source"]) || null;
  const hasRuntimeContractSignal = Boolean(
    contractKey ||
    routingSlot ||
    requiredCapabilities.includes(IMAGE_GENERATION_CONTRACT_KEY) ||
    modelCapabilityAssessmentSource ||
    isImageGenerationContractRoutingFailureCode(failureCode),
  );

  if (!hasRuntimeContractSignal) {
    return null;
  }

  const isRoutingBlocked =
    isImageGenerationContractRoutingFailureCode(failureCode);
  const routingOutcome = isRoutingBlocked
    ? "blocked"
    : params.normalizedStatus === "failed"
      ? "failed"
      : "accepted";

  return {
    contractKey,
    routingSlot,
    providerId:
      readString(
        [payload, modelCapabilityAssessment],
        ["provider_id", "providerId"],
      ) || null,
    model:
      readString(
        [payload, modelCapabilityAssessment],
        ["model", "model_id", "modelId"],
      ) || null,
    routingEvent: isRoutingBlocked
      ? "routing_not_possible"
      : "model_routing_decision",
    routingOutcome,
    failureCode: failureCode || null,
    modelCapabilityAssessmentSource,
    modelSupportsImageGeneration:
      readBoolean(
        [modelCapabilityAssessment],
        ["supports_image_generation", "supportsImageGeneration"],
      ) ?? null,
    limecorePolicySnapshotStatus:
      readString([limecorePolicySnapshot], ["status"]) || null,
    limecorePolicyDecision:
      readString([limecorePolicySnapshot], ["decision"]) || null,
    limecorePolicyDecisionSource:
      readString(
        [limecorePolicySnapshot],
        ["decision_source", "decisionSource"],
      ) || null,
    limecorePolicyDecisionScope:
      readString(
        [limecorePolicySnapshot],
        ["decision_scope", "decisionScope"],
      ) || null,
    limecorePolicyDecisionReason:
      readString(
        [limecorePolicySnapshot],
        ["decision_reason", "decisionReason"],
      ) || null,
    limecorePolicyMissingInputs: readStringArray(
      [limecorePolicySnapshot],
      ["missing_inputs", "missingInputs"],
    ),
    limecorePolicyPendingHitRefs: readStringArray(
      [limecorePolicySnapshot],
      ["pending_hit_refs", "pendingHitRefs"],
    ),
    limecorePolicyEvaluationStatus:
      readString([limecorePolicyEvaluation], ["status"]) || null,
    limecorePolicyEvaluationDecision:
      readString([limecorePolicyEvaluation], ["decision"]) || null,
    limecorePolicyEvaluationDecisionSource:
      readString(
        [limecorePolicyEvaluation],
        ["decision_source", "decisionSource"],
      ) || null,
    limecorePolicyEvaluationDecisionScope:
      readString(
        [limecorePolicyEvaluation],
        ["decision_scope", "decisionScope"],
      ) || null,
    limecorePolicyEvaluationDecisionReason:
      readString(
        [limecorePolicyEvaluation],
        ["decision_reason", "decisionReason"],
      ) || null,
    limecorePolicyEvaluationBlockingRefs: readStringArray(
      [limecorePolicyEvaluation],
      ["blocking_refs", "blockingRefs"],
    ),
    limecorePolicyEvaluationAskRefs: readStringArray(
      [limecorePolicyEvaluation],
      ["ask_refs", "askRefs"],
    ),
    limecorePolicyEvaluationPendingRefs: readStringArray(
      [limecorePolicyEvaluation],
      ["pending_refs", "pendingRefs"],
    ),
  };
}

function sanitizeStoryboardSlotText(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function buildNormalizedStoryboardSlot(params: {
  slotIndex: number;
  slotId?: string | null;
  label?: string | null;
  prompt?: string | null;
  shotType?: string | null;
  status?: string | null;
}): ImageStoryboardSlot | null {
  if (!Number.isFinite(params.slotIndex) || params.slotIndex <= 0) {
    return null;
  }

  return {
    slotId:
      sanitizeStoryboardSlotText(params.slotId) ||
      `storyboard-slot-${params.slotIndex}`,
    slotIndex: Math.trunc(params.slotIndex),
    label: sanitizeStoryboardSlotText(params.label),
    prompt: sanitizeStoryboardSlotText(params.prompt),
    shotType: sanitizeStoryboardSlotText(params.shotType),
    status: sanitizeStoryboardSlotText(params.status),
  };
}

export function readStoryboardSlotsFromUnknown(
  value: unknown,
): ImageStoryboardSlot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index) => {
      const record = asRecord(item);
      if (!record) {
        return null;
      }

      const slotIndex =
        readPositiveNumber([record], ["slot_index", "slotIndex"]) || index + 1;
      return buildNormalizedStoryboardSlot({
        slotIndex,
        slotId: readString([record], ["slot_id", "slotId"]),
        label: readString([record], ["label", "slot_label", "slotLabel"]),
        prompt: readString(
          [record],
          ["prompt", "slot_prompt", "slotPrompt", "revised_prompt"],
        ),
        shotType: readString([record], ["shot_type", "shotType"]),
        status: readString([record], ["status"]),
      });
    })
    .filter((item): item is ImageStoryboardSlot => Boolean(item))
    .sort((left, right) => left.slotIndex - right.slotIndex);
}

export function mergeStoryboardSlots(
  ...sources: Array<ImageStoryboardSlot[] | null | undefined>
): ImageStoryboardSlot[] {
  const bySlotKey = new Map<string, ImageStoryboardSlot>();

  sources.forEach((source) => {
    (source || []).forEach((slot) => {
      const slotKey =
        slot.slotId.trim() || `storyboard-slot-${Math.max(1, slot.slotIndex)}`;
      const existing = bySlotKey.get(slotKey);
      bySlotKey.set(slotKey, {
        ...existing,
        ...slot,
        slotId: slotKey,
        slotIndex:
          slot.slotIndex ||
          existing?.slotIndex ||
          Math.max(1, bySlotKey.size + 1),
        label: slot.label ?? existing?.label ?? null,
        prompt: slot.prompt ?? existing?.prompt ?? null,
        shotType: slot.shotType ?? existing?.shotType ?? null,
        status: slot.status ?? existing?.status ?? null,
      });
    });
  });

  return Array.from(bySlotKey.values()).sort(
    (left, right) => left.slotIndex - right.slotIndex,
  );
}
