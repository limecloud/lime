import { getScopedStorageKey } from "../hooks/agentChatShared";
import {
  loadPersisted,
  loadTransient,
  savePersisted,
  saveTransient,
} from "../hooks/agentChatStorage";
import {
  createInitialSessionImageWorkbenchState,
  type ImageWorkbenchOutput,
  type ImageWorkbenchTask,
  type SessionImageWorkbenchState,
} from "./imageWorkbenchHelpers";
import type { Message, MessageImageWorkbenchPreview } from "../types";

export interface SessionImageWorkbenchCachedState {
  state: SessionImageWorkbenchState;
  cacheMetadata: {
    storageKind: "transient" | "persisted";
    freshness: "fresh" | "stale";
    updatedAt: number;
    lastAccessedAt: number;
    expiresAt: number;
    staleUntil: number;
    contentId: string | null;
  };
}

interface SessionImageWorkbenchCachedStateRecord {
  state: SessionImageWorkbenchState;
  updatedAt: number;
  lastAccessedAt: number;
  expiresAt: number;
  staleUntil: number;
  contentId: string | null;
}

interface SessionImageWorkbenchCachePolicy {
  maxEntries: number;
  ttlMs: number;
  staleGraceMs: number;
}

interface LoadSessionImageWorkbenchCachedStateOptions {
  nowMs?: number;
  contentId?: string | null;
  refreshAccess?: boolean;
}

interface SaveSessionImageWorkbenchCachedStateOptions {
  nowMs?: number;
  contentId?: string | null;
}

const MAX_CACHED_IMAGE_WORKBENCH_STATES = 12;
const MAX_PERSISTED_IMAGE_WORKBENCH_STATES = 8;
const MAX_CACHED_IMAGE_WORKBENCH_TASKS = 8;
const MAX_CACHED_IMAGE_WORKBENCH_OUTPUTS = 36;
const TRANSIENT_IMAGE_WORKBENCH_TTL_MS = 10 * 60 * 1000;
const PERSISTED_IMAGE_WORKBENCH_TTL_MS = 30 * 60 * 1000;
const IMAGE_WORKBENCH_STALE_GRACE_MS = 2 * 60 * 1000;

const TRANSIENT_IMAGE_WORKBENCH_POLICY: SessionImageWorkbenchCachePolicy = {
  maxEntries: MAX_CACHED_IMAGE_WORKBENCH_STATES,
  ttlMs: TRANSIENT_IMAGE_WORKBENCH_TTL_MS,
  staleGraceMs: IMAGE_WORKBENCH_STALE_GRACE_MS,
};

const PERSISTED_IMAGE_WORKBENCH_POLICY: SessionImageWorkbenchCachePolicy = {
  maxEntries: MAX_PERSISTED_IMAGE_WORKBENCH_STATES,
  ttlMs: PERSISTED_IMAGE_WORKBENCH_TTL_MS,
  staleGraceMs: IMAGE_WORKBENCH_STALE_GRACE_MS,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeOptionalContentId(value: string | null | undefined) {
  return value?.trim() || null;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => readString(item))
        .filter((item): item is string => item !== null)
    : [];
}

function normalizeTaskMode(value: unknown): ImageWorkbenchTask["mode"] {
  return value === "edit" || value === "variation" ? value : "generate";
}

function normalizeTaskStatus(value: unknown): ImageWorkbenchTask["status"] {
  switch (value) {
    case "routing":
    case "queued":
    case "running":
    case "partial":
    case "complete":
    case "error":
    case "cancelled":
      return value;
    default:
      return "running";
  }
}

