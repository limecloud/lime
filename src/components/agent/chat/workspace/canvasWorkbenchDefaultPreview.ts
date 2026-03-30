import type { CanvasStateUnion } from "@/lib/workspace/workbenchCanvas";
import type { ThemeType } from "@/lib/workspace/workbenchContract";
import type { CanvasState as GeneralCanvasState } from "@/components/general-chat/bridge";
import type { TaskFile } from "../components/TaskFiles";
import type { CanvasWorkbenchDefaultPreview } from "../components/CanvasWorkbenchLayout";
import {
  isCanvasStateEmpty,
  serializeCanvasStateForSync,
} from "./themeWorkbenchHelpers";
import { resolvePreviousDocumentVersionContent } from "./workbenchPreviewHelpers";
import {
  extractFileNameFromPath,
  resolveAbsoluteWorkspacePath,
} from "./workspacePath";

interface BuildCanvasWorkbenchDefaultPreviewParams {
  workspaceRoot: string | null;
  canvasRenderTheme: ThemeType;
  generalCanvasState: Pick<GeneralCanvasState, "isOpen" | "content" | "filename">;
  resolvedCanvasState: CanvasStateUnion | null;
  activeCanvasTaskFile: TaskFile | null;
}

export function buildCanvasWorkbenchDefaultPreview({
  workspaceRoot,
  canvasRenderTheme,
  generalCanvasState,
  resolvedCanvasState,
  activeCanvasTaskFile,
}: BuildCanvasWorkbenchDefaultPreviewParams): CanvasWorkbenchDefaultPreview | null {
  if (canvasRenderTheme === "general") {
    if (!generalCanvasState.isOpen || !generalCanvasState.content.trim()) {
      return null;
    }

    const filePath = generalCanvasState.filename?.trim() || undefined;
    return {
      title: filePath ? extractFileNameFromPath(filePath) : "当前画布草稿",
      content: generalCanvasState.content,
      filePath,
      absolutePath: resolveAbsoluteWorkspacePath(workspaceRoot, filePath),
      previousContent: null,
    };
  }

  if (!resolvedCanvasState || isCanvasStateEmpty(resolvedCanvasState)) {
    return null;
  }

  const taskSelectionKey = activeCanvasTaskFile
    ? `task:${activeCanvasTaskFile.id}`
    : undefined;

  if (resolvedCanvasState.type === "document") {
    const currentVersion =
      resolvedCanvasState.versions.find(
        (item) => item.id === resolvedCanvasState.currentVersionId,
      ) ||
      resolvedCanvasState.versions[resolvedCanvasState.versions.length - 1] ||
      null;
    const filePath =
      activeCanvasTaskFile?.name || currentVersion?.metadata?.sourceFileName;

    return {
      selectionKey:
        taskSelectionKey ||
        (currentVersion ? `version:${currentVersion.id}` : undefined),
      title: filePath ? extractFileNameFromPath(filePath) : "当前文稿",
      content: resolvedCanvasState.content,
      filePath,
      absolutePath: resolveAbsoluteWorkspacePath(workspaceRoot, filePath),
      previousContent: resolvePreviousDocumentVersionContent(
        currentVersion,
        resolvedCanvasState.versions,
      ),
    };
  }

  const filePath = activeCanvasTaskFile?.name;
  return {
    selectionKey: taskSelectionKey,
    title: filePath ? extractFileNameFromPath(filePath) : "当前画布",
    content: serializeCanvasStateForSync(resolvedCanvasState),
    filePath,
    absolutePath: resolveAbsoluteWorkspacePath(workspaceRoot, filePath),
    previousContent: null,
  };
}
