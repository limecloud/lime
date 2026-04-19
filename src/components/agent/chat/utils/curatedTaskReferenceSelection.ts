import type { MemoryCategory, UnifiedMemory } from "@/lib/api/unifiedMemory";
import { buildMemoryEntryCreationReplayRequestMetadata } from "./creationReplayMetadata";
import type { CreationReplayMetadata } from "./creationReplayMetadata";
import type { CuratedTaskInputValues } from "./curatedTaskTemplates";

export interface CuratedTaskReferenceEntry {
  id: string;
  title: string;
  summary: string;
  category: MemoryCategory;
  categoryLabel: string;
  tags: string[];
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

  const title = normalizeOptionalText(entry.title) || "未命名灵感";
  const summary =
    normalizeOptionalText(entry.summary) || "等待补充摘要";
  const tags = Array.from(
    new Set(
      entry.tags
        .map((tag) => normalizeOptionalText(tag))
        .filter((tag): tag is string => Boolean(tag)),
    ),
  ).slice(0, 6);

  return {
    id,
    title,
    summary: truncateText(summary, 120),
    category: entry.category,
    categoryLabel: CATEGORY_LABELS[entry.category],
    tags,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function normalizeLaunchInputValues(
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

export function getCuratedTaskReferenceCategoryLabel(
  category: MemoryCategory,
): string {
  return CATEGORY_LABELS[category];
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
        title: normalizeOptionalText(memory.title) || "未命名灵感",
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
    title:
      normalizeOptionalText(creationReplay.data.title) || "未命名灵感",
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
    referenceMemoryIds: [referenceEntry.id],
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

  return `本轮可优先参考这些灵感：\n${entries
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
  const inferredReferenceIds = normalizeCuratedTaskReferenceMemoryIds([
    ...(params.referenceMemoryIds ?? []),
    ...(params.referenceEntries?.map((entry) => entry.id) ?? []),
  ]);
  const referenceEntryMap = new Map(
    (params.referenceEntries ?? []).map((entry) => [entry.id, entry]),
  );
  const normalizedReferenceEntries = (inferredReferenceIds ?? [])
    .map((id) => referenceEntryMap.get(id))
    .filter((entry): entry is CuratedTaskReferenceEntry => Boolean(entry))
    .slice(0, 3);
  const primaryReference = normalizedReferenceEntries[0];
  const primaryCreationReplay = primaryReference
    ? buildMemoryEntryCreationReplayRequestMetadata({
        id: primaryReference.id,
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
        launch_input_values: normalizeLaunchInputValues(params.inputValues),
        reference_memory_ids: inferredReferenceIds,
        reference_memory_entries:
          normalizedReferenceEntries.length > 0
            ? normalizedReferenceEntries.map((entry) =>
                compactRecord({
                  id: entry.id,
                  title: normalizeOptionalText(entry.title),
                  summary: normalizeOptionalText(entry.summary),
                  category: entry.category,
                  tags: entry.tags.slice(0, 4),
                }),
              )
            : undefined,
      }),
    },
  };
}
