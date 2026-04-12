import type { TurnMemoryPrefetchResult } from "@/lib/api/memoryRuntime";

export type RuntimeMemoryPrefetchHistorySource =
  | "thread_reliability"
  | "memory_page";

export type RuntimeMemoryPrefetchHistoryScope =
  | "all"
  | "workspace"
  | "session";

export type RuntimeMemoryPrefetchHistoryLayerKey =
  | "rules"
  | "working"
  | "durable"
  | "team"
  | "compaction";

export interface RuntimeMemoryPrefetchHistoryEntry {
  signature: string;
  capturedAt: number;
  sessionId: string;
  workingDir: string;
  userMessage: string | null;
  source: RuntimeMemoryPrefetchHistorySource;
  counts: {
    rules: number;
    working: boolean;
    durable: number;
    team: number;
    compaction: boolean;
  };
  preview: {
    firstRuleSourcePath: string | null;
    workingExcerpt: string | null;
    durableTitle: string | null;
    teamKey: string | null;
    compactionSummary: string | null;
  };
}

export interface RuntimeMemoryPrefetchHistoryDiff {
  layerChanges: {
    rulesDelta: number;
    durableDelta: number;
    teamDelta: number;
    workingChanged: "same" | "added" | "removed";
    compactionChanged: "same" | "added" | "removed";
  };
  previewChanges: Array<{
    key:
      | "rule"
      | "working"
      | "durable"
      | "team"
      | "compaction"
      | "user_message";
    previous: string | null;
    current: string | null;
  }>;
  changed: boolean;
}

export interface RuntimeMemoryPrefetchHistoryDiffAssessment {
  status: "stronger" | "same" | "weaker" | "mixed";
  addedLayers: RuntimeMemoryPrefetchHistoryLayerKey[];
  removedLayers: RuntimeMemoryPrefetchHistoryLayerKey[];
  previewChanged: boolean;
}

export interface RuntimeMemoryPrefetchHistorySummary {
  totalEntries: number;
  uniqueSessions: number;
  uniqueWorkingDirs: number;
  layerEntryHits: {
    rules: number;
    working: number;
    durable: number;
    team: number;
    compaction: number;
  };
  changedEntries: number;
  layerStability: RuntimeMemoryPrefetchHistoryLayerStability[];
}

export interface RuntimeMemoryPrefetchHistoryLayerStability {
  key: RuntimeMemoryPrefetchHistoryLayerKey;
  latestValue: number;
  hitEntries: number;
  missEntries: number;
  valueChanges: number;
  state: "steady_hit" | "steady_miss" | "varying";
}

interface RecordRuntimeMemoryPrefetchHistoryInput {
  sessionId: string;
  workingDir: string;
  userMessage?: string | null;
  source: RuntimeMemoryPrefetchHistorySource;
  result: TurnMemoryPrefetchResult;
  capturedAt?: number;
}

const RUNTIME_MEMORY_PREFETCH_HISTORY_KEY =
  "lime:memory-runtime-prefetch-history:v1";
const MAX_RUNTIME_MEMORY_PREFETCH_HISTORY = 12;
const RUNTIME_MEMORY_PREFETCH_HISTORY_LAYER_KEYS: RuntimeMemoryPrefetchHistoryLayerKey[] = [
  "rules",
  "working",
  "durable",
  "team",
  "compaction",
];
const RUNTIME_MEMORY_PREFETCH_HISTORY_LAYER_LABELS: Record<
  RuntimeMemoryPrefetchHistoryLayerKey,
  string
> = {
  rules: "规则层",
  working: "工作层",
  durable: "持久层",
  team: "Team 层",
  compaction: "压缩层",
};

function normalizeText(value?: string | null, maxLength = 240): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }

  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function normalizeWorkingDir(workingDir: string): string {
  const normalized = workingDir.replace(/\\/g, "/").trim().replace(/\/+$/u, "");
  if (/^[A-Z]:\//.test(normalized)) {
    return `${normalized.slice(0, 1).toLowerCase()}${normalized.slice(1)}`;
  }
  return normalized;
}

