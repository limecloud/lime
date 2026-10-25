import type { Dispatch, SetStateAction } from "react";
import type { AgentSessionExecutionRuntimePreferences } from "@/lib/api/agentExecutionRuntime";
import type { Artifact } from "@/lib/artifact/types";
import {
  normalizeArtifactProtocolPath,
  resolveArtifactProtocolFilePath,
} from "@/lib/artifact-protocol";
import type { Message, MessagePreviewTarget } from "../types";
import { isHiddenInternalArtifactPath } from "../utils/internalArtifactVisibility";
import { shouldAutoSelectGeneralArtifact } from "./generalArtifactAutoSelection";
import { doesWorkspaceFileCandidateMatch } from "./workspaceFilePathMatch";
import { normalizeProjectId } from "../utils/topicProjectResolution";

export const BLANK_HOME_DEFERRED_LOAD_MS = 18_000;
export const RECENT_CONVERSATIONS_IDLE_DEFERRED_LOAD_MS = 0;
export const SESSION_ENTRY_RUNTIME_WARMUP_DEFERRED_LOAD_MS = 45_000;
export const SESSION_ENTRY_AUXILIARY_DEFERRED_LOAD_MS = 45_000;
export const SESSION_RECENT_METADATA_BACKGROUND_SYNC_DELAY_MS = 12_000;
export const SESSION_RECENT_METADATA_NAVIGATION_DEFER_MS = 45_000;
export const SESSION_RECENT_METADATA_BACKGROUND_SYNC_IDLE_TIMEOUT_MS = 20_000;

export const NOOP_SET_CHAT_MESSAGES: Dispatch<SetStateAction<Message[]>> = () =>
  undefined;

interface ResolveTaskCenterHomeSurfaceStateParams {
  agentEntry: string;
  draftSurfaceActive: boolean;
  shouldSuppressDraftContent: boolean;
  sessionSwitchPending: boolean;
  hasInitialSessionRoute?: boolean;
  hasConversationActivity: boolean;
  hasCurrentSessionActivity?: boolean;
  isHomeSessionBackgroundRecovery?: boolean;
  sessionId?: string | null;
  embeddedHomeSessionIds: ReadonlySet<string>;
  isAutoRestoringSession: boolean;
  isSessionHydrating: boolean;
}

export interface TaskCenterHomeSurfaceState {
  shouldRenderEmbeddedHome: boolean;
  shouldHideCurrentSessionContent: boolean;
  isRestoringSession: boolean;
  sceneSessionId: string | null;
}

export type SessionRecentMetadataSyncPriority = "immediate" | "background";

export interface SessionRecentMetadataSyncOptions {
  priority?: SessionRecentMetadataSyncPriority;
}

export type SessionRecentMetadataPatch = Pick<
  AgentSessionExecutionRuntimePreferences,
  "webSearch" | "thinking" | "task" | "subagent"
>;

export interface PendingSessionRecentMetadataSync {
  patch: SessionRecentMetadataPatch;
  priority: SessionRecentMetadataSyncPriority;
  cancel: (() => void) | null;
  resolvers: Array<() => void>;
  rejecters: Array<(error: unknown) => void>;
}

export function resolveRuntimeWorkspaceId(
  projectId: string | null | undefined,
): string {
  return normalizeProjectId(projectId) ?? "";
}

export function areStringArraysEqual(
  left: string[] | null,
  right: string[],
): boolean {
  if (!left || left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => item === right[index]);
}

export function isTransientWorkspaceBridgeError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    message.includes("[DevBridge] 浏览器模式无法连接后端桥接") ||
    message.includes("Failed to fetch") ||
    normalized.includes("timeout") ||
    normalized.includes("aborterror") ||
    normalized.includes("bridge health check failed") ||
    normalized.includes("bridge cooldown active")
  );
}

export function shouldAutoRecoverWorkspacePathMissing(
  project:
    | {
        workspaceType?: string | null;
      }
    | null
    | undefined,
  workspacePathMissing: unknown,
): boolean {
  if (
    !workspacePathMissing ||
    typeof workspacePathMissing !== "object" ||
    Array.isArray(workspacePathMissing)
  ) {
    return false;
  }

  return project?.workspaceType === "temporary";
}

export function createLocalImageWorkbenchSessionKey(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `__local_image_workbench__:${Date.now().toString(36)}:${random}`;
}

export function createTaskCenterDraftSendRequestId(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `draft-send-${Date.now().toString(36)}-${random}`;
}

export function isTaskCenterDraftSendPendingForLayout({
  hasDraftSendRequest,
  hasDisplayMessages,
  isSending,
  queuedTurnCount,
}: {
  hasDraftSendRequest: boolean;
  hasDisplayMessages: boolean;
  isSending: boolean;
  queuedTurnCount: number;
}): boolean {
  if (!hasDraftSendRequest) {
    return false;
  }

  return !hasDisplayMessages || isSending || queuedTurnCount > 0;
}

