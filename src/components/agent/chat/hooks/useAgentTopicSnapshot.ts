import { useEffect, useRef } from "react";
import { logAgentDebug } from "@/lib/agentDebug";
import { buildLiveTaskSnapshot } from "./agentChatShared";
import type { Message } from "../types";
import type { Topic } from "./agentChatShared";

const TOPIC_PREVIEW_UPDATE_THROTTLE_MS = 600;

interface UseAgentTopicSnapshotOptions {
  sessionId: string | null;
  hasActiveTopic: boolean;
  messages: Message[];
  isSending: boolean;
  pendingActionCount: number;
  queuedTurnCount: number;
  workspaceId: string;
  workspacePathMissing: boolean;
  topicsCount: number;
  updateTopicSnapshot: (
    targetSessionId: string,
    snapshot: Partial<
      Pick<
        Topic,
        | "updatedAt"
        | "messagesCount"
        | "status"
        | "statusReason"
        | "lastPreview"
        | "hasUnread"
      >
    >,
  ) => void;
}

export function useAgentTopicSnapshot(options: UseAgentTopicSnapshotOptions) {
  const {
    sessionId,
    hasActiveTopic,
    messages,
    isSending,
    pendingActionCount,
    queuedTurnCount,
    workspaceId,
    workspacePathMissing,
    topicsCount,
    updateTopicSnapshot,
  } = options;
  const lastCommittedSnapshotKeyRef = useRef<string | null>(null);
  const lastCommittedStructureKeyRef = useRef<string | null>(null);
  const pendingPreviewFlushTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const pendingPreviewPayloadRef = useRef<{
    sessionId: string;
    snapshot: Partial<
      Pick<
        Topic,
        | "updatedAt"
        | "messagesCount"
        | "status"
        | "statusReason"
        | "lastPreview"
        | "hasUnread"
      >
    >;
    snapshotKey: string;
    structureKey: string;
  } | null>(null);

  useEffect(
    () => () => {
      if (pendingPreviewFlushTimerRef.current) {
        clearTimeout(pendingPreviewFlushTimerRef.current);
        pendingPreviewFlushTimerRef.current = null;
      }
      pendingPreviewPayloadRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const clearPendingPreviewFlush = () => {
      if (pendingPreviewFlushTimerRef.current) {
        clearTimeout(pendingPreviewFlushTimerRef.current);
        pendingPreviewFlushTimerRef.current = null;
      }
      pendingPreviewPayloadRef.current = null;
    };

    const commitSnapshot = (
      targetSessionId: string,
      snapshot: Partial<
        Pick<
          Topic,
          | "updatedAt"
          | "messagesCount"
          | "status"
          | "statusReason"
          | "lastPreview"
          | "hasUnread"
        >
      >,
      snapshotKey: string,
      structureKey: string,
      reason: "apply" | "flushPreview",
    ) => {
      clearPendingPreviewFlush();
      lastCommittedSnapshotKeyRef.current = snapshotKey;
      lastCommittedStructureKeyRef.current = structureKey;
      logAgentDebug("useAgentTopicSnapshot", reason, {
        activeSessionId: targetSessionId,
        hasUnread: snapshot.hasUnread,
        messagesCount: snapshot.messagesCount,
        status: snapshot.status,
        statusReason: snapshot.statusReason ?? null,
        updatedAt: snapshot.updatedAt?.toISOString() ?? null,
      });
      updateTopicSnapshot(targetSessionId, snapshot);
    };

    if (!sessionId || !hasActiveTopic) {
      if (sessionId && !hasActiveTopic) {
        logAgentDebug(
          "useAgentTopicSnapshot",
          "skipWithoutActiveTopic",
          {
            activeSessionId: sessionId,
            topicsCount,
            workspaceId,
          },
          { level: "warn", throttleMs: 1000 },
        );
      }
      clearPendingPreviewFlush();
      lastCommittedSnapshotKeyRef.current = null;
      lastCommittedStructureKeyRef.current = null;
      return;
    }

    const snapshot = buildLiveTaskSnapshot({
      messages,
      isSending,
      pendingActionCount,
      queuedTurnCount,
      workspaceError: workspacePathMissing,
    });

    const snapshotKey = JSON.stringify({
      sessionId,
      updatedAt: snapshot.updatedAt?.getTime() ?? null,
      messagesCount: snapshot.messagesCount,
      status: snapshot.status,
      statusReason: snapshot.statusReason ?? null,
      lastPreview: snapshot.lastPreview,
      hasUnread: snapshot.hasUnread,
    });
    const structureKey = JSON.stringify({
      sessionId,
      updatedAt: snapshot.updatedAt?.getTime() ?? null,
      messagesCount: snapshot.messagesCount,
      status: snapshot.status,
      statusReason: snapshot.statusReason ?? null,
      hasUnread: snapshot.hasUnread,
    });

    if (lastCommittedSnapshotKeyRef.current === snapshotKey) {
      logAgentDebug(
        "useAgentTopicSnapshot",
        "skipDuplicate",
        {
          activeSessionId: sessionId,
          snapshotKey,
        },
        { throttleMs: 1200 },
      );
      return;
    }

    const structureChanged =
      lastCommittedStructureKeyRef.current !== structureKey;
    if (structureChanged || !isSending) {
      commitSnapshot(sessionId, snapshot, snapshotKey, structureKey, "apply");
      return;
    }

    pendingPreviewPayloadRef.current = {
      sessionId,
      snapshot,
      snapshotKey,
      structureKey,
    };
    if (pendingPreviewFlushTimerRef.current) {
      clearTimeout(pendingPreviewFlushTimerRef.current);
    }
    pendingPreviewFlushTimerRef.current = setTimeout(() => {
      const payload = pendingPreviewPayloadRef.current;
      if (!payload) {
        return;
      }
      commitSnapshot(
        payload.sessionId,
        payload.snapshot,
        payload.snapshotKey,
        payload.structureKey,
        "flushPreview",
      );
    }, TOPIC_PREVIEW_UPDATE_THROTTLE_MS);
  }, [
    hasActiveTopic,
    isSending,
    messages,
    pendingActionCount,
    queuedTurnCount,
    sessionId,
    topicsCount,
    updateTopicSnapshot,
    workspaceId,
    workspacePathMissing,
  ]);
}