function normalizeSessionId(sessionId?: string | null): string {
  return typeof sessionId === "string" ? sessionId.trim() : "";
}

function buildRuntimeMemoryPrefetchHistoryEntry(
  input: RecordRuntimeMemoryPrefetchHistoryInput,
): RuntimeMemoryPrefetchHistoryEntry | null {
  const sessionId = input.sessionId.trim();
  const workingDir = normalizeWorkingDir(input.workingDir);
  if (!sessionId || !workingDir) {
    return null;
  }

  const userMessage = normalizeText(input.userMessage, 280);
  const preview = {
    firstRuleSourcePath:
      input.result.rules_source_paths.find((path) => path.trim().length > 0) ||
      null,
    workingExcerpt: normalizeText(input.result.working_memory_excerpt, 320),
    durableTitle:
      input.result.durable_memories.find((entry) => entry.title.trim().length > 0)
        ?.title || null,
    teamKey:
      input.result.team_memory_entries.find((entry) => entry.key.trim().length > 0)
        ?.key || null,
    compactionSummary: normalizeText(
      input.result.latest_compaction?.summary_preview,
      320,
    ),
  };

  const counts = {
    rules: input.result.rules_source_paths.length,
    working: Boolean(input.result.working_memory_excerpt),
    durable: input.result.durable_memories.length,
    team: input.result.team_memory_entries.length,
    compaction: Boolean(input.result.latest_compaction),
  };

  const signature = [
    sessionId,
    workingDir,
    userMessage || "",
    counts.rules,
    counts.working ? "1" : "0",
    counts.durable,
    counts.team,
    counts.compaction ? "1" : "0",
    preview.firstRuleSourcePath || "",
    preview.workingExcerpt || "",
    preview.durableTitle || "",
    preview.teamKey || "",
    preview.compactionSummary || "",
  ].join("|");

  return {
    signature,
    capturedAt:
      typeof input.capturedAt === "number" && Number.isFinite(input.capturedAt)
        ? input.capturedAt
        : Date.now(),
    sessionId,
    workingDir,
    userMessage,
    source: input.source,
    counts,
    preview,
  };
}

function isRuntimeMemoryPrefetchHistoryEntry(
  value: unknown,
): value is RuntimeMemoryPrefetchHistoryEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const entry = value as Record<string, unknown>;
  const counts = entry.counts as Record<string, unknown> | undefined;
  const preview = entry.preview as Record<string, unknown> | undefined;

  return (
    typeof entry.signature === "string" &&
    typeof entry.capturedAt === "number" &&
    typeof entry.sessionId === "string" &&
    typeof entry.workingDir === "string" &&
    (entry.userMessage === null || typeof entry.userMessage === "string") &&
    (entry.source === "thread_reliability" || entry.source === "memory_page") &&
    typeof counts?.rules === "number" &&
    typeof counts?.working === "boolean" &&
    typeof counts?.durable === "number" &&
    typeof counts?.team === "number" &&
    typeof counts?.compaction === "boolean" &&
    (preview?.firstRuleSourcePath === null ||
      typeof preview?.firstRuleSourcePath === "string") &&
    (preview?.workingExcerpt === null ||
      typeof preview?.workingExcerpt === "string") &&
    (preview?.durableTitle === null ||
      typeof preview?.durableTitle === "string") &&
    (preview?.teamKey === null || typeof preview?.teamKey === "string") &&
    (preview?.compactionSummary === null ||
      typeof preview?.compactionSummary === "string")
  );
}

function readRuntimeMemoryPrefetchHistory(): RuntimeMemoryPrefetchHistoryEntry[] {
  if (typeof localStorage === "undefined") {
    return [];
  }

  const raw = localStorage.getItem(RUNTIME_MEMORY_PREFETCH_HISTORY_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(isRuntimeMemoryPrefetchHistoryEntry)
      .sort((left, right) => right.capturedAt - left.capturedAt);
  } catch {
    return [];
  }
}

