import type {
  AgentRuntimeReviewDecisionStatus,
  AgentRuntimeSaveReviewDecisionRequest,
} from "@/lib/api/agentRuntime";
import type { MemoryCategory, UnifiedMemory } from "@/lib/api/unifiedMemory";
import {
  getCuratedTaskReferenceFallbackTitle,
  type CuratedTaskReferenceEntry,
} from "./curatedTaskReferenceSelection";

export type CuratedTaskRecommendationSignalSource =
  | "saved_inspiration"
  | "active_reference"
  | "review_feedback";

export interface CuratedTaskRecommendationSignal {
  source: CuratedTaskRecommendationSignalSource;
  category: MemoryCategory;
  title: string;
  summary: string;
  tags: string[];
  preferredTaskIds?: string[];
  createdAt: number;
  projectId?: string;
  sessionId?: string;
}

interface StoredCuratedTaskRecommendationSignal extends CuratedTaskRecommendationSignal {
  key: string;
}

const CURATED_TASK_RECOMMENDATION_SIGNAL_STORAGE_KEY =
  "lime:curated-task-recommendation-signals:v1";
const CURATED_TASK_RECOMMENDATION_SIGNAL_MAX_RECORDS = 24;
const CURATED_TASK_RECOMMENDATION_SIGNAL_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const CURATED_TASK_RECOMMENDATION_SIGNAL_EVENT =
  "lime:curated-task-recommendation-signals-changed";

const REVIEW_DECISION_STATUS_LABELS: Record<
  AgentRuntimeReviewDecisionStatus,
  string
> = {
  accepted: "可继续复用",
  deferred: "继续观察",
  needs_more_evidence: "补证据",
  rejected: "先别继续",
  pending_review: "待复核",
};

const REVIEW_DECISION_TASK_PREFERENCES: Record<
  AgentRuntimeReviewDecisionStatus,
  string[]
> = {
  accepted: ["daily-trend-briefing", "social-post-starter"],
  deferred: ["account-project-review", "daily-trend-briefing"],
  needs_more_evidence: ["account-project-review", "viral-content-breakdown"],
  rejected: ["viral-content-breakdown", "social-post-starter"],
  pending_review: ["account-project-review"],
};

type ReviewDecisionRecommendationSignalInput = Pick<
  AgentRuntimeSaveReviewDecisionRequest,
  | "session_id"
  | "decision_status"
  | "decision_summary"
  | "chosen_fix_strategy"
  | "risk_level"
  | "risk_tags"
  | "followup_actions"
>;

function normalizeOptionalText(value?: string | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function dedupeNonEmptyText(
  values: Array<string | null | undefined>,
): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeOptionalText(value))
        .filter((value): value is string => Boolean(value)),
    ),
  );
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

function normalizePreferredTaskIds(values?: string[]): string[] | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }

  const normalized = Array.from(
    new Set(
      values
        .map((value) => normalizeOptionalText(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ).slice(0, 4);

  return normalized.length > 0 ? normalized : undefined;
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
      signal.source === "active_reference" ||
      signal.source === "review_feedback") &&
    isMemoryCategory(signal.category) &&
    typeof signal.title === "string" &&
    signal.title.length > 0 &&
    typeof signal.summary === "string" &&
    typeof signal.createdAt === "number" &&
    Number.isFinite(signal.createdAt) &&
    Array.isArray(signal.tags) &&
    (signal.preferredTaskIds == null || Array.isArray(signal.preferredTaskIds))
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
          now - signal.createdAt <=
          CURATED_TASK_RECOMMENDATION_SIGNAL_MAX_AGE_MS,
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

export function subscribeCuratedTaskRecommendationSignalsChanged(
  callback: () => void,
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const customEventHandler = () => {
    callback();
  };

  const storageHandler = (event: StorageEvent) => {
    if (event.key !== CURATED_TASK_RECOMMENDATION_SIGNAL_STORAGE_KEY) {
      return;
    }
    callback();
  };

  window.addEventListener(
    CURATED_TASK_RECOMMENDATION_SIGNAL_EVENT,
    customEventHandler,
  );
  window.addEventListener("storage", storageHandler);

  return () => {
    window.removeEventListener(
      CURATED_TASK_RECOMMENDATION_SIGNAL_EVENT,
      customEventHandler,
    );
    window.removeEventListener("storage", storageHandler);
  };
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
    title:
      normalizeOptionalText(memory.title) ||
      getCuratedTaskReferenceFallbackTitle(memory.category),
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
    title:
      normalizeOptionalText(entry.title) ||
      getCuratedTaskReferenceFallbackTitle(entry.category),
    summary: normalizeOptionalText(entry.summary) || "等待补充摘要",
    tags: normalizeTags(entry.tags),
    createdAt: Date.now(),
    projectId: normalizeOptionalText(options.projectId) || undefined,
    sessionId: normalizeOptionalText(options.sessionId) || undefined,
  }));
}