function normalizeImageWorkbenchTask(value: unknown): ImageWorkbenchTask | null {
  const record = asRecord(value);
  const id = readString(record?.id);
  if (!record || !id) {
    return null;
  }

  const outputIds = normalizeStringArray(record.outputIds);
  const hookImageIds = normalizeStringArray(record.hookImageIds);
  const createdAt = readFiniteNumber(record.createdAt) ?? Date.now();
  const expectedCount =
    (readFiniteNumber(record.expectedCount) ?? outputIds.length) || 1;

  return {
    ...(record as Partial<ImageWorkbenchTask>),
    id,
    sessionId: readString(record.sessionId) || id,
    mode: normalizeTaskMode(record.mode),
    status: normalizeTaskStatus(record.status),
    prompt: readString(record.prompt) || "图片任务",
    rawText: readString(record.rawText) || readString(record.prompt) || "",
    expectedCount,
    outputIds,
    hookImageIds,
    createdAt,
    applyTarget: asRecord(record.applyTarget)
      ? (record.applyTarget as ImageWorkbenchTask["applyTarget"])
      : null,
    taskFilePath: readString(record.taskFilePath),
    artifactPath: readString(record.artifactPath),
  };
}

function normalizeImageWorkbenchOutput(
  value: unknown,
): ImageWorkbenchOutput | null {
  const record = asRecord(value);
  const id = readString(record?.id);
  const taskId = readString(record?.taskId);
  const url = readString(record?.url);
  if (!record || !id || !taskId || !url) {
    return null;
  }

  return {
    ...(record as Partial<ImageWorkbenchOutput>),
    id,
    taskId,
    hookImageId: readString(record.hookImageId) || `${id}:hook`,
    refId: readString(record.refId) || id,
    url,
    prompt: readString(record.prompt) || "图片结果",
    createdAt: readFiniteNumber(record.createdAt) ?? Date.now(),
    parentOutputId: readString(record.parentOutputId),
    resourceSaved: record.resourceSaved === true,
    applyTarget: asRecord(record.applyTarget)
      ? (record.applyTarget as ImageWorkbenchOutput["applyTarget"])
      : null,
  };
}

function normalizeSessionImageWorkbenchState(
  value: unknown,
): SessionImageWorkbenchState {
  const record = asRecord(value);
  if (!record) {
    return createInitialSessionImageWorkbenchState();
  }

  const tasks = Array.isArray(record.tasks)
    ? record.tasks
        .map(normalizeImageWorkbenchTask)
        .filter((item): item is ImageWorkbenchTask => item !== null)
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, MAX_CACHED_IMAGE_WORKBENCH_TASKS)
    : [];
  const taskIds = new Set(tasks.map((task) => task.id));
  const outputs = Array.isArray(record.outputs)
    ? record.outputs
        .map(normalizeImageWorkbenchOutput)
        .filter(
          (item): item is ImageWorkbenchOutput =>
            item !== null && taskIds.has(item.taskId),
        )
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, MAX_CACHED_IMAGE_WORKBENCH_OUTPUTS)
    : [];
  const outputIds = new Set(outputs.map((output) => output.id));
  const selectedOutputId = readString(record.selectedOutputId);

  return {
    active: record.active === true,
    viewport: asRecord(record.viewport)
      ? {
          x: readFiniteNumber((record.viewport as Record<string, unknown>).x) ?? 0,
          y: readFiniteNumber((record.viewport as Record<string, unknown>).y) ?? 0,
          scale:
            readFiniteNumber(
              (record.viewport as Record<string, unknown>).scale,
            ) ?? 1,
        }
      : { x: 0, y: 0, scale: 1 },
    tasks,
    outputs,
    selectedOutputId:
      selectedOutputId && outputIds.has(selectedOutputId)
        ? selectedOutputId
        : outputs[0]?.id || null,
    nextOutputIndex:
      readFiniteNumber(record.nextOutputIndex) ??
      Math.max(1, outputs.length + 1),
  };
}

export function isSessionImageWorkbenchStateMeaningful(
  value?: SessionImageWorkbenchState | null,
): boolean {
  return Boolean(value && (value.tasks.length > 0 || value.outputs.length > 0));
}

