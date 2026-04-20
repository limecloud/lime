import type { MemoryCategory, UnifiedMemory } from "@/lib/api/unifiedMemory";
import { buildMemoryEntryCreationReplayRequestMetadata } from "./creationReplayMetadata";
import type { CreationReplayMetadata } from "./creationReplayMetadata";
import type { CuratedTaskInputValues } from "./curatedTaskTemplates";

export type CuratedTaskReferenceSourceKind =
  | "memory"
  | "sceneapp_execution_summary";

export interface CuratedTaskReferenceEntry {
  id: string;
  sourceKind?: CuratedTaskReferenceSourceKind;
  title: string;
  summary: string;
  category: MemoryCategory;
  categoryLabel: string;
  tags: string[];
  taskPrefillByTaskId?: Record<string, CuratedTaskInputValues>;
}

export interface CuratedTaskReferenceSelection {
  referenceMemoryIds: string[];
  referenceEntries: CuratedTaskReferenceEntry[];
}

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  identity: "风格",
  context: "参考",
  preference: "偏好",
  experience: "成果",
  activity: "收藏",
};

export function getCuratedTaskReferenceCategoryLabel(
  category: MemoryCategory,
): string {
  return CATEGORY_LABELS[category];
}

export function getCuratedTaskReferenceFallbackTitle(
  category: MemoryCategory,
): string {
  return `未命名${getCuratedTaskReferenceCategoryLabel(category)}`;
}

function normalizeOptionalText(value?: string | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized : undefined;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function compactRecord<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as T;
}