function buildReviewDecisionSignalTitle(params: {
  sceneTitle?: string | null;
  decisionStatus: AgentRuntimeReviewDecisionStatus;
}): string {
  const sceneTitle = normalizeOptionalText(params.sceneTitle);
  const decisionLabel = REVIEW_DECISION_STATUS_LABELS[params.decisionStatus];
  if (sceneTitle) {
    return `${sceneTitle} · ${decisionLabel}`;
  }

  return `最近判断 · ${decisionLabel}`;
}

function buildReviewDecisionSignalSummary(
  request: ReviewDecisionRecommendationSignalInput,
): string {
  const sections = dedupeNonEmptyText([
    request.decision_summary,
    request.chosen_fix_strategy,
    request.followup_actions.length > 0
      ? `下一步：${request.followup_actions.join("、")}`
      : null,
  ]);

  return sections.join(" ").trim() || "最近这轮结果已经产生新的判断。";
}

export function buildCuratedTaskRecommendationSignalFromReviewDecision(
  request: ReviewDecisionRecommendationSignalInput,
  options: {
    projectId?: string | null;
    sessionId?: string | null;
    sceneTitle?: string | null;
  } = {},
): CuratedTaskRecommendationSignal {
  const decisionLabel = REVIEW_DECISION_STATUS_LABELS[request.decision_status];
  const riskLevelLabel =
    request.risk_level === "high"
      ? "高风险"
      : request.risk_level === "medium"
        ? "中风险"
        : request.risk_level === "low"
          ? "低风险"
          : "待判断";

  return {
    source: "review_feedback",
    category: "experience",
    title: buildReviewDecisionSignalTitle({
      sceneTitle: options.sceneTitle,
      decisionStatus: request.decision_status,
    }),
    summary: buildReviewDecisionSignalSummary(request),
    tags: normalizeTags([
      "复盘",
      decisionLabel,
      riskLevelLabel,
      ...request.risk_tags,
      ...request.followup_actions,
    ]),
    preferredTaskIds:
      normalizePreferredTaskIds(
        REVIEW_DECISION_TASK_PREFERENCES[request.decision_status],
      ) ?? [],
    createdAt: Date.now(),
    projectId: normalizeOptionalText(options.projectId) || undefined,
    sessionId:
      normalizeOptionalText(options.sessionId) ||
      normalizeOptionalText(request.session_id) ||
      undefined,
  };
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
    preferredTaskIds: normalizePreferredTaskIds(signal.preferredTaskIds),
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

export function recordCuratedTaskRecommendationSignalFromReviewDecision(
  request: ReviewDecisionRecommendationSignalInput,
  options: {
    projectId?: string | null;
    sessionId?: string | null;
    sceneTitle?: string | null;
  } = {},
): void {
  recordCuratedTaskRecommendationSignal(
    buildCuratedTaskRecommendationSignalFromReviewDecision(request, options),
  );
}

export function listCuratedTaskRecommendationSignals(
  options: {
    projectId?: string | null;
    sessionId?: string | null;
  } = {},
): CuratedTaskRecommendationSignal[] {
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
