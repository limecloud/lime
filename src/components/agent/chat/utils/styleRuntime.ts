import type { ThemeType } from "@/lib/workspace/workbenchContract";
import type { CanvasStateUnion } from "@/lib/workspace/workbenchCanvas";
import type { CanvasState as GeneralCanvasState } from "@/components/general-chat/bridge";
import type { TaskFile } from "../components/TaskFiles";
import { getSupportedFilenames } from "./workflowMapping";

interface StyleActionContext {
  activeTheme: ThemeType;
  generalCanvasState: GeneralCanvasState;
  resolvedCanvasState: CanvasStateUnion | null;
  taskFiles: TaskFile[];
  selectedFileId?: string;
}

function getSelectedTaskFileContent(context: StyleActionContext): string {
  const selectedFile = context.taskFiles.find(
    (file) => file.id === context.selectedFileId,
  );
  return typeof selectedFile?.content === "string"
    ? selectedFile.content.trim()
    : "";
}

export function extractStyleActionContent(context: StyleActionContext): string {
  const { activeTheme, generalCanvasState, resolvedCanvasState } = context;
  const selectedFileContent = getSelectedTaskFileContent(context);

  if (selectedFileContent) {
    return selectedFileContent;
  }

  if (activeTheme === "general") {
    return generalCanvasState.content.trim();
  }

  if (!resolvedCanvasState) {
    return "";
  }

  switch (resolvedCanvasState.type) {
    case "document":
      return resolvedCanvasState.content.trim();
    case "video":
      return resolvedCanvasState.prompt.trim();
    default:
      return "";
  }
}

export function resolveStyleActionFileName(
  context: StyleActionContext,
): string {
  const selectedFile = context.taskFiles.find(
    (file) => file.id === context.selectedFileId,
  );
  if (selectedFile?.name) {
    return selectedFile.name;
  }

  if (context.activeTheme === "general") {
    return context.generalCanvasState.filename || "article.md";
  }

  const supportedFileNames = getSupportedFilenames(context.activeTheme);
  if (supportedFileNames.length > 0) {
    return supportedFileNames[supportedFileNames.length - 1] || "article.md";
  }

  switch (context.resolvedCanvasState?.type) {
    case "document":
      return "article.md";
    case "video":
      return "script-final.md";
    default:
      return "article.md";
  }
}
