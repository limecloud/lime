import { useEffect, useRef } from "react";
import { logAgentDebug } from "@/lib/agentDebug";
import type { LayoutMode } from "@/lib/workspace/workbenchContract";

const AGENT_CHAT_DEBUG_COMPONENT = "LocalConversationPage";

export interface WorkspaceDebugMountContext {
  agentEntry: string;
  contentId?: string | null;
  externalProjectId?: string | null;
  initialCreationMode?: string | null;
  initialTheme?: string | null;
  lockTheme: boolean;
}

export interface WorkspaceDebugStateSnapshot {
  activeTheme: string;
  contentId: string | null;
  initialContentLoadError: string | null;
  isAutoRestoringSession: boolean;
  isInitialContentLoading: boolean;
  isSessionHydrating: boolean;
  isSending: boolean;
  layoutMode: LayoutMode;
  messagesCount: number;
  projectId: string | null;
  sessionId: string | null;
  skillsCount: number;
  skillsLoading: boolean;
  topicsCount: number;
  workspaceHealthError: boolean;
}

export interface UseWorkspaceDebugRuntimeParams extends WorkspaceDebugMountContext {
  stateSnapshot: WorkspaceDebugStateSnapshot;
}

export function buildWorkspaceDebugMountContext({
  agentEntry,
  contentId,
  externalProjectId,
  initialCreationMode,
  initialTheme,
  lockTheme,
}: WorkspaceDebugMountContext): Record<string, unknown> {
  return {
    agentEntry,
    contentId: contentId ?? null,
    externalProjectId: externalProjectId ?? null,
    initialCreationMode: initialCreationMode ?? null,
    initialTheme: initialTheme ?? null,
    lockTheme,
  };
}

export function buildWorkspaceDebugUnmountContext({
  contentId,
  externalProjectId,
  lifetimeMs,
}: {
  contentId?: string | null;
  externalProjectId?: string | null;
  lifetimeMs: number;
}): Record<string, unknown> {
  return {
    contentId: contentId ?? null,
    externalProjectId: externalProjectId ?? null,
    lifetimeMs,
  };
}

export function buildWorkspaceDebugStateSnapshotDedupeKey(
  snapshot: WorkspaceDebugStateSnapshot,
): string {
  return JSON.stringify(snapshot);
}

export function useWorkspaceDebugRuntime({
  agentEntry,
  contentId,
  externalProjectId,
  initialCreationMode,
  initialTheme,
  lockTheme,
  stateSnapshot,
}: UseWorkspaceDebugRuntimeParams): void {
  const pageMountedAtRef = useRef(Date.now());

  useEffect(() => {
    const mountedAt = pageMountedAtRef.current;
    logAgentDebug(
      AGENT_CHAT_DEBUG_COMPONENT,
      "mount",
      buildWorkspaceDebugMountContext({
        agentEntry,
        contentId,
        externalProjectId,
        initialCreationMode,
        initialTheme,
        lockTheme,
      }),
    );

    return () => {
      logAgentDebug(
        AGENT_CHAT_DEBUG_COMPONENT,
        "unmount",
        buildWorkspaceDebugUnmountContext({
          contentId,
          externalProjectId,
          lifetimeMs: Date.now() - mountedAt,
        }),
        { consoleOnly: true },
      );
    };
  }, [
    agentEntry,
    contentId,
    externalProjectId,
    initialCreationMode,
    initialTheme,
    lockTheme,
  ]);

  useEffect(() => {
    logAgentDebug(
      AGENT_CHAT_DEBUG_COMPONENT,
      "stateSnapshot",
      { ...stateSnapshot },
      {
        dedupeKey: buildWorkspaceDebugStateSnapshotDedupeKey(stateSnapshot),
        throttleMs: 800,
      },
    );
  }, [stateSnapshot]);
}