function writeRuntimeMemoryPrefetchHistory(
  entries: RuntimeMemoryPrefetchHistoryEntry[],
): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(
    RUNTIME_MEMORY_PREFETCH_HISTORY_KEY,
    JSON.stringify(entries),
  );
}

export function listRuntimeMemoryPrefetchHistory(
  limit = MAX_RUNTIME_MEMORY_PREFETCH_HISTORY,
): RuntimeMemoryPrefetchHistoryEntry[] {
  if (limit <= 0) {
    return [];
  }
  return readRuntimeMemoryPrefetchHistory().slice(0, limit);
}

export function recordRuntimeMemoryPrefetchHistory(
  input: RecordRuntimeMemoryPrefetchHistoryInput,
): RuntimeMemoryPrefetchHistoryEntry[] {
  const nextEntry = buildRuntimeMemoryPrefetchHistoryEntry(input);
  if (!nextEntry) {
    return listRuntimeMemoryPrefetchHistory();
  }

  const nextEntries = [
    nextEntry,
    ...readRuntimeMemoryPrefetchHistory().filter(
      (entry) => entry.signature !== nextEntry.signature,
    ),
  ].slice(0, MAX_RUNTIME_MEMORY_PREFETCH_HISTORY);

  writeRuntimeMemoryPrefetchHistory(nextEntries);
  return nextEntries;
}

export function clearRuntimeMemoryPrefetchHistory(): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.removeItem(RUNTIME_MEMORY_PREFETCH_HISTORY_KEY);
}

export function filterRuntimeMemoryPrefetchHistory(
  entries: RuntimeMemoryPrefetchHistoryEntry[],
  query: {
    scope?: RuntimeMemoryPrefetchHistoryScope;
    sessionId?: string | null;
    workingDir?: string | null;
  } = {},
): RuntimeMemoryPrefetchHistoryEntry[] {
  const scope = query.scope || "all";
  if (scope === "all") {
    return entries;
  }

  if (scope === "session") {
    const sessionId = normalizeSessionId(query.sessionId);
    if (!sessionId) {
      return [];
    }
    return entries.filter((entry) => entry.sessionId === sessionId);
  }

  const workingDir =
    typeof query.workingDir === "string" && query.workingDir.trim()
      ? normalizeWorkingDir(query.workingDir)
      : "";
  if (!workingDir) {
    return [];
  }

  return entries.filter(
    (entry) => normalizeWorkingDir(entry.workingDir) === workingDir,
  );
}

function pushPreviewChange(
  changes: RuntimeMemoryPrefetchHistoryDiff["previewChanges"],
  key: RuntimeMemoryPrefetchHistoryDiff["previewChanges"][number]["key"],
  previous: string | null,
  current: string | null,
): void {
  if ((previous || "") === (current || "")) {
    return;
  }
  changes.push({ key, previous, current });
}

export function formatRuntimeMemoryPrefetchHistoryLayerLabel(
  key: RuntimeMemoryPrefetchHistoryLayerKey,
): string {
  return RUNTIME_MEMORY_PREFETCH_HISTORY_LAYER_LABELS[key];
}

