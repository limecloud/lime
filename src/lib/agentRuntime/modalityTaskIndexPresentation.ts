import type {
  AgentRuntimeEvidenceTaskIndex,
  AgentRuntimeEvidenceTaskIndexItem,
} from "@/lib/api/agentRuntime";

export interface ModalityTaskIndexQueryFilters {
  threadId?: string;
  turnId?: string;
  contentId?: string;
  entryKey?: string;
  modality?: string;
  skillId?: string;
  modelId?: string;
  executorKind?: string;
  executorBindingKey?: string;
  costState?: string;
  limitState?: string;
}

export interface ModalityTaskIndexRow {
  id: string;
  title: string;
  artifactPath?: string;
  taskId?: string;
  taskType?: string;
  contractKey?: string;
  source?: string;
  threadId?: string;
  turnId?: string;
  contentId?: string;
  entryKey?: string;
  entrySource?: string;
  modality?: string;
  skillId?: string;
  modelId?: string;
  executorKind?: string;
  executorBindingKey?: string;
  costState?: string;
  limitState?: string;
  estimatedCostClass?: string;
  limitEventKind?: string;
  quotaLow?: boolean;
  routingOutcome?: string;
}

export interface ModalityTaskIndexFacets {
  identityAnchors: string[];
  executorDimensions: string[];
  costLimitDimensions: string[];
  threadIds: string[];
  turnIds: string[];
  contentIds: string[];
  entryKeys: string[];
  modalities: string[];
  skillIds: string[];
  modelIds: string[];
  executorKinds: string[];
  executorBindingKeys: string[];
  costStates: string[];
  limitStates: string[];
  estimatedCostClasses: string[];
  limitEventKinds: string[];
  quotaLowCount: number;
}

