import type { AgentToolCallState as ToolCallState } from "@/lib/api/agentProtocol";
import type { Artifact } from "@/lib/artifact/types";
import type { BrowserAssistSessionState, Message } from "../types";
import { loadTransient, saveTransient } from "../hooks/agentChatStorage";
import { getScopedStorageKey } from "../hooks/agentChatShared";

const BROWSER_ASSIST_SESSION_STORAGE_PREFIX = "aster_browser_assist_session";

export function resolveBrowserAssistSessionScopeKey(
  workspaceId: string | null | undefined,
  sessionId: string | null | undefined,
): string {
  const normalizedSessionId = sessionId?.trim() || "active";
  const normalizedWorkspaceId = workspaceId?.trim() || "global";
  return `${normalizedSessionId}::${normalizedWorkspaceId}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readFirstString(
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

function normalizeTimestamp(...values: unknown[]): number {
  for (const value of values) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.getTime();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.getTime();
      }
    }
  }

  return Date.now();
}

function parseToolCallArguments(
  argumentsValue?: string,
): Record<string, unknown> | null {
  if (!argumentsValue?.trim()) {
    return null;
  }

  try {
    return asRecord(JSON.parse(argumentsValue));
  } catch {
    return null;
  }
}

export function createBrowserAssistSessionState(
  params: Partial<BrowserAssistSessionState> | null | undefined,
): BrowserAssistSessionState | null {
  if (!params) {
    return null;
  }

  const sessionId = params.sessionId?.trim();
  const profileKey = params.profileKey?.trim();
  if (!sessionId && !profileKey) {
    return null;
  }

  return {
    sessionId,
    profileKey,
    url: params.url?.trim(),
    title: params.title?.trim() || "浏览器协助",
    targetId: params.targetId?.trim(),
    transportKind: params.transportKind?.trim(),
    lifecycleState: params.lifecycleState?.trim(),
    controlMode: params.controlMode?.trim(),
    source: params.source || "tool_call",
    updatedAt: normalizeTimestamp(params.updatedAt),
  };
}

export function mergeBrowserAssistSessionStates(
  current: BrowserAssistSessionState | null,
  incoming: BrowserAssistSessionState | null,
): BrowserAssistSessionState | null {
  if (!current) {
    return incoming;
  }
  if (!incoming) {
    return current;
  }

  const primary = incoming.updatedAt >= current.updatedAt ? incoming : current;
  const fallback = primary === incoming ? current : incoming;

  return {
    sessionId: primary.sessionId || fallback.sessionId,
    profileKey: primary.profileKey || fallback.profileKey,
    url: primary.url || fallback.url,
    title: primary.title || fallback.title,
    targetId: primary.targetId || fallback.targetId,
    transportKind: primary.transportKind || fallback.transportKind,
    lifecycleState: primary.lifecycleState || fallback.lifecycleState,
    controlMode: primary.controlMode || fallback.controlMode,
    source: primary.source || fallback.source,
    updatedAt: Math.max(current.updatedAt, incoming.updatedAt),
  };
}

export function areBrowserAssistSessionStatesEqual(
  left: BrowserAssistSessionState | null,
  right: BrowserAssistSessionState | null,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  return (
    left.sessionId === right.sessionId &&
    left.profileKey === right.profileKey &&
    left.url === right.url &&
    left.title === right.title &&
    left.targetId === right.targetId &&
    left.transportKind === right.transportKind &&
    left.lifecycleState === right.lifecycleState &&
    left.controlMode === right.controlMode &&
    left.source === right.source &&
    left.updatedAt === right.updatedAt
  );
}

export function extractBrowserAssistSessionFromToolCall(
  toolCall: ToolCallState,
): BrowserAssistSessionState | null {
  const metadata = asRecord(toolCall.result?.metadata);
  const normalizedName = toolCall.name.trim().toLowerCase();
  const toolFamily = readFirstString([metadata], ["tool_family", "toolFamily"]);
  if (!normalizedName.includes("browser") && toolFamily !== "browser") {
    return null;
  }

  const argumentsRecord = parseToolCallArguments(toolCall.arguments);
  const metadataResult = asRecord(metadata?.result);
  const metadataSession = asRecord(metadata?.session);
  const metadataBrowserSession =
    asRecord(metadata?.browser_session) || asRecord(metadata?.browserSession);
  const metadataResultSession = asRecord(metadataResult?.session);
  const metadataResultBrowserSession =
    asRecord(metadataResult?.browser_session) ||
    asRecord(metadataResult?.browserSession);
  const metadataResultData = asRecord(metadataResult?.data);
  const metadataResultDataBrowserSession =
    asRecord(metadataResultData?.browser_session) ||
    asRecord(metadataResultData?.browserSession);
  const metadataPageInfo =
    asRecord(metadata?.page_info) ||
    asRecord(metadata?.pageInfo) ||
    asRecord(metadata?.last_page_info) ||
    asRecord(metadata?.lastPageInfo);
  const metadataResultPageInfo =
    asRecord(metadataResult?.page_info) ||
    asRecord(metadataResult?.pageInfo) ||
    asRecord(metadataResult?.last_page_info) ||
    asRecord(metadataResult?.lastPageInfo);
  const metadataDataPageInfo =
    asRecord(metadataResultData?.page_info) ||
    asRecord(metadataResultData?.pageInfo) ||
    asRecord(metadataResultData?.last_page_info) ||
    asRecord(metadataResultData?.lastPageInfo);

  const candidates = [
    metadata,
    metadataResult,
    metadataSession,
    metadataBrowserSession,
    metadataPageInfo,
    metadataResultSession,
    metadataResultBrowserSession,
    metadataResultData,
    metadataResultDataBrowserSession,
    metadataResultPageInfo,
    metadataDataPageInfo,
    argumentsRecord,
  ];

  return createBrowserAssistSessionState({
    sessionId: readFirstString(candidates, ["session_id", "sessionId"]),
    profileKey: readFirstString(candidates, ["profile_key", "profileKey"]),
    url: readFirstString(candidates, [
      "url",
      "href",
      "target_url",
      "targetUrl",
    ]),
    title: readFirstString(candidates, [
      "title",
      "target_title",
      "targetTitle",
    ]),
    targetId: readFirstString(candidates, ["target_id", "targetId"]),
    transportKind: readFirstString(candidates, [
      "transport_kind",
      "transportKind",
    ]),
    lifecycleState: readFirstString(candidates, [
      "lifecycle_state",
      "lifecycleState",
    ]),
    controlMode: readFirstString(candidates, ["control_mode", "controlMode"]),
    source: "tool_call",
    updatedAt: normalizeTimestamp(toolCall.endTime, toolCall.startTime),
  });
}

export function findLatestBrowserAssistSessionInMessages(
  messages: Message[],
): BrowserAssistSessionState | null {
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const message = messages[messageIndex];
    const toolCalls = message.toolCalls || [];
    for (let toolIndex = toolCalls.length - 1; toolIndex >= 0; toolIndex -= 1) {
      const context = extractBrowserAssistSessionFromToolCall(
        toolCalls[toolIndex],
      );
      if (context) {
        return context;
      }
    }
  }

  return null;
}

export function extractBrowserAssistSessionFromArtifact(
  artifact: Artifact | null | undefined,
): BrowserAssistSessionState | null {
  if (!artifact || artifact.type !== "browser_assist") {
    return null;
  }

  const meta = asRecord(artifact.meta);
  return createBrowserAssistSessionState({
    sessionId: readFirstString(meta ? [meta] : [], ["sessionId", "session_id"]),
    profileKey: readFirstString(meta ? [meta] : [], [
      "profileKey",
      "profile_key",
    ]),
    url: readFirstString(meta ? [meta] : [], ["url", "launchUrl"]),
    title: artifact.title?.trim(),
    targetId: readFirstString(meta ? [meta] : [], ["targetId", "target_id"]),
    transportKind: readFirstString(meta ? [meta] : [], [
      "transportKind",
      "transport_kind",
    ]),
    lifecycleState: readFirstString(meta ? [meta] : [], [
      "lifecycleState",
      "lifecycle_state",
    ]),
    controlMode: readFirstString(meta ? [meta] : [], [
      "controlMode",
      "control_mode",
    ]),
    source: "artifact_restore",
    updatedAt: artifact.updatedAt,
  });
}

export function resolveBrowserAssistSessionStorageKey(
  workspaceId: string | null | undefined,
  sessionId: string | null | undefined,
): string {
  const normalizedSessionId = sessionId?.trim() || "active";
  return getScopedStorageKey(
    workspaceId,
    `${BROWSER_ASSIST_SESSION_STORAGE_PREFIX}_${normalizedSessionId}`,
  );
}

export function loadBrowserAssistSessionState(
  workspaceId: string | null | undefined,
  sessionId: string | null | undefined,
): BrowserAssistSessionState | null {
  const key = resolveBrowserAssistSessionStorageKey(workspaceId, sessionId);
  return createBrowserAssistSessionState(
    loadTransient<Record<string, unknown> | null>(key, null) || undefined,
  );
}

export function saveBrowserAssistSessionState(
  workspaceId: string | null | undefined,
  sessionId: string | null | undefined,
  state: BrowserAssistSessionState,
) {
  const key = resolveBrowserAssistSessionStorageKey(workspaceId, sessionId);
  saveTransient(key, state);
}

export function clearBrowserAssistSessionState(
  workspaceId: string | null | undefined,
  sessionId: string | null | undefined,
) {
  const key = resolveBrowserAssistSessionStorageKey(workspaceId, sessionId);
  saveTransient(key, null);
}