export function compareRuntimeMemoryPrefetchHistoryEntries(
  current: RuntimeMemoryPrefetchHistoryEntry,
  previous: RuntimeMemoryPrefetchHistoryEntry,
): RuntimeMemoryPrefetchHistoryDiff {
  const previewChanges: RuntimeMemoryPrefetchHistoryDiff["previewChanges"] = [];
  pushPreviewChange(
    previewChanges,
    "user_message",
    previous.userMessage,
    current.userMessage,
  );
  pushPreviewChange(
    previewChanges,
    "rule",
    previous.preview.firstRuleSourcePath,
    current.preview.firstRuleSourcePath,
  );
  pushPreviewChange(
    previewChanges,
    "working",
    previous.preview.workingExcerpt,
    current.preview.workingExcerpt,
  );
  pushPreviewChange(
    previewChanges,
    "durable",
    previous.preview.durableTitle,
    current.preview.durableTitle,
  );
  pushPreviewChange(
    previewChanges,
    "team",
    previous.preview.teamKey,
    current.preview.teamKey,
  );
  pushPreviewChange(
    previewChanges,
    "compaction",
    previous.preview.compactionSummary,
    current.preview.compactionSummary,
  );

  const layerChanges = {
    rulesDelta: current.counts.rules - previous.counts.rules,
    durableDelta: current.counts.durable - previous.counts.durable,
    teamDelta: current.counts.team - previous.counts.team,
    workingChanged:
      current.counts.working === previous.counts.working
        ? "same"
        : current.counts.working
          ? "added"
          : "removed",
    compactionChanged:
      current.counts.compaction === previous.counts.compaction
        ? "same"
        : current.counts.compaction
          ? "added"
          : "removed",
  } as const;

  return {
    layerChanges,
    previewChanges,
    changed:
      layerChanges.rulesDelta !== 0 ||
      layerChanges.durableDelta !== 0 ||
      layerChanges.teamDelta !== 0 ||
      layerChanges.workingChanged !== "same" ||
      layerChanges.compactionChanged !== "same" ||
      previewChanges.length > 0,
  };
}

export function assessRuntimeMemoryPrefetchHistoryDiff(
  diff: RuntimeMemoryPrefetchHistoryDiff,
): RuntimeMemoryPrefetchHistoryDiffAssessment {
  const addedLayers: RuntimeMemoryPrefetchHistoryLayerKey[] = [];
  const removedLayers: RuntimeMemoryPrefetchHistoryLayerKey[] = [];

  if (diff.layerChanges.rulesDelta > 0) {
    addedLayers.push("rules");
  } else if (diff.layerChanges.rulesDelta < 0) {
    removedLayers.push("rules");
  }

  if (diff.layerChanges.workingChanged === "added") {
    addedLayers.push("working");
  } else if (diff.layerChanges.workingChanged === "removed") {
    removedLayers.push("working");
  }

  if (diff.layerChanges.durableDelta > 0) {
    addedLayers.push("durable");
  } else if (diff.layerChanges.durableDelta < 0) {
    removedLayers.push("durable");
  }

  if (diff.layerChanges.teamDelta > 0) {
    addedLayers.push("team");
  } else if (diff.layerChanges.teamDelta < 0) {
    removedLayers.push("team");
  }

  if (diff.layerChanges.compactionChanged === "added") {
    addedLayers.push("compaction");
  } else if (diff.layerChanges.compactionChanged === "removed") {
    removedLayers.push("compaction");
  }

  let status: RuntimeMemoryPrefetchHistoryDiffAssessment["status"] = "same";
  if (addedLayers.length > 0 && removedLayers.length === 0) {
    status = "stronger";
  } else if (removedLayers.length > 0 && addedLayers.length === 0) {
    status = "weaker";
  } else if (addedLayers.length > 0 && removedLayers.length > 0) {
    status = "mixed";
  }

  return {
    status,
    addedLayers,
    removedLayers,
    previewChanged: diff.previewChanges.length > 0,
  };
}

export function formatRuntimeMemoryPrefetchHistoryDiffStatusLabel(
  status: RuntimeMemoryPrefetchHistoryDiffAssessment["status"],
): string {
  switch (status) {
    case "stronger":
      return "补强";
    case "weaker":
      return "退化";
    case "mixed":
      return "波动";
    case "same":
    default:
      return "持平";
  }
}

function joinRuntimeMemoryPrefetchHistoryLayerLabels(
  layers: RuntimeMemoryPrefetchHistoryLayerKey[],
): string {
  return layers.map((layer) => formatRuntimeMemoryPrefetchHistoryLayerLabel(layer)).join("、");
}