function normalizeString(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function uniqueNonEmptyStrings(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeString(value))
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function readItemField(
  items: AgentRuntimeEvidenceTaskIndexItem[],
  field: keyof AgentRuntimeEvidenceTaskIndexItem,
): Array<string | undefined> {
  return items.map((item) => {
    const value = item[field];
    return typeof value === "string" ? value : undefined;
  });
}

export function buildModalityTaskIndexFacets(
  index: AgentRuntimeEvidenceTaskIndex,
): ModalityTaskIndexFacets {
  const threadIds = uniqueNonEmptyStrings([
    ...index.thread_ids,
    ...readItemField(index.items, "thread_id"),
  ]);
  const turnIds = uniqueNonEmptyStrings([
    ...index.turn_ids,
    ...readItemField(index.items, "turn_id"),
  ]);
  const contentIds = uniqueNonEmptyStrings([
    ...index.content_ids,
    ...readItemField(index.items, "content_id"),
  ]);
  const entryKeys = uniqueNonEmptyStrings([
    ...index.entry_keys,
    ...readItemField(index.items, "entry_key"),
  ]);
  const modalities = uniqueNonEmptyStrings([
    ...index.modalities,
    ...readItemField(index.items, "modality"),
  ]);
  const skillIds = uniqueNonEmptyStrings([
    ...index.skill_ids,
    ...readItemField(index.items, "skill_id"),
  ]);
  const modelIds = uniqueNonEmptyStrings([
    ...index.model_ids,
    ...readItemField(index.items, "model_id"),
  ]);
  const executorKinds = uniqueNonEmptyStrings([
    ...index.executor_kinds,
    ...readItemField(index.items, "executor_kind"),
  ]);
  const executorBindingKeys = uniqueNonEmptyStrings([
    ...index.executor_binding_keys,
    ...readItemField(index.items, "executor_binding_key"),
  ]);
  const costStates = uniqueNonEmptyStrings([
    ...index.cost_states,
    ...readItemField(index.items, "cost_state"),
  ]);
  const limitStates = uniqueNonEmptyStrings([
    ...index.limit_states,
    ...readItemField(index.items, "limit_state"),
  ]);
  const estimatedCostClasses = uniqueNonEmptyStrings([
    ...index.estimated_cost_classes,
    ...readItemField(index.items, "estimated_cost_class"),
  ]);
  const limitEventKinds = uniqueNonEmptyStrings([
    ...index.limit_event_kinds,
    ...readItemField(index.items, "limit_event_kind"),
  ]);
  const quotaLowCount =
    index.quota_low_count ||
    index.items.filter((item) => item.quota_low).length;

  return {
    identityAnchors: uniqueNonEmptyStrings([
      ...threadIds,
      ...turnIds,
      ...contentIds,
      ...entryKeys,
    ]),
    executorDimensions: uniqueNonEmptyStrings([
      ...modalities,
      ...skillIds,
      ...modelIds,
      ...executorKinds,
      ...executorBindingKeys,
    ]),
    costLimitDimensions: uniqueNonEmptyStrings([
      ...costStates,
      ...limitStates,
      ...estimatedCostClasses,
      ...limitEventKinds,
      quotaLowCount > 0 ? "quota_low" : undefined,
    ]),
    threadIds,
    turnIds,
    contentIds,
    entryKeys,
    modalities,
    skillIds,
    modelIds,
    executorKinds,
    executorBindingKeys,
    costStates,
    limitStates,
    estimatedCostClasses,
    limitEventKinds,
    quotaLowCount,
  };
}

function buildRowTitle(item: AgentRuntimeEvidenceTaskIndexItem): string {
  return (
    normalizeString(item.entry_key) ||
    normalizeString(item.task_id) ||
    normalizeString(item.contract_key) ||
    normalizeString(item.artifact_path) ||
    "未命名任务索引"
  );
}

function buildRowBaseId(
  item: AgentRuntimeEvidenceTaskIndexItem,
  position: number,
): string {
  const parts = uniqueNonEmptyStrings([
    item.task_id,
    item.thread_id,
    item.turn_id,
    item.content_id,
    item.entry_key,
    item.contract_key,
    item.artifact_path,
  ]);

  return parts.length > 0 ? parts.join(":") : `task-index-${position}`;
}

export function buildModalityTaskIndexRows(
  index: AgentRuntimeEvidenceTaskIndex,
): ModalityTaskIndexRow[] {
  const seen = new Map<string, number>();

  return index.items.map((item, position) => {
    const baseId = buildRowBaseId(item, position);
    const seenCount = seen.get(baseId) ?? 0;
    seen.set(baseId, seenCount + 1);
    const id = seenCount > 0 ? `${baseId}:${seenCount}` : baseId;

    return {
      id,
      title: buildRowTitle(item),
      artifactPath: normalizeString(item.artifact_path),
      taskId: normalizeString(item.task_id),
      taskType: normalizeString(item.task_type),
      contractKey: normalizeString(item.contract_key),
      source: normalizeString(item.source),
      threadId: normalizeString(item.thread_id),
      turnId: normalizeString(item.turn_id),
      contentId: normalizeString(item.content_id),
      entryKey: normalizeString(item.entry_key),
      entrySource: normalizeString(item.entry_source),
      modality: normalizeString(item.modality),
      skillId: normalizeString(item.skill_id),
      modelId: normalizeString(item.model_id),
      executorKind: normalizeString(item.executor_kind),
      executorBindingKey: normalizeString(item.executor_binding_key),
      costState: normalizeString(item.cost_state),
      limitState: normalizeString(item.limit_state),
      estimatedCostClass: normalizeString(item.estimated_cost_class),
      limitEventKind: normalizeString(item.limit_event_kind),
      quotaLow: item.quota_low,
      routingOutcome: normalizeString(item.routing_outcome),
    };
  });
}

function matchesFilter(
  value: string | undefined,
  expected: string | undefined,
) {
  const normalizedExpected = normalizeString(expected);
  if (!normalizedExpected) {
    return true;
  }

  return normalizeString(value) === normalizedExpected;
}

export function filterModalityTaskIndexRows(
  rows: ModalityTaskIndexRow[],
  filters: ModalityTaskIndexQueryFilters,
): ModalityTaskIndexRow[] {
  return rows.filter(
    (row) =>
      matchesFilter(row.threadId, filters.threadId) &&
      matchesFilter(row.turnId, filters.turnId) &&
      matchesFilter(row.contentId, filters.contentId) &&
      matchesFilter(row.entryKey, filters.entryKey) &&
      matchesFilter(row.modality, filters.modality) &&
      matchesFilter(row.skillId, filters.skillId) &&
      matchesFilter(row.modelId, filters.modelId) &&
      matchesFilter(row.executorKind, filters.executorKind) &&
      matchesFilter(row.executorBindingKey, filters.executorBindingKey) &&
      matchesFilter(row.costState, filters.costState) &&
      matchesFilter(row.limitState, filters.limitState),
  );
}