export function shouldBuildFullThreadTimeline({
  harnessPanelVisible,
  layoutMode,
}: {
  harnessPanelVisible: boolean;
  layoutMode: string;
}): boolean {
  return layoutMode !== "chat" || harnessPanelVisible;
}

export function resolveHarnessRuntimeVisible({
  harnessPanelVisible,
  rightSurfaceActive,
}: {
  harnessPanelVisible: boolean;
  rightSurfaceActive?: string | null;
}): boolean {
  return harnessPanelVisible || rightSurfaceActive === "harness";
}

export function shouldAutoRefreshWorkspaceRightSurfacePending({
  sessionId,
  workspaceId,
  workspaceRoot,
  sceneIsSending,
  sceneIsPreparingSend,
  sceneLayoutMode,
  taskCenterHomeHotpathActive = false,
  manualRightSurfaceActive,
  pluginActivationActive,
}: {
  sessionId?: string | null;
  workspaceId?: string | null;
  workspaceRoot?: string | null;
  sceneIsSending: boolean;
  sceneIsPreparingSend: boolean;
  sceneLayoutMode: string;
  taskCenterHomeHotpathActive?: boolean;
  manualRightSurfaceActive: boolean;
  pluginActivationActive: boolean;
}): boolean {
  const hasPendingListScope = Boolean(
    sessionId?.trim() || workspaceId?.trim() || workspaceRoot?.trim(),
  );
  if (sceneIsPreparingSend) return false;
  // Tools request visible surfaces while the turn is running, including approval waits.
  if (sessionId?.trim()) return true;
  if (taskCenterHomeHotpathActive || sceneIsSending) {
    return false;
  }

  return (
    hasPendingListScope ||
    sceneLayoutMode !== "chat" ||
    manualRightSurfaceActive ||
    pluginActivationActive
  );
}

export function shouldAutoInitWorkspaceSessionFiles({
  sessionId,
  isSending,
  currentTurnId,
  queuedTurnCount,
  draftSendInFlight = false,
}: {
  sessionId?: string | null;
  isSending: boolean;
  currentTurnId?: string | null;
  queuedTurnCount: number;
  draftSendInFlight?: boolean;
}): boolean {
  if (!sessionId?.trim()) {
    return false;
  }

  return (
    !draftSendInFlight && !isSending && !currentTurnId && queuedTurnCount === 0
  );
}

export function shouldPauseTaskCenterInitialSessionNavigation({
  agentEntry,
  draftSurfaceActive,
  hasHomeHotpathPending,
}: {
  agentEntry?: string | null;
  draftSurfaceActive: boolean;
  hasHomeHotpathPending: boolean;
}): boolean {
  if (agentEntry !== "conversation" && agentEntry !== "new-task") {
    return false;
  }

  return draftSurfaceActive || hasHomeHotpathPending;
}

export function shouldSuppressTaskCenterDraftContentForLayout({
  draftSurfaceActive,
  draftSendInFlight,
  hasVisibleSessionActivity,
}: {
  draftSurfaceActive: boolean;
  draftSendInFlight: boolean;
  hasVisibleSessionActivity: boolean;
}): boolean {
  return draftSurfaceActive && !draftSendInFlight && !hasVisibleSessionActivity;
}

export function resolveTaskCenterHomeSurfaceState({
  agentEntry,
  draftSurfaceActive,
  shouldSuppressDraftContent,
  sessionSwitchPending,
  hasInitialSessionRoute = false,
  hasConversationActivity,
  hasCurrentSessionActivity = hasConversationActivity,
  isHomeSessionBackgroundRecovery = false,
  sessionId,
  embeddedHomeSessionIds,
  isAutoRestoringSession,
  isSessionHydrating,
}: ResolveTaskCenterHomeSurfaceStateParams): TaskCenterHomeSurfaceState {
  const hasEmbeddedHomeSession = Boolean(
    sessionId && embeddedHomeSessionIds.has(sessionId),
  );
  const shouldProtectInitialSessionRoute =
    hasInitialSessionRoute && !draftSurfaceActive;
  const shouldRenderEmbeddedHome = Boolean(
    agentEntry === "conversation" &&
    !sessionSwitchPending &&
    !shouldProtectInitialSessionRoute &&
    !hasConversationActivity &&
    !hasCurrentSessionActivity &&
    (draftSurfaceActive || hasEmbeddedHomeSession),
  );
  const shouldBlockForSessionSwitch =
    sessionSwitchPending && !hasCurrentSessionActivity;
  const isSessionRestorePending =
    isAutoRestoringSession || isSessionHydrating || shouldBlockForSessionSwitch;
  const shouldHideBackgroundSessionContent =
    isHomeSessionBackgroundRecovery && !hasInitialSessionRoute;
  const shouldKeepDraftHomeShell =
    shouldSuppressDraftContent &&
    !sessionSwitchPending &&
    !shouldProtectInitialSessionRoute &&
    !hasCurrentSessionActivity;
  const shouldHideCurrentSessionContent =
    shouldBlockForSessionSwitch ||
    shouldHideBackgroundSessionContent ||
    (shouldSuppressDraftContent &&
      !shouldProtectInitialSessionRoute &&
      !hasCurrentSessionActivity);

  return {
    shouldRenderEmbeddedHome,
    shouldHideCurrentSessionContent,
    isRestoringSession: isSessionRestorePending && !shouldKeepDraftHomeShell,
    sceneSessionId: shouldHideCurrentSessionContent
      ? null
      : (sessionId ?? null),
  };
}