function normalizeTaskStatusFromPreview(
  status: MessageImageWorkbenchPreview["status"],
): ImageWorkbenchTask["status"] {
  switch (status) {
    case "complete":
      return "complete";
    case "partial":
      return "partial";
    case "failed":
      return "error";
    case "cancelled":
      return "cancelled";
    case "running":
    default:
      return "running";
  }
}

function resolveMessageTimestampMs(message: Message): number {
  if (message.timestamp instanceof Date) {
    return message.timestamp.getTime();
  }
  const timestamp = Date.parse(String(message.timestamp));
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function buildOutputsFromPreview(params: {
  preview: MessageImageWorkbenchPreview;
  createdAt: number;
}): ImageWorkbenchOutput[] {
  const previewImages =
    params.preview.previewImages?.filter((url) => url.trim()) || [];
  const imageUrls =
    previewImages.length > 0
      ? previewImages
      : params.preview.imageUrl?.trim()
        ? [params.preview.imageUrl.trim()]
        : [];

  return imageUrls.map((url, index) => ({
    id: `${params.preview.taskId}:output:${index + 1}`,
    taskId: params.preview.taskId,
    hookImageId: `${params.preview.taskId}:hook:${index + 1}`,
    refId: `img-${params.preview.taskId.slice(0, 6)}-${index + 1}`,
    url,
    prompt: params.preview.prompt || "图片结果",
    createdAt: params.createdAt + index,
    size: params.preview.size,
    parentOutputId: null,
    resourceSaved: false,
    applyTarget: null,
  }));
}

export function buildSessionImageWorkbenchStateFromMessages(
  messages: Message[],
): SessionImageWorkbenchState {
  const state = createInitialSessionImageWorkbenchState();
  const seenTaskIds = new Set<string>();

  messages.forEach((message) => {
    const preview = message.imageWorkbenchPreview;
    const taskId = preview?.taskId?.trim();
    if (!preview || !taskId || seenTaskIds.has(taskId)) {
      return;
    }
    seenTaskIds.add(taskId);

    const createdAt = resolveMessageTimestampMs(message);
    const outputs = buildOutputsFromPreview({
      preview,
      createdAt,
    });
    const outputIds = outputs.map((output) => output.id);
    const expectedCount =
      (preview.expectedImageCount ?? preview.imageCount ?? outputIds.length) ||
      1;

    state.tasks.push({
      sessionId: taskId,
      id: taskId,
      mode: preview.mode || "generate",
      status: normalizeTaskStatusFromPreview(preview.status),
      prompt: preview.prompt || "图片任务",
      rawText: preview.prompt || message.content || "图片任务",
      expectedCount,
      layoutHint: preview.layoutHint ?? null,
      storyboardSlots: preview.storyboardSlots,
      outputIds,
      targetOutputId: null,
      targetOutputRefId: null,
      sourceImageUrl: preview.sourceImageUrl ?? null,
      sourceImagePrompt: preview.sourceImagePrompt ?? null,
      sourceImageRef: preview.sourceImageRef ?? null,
      sourceImageCount: preview.sourceImageCount,
      createdAt,
      failureMessage: preview.statusMessage ?? undefined,
      hookImageIds: outputs.map((output) => output.hookImageId),
      applyTarget: null,
      taskFilePath: preview.taskFilePath ?? null,
      artifactPath: preview.artifactPath ?? null,
    });
    state.outputs.push(...outputs);
  });

  if (state.outputs.length > 0) {
    state.selectedOutputId = state.outputs[0]?.id || null;
    state.nextOutputIndex = state.outputs.length + 1;
  }

  return normalizeSessionImageWorkbenchState(state);
}

function normalizeCachedStateRecord(
  value: unknown,
  policy: SessionImageWorkbenchCachePolicy,
  nowMs: number,
  options?: LoadSessionImageWorkbenchCachedStateOptions,
): SessionImageWorkbenchCachedStateRecord | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const updatedAt = readFiniteNumber(record.updatedAt) ?? nowMs;
  const lastAccessedAt = readFiniteNumber(record.lastAccessedAt) ?? updatedAt;
  const expiresAt = readFiniteNumber(record.expiresAt) ?? updatedAt + policy.ttlMs;
  const staleUntil =
    readFiniteNumber(record.staleUntil) ?? expiresAt + policy.staleGraceMs;
  if (nowMs > staleUntil) {
    return null;
  }

  const contentId = normalizeOptionalContentId(readString(record.contentId));
  const targetContentId = normalizeOptionalContentId(options?.contentId);
  if (contentId && targetContentId && contentId !== targetContentId) {
    return null;
  }

  const state = normalizeSessionImageWorkbenchState(record.state);
  if (!isSessionImageWorkbenchStateMeaningful(state)) {
    return null;
  }

  return {
    state,
    updatedAt,
    lastAccessedAt,
    expiresAt,
    staleUntil,
    contentId,
  };
}

