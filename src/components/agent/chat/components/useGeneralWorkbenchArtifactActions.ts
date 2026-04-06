import { useCallback } from "react";
import { toast } from "sonner";
import {
  openFileWithDefaultApp as openSessionFileWithDefaultApp,
  revealFileInFinder as revealSessionFileInFinder,
} from "@/lib/api/session-files";
import { formatGeneralWorkbenchActionErrorMessage } from "./generalWorkbenchSidebarShared";

interface UseGeneralWorkbenchArtifactActionsParams {
  runDetailSessionId: string | null;
}

export function useGeneralWorkbenchArtifactActions({
  runDetailSessionId,
}: UseGeneralWorkbenchArtifactActionsParams) {
  const handleRevealArtifactInFinder = useCallback(
    async (artifactPath: string, sessionId?: string | null) => {
      const resolvedSessionId = sessionId?.trim() || runDetailSessionId;
      if (!resolvedSessionId) {
        toast.error("缺少会话ID，无法定位产物文件");
        return;
      }
      try {
        await revealSessionFileInFinder(resolvedSessionId, artifactPath);
      } catch (error) {
        console.warn("[GeneralWorkbenchSidebar] 定位产物文件失败:", error);
        toast.error(
          formatGeneralWorkbenchActionErrorMessage("定位产物文件失败", error),
        );
      }
    },
    [runDetailSessionId],
  );

  const handleOpenArtifactWithDefaultApp = useCallback(
    async (artifactPath: string, sessionId?: string | null) => {
      const resolvedSessionId = sessionId?.trim() || runDetailSessionId;
      if (!resolvedSessionId) {
        toast.error("缺少会话ID，无法打开产物文件");
        return;
      }
      try {
        await openSessionFileWithDefaultApp(resolvedSessionId, artifactPath);
      } catch (error) {
        console.warn("[GeneralWorkbenchSidebar] 打开产物文件失败:", error);
        toast.error(
          formatGeneralWorkbenchActionErrorMessage("打开产物文件失败", error),
        );
      }
    },
    [runDetailSessionId],
  );

  return {
    handleRevealArtifactInFinder,
    handleOpenArtifactWithDefaultApp,
  };
}
