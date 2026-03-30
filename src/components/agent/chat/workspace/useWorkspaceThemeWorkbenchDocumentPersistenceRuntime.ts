import { useEffect, type MutableRefObject } from "react";
import { updateContent } from "@/lib/api/project";
import type { CanvasStateUnion } from "@/lib/workspace/workbenchCanvas";
import type { TopicBranchStatus } from "../hooks/useTopicBranchBoard";
import {
  THEME_WORKBENCH_DOCUMENT_META_KEY,
  buildPersistedThemeWorkbenchDocument,
} from "./themeWorkbenchHelpers";

interface UseWorkspaceThemeWorkbenchDocumentPersistenceRuntimeParams {
  isThemeWorkbench: boolean;
  contentId?: string | null;
  canvasState: CanvasStateUnion | null;
  documentVersionStatusMap: Record<string, TopicBranchStatus>;
  contentMetadataRef: MutableRefObject<Record<string, unknown>>;
  persistedWorkbenchSnapshotRef: MutableRefObject<string>;
}

export function useWorkspaceThemeWorkbenchDocumentPersistenceRuntime({
  isThemeWorkbench,
  contentId,
  canvasState,
  documentVersionStatusMap,
  contentMetadataRef,
  persistedWorkbenchSnapshotRef,
}: UseWorkspaceThemeWorkbenchDocumentPersistenceRuntimeParams) {
  useEffect(() => {
    if (
      !isThemeWorkbench ||
      !contentId ||
      !canvasState ||
      canvasState.type !== "document"
    ) {
      return;
    }

    const persisted = buildPersistedThemeWorkbenchDocument(
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
      [THEME_WORKBENCH_DOCUMENT_META_KEY]: persisted,
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
          console.warn("[AgentChatPage] 保存文稿版本状态失败:", error);
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