function pruneCacheEntries(
  snapshotMap: Record<string, unknown>,
  policy: SessionImageWorkbenchCachePolicy,
  nowMs: number,
) {
  return Object.entries(snapshotMap)
    .map(
      ([id, value]) =>
        [id, normalizeCachedStateRecord(value, policy, nowMs)] as const,
    )
    .filter(
      (entry): entry is [string, SessionImageWorkbenchCachedStateRecord] =>
        entry[1] !== null,
    )
    .sort((left, right) => right[1].lastAccessedAt - left[1].lastAccessedAt)
    .slice(0, policy.maxEntries);
}

function toCachedState(
  record: SessionImageWorkbenchCachedStateRecord,
  storageKind: SessionImageWorkbenchCachedState["cacheMetadata"]["storageKind"],
  nowMs: number,
): SessionImageWorkbenchCachedState {
  return {
    state: record.state,
    cacheMetadata: {
      storageKind,
      freshness: nowMs < record.expiresAt ? "fresh" : "stale",
      updatedAt: record.updatedAt,
      lastAccessedAt: record.lastAccessedAt,
      expiresAt: record.expiresAt,
      staleUntil: record.staleUntil,
      contentId: record.contentId,
    },
  };
}

export function loadSessionImageWorkbenchCachedState(
  workspaceId: string,
  sessionId: string,
  options: LoadSessionImageWorkbenchCachedStateOptions = {},
): SessionImageWorkbenchCachedState | null {
  const nowMs = options.nowMs ?? Date.now();
  const shouldRefreshAccess = options.refreshAccess !== false;
  const cacheKey = getScopedStorageKey(workspaceId, "image_workbench_states");
  const snapshotMap = loadTransient<Record<string, unknown>>(cacheKey, {});
  const transientSnapshot = normalizeCachedStateRecord(
    snapshotMap[sessionId],
    TRANSIENT_IMAGE_WORKBENCH_POLICY,
    nowMs,
    options,
  );

  if (transientSnapshot) {
    if (!shouldRefreshAccess) {
      return toCachedState(transientSnapshot, "transient", nowMs);
    }

    const refreshedMap = {
      ...snapshotMap,
      [sessionId]: {
        ...transientSnapshot,
        lastAccessedAt: nowMs,
      },
    };
    saveTransient(
      cacheKey,
      Object.fromEntries(
        pruneCacheEntries(refreshedMap, TRANSIENT_IMAGE_WORKBENCH_POLICY, nowMs),
      ),
    );
    return toCachedState(
      {
        ...transientSnapshot,
        lastAccessedAt: nowMs,
      },
      "transient",
      nowMs,
    );
  }

  const persistedCacheKey = getScopedStorageKey(
    workspaceId,
    "image_workbench_states_persisted",
  );
  const persistedSnapshotMap = loadPersisted<Record<string, unknown>>(
    persistedCacheKey,
    {},
  );
  const persistedSnapshot = normalizeCachedStateRecord(
    persistedSnapshotMap[sessionId],
    PERSISTED_IMAGE_WORKBENCH_POLICY,
    nowMs,
    options,
  );

  if (!persistedSnapshot) {
    if (!shouldRefreshAccess) {
      return null;
    }

    saveTransient(
      cacheKey,
      Object.fromEntries(
        pruneCacheEntries(snapshotMap, TRANSIENT_IMAGE_WORKBENCH_POLICY, nowMs),
      ),
    );
    savePersisted(
      persistedCacheKey,
      Object.fromEntries(
        pruneCacheEntries(
          persistedSnapshotMap,
          PERSISTED_IMAGE_WORKBENCH_POLICY,
          nowMs,
        ),
      ),
    );
    return null;
  }

  if (!shouldRefreshAccess) {
    return toCachedState(persistedSnapshot, "persisted", nowMs);
  }

  const refreshedPersistedMap = {
    ...persistedSnapshotMap,
    [sessionId]: {
      ...persistedSnapshot,
      lastAccessedAt: nowMs,
    },
  };
  savePersisted(
    persistedCacheKey,
    Object.fromEntries(
      pruneCacheEntries(
        refreshedPersistedMap,
        PERSISTED_IMAGE_WORKBENCH_POLICY,
        nowMs,
      ),
    ),
  );

  return toCachedState(
    {
      ...persistedSnapshot,
      lastAccessedAt: nowMs,
    },
    "persisted",
    nowMs,
  );
}

