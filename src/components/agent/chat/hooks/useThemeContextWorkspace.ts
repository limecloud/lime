import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getContent, listContents, type ContentListItem } from "@/lib/api/project";
import { extractArtifactProtocolPathsFromValue } from "@/lib/artifact-protocol";
import { normalizeProjectId } from "../utils/topicProjectResolution";
import { useMaterials } from "@/hooks/useMaterials";
import { isSpecializedWorkbenchTheme } from "@/lib/workspace/workbenchContract";
import type { Message } from "../types";
import {
  searchThemeContextWithWebSearch,
  type SearchCitation,
  type ThemeContextSearchMode,
} from "../utils/contextSearch";

const CONTEXT_SELECTION_KEY_PREFIX = "agent_active_context_ids_";
const CONTEXT_MANUAL_SELECTION_KEY_PREFIX = "agent_manual_context_ids_";
const GENERATED_CONTEXT_STORAGE_KEY_PREFIX = "agent_generated_contexts_";
const DEFAULT_CONTEXT_ITEM_LIMIT = 12;
const DEFAULT_CONTEXT_TOKEN_LIMIT = 32000;
const DEFAULT_ACTIVE_CONTEXT_COUNT = 3;
const LOCAL_CONTEXT_PREVIEW_LENGTH = 900;
const SEARCH_CONTEXT_PREVIEW_LENGTH = 560;

type ContextSource = "material" | "content" | "search";

interface GeneratedSearchContextItem {
  id: string;
  name: string;
  source: "search";
  searchMode: ThemeContextSearchMode;
  query: string;
  summary: string;
  citations: SearchCitation[];
  rawResponse?: string;
  createdAt: number;
}

interface ContextCatalogItem {
  id: string;
  name: string;
  source: ContextSource;
  normalizedText: string;
  estimatedTokens: number;
  previewText: string;
  bodyText?: string;
  query?: string;
  searchMode?: ThemeContextSearchMode;
  citations?: SearchCitation[];
  createdAt?: number;
}

export interface SidebarContextItem {
  id: string;
  name: string;
  source: ContextSource;
  active: boolean;
  searchMode?: ThemeContextSearchMode;
  query?: string;
  previewText?: string;
  citations?: SearchCitation[];
  createdAt?: number;
}

export interface SidebarActivityLog {
  id: string;
  name: string;
  status: "running" | "completed" | "failed";
  timeLabel: string;
  durationLabel?: string;
  applyTarget?: string;
  contextIds?: string[];
  inputSummary?: string;
  outputSummary?: string;
  runId?: string;
  executionId?: string;
  sessionId?: string;
  artifactPaths?: string[];
  messageId?: string;
  gateKey?: "idle" | "topic_select" | "write_mode" | "publish_confirm";
  source?: string;
  sourceRef?: string;
}

export interface ThemeContextWorkspaceState {
  generalWorkbenchEnabled: boolean;
  enabled: boolean;
  contextSearchQuery: string;
  setContextSearchQuery: (value: string) => void;
  contextSearchMode: ThemeContextSearchMode;
  setContextSearchMode: (value: ThemeContextSearchMode) => void;
  contextSearchLoading: boolean;
  contextSearchError: string | null;
  contextSearchBlockedReason: string | null;
  submitContextSearch: () => Promise<void>;
  addTextContext: (payload: {
    content: string;
    name?: string;
  }) => Promise<void>;
  addLinkContext: (payload: {
    url: string;
    name?: string;
  }) => Promise<void>;
  addFileContext: (payload: {
    path: string;
    name?: string;
  }) => Promise<void>;
  sidebarContextItems: SidebarContextItem[];
  toggleContextActive: (contextId: string) => void;
  getContextDetail: (contextId: string) => ContextCatalogItem | null;
  contextBudget: {
    activeCount: number;
    activeCountLimit: number;
    estimatedTokens: number;
    tokenLimit: number;
  };
  activityLogs: SidebarActivityLog[];
  activeContextPrompt: string;
  prepareActiveContextPrompt: () => Promise<string>;
}

function buildContextStorageKey(projectId: string) {
  return `${CONTEXT_SELECTION_KEY_PREFIX}${projectId}`;
}

