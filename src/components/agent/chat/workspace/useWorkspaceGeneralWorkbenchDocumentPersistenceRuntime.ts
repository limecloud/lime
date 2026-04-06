import { useEffect, type MutableRefObject } from "react";
import { updateContent } from "@/lib/api/project";
import type { CanvasStateUnion } from "@/lib/workspace/workbenchCanvas";
import type { TopicBranchStatus } from "../hooks/useTopicBranchBoard";
import {
  GENERAL_WORKBENCH_DOCUMENT_META_KEY,
  buildPersistedGeneralWorkbenchDocument,
} from "./generalWorkbenchHelpers";

interface UseWorkspaceGeneralWorkbenchDocumentPersistenceRuntimeParams {
  isThemeWorkbench: boolean;
  contentId?: string | null;
  canvasState: CanvasStateUnion | null;
  documentVersionStatusMap: Record<string, TopicBranchStatus>;
  contentMetadataRef: MutableRefObject<Record<string, unknown>>;
  persistedWorkbenchSnapshotRef: MutableRefObject<string>;
}

export function useWorkspaceGeneralWorkbenchDocumentPersistenceRuntime({
  isThemeWorkbench,
  contentId,
  canvasState,
  documentVersionStatusMap,
  contentMetadataRef,
  persistedWorkbenchSnapshotRef,
}: UseWorkspaceGeneralWorkbenchDocumentPersistenceRuntimeParams) {
  useEffect(() => {
    if (
      !isThemeWorkbench ||
      !contentId ||
      !canvasState ||
      canvasState.type !== "document"
    ) {
      return;
    }

    const persisted = buildPersistedGeneralWorkbenchDocument(
      canvasState,
      documentVersionStatusMap,
    );
    if (!persisted) {
      return;
    }

    const snapshot = JSON.stringify(persisted);
    if (snapshot === persistedWorkbenchSnapshotRef.current) {
      return;
    }

    const nextMetadata = {
      ...(contentMetadataRef.current || {}),
      [GENERAL_WORKBENCH_DOCUMENT_META_KEY]: persisted,
    };

    const timer = setTimeout(() => {
      updateContent(contentId, {
        metadata: nextMetadata,
      })
        .then((updated) => {
          contentMetadataRef.current = updated.metadata || nextMetadata;
          persistedWorkbenchSnapshotRef.current = snapshot;
        })
        .catch((error) => {
          console.warn("[AgentChatPage] 保存工作区文稿版本状态失败:", error);
        });
    }, 1000);

    return () => clearTimeout(timer);
  }, [
    canvasState,
    contentId,
    contentMetadataRef,
    documentVersionStatusMap,
    isThemeWorkbench,
    persistedWorkbenchSnapshotRef,
  ]);
}