export function saveSessionImageWorkbenchCachedState(
  workspaceId: string,
  sessionId: string,
  state: SessionImageWorkbenchState,
  options: SaveSessionImageWorkbenchCachedStateOptions = {},
): void {
  const normalizedState = normalizeSessionImageWorkbenchState(state);
  if (!isSessionImageWorkbenchStateMeaningful(normalizedState)) {
    return;
  }

  const nowMs = options.nowMs ?? Date.now();
  const contentId = normalizeOptionalContentId(options.contentId);
  const cacheKey = getScopedStorageKey(workspaceId, "image_workbench_states");
  const persistedCacheKey = getScopedStorageKey(
    workspaceId,
    "image_workbench_states_persisted",
  );
  const currentMap = loadTransient<Record<string, unknown>>(cacheKey, {});
  const persistedMap = loadPersisted<Record<string, unknown>>(
    persistedCacheKey,
    {},
  );
  const transientRecord = {
    state: normalizedState,
    updatedAt: nowMs,
    lastAccessedAt: nowMs,
    expiresAt: nowMs + TRANSIENT_IMAGE_WORKBENCH_POLICY.ttlMs,
    staleUntil:
      nowMs +
      TRANSIENT_IMAGE_WORKBENCH_POLICY.ttlMs +
      TRANSIENT_IMAGE_WORKBENCH_POLICY.staleGraceMs,
    contentId,
  } satisfies SessionImageWorkbenchCachedStateRecord;
  const persistedRecord = {
    state: normalizedState,
    updatedAt: nowMs,
    lastAccessedAt: nowMs,
    expiresAt: nowMs + PERSISTED_IMAGE_WORKBENCH_POLICY.ttlMs,
    staleUntil:
      nowMs +
      PERSISTED_IMAGE_WORKBENCH_POLICY.ttlMs +
      PERSISTED_IMAGE_WORKBENCH_POLICY.staleGraceMs,
    contentId,
  } satisfies SessionImageWorkbenchCachedStateRecord;

  saveTransient(
    cacheKey,
    Object.fromEntries(
      pruneCacheEntries(
        {
          ...currentMap,
          [sessionId]: transientRecord,
        },
        TRANSIENT_IMAGE_WORKBENCH_POLICY,
        nowMs,
      ),
    ),
  );
  savePersisted(
    persistedCacheKey,
    Object.fromEntries(
      pruneCacheEntries(
        {
          ...persistedMap,
          [sessionId]: persistedRecord,
        },
        PERSISTED_IMAGE_WORKBENCH_POLICY,
        nowMs,
      ),
    ),
  );
}
