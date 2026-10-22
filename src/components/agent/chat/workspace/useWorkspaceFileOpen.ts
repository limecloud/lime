import { useCallback, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { resolveFilePath, type SessionFile } from "@/lib/api/session-files";
import type { TaskFile } from "../components/TaskFiles";
import {
  isAbsoluteWorkspacePath,
  resolveAbsoluteWorkspacePath,
} from "./workspacePath";

interface WorkspaceFileOpenParams {
  threadId?: string | null;
  sessionId?: string | null;
  projectRootPath?: string | null;
  sessionFiles: SessionFile[];
  taskFiles: TaskFile[];
  openWorkspaceFile: (path: string) => void;
}

export function useWorkspaceFileOpen({
  threadId,
  sessionId,
  projectRootPath,
  sessionFiles,
  taskFiles,
  openWorkspaceFile,
}: WorkspaceFileOpenParams) {
  const { t } = useTranslation("agent");
  const generation = useRef(0);
  useLayoutEffect(() => {
    generation.current += 1;
    return () => {
      generation.current += 1;
    };
  }, [sessionId, threadId, projectRootPath]);

  return useCallback(
    (fileName: string) => {
      const request = ++generation.current;
      const name = fileName.trim();
      if (!name || /^[a-z][a-z\d+.-]*:\/\//i.test(name)) {
        return;
      }

      const isSessionFile =
        sessionFiles.some((file) => file.name === name) ||
        taskFiles.some(
          (file) => file.name === name && file.id.startsWith("session-file:"),
        );
      if (!isSessionFile) {
        const path = resolveAbsoluteWorkspacePath(projectRootPath, name);
        if (path && isAbsoluteWorkspacePath(path)) {
          openWorkspaceFile(path);
        }
        return;
      }

      void (async () => {
        try {
          if (!sessionId) {
            throw new Error("Missing session identity");
          }
          const path = (await resolveFilePath(sessionId, name)).trim();
          if (!isAbsoluteWorkspacePath(path)) {
            throw new Error("Session file path must be absolute");
          }
          if (generation.current === request) {
            openWorkspaceFile(path);
          }
        } catch {
          if (generation.current === request) {
            toast.error(
              t(
                "agentChat.workspace.artifactPreview.toast.sessionFileReadFailed",
              ),
            );
          }
        }
      })();
    },
    [openWorkspaceFile, projectRootPath, sessionFiles, taskFiles, sessionId, t],
  );
}
