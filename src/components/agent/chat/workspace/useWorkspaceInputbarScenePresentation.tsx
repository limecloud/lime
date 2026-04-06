import {
  useCallback,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Character } from "@/lib/api/memory";
import type { TaskFile } from "../components/TaskFiles";
import { resolveCanvasTaskFileTarget } from "../utils/taskFileCanvasSync";
import { isRenderableTaskFile } from "./generalWorkbenchHelpers";
import { useWorkspaceInputbarPresentation } from "./useWorkspaceInputbarPresentation";

type WorkspaceInputbarPresentationParams = Parameters<
  typeof useWorkspaceInputbarPresentation
>[0];

interface UseWorkspaceInputbarScenePresentationParams {
  setMentionedCharacters: Dispatch<SetStateAction<Character[]>>;
  taskFiles: TaskFile[];
  taskFilesExpanded: boolean;
  setTaskFilesExpanded: Dispatch<SetStateAction<boolean>>;
  selectedFileId?: string;
  isThemeWorkbench: boolean;
  inputbarPresentation: {
    teamWorkbench: WorkspaceInputbarPresentationParams["teamWorkbench"];
    inputbar: Omit<
      WorkspaceInputbarPresentationParams["inputbar"],
      | "taskFiles"
      | "selectedFileId"
      | "taskFilesExpanded"
      | "onToggleTaskFiles"
      | "onSelectCharacter"
    >;
    floatingTeamWorkspaceDock: WorkspaceInputbarPresentationParams["floatingTeamWorkspaceDock"];
    generalWorkbenchEntryPrompt: WorkspaceInputbarPresentationParams["generalWorkbenchEntryPrompt"];
    onRestartGeneralWorkbenchEntryPrompt: WorkspaceInputbarPresentationParams["onRestartGeneralWorkbenchEntryPrompt"];
    onContinueGeneralWorkbenchEntryPrompt: WorkspaceInputbarPresentationParams["onContinueGeneralWorkbenchEntryPrompt"];
    generalWorkbenchDialog: WorkspaceInputbarPresentationParams["generalWorkbenchDialog"];
  };
}

interface WorkspaceInputbarScenePresentationResult {
  visibleTaskFiles: TaskFile[];
  visibleSelectedFileId?: string;
  activeCanvasTaskFile: TaskFile | null;
  teamWorkbenchSurfaceProps: ReturnType<
    typeof useWorkspaceInputbarPresentation
  >["teamWorkbenchSurfaceProps"];
  inputbarNode: ReturnType<
    typeof useWorkspaceInputbarPresentation
  >["inputbarNode"];
  generalWorkbenchDialog: ReturnType<
    typeof useWorkspaceInputbarPresentation
  >["generalWorkbenchDialog"];
}

export function useWorkspaceInputbarScenePresentation({
  setMentionedCharacters,
  taskFiles,
  taskFilesExpanded,
  setTaskFilesExpanded,
  selectedFileId,
  isThemeWorkbench,
  inputbarPresentation,
}: UseWorkspaceInputbarScenePresentationParams): WorkspaceInputbarScenePresentationResult {
  const handleSelectCharacter = useCallback(
    (character: Character) => {
      setMentionedCharacters((previous) => {
        if (previous.find((item) => item.id === character.id)) {
          return previous;
        }
        return [...previous, character];
      });
    },
    [setMentionedCharacters],
  );

  const handleToggleTaskFiles = useCallback(() => {
    setTaskFilesExpanded((previous) => !previous);
  }, [setTaskFilesExpanded]);

  const visibleTaskFiles = useMemo(
    () =>
      taskFiles.filter((file) => isRenderableTaskFile(file, isThemeWorkbench)),
    [isThemeWorkbench, taskFiles],
  );

  const visibleSelectedFileId = useMemo(() => {
    if (!selectedFileId) {
      return undefined;
    }
    return visibleTaskFiles.some((file) => file.id === selectedFileId)
      ? selectedFileId
      : undefined;
  }, [selectedFileId, visibleTaskFiles]);

  const activeCanvasTaskFile = useMemo(
    () =>
      resolveCanvasTaskFileTarget(visibleTaskFiles, visibleSelectedFileId)
        .targetFile,
    [visibleSelectedFileId, visibleTaskFiles],
  );

  const {
    teamWorkbenchSurfaceProps,
    inputbarNode,
    generalWorkbenchDialog,
  } = useWorkspaceInputbarPresentation({
    teamWorkbench: inputbarPresentation.teamWorkbench,
    inputbar: {
      ...inputbarPresentation.inputbar,
      taskFiles: visibleTaskFiles,
      selectedFileId: visibleSelectedFileId,
      taskFilesExpanded,
      onToggleTaskFiles: handleToggleTaskFiles,
      onSelectCharacter: handleSelectCharacter,
    },
    floatingTeamWorkspaceDock:
      inputbarPresentation.floatingTeamWorkspaceDock,
    generalWorkbenchEntryPrompt:
      inputbarPresentation.generalWorkbenchEntryPrompt,
    onRestartGeneralWorkbenchEntryPrompt:
      inputbarPresentation.onRestartGeneralWorkbenchEntryPrompt,
    onContinueGeneralWorkbenchEntryPrompt:
      inputbarPresentation.onContinueGeneralWorkbenchEntryPrompt,
    generalWorkbenchDialog: inputbarPresentation.generalWorkbenchDialog,
  });

  return {
    visibleTaskFiles,
    visibleSelectedFileId,
    activeCanvasTaskFile,
    teamWorkbenchSurfaceProps,
    inputbarNode,
    generalWorkbenchDialog,
  };
}