function buildManualContextStorageKey(projectId: string) {
  return `${CONTEXT_MANUAL_SELECTION_KEY_PREFIX}${projectId}`;
}

function buildGeneratedContextStorageKey(projectId: string) {
  return `${GENERATED_CONTEXT_STORAGE_KEY_PREFIX}${projectId}`;
}

function loadTransient<T>(key: string, defaultValue: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) {
      return defaultValue;
    }
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

function saveTransient(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function normalizeDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function formatLogTimeLabel(rawDate: unknown): string {
  const date = normalizeDate(rawDate);
  if (!date) {
    return "--:--";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function truncateText(value: string, maxLength = 100): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateContextBody(value: string, source: ContextSource): string {
  const normalized = normalizeText(value);
  const maxLength =
    source === "search" ? SEARCH_CONTEXT_PREVIEW_LENGTH : LOCAL_CONTEXT_PREVIEW_LENGTH;
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

function estimateTokens(value: string, fallback = 120): number {
  const normalized = normalizeText(value);
  if (!normalized) {
    return fallback;
  }
  return Math.max(fallback, Math.ceil(normalized.length / 4));
}

function resolveContextTitle(value: string, fallback: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return fallback;
  }
  return normalized.length > 36 ? `${normalized.slice(0, 36)}...` : normalized;
}

function resolvePathFileName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const last = segments[segments.length - 1]?.trim();
  return last || "上下文文件";
}

function resolveContentTimestamp(content: ContentListItem): number {
  if (typeof content.updated_at === "number" && Number.isFinite(content.updated_at)) {
    return content.updated_at;
  }
  if (typeof content.created_at === "number" && Number.isFinite(content.created_at)) {
    return content.created_at;
  }
  return 0;
}

function dedupeContentsByTitle(contents: ContentListItem[]): ContentListItem[] {
  const deduped = new Map<string, ContentListItem>();

  contents.forEach((item) => {
    const normalizedTitle = normalizeText(item.title || "").toLowerCase();
    const dedupeKey = normalizedTitle || `content:${item.id}`;
    const existing = deduped.get(dedupeKey);
    if (!existing) {
      deduped.set(dedupeKey, item);
      return;
    }
    if (resolveContentTimestamp(item) >= resolveContentTimestamp(existing)) {
      deduped.set(dedupeKey, item);
    }
  });

  return Array.from(deduped.values());
}

function formatDurationLabel(
  startTime?: unknown,
  endTime?: unknown,
): string | undefined {
  const normalizedStart = normalizeDate(startTime);
  const normalizedEnd = normalizeDate(endTime);
  if (!normalizedStart || !normalizedEnd) {
    return undefined;
  }

  const durationMs = normalizedEnd.getTime() - normalizedStart.getTime();
  if (durationMs < 0) {
    return undefined;
  }

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  if (durationMs < 60000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }

  return `${Math.floor(durationMs / 60000)}m${Math.round(
    (durationMs % 60000) / 1000,
  )}s`;
}

function tryParseJson(raw?: string): unknown {
  if (!raw || typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function extractToolCallArtifactPaths(
  argumentsRaw?: string,
  outputRaw?: string,
): string[] {
  const bucket = new Set<string>();
  const parsedArgs = tryParseJson(argumentsRaw);
  const parsedOutput = tryParseJson(outputRaw);

  for (const path of extractArtifactProtocolPathsFromValue(parsedArgs)) {
    bucket.add(path);
  }
  for (const path of extractArtifactProtocolPathsFromValue(parsedOutput)) {
    bucket.add(path);
  }

  return Array.from(bucket);
}

function resolveApplyTarget(toolName: string): string {
  const normalized = toolName.toLowerCase();
  if (
    normalized.includes("cover") ||
    normalized.includes("image") ||
    normalized.includes("illustration")
  ) {
    return "封面/插图";
  }
  if (
    normalized.includes("typesetting") ||
    normalized.includes("format") ||
    normalized.includes("review")
  ) {
    return "主稿排版";
  }
  if (normalized.includes("publish")) {
    return "发布素材";
  }
  return "主稿内容";
}

function resolveContextSourceLabel(
  source: ContextSource,
  searchMode?: ThemeContextSearchMode,
): string {
  if (source === "material") {
    return "素材库";
  }
  if (source === "content") {
    return "历史内容";
  }
  return searchMode === "social" ? "社交媒体" : "网络搜索";
}

function buildGeneratedContextId(
  searchMode: ThemeContextSearchMode,
  query: string,
): string {
  const normalizedQuery = normalizeText(query).toLowerCase();
  return `search:${searchMode}:${normalizedQuery}`;
}

function buildActiveContextPromptText(
  items: ContextCatalogItem[],
  contextBodyById: Record<string, string>,
): string {
  if (items.length === 0) {
    return "";
  }

  const blocks = items.map((item, index) => {
    const body =
      contextBodyById[item.id] ||
      item.bodyText ||
      truncateContextBody(item.previewText || item.name, item.source);
    const lines = [
      `${index + 1}. [${resolveContextSourceLabel(item.source, item.searchMode)}] ${item.name}`,
    ];

    if (item.source === "search" && item.query) {
      lines.push(`检索词：${item.query}`);
    }

    if (body) {
      lines.push(`摘要：${body}`);
    }

    if (item.source === "search" && item.citations && item.citations.length > 0) {
      lines.push("来源：");
      item.citations.slice(0, 5).forEach((citation) => {
        lines.push(`- ${citation.title} ${citation.url}`);
      });
    }

    return lines.join("\n");
  });

  return [
    "[生效上下文]",
    blocks.join("\n\n"),
    "",
    "[要求]",
    "优先基于上述上下文作答；若上下文不足，请明确指出不足点。",
  ].join("\n");
}

function resolveContextTokenEstimate(
  item: ContextCatalogItem,
  contextBodyById: Record<string, string>,
): number {
  const cachedBody = contextBodyById[item.id];
  const sourceText = cachedBody || item.bodyText || item.previewText || item.name;
  return estimateTokens(sourceText, item.estimatedTokens);
}

interface UseThemeContextWorkspaceOptions {
  projectId?: string;
  activeTheme: string;
  messages: Message[];
  providerType?: string | null;
  model?: string | null;
}

export function useThemeContextWorkspace({
  projectId,
  activeTheme,
  messages,
  providerType,
  model,
}: UseThemeContextWorkspaceOptions): ThemeContextWorkspaceState {
  const enabled = isSpecializedWorkbenchTheme(activeTheme);
  const normalizedProjectId = normalizeProjectId(projectId);
  const contextProjectId = enabled ? normalizedProjectId : null;

  const materialWorkspace = useMaterials(contextProjectId);
  const materials = materialWorkspace.materials;
  const getMaterialContent = materialWorkspace.getContent;
  const uploadMaterial = materialWorkspace.upload;

  const [projectContents, setProjectContents] = useState<ContentListItem[]>([]);
  const [generatedSearchContexts, setGeneratedSearchContexts] = useState<
    GeneratedSearchContextItem[]
  >([]);
  const [contextSearchQuery, setContextSearchQueryState] = useState("");
  const [contextSearchMode, setContextSearchModeState] =
    useState<ThemeContextSearchMode>("web");
  const [contextSearchLoading, setContextSearchLoading] = useState(false);
  const [contextSearchError, setContextSearchError] = useState<string | null>(null);
  const [activeContextIds, setActiveContextIds] = useState<string[]>([]);
  const [manualContextIds, setManualContextIds] = useState<string[]>([]);
  const [contextBodyById, setContextBodyById] = useState<Record<string, string>>({});
  const contextSelectionInitializedRef = useRef<string | null>(null);
  const contextSnapshotByToolCallRef = useRef<Record<string, string[]>>({});
  const contextBodyByIdRef = useRef<Record<string, string>>({});
  const contextBodyPromiseRef = useRef<Record<string, Promise<string>>>({});
  const [generatedContextReadyProjectId, setGeneratedContextReadyProjectId] =
    useState<string | null>(null);

  useEffect(() => {
    contextBodyByIdRef.current = contextBodyById;
  }, [contextBodyById]);

  useEffect(() => {
    contextBodyPromiseRef.current = {};
    setContextBodyById({});
    setContextSearchError(null);
  }, [contextProjectId]);

  useEffect(() => {
    if (!contextProjectId) {
      setProjectContents([]);
      return;
    }

    let cancelled = false;
    listContents(contextProjectId)
      .then((items) => {
        if (!cancelled) {
          setProjectContents(items);
        }
      })
      .catch((error) => {
        console.warn("[useThemeContextWorkspace] 加载上下文内容失败:", error);
        if (!cancelled) {
          setProjectContents([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [contextProjectId]);

  useEffect(() => {
    setGeneratedContextReadyProjectId(null);

    if (!contextProjectId) {
      setGeneratedSearchContexts([]);
      return;
    }

    const storageKey = buildGeneratedContextStorageKey(contextProjectId);
    const stored = loadTransient<GeneratedSearchContextItem[]>(storageKey, []);
    setGeneratedSearchContexts(Array.isArray(stored) ? stored : []);
    setGeneratedContextReadyProjectId(contextProjectId);
  }, [contextProjectId]);

  useEffect(() => {
    if (!contextProjectId) {
      return;
    }
    const storageKey = buildGeneratedContextStorageKey(contextProjectId);
    saveTransient(storageKey, generatedSearchContexts);
  }, [contextProjectId, generatedSearchContexts]);

  const contextCatalog = useMemo<ContextCatalogItem[]>(() => {
    if (!enabled) {
      return [];
    }

    const generatedItems: ContextCatalogItem[] = [...generatedSearchContexts]
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((item) => ({
        id: item.id,
        name: item.name,
        source: "search" as const,
        searchMode: item.searchMode,
        query: item.query,
        citations: item.citations,
        previewText: truncateContextBody(item.summary, "search"),
        bodyText: item.summary,
        normalizedText: normalizeText(
          `${item.name} ${item.query} ${item.summary} ${item.citations
            .map((citation) => `${citation.title} ${citation.url}`)
            .join(" ")}`,
        ).toLowerCase(),
        estimatedTokens: estimateTokens(item.summary, 180),
        createdAt: item.createdAt,
      }));

    const materialItems: ContextCatalogItem[] = materials.map((material) => {
      const snippet = `${material.name} ${material.description || ""} ${(material.tags || []).join(" ")}`;
      const previewText = truncateContextBody(
        `${material.description || ""} ${(material.tags || []).join(" ")}`,
        "material",
      );
      return {
        id: `material:${material.id}`,
        name: material.name,
        source: "material",
        normalizedText: normalizeText(snippet).toLowerCase(),
        previewText,
        estimatedTokens: estimateTokens(snippet, 120),
      };
    });

    const dedupedProjectContents = dedupeContentsByTitle(projectContents);
    const contentItems: ContextCatalogItem[] = dedupedProjectContents.map((content) => {
      const snippet = `${content.title} ${content.content_type || ""} ${content.status || ""}`;
      return {
        id: `content:${content.id}`,
        name: content.title,
        source: "content",
        normalizedText: normalizeText(snippet).toLowerCase(),
        previewText: truncateContextBody(snippet, "content"),
        estimatedTokens: 320,
        createdAt: resolveContentTimestamp(content) || undefined,
      };
    });

    return [...generatedItems, ...materialItems, ...contentItems];
  }, [enabled, generatedSearchContexts, materials, projectContents]);

  const contextCatalogById = useMemo(
    () => new Map(contextCatalog.map((item) => [item.id, item])),
    [contextCatalog],
  );

  const orderedActiveContextItems = useMemo(
    () =>
      activeContextIds
        .map((id) => contextCatalogById.get(id))
        .filter((item): item is ContextCatalogItem => Boolean(item)),
    [activeContextIds, contextCatalogById],
  );

  useEffect(() => {
    if (!contextProjectId) {
      contextSelectionInitializedRef.current = null;
      setActiveContextIds([]);
      setManualContextIds([]);
      return;
    }

    if (generatedContextReadyProjectId !== contextProjectId) {
      return;
    }

    if (contextSelectionInitializedRef.current === contextProjectId) {
      return;
    }

    const storageKey = buildContextStorageKey(contextProjectId);
    const manualStorageKey = buildManualContextStorageKey(contextProjectId);
    const persisted = loadTransient<string[]>(storageKey, []);
    const manualPersisted = loadTransient<string[]>(manualStorageKey, []);
    const validPersisted = persisted.filter((id) => contextCatalog.some((item) => item.id === id));
    const validManualPersisted = manualPersisted.filter((id) =>
      contextCatalog.some((item) => item.id === id),
    );

    if (validPersisted.length > 0) {
      setActiveContextIds(validPersisted);
      setManualContextIds(
        validManualPersisted.filter((id) => validPersisted.includes(id)),
      );
    } else {
      setActiveContextIds(
        contextCatalog.slice(0, DEFAULT_ACTIVE_CONTEXT_COUNT).map((item) => item.id),
      );
      setManualContextIds([]);
    }
    contextSelectionInitializedRef.current = contextProjectId;
  }, [contextCatalog, contextProjectId, generatedContextReadyProjectId]);

  useEffect(() => {
    if (!enabled || !contextProjectId) {
      return;
    }

    if (manualContextIds.length > 0 || contextCatalog.length === 0) {
      return;
    }

    setActiveContextIds((previous) => {
      const validSet = new Set(contextCatalog.map((item) => item.id));
      const normalized = previous.filter((id) => validSet.has(id));
      const targetCount = Math.min(DEFAULT_ACTIVE_CONTEXT_COUNT, contextCatalog.length);
      if (normalized.length >= targetCount) {
        return normalized;
      }

      const next = [...normalized];
      for (const item of contextCatalog) {
        if (next.length >= targetCount) {
          break;
        }
        if (!next.includes(item.id)) {
          next.push(item.id);
        }
      }
      return next;
    });
  }, [contextCatalog, contextProjectId, enabled, manualContextIds.length]);

  useEffect(() => {
    if (!contextProjectId) {
      return;
    }
    const storageKey = buildContextStorageKey(contextProjectId);
    const manualStorageKey = buildManualContextStorageKey(contextProjectId);
    saveTransient(storageKey, activeContextIds);
    saveTransient(manualStorageKey, manualContextIds);
  }, [activeContextIds, contextProjectId, manualContextIds]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    setActiveContextIds((previous) => {
      const validSet = new Set(contextCatalog.map((item) => item.id));
      const validActive = previous.filter((id) => validSet.has(id));
      if (validActive.length <= DEFAULT_CONTEXT_ITEM_LIMIT) {
        return validActive;
      }

      const removable = validActive.filter((id) => !manualContextIds.includes(id));
      if (removable.length === 0) {
        return validActive.slice(0, DEFAULT_CONTEXT_ITEM_LIMIT);
      }

      const removeSet = new Set<string>();
      for (const id of removable) {
        if (validActive.length - removeSet.size <= DEFAULT_CONTEXT_ITEM_LIMIT) {
          break;
        }
        removeSet.add(id);
      }

      return validActive.filter((id) => !removeSet.has(id));
    });
  }, [contextCatalog, enabled, manualContextIds]);

  const activeContextSet = useMemo(() => new Set(activeContextIds), [activeContextIds]);

  const activeContextTokenUsage = useMemo(
    () =>
      orderedActiveContextItems.reduce(
        (sum, item) => sum + resolveContextTokenEstimate(item, contextBodyById),
        0,
      ),
    [contextBodyById, orderedActiveContextItems],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (activeContextTokenUsage <= DEFAULT_CONTEXT_TOKEN_LIMIT) {
      return;
    }

    const removable = orderedActiveContextItems
      .filter((item) => !manualContextIds.includes(item.id))
      .sort((left, right) => {
        if (left.source === "search" && right.source !== "search") {
          return -1;
        }
        if (left.source !== "search" && right.source === "search") {
          return 1;
        }
        return (
          resolveContextTokenEstimate(right, contextBodyById) -
          resolveContextTokenEstimate(left, contextBodyById)
        );
      });

    if (removable.length === 0) {
      return;
    }

    let currentTokens = activeContextTokenUsage;
    const removeSet = new Set<string>();

    for (const item of removable) {
      if (currentTokens <= DEFAULT_CONTEXT_TOKEN_LIMIT) {
        break;
      }
      removeSet.add(item.id);
      currentTokens -= resolveContextTokenEstimate(item, contextBodyById);
    }

    if (removeSet.size > 0) {
      setActiveContextIds((previous) => previous.filter((id) => !removeSet.has(id)));
    }
  }, [
    activeContextTokenUsage,
    contextBodyById,
    enabled,
    manualContextIds,
    orderedActiveContextItems,
  ]);

  const loadContextBody = useCallback(
    async (item: ContextCatalogItem): Promise<string> => {
      const cached = contextBodyByIdRef.current[item.id];
      if (cached) {
        return cached;
      }

      if (item.source === "search") {
        const summary = normalizeText(item.bodyText || item.previewText || item.name);
        setContextBodyById((previous) =>
          previous[item.id] === summary ? previous : { ...previous, [item.id]: summary },
        );
        return summary;
      }

      const inflight = contextBodyPromiseRef.current[item.id];
      if (inflight) {
        return inflight;
      }

      const promise = (async () => {
        try {
          let nextBody = "";
          if (item.source === "material") {
            const materialId = item.id.replace(/^material:/, "");
            nextBody = await getMaterialContent(materialId);
          } else {
            const contentId = item.id.replace(/^content:/, "");
            const detail = await getContent(contentId);
            nextBody = detail?.body || "";
          }

          const normalizedBody = truncateContextBody(
            nextBody || item.previewText || item.name,
            item.source,
          );
          setContextBodyById((previous) =>
            previous[item.id] === normalizedBody
              ? previous
              : { ...previous, [item.id]: normalizedBody },
          );
          return normalizedBody;
        } catch (error) {
          console.warn("[useThemeContextWorkspace] 加载上下文正文失败:", error);
          const fallbackBody = truncateContextBody(item.previewText || item.name, item.source);
          setContextBodyById((previous) =>
            previous[item.id] === fallbackBody
              ? previous
              : { ...previous, [item.id]: fallbackBody },
          );
          return fallbackBody;
        } finally {
          delete contextBodyPromiseRef.current[item.id];
        }
      })();

      contextBodyPromiseRef.current[item.id] = promise;
      return promise;
    },
    [getMaterialContent],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    orderedActiveContextItems.forEach((item) => {
      if (item.source === "search") {
        return;
      }
      if (contextBodyByIdRef.current[item.id]) {
        return;
      }
      void loadContextBody(item);
    });
  }, [enabled, loadContextBody, orderedActiveContextItems]);

  const sidebarContextItems = useMemo<SidebarContextItem[]>(
    () =>
      contextCatalog.map((item) => ({
        id: item.id,
        name: item.name,
        source: item.source,
        searchMode: item.searchMode,
        query: item.query,
        previewText: item.previewText,
        citations: item.citations,
        createdAt: item.createdAt,
        active: activeContextSet.has(item.id),
      })),
    [activeContextSet, contextCatalog],
  );

  const activityLogs = useMemo<SidebarActivityLog[]>(() => {
    if (!enabled) {
      return [];
    }

    const logs: SidebarActivityLog[] = [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message.toolCalls || message.toolCalls.length === 0) {
        continue;
      }

      for (const toolCall of message.toolCalls) {
        const status =
          toolCall.status === "running" ||
          toolCall.status === "completed" ||
          toolCall.status === "failed"
            ? toolCall.status
            : "failed";
        const logId = `${message.id}-${toolCall.id}`;
        const existingSnapshot = contextSnapshotByToolCallRef.current[logId];
        if (!existingSnapshot || (existingSnapshot.length === 0 && activeContextIds.length > 0)) {
          contextSnapshotByToolCallRef.current[logId] = [...activeContextIds];
        }

        const inputSummary = toolCall.arguments
          ? truncateText(toolCall.arguments, 80)
          : undefined;
        const outputSummary = toolCall.result?.error
          ? truncateText(toolCall.result.error, 80)
          : toolCall.result?.output
            ? truncateText(toolCall.result.output, 80)
            : undefined;
        const artifactPaths = extractToolCallArtifactPaths(
          toolCall.arguments,
          toolCall.result?.output,
        );

        logs.push({
          id: logId,
          name: toolCall.name,
          status,
          timeLabel: formatLogTimeLabel(message.timestamp),
          durationLabel: formatDurationLabel(toolCall.startTime, toolCall.endTime),
          applyTarget: resolveApplyTarget(toolCall.name),
          contextIds: contextSnapshotByToolCallRef.current[logId],
          inputSummary,
          outputSummary,
          messageId: message.id,
          artifactPaths: artifactPaths.length > 0 ? artifactPaths : undefined,
        });
        if (logs.length >= 20) {
          return logs;
        }
      }
    }
    return logs;
  }, [activeContextIds, enabled, messages]);

  const activeContextPrompt = useMemo(
    () => buildActiveContextPromptText(orderedActiveContextItems, contextBodyById),
    [contextBodyById, orderedActiveContextItems],
  );

  const prepareActiveContextPrompt = useCallback(async () => {
    if (!enabled) {
      return "";
    }

    if (orderedActiveContextItems.length === 0) {
      return "";
    }

    const resolvedBodies = await Promise.all(
      orderedActiveContextItems.map(async (item) => ({
        id: item.id,
        body: await loadContextBody(item),
      })),
    );

    const mergedContextBodies = {
      ...contextBodyByIdRef.current,
    };
    resolvedBodies.forEach(({ id, body }) => {
      mergedContextBodies[id] = body;
    });

    return buildActiveContextPromptText(orderedActiveContextItems, mergedContextBodies);
  }, [enabled, loadContextBody, orderedActiveContextItems]);

  const setContextSearchQuery = useCallback((value: string) => {
    setContextSearchError(null);
    setContextSearchQueryState(value);
  }, []);

  const setContextSearchMode = useCallback((value: ThemeContextSearchMode) => {
    setContextSearchError(null);
    setContextSearchModeState(value);
  }, []);

  const contextSearchBlockedReason = useMemo(() => {
    if (!enabled) {
      return null;
    }
    if (!contextProjectId) {
      return "请先选择项目后再添加上下文";
    }
    if (!providerType?.trim() || !model?.trim()) {
      return "请先选择可用模型后再搜索";
    }
    return null;
  }, [contextProjectId, enabled, model, providerType]);

  const submitContextSearch = useCallback(async () => {
    if (!enabled) {
      return;
    }

    const trimmedQuery = contextSearchQuery.trim();
    if (!trimmedQuery || contextSearchLoading) {
      return;
    }

    if (!contextProjectId) {
      setContextSearchError("请先选择项目后再添加上下文");
      return;
    }

    if (!providerType?.trim() || !model?.trim()) {
      setContextSearchError("当前未选择可用模型，无法执行联网搜索");
      return;
    }

    setContextSearchLoading(true);
    setContextSearchError(null);

    try {
      const result = await searchThemeContextWithWebSearch({
        workspaceId: contextProjectId,
        projectId: contextProjectId,
        providerType,
        model,
        query: trimmedQuery,
        mode: contextSearchMode,
      });

      const contextId = buildGeneratedContextId(contextSearchMode, trimmedQuery);
      const nextContext: GeneratedSearchContextItem = {
        id: contextId,
        name: result.title,
        source: "search",
        searchMode: contextSearchMode,
        query: trimmedQuery,
        summary: result.summary,
        citations: result.citations,
        rawResponse: result.rawResponse,
        createdAt: Date.now(),
      };

      setGeneratedSearchContexts((previous) => [
        nextContext,
        ...previous.filter((item) => item.id !== contextId),
      ]);
      setContextBodyById((previous) => ({
        ...previous,
        [contextId]: normalizeText(result.summary),
      }));
      setContextSearchQueryState("");
      setActiveContextIds((previous) =>
        previous.includes(contextId) ? previous : [contextId, ...previous],
      );
      setManualContextIds((previous) =>
        previous.includes(contextId) ? previous : [...previous, contextId],
      );
    } catch (error) {
      setContextSearchError(
        error instanceof Error ? error.message : String(error || "上下文搜索失败"),
      );
    } finally {
      setContextSearchLoading(false);
    }
  }, [
    contextProjectId,
    contextSearchLoading,
    contextSearchMode,
    contextSearchQuery,
    enabled,
    model,
    providerType,
  ]);

  const addTextContext = useCallback(
    async (payload: { content: string; name?: string }) => {
      if (!enabled) {
        throw new Error("当前主题不支持添加上下文");
      }
      if (!contextProjectId) {
        throw new Error("请先选择项目后再添加上下文");
      }

      const normalizedContent = payload.content.trim();
      if (!normalizedContent) {
        throw new Error("请输入文本内容");
      }

      const firstLine = normalizedContent.split(/\r?\n/).find((line) => line.trim().length > 0) || "";
      const material = await uploadMaterial({
        projectId: contextProjectId,
        name: resolveContextTitle(payload.name || firstLine, "文本上下文"),
        type: "text",
        content: normalizedContent,
        tags: ["上下文", "文本"],
      });

      const contextId = `material:${material.id}`;
      setContextBodyById((previous) => ({
        ...previous,
        [contextId]: truncateContextBody(normalizedContent, "material"),
      }));
      setActiveContextIds((previous) =>
        previous.includes(contextId) ? previous : [contextId, ...previous],
      );
    },
    [contextProjectId, enabled, uploadMaterial],
  );

  const addLinkContext = useCallback(
    async (payload: { url: string; name?: string }) => {
      if (!enabled) {
        throw new Error("当前主题不支持添加上下文");
      }
      if (!contextProjectId) {
        throw new Error("请先选择项目后再添加上下文");
      }

      const normalizedUrl = payload.url.trim();
      if (!normalizedUrl) {
        throw new Error("请输入网站链接");
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(normalizedUrl);
      } catch {
        throw new Error("链接格式不正确");
      }

      const fallbackName = parsedUrl.hostname || "网站链接";
      const material = await uploadMaterial({
        projectId: contextProjectId,
        name: resolveContextTitle(payload.name || fallbackName, "网站链接"),
        type: "link",
        content: parsedUrl.toString(),
        tags: ["上下文", "链接"],
      });

      const contextId = `material:${material.id}`;
      setContextBodyById((previous) => ({
        ...previous,
        [contextId]: truncateContextBody(parsedUrl.toString(), "material"),
      }));
      setActiveContextIds((previous) =>
        previous.includes(contextId) ? previous : [contextId, ...previous],
      );
    },
    [contextProjectId, enabled, uploadMaterial],
  );

  const addFileContext = useCallback(
    async (payload: { path: string; name?: string }) => {
      if (!enabled) {
        throw new Error("当前主题不支持添加上下文");
      }
      if (!contextProjectId) {
        throw new Error("请先选择项目后再添加上下文");
      }

      const normalizedPath = payload.path.trim();
      if (!normalizedPath) {
        throw new Error("文件路径无效");
      }

      const material = await uploadMaterial({
        projectId: contextProjectId,
        name: resolveContextTitle(payload.name || resolvePathFileName(normalizedPath), "上下文文件"),
        type: "document",
        filePath: normalizedPath,
        tags: ["上下文", "文件"],
      });

      const contextId = `material:${material.id}`;
      setActiveContextIds((previous) =>
        previous.includes(contextId) ? previous : [contextId, ...previous],
      );
    },
    [contextProjectId, enabled, uploadMaterial],
  );

  const toggleContextActive = useCallback((contextId: string) => {
    setActiveContextIds((previous) => {
      const exists = previous.includes(contextId);
      if (exists) {
        setManualContextIds((manualPrevious) =>
          manualPrevious.filter((id) => id !== contextId),
        );
        return previous.filter((id) => id !== contextId);
      }
      setManualContextIds((manualPrevious) =>
        manualPrevious.includes(contextId)
          ? manualPrevious
          : [...manualPrevious, contextId],
      );
      return [...previous, contextId];
    });
  }, []);

  const getContextDetail = useCallback(
    (contextId: string) => {
      return contextCatalogById.get(contextId) ?? null;
    },
    [contextCatalogById],
  );

  return {
    generalWorkbenchEnabled: enabled,
    enabled,
    contextSearchQuery,
    setContextSearchQuery,
    contextSearchMode,
    setContextSearchMode,
    contextSearchLoading,
    contextSearchError,
    contextSearchBlockedReason,
    submitContextSearch,
    addTextContext,
    addLinkContext,
    addFileContext,
    sidebarContextItems,
    toggleContextActive,
    getContextDetail,
    contextBudget: {
      activeCount: activeContextSet.size,
      activeCountLimit: DEFAULT_CONTEXT_ITEM_LIMIT,
      estimatedTokens: activeContextTokenUsage,
      tokenLimit: DEFAULT_CONTEXT_TOKEN_LIMIT,
    },
    activityLogs,
    activeContextPrompt,
    prepareActiveContextPrompt,
  };
}