export function scheduleAfterNextPaint(callback: () => void): () => void {
  if (typeof window === "undefined") {
    callback();
    return () => undefined;
  }

  if (typeof window.requestAnimationFrame !== "function") {
    const timeoutId = window.setTimeout(callback, 0);
    return () => window.clearTimeout(timeoutId);
  }

  let timeoutId: number | null = null;
  const firstFrameId = window.requestAnimationFrame(() => {
    timeoutId = window.setTimeout(callback, 0);
  });

  return () => {
    window.cancelAnimationFrame(firstFrameId);
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  };
}

export function scheduleAfterCommit(callback: () => void): () => void {
  let cancelled = false;
  const run = () => {
    if (!cancelled) {
      callback();
    }
  };

  if (typeof queueMicrotask === "function") {
    queueMicrotask(run);
  } else {
    void Promise.resolve().then(run);
  }

  return () => {
    cancelled = true;
  };
}

export function mergeSessionRecentMetadataSyncPriority(
  current: SessionRecentMetadataSyncPriority,
  next?: SessionRecentMetadataSyncPriority,
): SessionRecentMetadataSyncPriority {
  if (current === "immediate" || next !== "background") {
    return "immediate";
  }

  return "background";
}

export function resolveDefaultSelectedArtifact(
  activeTheme: string,
  artifacts: Artifact[],
): Artifact | null {
  if (artifacts.length === 0) {
    return null;
  }

  if (activeTheme !== "general") {
    return artifacts[artifacts.length - 1] ?? null;
  }

  for (let index = artifacts.length - 1; index >= 0; index -= 1) {
    const candidate = artifacts[index];
    if (shouldAutoSelectGeneralArtifact(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function resolveVideoCanvasStatusFromPreview(
  target: Extract<MessagePreviewTarget, { kind: "task" }>,
): "idle" | "generating" | "success" | "error" {
  const preview = target.preview;
  if (preview.kind !== "video_generate") {
    return "idle";
  }
  if (
    (preview.status === "complete" || preview.status === "partial") &&
    preview.videoUrl
  ) {
    return "success";
  }
  if (preview.status === "failed" || preview.status === "cancelled") {
    return "error";
  }
  return "generating";
}

export function resolveTaskPreviewArtifact(
  message: Message,
  target: Extract<MessagePreviewTarget, { kind: "task" }>,
): Artifact | null {
  const normalizedArtifactPath = normalizeArtifactProtocolPath(
    target.preview.kind === "video_generate"
      ? null
      : target.preview.artifactPath || null,
  );
  const messageArtifacts = message.artifacts || [];
  if (normalizedArtifactPath) {
    const matchedArtifact = messageArtifacts.find(
      (artifact) =>
        !isHiddenInternalArtifactPath(
          resolveArtifactProtocolFilePath(artifact),
        ) &&
        doesWorkspaceFileCandidateMatch(
          resolveArtifactProtocolFilePath(artifact),
          normalizedArtifactPath,
        ),
    );
    if (matchedArtifact) {
      return matchedArtifact;
    }
  }

  const visibleArtifacts = messageArtifacts.filter(
    (artifact) =>
      !isHiddenInternalArtifactPath(resolveArtifactProtocolFilePath(artifact)),
  );
  return visibleArtifacts.length > 0
    ? (visibleArtifacts[visibleArtifacts.length - 1] ?? null)
    : null;
}

export function normalizeVideoAspectRatio(
  value?: string,
): "adaptive" | "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9" {
  switch (value) {
    case "16:9":
    case "9:16":
    case "1:1":
    case "4:3":
    case "3:4":
    case "21:9":
      return value;
    default:
      return "adaptive";
  }
}

export function normalizeVideoResolution(
  value?: string,
): "480p" | "720p" | "1080p" {
  switch (value) {
    case "480p":
    case "1080p":
      return value;
    case "720p":
    default:
      return "720p";
  }
}