export function describeRuntimeMemoryPrefetchHistoryDiffAssessment(
  assessment: RuntimeMemoryPrefetchHistoryDiffAssessment,
): string {
  if (assessment.status === "same") {
    return assessment.previewChanged
      ? "命中层级持平，但摘要内容有更新。"
      : "命中层级与基线持平。";
  }

  if (assessment.status === "stronger") {
    return `补强层：${joinRuntimeMemoryPrefetchHistoryLayerLabels(assessment.addedLayers)}。${
      assessment.previewChanged ? " 摘要内容也有更新。" : ""
    }`;
  }

  if (assessment.status === "weaker") {
    return `退化层：${joinRuntimeMemoryPrefetchHistoryLayerLabels(assessment.removedLayers)}。${
      assessment.previewChanged ? " 摘要内容也有更新。" : ""
    }`;
  }

  return `补强层：${joinRuntimeMemoryPrefetchHistoryLayerLabels(assessment.addedLayers)}；退化层：${joinRuntimeMemoryPrefetchHistoryLayerLabels(assessment.removedLayers)}。${
    assessment.previewChanged ? " 摘要内容也有更新。" : ""
  }`;
}

export function summarizeRuntimeMemoryPrefetchHistory(
  entries: RuntimeMemoryPrefetchHistoryEntry[],
): RuntimeMemoryPrefetchHistorySummary {
  const uniqueSessions = new Set<string>();
  const uniqueWorkingDirs = new Set<string>();
  const layerEntryHits: RuntimeMemoryPrefetchHistorySummary["layerEntryHits"] = {
    rules: 0,
    working: 0,
    durable: 0,
    team: 0,
    compaction: 0,
  };

  let changedEntries = 0;

  const layerStability = RUNTIME_MEMORY_PREFETCH_HISTORY_LAYER_KEYS.map((key) => {
    const values = entries.map((entry) => {
      switch (key) {
        case "rules":
          return entry.counts.rules;
        case "working":
          return entry.counts.working ? 1 : 0;
        case "durable":
          return entry.counts.durable;
        case "team":
          return entry.counts.team;
        case "compaction":
          return entry.counts.compaction ? 1 : 0;
        default:
          return 0;
      }
    });

    const hitEntries = values.filter((value) => value > 0).length;
    const missEntries = values.length - hitEntries;
    const valueChanges = values.reduce((count, value, index) => {
      if (index === 0) {
        return count;
      }
      return count + (value !== values[index - 1] ? 1 : 0);
    }, 0);

    return {
      key,
      latestValue: values[0] || 0,
      hitEntries,
      missEntries,
      valueChanges,
      state:
        hitEntries === 0
          ? "steady_miss"
          : missEntries === 0 && valueChanges === 0
            ? "steady_hit"
            : "varying",
    } satisfies RuntimeMemoryPrefetchHistoryLayerStability;
  });

  entries.forEach((entry, index) => {
    uniqueSessions.add(entry.sessionId);
    uniqueWorkingDirs.add(normalizeWorkingDir(entry.workingDir));

    if (entry.counts.rules > 0) {
      layerEntryHits.rules += 1;
    }
    if (entry.counts.working) {
      layerEntryHits.working += 1;
    }
    if (entry.counts.durable > 0) {
      layerEntryHits.durable += 1;
    }
    if (entry.counts.team > 0) {
      layerEntryHits.team += 1;
    }
    if (entry.counts.compaction) {
      layerEntryHits.compaction += 1;
    }

    const previousEntry = entries[index + 1];
    if (
      previousEntry &&
      compareRuntimeMemoryPrefetchHistoryEntries(entry, previousEntry).changed
    ) {
      changedEntries += 1;
    }
  });

  return {
    totalEntries: entries.length,
    uniqueSessions: uniqueSessions.size,
    uniqueWorkingDirs: uniqueWorkingDirs.size,
    layerEntryHits,
    changedEntries,
    layerStability,
  };
}
