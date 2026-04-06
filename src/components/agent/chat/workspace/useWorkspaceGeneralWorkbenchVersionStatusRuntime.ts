import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { CanvasStateUnion } from "@/lib/workspace/workbenchCanvas";
import type { TopicBranchStatus } from "../hooks/useTopicBranchBoard";

interface GeneralWorkbenchLatestTerminalSummary {
  run_id: string;
  status?: string | null;
}

interface UseWorkspaceGeneralWorkbenchVersionStatusRuntimeParams {
  isThemeWorkbench: boolean;
  themeWorkbenchRunState: "idle" | "auto_running" | "await_user_decision";
  canvasState: CanvasStateUnion | null;
  latestTerminal: GeneralWorkbenchLatestTerminalSummary | null;
  setDocumentVersionStatusMap: Dispatch<
    SetStateAction<Record<string, TopicBranchStatus>>
  >;
}

export function useWorkspaceGeneralWorkbenchVersionStatusRuntime({
  isThemeWorkbench,
  themeWorkbenchRunState,
  canvasState,
  latestTerminal,
  setDocumentVersionStatusMap,
}: UseWorkspaceGeneralWorkbenchVersionStatusRuntimeParams) {
  useEffect(() => {
    if (!isThemeWorkbench || themeWorkbenchRunState !== "idle") {
      return;
    }
    if (!canvasState || canvasState.type !== "document") {
      return;
    }

    setDocumentVersionStatusMap((previous) => {
      if (latestTerminal) {
        const terminalVersionId = latestTerminal.run_id;
        const terminalVersionExists = canvasState.versions.some(
          (version) => version.id === terminalVersionId,
        );
        if (terminalVersionExists) {
          const terminalStatus: TopicBranchStatus =
            latestTerminal.status === "success" ? "merged" : "candidate";
          if (previous[terminalVersionId] !== terminalStatus) {
            return {
              ...previous,
              [terminalVersionId]: terminalStatus,
            };
          }
        }
      }

      const currentVersionId = canvasState.currentVersionId;
      if (!currentVersionId || previous[currentVersionId] !== "in_progress") {
        return previous;
      }
      return {
        ...previous,
        [currentVersionId]: "pending",
      };
    });
  }, [
    canvasState,
    isThemeWorkbench,
    latestTerminal,
    setDocumentVersionStatusMap,
    themeWorkbenchRunState,
  ]);
}
