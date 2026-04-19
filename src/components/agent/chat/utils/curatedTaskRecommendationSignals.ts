import type { MemoryCategory, UnifiedMemory } from "@/lib/api/unifiedMemory";
import type { CuratedTaskReferenceEntry } from "./curatedTaskReferenceSelection";

export type CuratedTaskRecommendationSignalSource =
  | "saved_inspiration"
  | "active_reference";

export interface CuratedTaskRecommendationSignal {
  source: CuratedTaskRecommendationSignalSource;
  category: MemoryCategory;
  title: string;
  summary: string;
  tags: string[];
  createdAt: number;
  projectId?: string;
  sessionId?: string;
}

interface StoredCuratedTaskRecommendationSignal
  extends CuratedTaskRecommendationSignal {
  key: string;
}

const CURATED_TASK_RECOMMENDATION_SIGNAL_STORAGE_KEY =
  "lime:curated-task-recommendation-signals:v1";
const CURATED_TASK_RECOMMENDATION_SIGNAL_MAX_RECORDS = 24;
const CURATED_TASK_RECOMMENDATION_SIGNAL_MAX_AGE_MS =
  30 * 24 * 60 * 60 * 1000;

export const CURATED_TASK_RECOMMENDATION_SIGNAL_EVENT =
  "lime:curated-task-recommendation-signals-changed";

function normalizeOptionalText(value?: string | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeTags(values?: string[]): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .map((value) => normalizeOptionalText(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ).slice(0, 6);
}

function buildStoredSignalKey(
  signal: Pick<
    CuratedTaskRecommendationSignal,
    "source" | "projectId" | "sessionId" | "category" | "title"
  >,
): string {
  return [
    signal.source,
    signal.projectId || "",
    signal.sessionId || "",
    signal.category,
    signal.title,
  ].join("::");
}

function isMemoryCategory(value: unknown): value is MemoryCategory {
  return (
    value === "identity" ||
    value === "context" ||
    value === "preference" ||
    value === "experience" ||
    value === "activity"
  );
}

function isStoredSignal(
  value: unknown,
): value is StoredCuratedTaskRecommendationSignal {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const signal = value as Partial<StoredCuratedTaskRecommendationSignal>;
  return (
    typeof signal.key === "string" &&
    signal.key.length > 0 &&
    typeof signal.source === "string" &&
    (signal.source === "saved_inspiration" ||
      signal.source === "active_reference") &&
    isMemoryCategory(signal.category) &&
    typeof signal.title === "string" &&
    signal.title.length > 0 &&
    typeof signal.summary === "string" &&
    typeof signal.createdAt === "number" &&
    Number.isFinite(signal.createdAt) &&
    Array.isArray(signal.tags)
  );
}

function readStoredSignals(): StoredCuratedTaskRecommendationSignal[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(
      CURATED_TASK_RECOMMENDATION_SIGNAL_STORAGE_KEY,
    );
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const now = Date.now();
    return parsed
      .filter(isStoredSignal)
      .filter(
        (signal) =>
          now - signal.createdAt <= CURATED_TASK_RECOMMENDATION_SIGNAL_MAX_AGE_MS,
      )
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, CURATED_TASK_RECOMMENDATION_SIGNAL_MAX_RECORDS);
  } catch {
    return [];
  }
}

function writeStoredSignals(
  signals: StoredCuratedTaskRecommendationSignal[],
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      CURATED_TASK_RECOMMENDATION_SIGNAL_STORAGE_KEY,
      JSON.stringify(signals),
    );
  } catch {
    // ignore write errors
  }
}

function emitSignalsChanged(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(CURATED_TASK_RECOMMENDATION_SIGNAL_EVENT),
  );
}

export function buildCuratedTaskRecommendationSignalFromMemory(
  memory: UnifiedMemory,
  options: {
    projectId?: string | null;
    sessionId?: string | null;
  } = {},
): CuratedTaskRecommendationSignal {
  return {
    source: "saved_inspiration",
    category: memory.category,
    title: normalizeOptionalText(memory.title) || "未命名灵感",
    summary:
      normalizeOptionalText(memory.summary) ||
      normalizeOptionalText(memory.content) ||
      "等待补充摘要",
    tags: normalizeTags(memory.tags),
    createdAt: Date.now(),
    projectId: normalizeOptionalText(options.projectId) || undefined,
    sessionId:
      normalizeOptionalText(options.sessionId) ||
      normalizeOptionalText(memory.session_id) ||
      undefined,
  };
}

export function buildCuratedTaskRecommendationSignalsFromReferenceEntries(
  entries?: CuratedTaskReferenceEntry[] | null,
  options: {
    projectId?: string | null;
    sessionId?: string | null;
  } = {},
): CuratedTaskRecommendationSignal[] {
  if (!entries || entries.length === 0) {
    return [];
  }

  return entries.slice(0, 3).map((entry) => ({
    source: "active_reference",
    category: entry.category,
    title: normalizeOptionalText(entry.title) || "未命名灵感",
    summary: normalizeOptionalText(entry.summary) || "等待补充摘要",
    tags: normalizeTags(entry.tags),
    createdAt: Date.now(),
    projectId: normalizeOptionalText(options.projectId) || undefined,
    sessionId: normalizeOptionalText(options.sessionId) || undefined,
  }));
}

export function recordCuratedTaskRecommendationSignal(
  signal: CuratedTaskRecommendationSignal,
): void {
  const normalizedTitle = normalizeOptionalText(signal.title);
  const normalizedSummary = normalizeOptionalText(signal.summary);
  if (!normalizedTitle || !normalizedSummary) {
    return;
  }

  const storedSignal: StoredCuratedTaskRecommendationSignal = {
    ...signal,
    title: normalizedTitle,
    summary: normalizedSummary,
    tags: normalizeTags(signal.tags),
    projectId: normalizeOptionalText(signal.projectId),
    sessionId: normalizeOptionalText(signal.sessionId),
    key: buildStoredSignalKey({
      source: signal.source,
      projectId: signal.projectId,
      sessionId: signal.sessionId,
      category: signal.category,
      title: normalizedTitle,
    }),
  };

  const nextSignals = [
    storedSignal,
    ...readStoredSignals().filter((item) => item.key !== storedSignal.key),
  ].slice(0, CURATED_TASK_RECOMMENDATION_SIGNAL_MAX_RECORDS);

  writeStoredSignals(nextSignals);
  emitSignalsChanged();
}

export function recordCuratedTaskRecommendationSignalFromMemory(
  memory: UnifiedMemory,
  options: {
    projectId?: string | null;
    sessionId?: string | null;
  } = {},
): void {
  recordCuratedTaskRecommendationSignal(
    buildCuratedTaskRecommendationSignalFromMemory(memory, options),
  );
}

export function listCuratedTaskRecommendationSignals(options: {
  projectId?: string | null;
  sessionId?: string | null;
} = {}): CuratedTaskRecommendationSignal[] {
  const projectId = normalizeOptionalText(options.projectId);
  const sessionId = normalizeOptionalText(options.sessionId);
  const signals = readStoredSignals();

  const scopedSignals = signals.filter((signal) => {
    if (projectId && signal.projectId === projectId) {
      return true;
    }
    if (sessionId && signal.sessionId === sessionId) {
      return true;
    }
    return !signal.projectId && !signal.sessionId;
  });

  return (scopedSignals.length > 0 ? scopedSignals : signals).map(
    ({ key: _key, ...signal }) => signal,
  );
}