function normalizeCuratedTaskReferenceEntry(
  entry?: CuratedTaskReferenceEntry | null,
): CuratedTaskReferenceEntry | null {
  if (!entry) {
    return null;
  }

  const id = normalizeOptionalText(entry.id);
  if (!id) {
    return null;
  }

  const title =
    normalizeOptionalText(entry.title) ||
    getCuratedTaskReferenceFallbackTitle(entry.category);
  const summary =
    normalizeOptionalText(entry.summary) || "等待补充摘要";
  const tags = Array.from(
    new Set(
      entry.tags
        .map((tag) => normalizeOptionalText(tag))
        .filter((tag): tag is string => Boolean(tag)),
    ),
  ).slice(0, 6);
  const sourceKind =
    entry.sourceKind === "sceneapp_execution_summary"
      ? "sceneapp_execution_summary"
      : "memory";
  const taskPrefillByTaskId = Object.fromEntries(
    Object.entries(entry.taskPrefillByTaskId ?? {})
      .map(([taskId, inputValues]) => [
        normalizeOptionalText(taskId),
        normalizeCuratedTaskLaunchInputValues(inputValues),
      ] as const)
      .filter(
        (
          item,
        ): item is [
          string,
          CuratedTaskInputValues,
        ] => Boolean(item[0]) && Boolean(item[1]),
      ),
  );

  return {
    id,
    sourceKind,
    title,
    summary: truncateText(summary, 120),
    category: entry.category,
    categoryLabel: CATEGORY_LABELS[entry.category],
    tags,
    ...(Object.keys(taskPrefillByTaskId).length > 0
      ? {
          taskPrefillByTaskId,
        }
      : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

export function normalizeCuratedTaskLaunchInputValues(
  inputValues?: CuratedTaskInputValues | null,
): CuratedTaskInputValues | undefined {
  if (!inputValues) {
    return undefined;
  }

  const normalizedEntries = Object.entries(inputValues)
    .map(([key, value]) => [key, String(value ?? "").trim()] as const)
    .filter(([, value]) => value.length > 0);

  if (normalizedEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(normalizedEntries);
}

export function normalizeCuratedTaskReferenceMemoryIds(
  values?: Array<string | null | undefined> | null,
): string[] | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }

  const normalized = Array.from(
    new Set(
      values
        .map((value) => normalizeOptionalText(value))
        .filter((value): value is string => Boolean(value)),
    ),
  );

  return normalized.length > 0 ? normalized : undefined;
}

export function getCuratedTaskReferenceSourceKind(
  entry?: Pick<CuratedTaskReferenceEntry, "sourceKind"> | null,
): CuratedTaskReferenceSourceKind {
  return entry?.sourceKind === "sceneapp_execution_summary"
    ? "sceneapp_execution_summary"
    : "memory";
}

export function getCuratedTaskReferenceSourceLabel(
  entry?: Pick<CuratedTaskReferenceEntry, "sourceKind"> | null,
): string {
  return getCuratedTaskReferenceSourceKind(entry) ===
    "sceneapp_execution_summary"
    ? "项目结果"
    : "灵感库";
}

export function getCuratedTaskReferenceMemoryId(
  entry?: Pick<CuratedTaskReferenceEntry, "id" | "sourceKind"> | null,
): string | undefined {
  if (!entry || getCuratedTaskReferenceSourceKind(entry) !== "memory") {
    return undefined;
  }

  return normalizeOptionalText(entry.id);
}

export function extractCuratedTaskReferenceMemoryIds(
  entries?: Array<CuratedTaskReferenceEntry | null | undefined> | null,
): string[] | undefined {
  return normalizeCuratedTaskReferenceMemoryIds(
    (entries ?? []).map((entry) => getCuratedTaskReferenceMemoryId(entry)),
  );
}

export function buildCuratedTaskLaunchInputPrefillFromReferenceEntries(params: {
  taskId: string;
  inputValues?: CuratedTaskInputValues | null;
  referenceEntries?: CuratedTaskReferenceEntry[] | null;
}): CuratedTaskInputValues | undefined {
  const normalizedInputValues = normalizeCuratedTaskLaunchInputValues(
    params.inputValues,
  );
  const mergedInputValues: CuratedTaskInputValues = {
    ...(normalizedInputValues ?? {}),
  };

  for (const entry of params.referenceEntries ?? []) {
    const taskPrefill =
      entry.taskPrefillByTaskId?.[params.taskId];
    if (!taskPrefill) {
      continue;
    }

    for (const [key, value] of Object.entries(taskPrefill)) {
      if (normalizeOptionalText(mergedInputValues[key])) {
        continue;
      }

      mergedInputValues[key] = value;
    }
  }

  return normalizeCuratedTaskLaunchInputValues(mergedInputValues);
}

export function mergeCuratedTaskReferenceEntries(
  entries: Array<CuratedTaskReferenceEntry | null | undefined>,
): CuratedTaskReferenceEntry[] {
  const result: CuratedTaskReferenceEntry[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const normalized = normalizeCuratedTaskReferenceEntry(entry);
    if (!normalized || seen.has(normalized.id)) {
      continue;
    }

    seen.add(normalized.id);
    result.push(normalized);
  }

  return result;
}

export function buildCuratedTaskReferenceEntries(
  memories: UnifiedMemory[],
): CuratedTaskReferenceEntry[] {
  return mergeCuratedTaskReferenceEntries(
    memories.map((memory) => {
      const summary =
        normalizeOptionalText(memory.summary) ||
        normalizeOptionalText(memory.content) ||
        "等待补充摘要";

      return {
        id: memory.id,
        sourceKind: "memory",
        title:
          normalizeOptionalText(memory.title) ||
          getCuratedTaskReferenceFallbackTitle(memory.category),
        summary,
        category: memory.category,
        categoryLabel: CATEGORY_LABELS[memory.category],
        tags: memory.tags,
      };
    }),
  );
}

export function buildCuratedTaskReferenceEntryFromCreationReplay(
  creationReplay?: CreationReplayMetadata,
): CuratedTaskReferenceEntry | null {
  if (!creationReplay || creationReplay.kind !== "memory_entry") {
    return null;
  }

  return normalizeCuratedTaskReferenceEntry({
    id: creationReplay.source.entry_id || "",
    sourceKind: "memory",
    title:
      normalizeOptionalText(creationReplay.data.title) ||
      getCuratedTaskReferenceFallbackTitle(creationReplay.data.category),
    summary:
      normalizeOptionalText(creationReplay.data.summary) ||
      normalizeOptionalText(creationReplay.data.content_excerpt) ||
      "等待补充摘要",
    category: creationReplay.data.category,
    categoryLabel: CATEGORY_LABELS[creationReplay.data.category],
    tags: creationReplay.data.tags || [],
  });
}

export function buildCuratedTaskReferenceSelectionFromCreationReplay(
  creationReplay?: CreationReplayMetadata,
): CuratedTaskReferenceSelection {
  const referenceEntry =
    buildCuratedTaskReferenceEntryFromCreationReplay(creationReplay);

  if (!referenceEntry) {
    return {
      referenceMemoryIds: [],
      referenceEntries: [],
    };
  }

  return {
    referenceMemoryIds: extractCuratedTaskReferenceMemoryIds([
      referenceEntry,
    ]) ?? [],
    referenceEntries: [referenceEntry],
  };
}

function buildReferencePromptLine(entry: CuratedTaskReferenceEntry): string {
  const parts = [`[${entry.categoryLabel}] ${entry.title}`];

  if (entry.summary) {
    parts.push(`摘要：${entry.summary}`);
  }

  if (entry.tags.length > 0) {
    parts.push(`标签：${entry.tags.slice(0, 3).join("、")}`);
  }

  return `- ${parts.join("；")}`;
}

export function buildCuratedTaskReferencePromptBlock(
  entries?: CuratedTaskReferenceEntry[],
): string | null {
  if (!entries || entries.length === 0) {
    return null;
  }

  return `本轮可优先参考这些参考基线：\n${entries
    .slice(0, 3)
    .map((entry) => buildReferencePromptLine(entry))
    .join("\n")}`;
}

export function buildCuratedTaskLaunchRequestMetadata(params: {
  taskId: string;
  taskTitle: string;
  inputValues?: CuratedTaskInputValues | null;
  referenceMemoryIds?: string[];
  referenceEntries?: CuratedTaskReferenceEntry[];
  baseRequestMetadata?: Record<string, unknown>;
}): Record<string, unknown> {
  const normalizedReferenceEntries = mergeCuratedTaskReferenceEntries(
    params.referenceEntries ?? [],
  ).slice(0, 3);
  const inferredReferenceIds = normalizeCuratedTaskReferenceMemoryIds([
    ...(params.referenceMemoryIds ?? []),
    ...(extractCuratedTaskReferenceMemoryIds(
      normalizedReferenceEntries,
    ) ?? []),
  ]);
  const primaryReference = normalizedReferenceEntries.find(
    (entry) => getCuratedTaskReferenceSourceKind(entry) === "memory",
  );
  const primaryCreationReplay = primaryReference
    ? buildMemoryEntryCreationReplayRequestMetadata({
        id: getCuratedTaskReferenceMemoryId(primaryReference),
        category: primaryReference.category,
        title: primaryReference.title,
        summary: primaryReference.summary,
        content: primaryReference.summary,
        tags: primaryReference.tags,
      }).harness.creation_replay
    : undefined;
  const existingHarness = asRecord(params.baseRequestMetadata?.harness) || {};

  return {
    ...(params.baseRequestMetadata || {}),
    harness: {
      ...existingHarness,
      ...(primaryCreationReplay
        ? {
            creation_replay: primaryCreationReplay,
          }
        : {}),
      curated_task: compactRecord({
        task_id: normalizeOptionalText(params.taskId),
        task_title: normalizeOptionalText(params.taskTitle),
        launch_input_values: normalizeCuratedTaskLaunchInputValues(
          params.inputValues,
        ),
        reference_memory_ids: inferredReferenceIds,
        reference_entries:
          normalizedReferenceEntries.length > 0
            ? normalizedReferenceEntries.map((entry) =>
                compactRecord({
                  id: entry.id,
                  source_kind: getCuratedTaskReferenceSourceKind(entry),
                  title: normalizeOptionalText(entry.title),
                  summary: normalizeOptionalText(entry.summary),
                  category: entry.category,
                  tags: entry.tags.slice(0, 4),
                  task_prefill_by_task_id:
                    entry.taskPrefillByTaskId &&
                    Object.keys(entry.taskPrefillByTaskId).length > 0
                      ? Object.fromEntries(
                          Object.entries(entry.taskPrefillByTaskId).map(
                            ([taskId, inputValues]) => [
                              taskId,
                              normalizeCuratedTaskLaunchInputValues(inputValues),
                            ],
                          ),
                        )
                      : undefined,
                }),
              )
            : undefined,
      }),
    },
  };
}
