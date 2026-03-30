import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { CanvasStateUnion } from "@/lib/workspace/workbenchCanvas";
import { createInitialDocumentState } from "@/lib/workspace/workbenchCanvas";
import { createInitialMusicState } from "@/lib/workspace/workbenchCanvas";
import { parseLyrics } from "@/lib/workspace/workbenchCanvas";
import type { ThemeType } from "@/lib/workspace/workbenchContract";
import type { TaskFile } from "../components/TaskFiles";
import {
  resolveCanvasTaskFileTarget,
  shouldDeferCanvasSyncWhileEditing,
} from "../utils/taskFileCanvasSync";
import { isRenderableTaskFile } from "./themeWorkbenchHelpers";

interface UseWorkspaceCanvasTaskFileSyncParams {
  taskFiles: TaskFile[];
  isThemeWorkbench: boolean;
  selectedFileId?: string;
  canvasState: CanvasStateUnion | null;
  mappedTheme: ThemeType;
  documentEditorFocusedRef: MutableRefObject<boolean>;
  setSelectedFileId: Dispatch<SetStateAction<string | undefined>>;
  setCanvasState: Dispatch<SetStateAction<CanvasStateUnion | null>>;
  upsertNovelCanvasState: (
    previous: CanvasStateUnion | null,
    content: string,
  ) => CanvasStateUnion | null;
}

export function useWorkspaceCanvasTaskFileSync({
  taskFiles,
  isThemeWorkbench,
  selectedFileId,
  canvasState,
  mappedTheme,
  documentEditorFocusedRef,
  setSelectedFileId,
  setCanvasState,
  upsertNovelCanvasState,
}: UseWorkspaceCanvasTaskFileSyncParams) {
  useEffect(() => {
    const renderableFiles = taskFiles.filter((file) =>
      isRenderableTaskFile(file, isThemeWorkbench),
    );
    if (renderableFiles.length === 0) {
      return;
    }

    const { targetFile, nextSelectedFileId } = resolveCanvasTaskFileTarget(
      renderableFiles,
      selectedFileId,
    );
    if (!targetFile?.content) {
      return;
    }

    if (nextSelectedFileId) {
      setSelectedFileId((previous) =>
        previous === nextSelectedFileId ? previous : nextSelectedFileId,
      );
    }

    if (
      shouldDeferCanvasSyncWhileEditing({
        canvasType: canvasState?.type ?? null,
        editorFocused: documentEditorFocusedRef.current,
      })
    ) {
      return;
    }

    const targetContent = targetFile.content;
    setCanvasState((previous) => {
      if (mappedTheme === "music") {
        const sections = parseLyrics(targetContent);
        if (!previous || previous.type !== "music") {
          const musicState = createInitialMusicState();
          musicState.sections = sections;
          const titleMatch = targetContent.match(/^#\s*(.+)$/m);
          if (titleMatch) {
            musicState.spec.title = titleMatch[1].trim();
          }
          return musicState;
        }
        return { ...previous, sections };
      }

      if (mappedTheme === "novel") {
        return upsertNovelCanvasState(previous, targetContent);
      }

      if (!previous || previous.type !== "document") {
        return createInitialDocumentState(targetContent);
      }
      if (previous.content === targetContent) {
        return previous;
      }
      return { ...previous, content: targetContent };
    });
  }, [
    canvasState?.type,
    documentEditorFocusedRef,
    isThemeWorkbench,
    mappedTheme,
    selectedFileId,
    setCanvasState,
    setSelectedFileId,
    taskFiles,
    upsertNovelCanvasState,
  ]);
}
