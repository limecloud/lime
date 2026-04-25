import { useCallback, useEffect, useRef } from "react";
import type { TaskFile } from "../components/TaskFiles";
import type {
  CreationMode,
  ThemeType,
} from "@/lib/workspace/workbenchContract";
import { isSpecializedWorkbenchTheme } from "@/lib/workspace/workbenchContract";
import { normalizeInitialTheme } from "../agentChatWorkspaceShared";
import { normalizeSessionTaskFileType } from "./generalWorkbenchHelpers";

interface SessionFileSummary {
  name: string;
  fileType?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: number;
  updatedAt?: number;
}

interface SessionMetaSummary {
  sessionId: string;
  theme?: string | null;
  creationMode?: string | null;
}

interface UseWorkspaceSessionRestoreParams {
  sessionId?: string | null;
  sessionMeta?: SessionMetaSummary | null;
  lockTheme: boolean;
  initialTheme?: string;
  sessionFiles: SessionFileSummary[];
  taskFilesLength: number;
  setActiveTheme: (theme: ThemeType) => void;
  setCreationMode: (mode: CreationMode) => void;
  setTaskFiles: (files: TaskFile[]) => void;
}

function buildSessionTaskFilePlaceholders(
  sessionFiles: SessionFileSummary[],
): TaskFile[] {
  return sessionFiles.map((file) => ({
    id: `session-file:${file.name}`,
    name: file.name,
    type: normalizeSessionTaskFileType(file.fileType ?? "other", file.name),
    version: 1,
    createdAt: file.createdAt ?? Date.now(),
    updatedAt: file.updatedAt ?? file.createdAt ?? Date.now(),
    metadata: file.metadata,
  }));
}

export function useWorkspaceSessionRestore({
  sessionId,
  sessionMeta,
  lockTheme,
  initialTheme,
  sessionFiles,
  taskFilesLength,
  setActiveTheme,
  setCreationMode,
  setTaskFiles,
}: UseWorkspaceSessionRestoreParams) {
  const restoredMetaSessionIdRef = useRef<string | null>(null);
  const restoredFilesSessionIdRef = useRef<string | null>(null);

  const resetRestoredSessionState = useCallback(() => {
    restoredMetaSessionIdRef.current = null;
    restoredFilesSessionIdRef.current = null;
  }, []);

  useEffect(() => {
    if (!sessionId || !sessionMeta) {
      return;
    }

    if (sessionMeta.sessionId !== sessionId) {
      return;
    }

    if (restoredMetaSessionIdRef.current === sessionId) {
      return;
    }

    console.log("[AgentChatPage] 恢复会话元数据:", sessionId, sessionMeta);

    if (sessionMeta.theme && (!lockTheme || !initialTheme)) {
      const entryIsGeneral = !initialTheme || initialTheme === "general";
      const restoredIsSpecializedTheme = isSpecializedWorkbenchTheme(
        sessionMeta.theme,
      );
      if (entryIsGeneral && restoredIsSpecializedTheme) {
        console.log(
          "[AgentChatPage] 通用对话入口，跳过恢复内容工作区主题:",
          sessionMeta.theme,
        );
      } else {
        console.log("[AgentChatPage] 恢复主题:", sessionMeta.theme);
        setActiveTheme(normalizeInitialTheme(sessionMeta.theme));
      }
    }

    if (sessionMeta.creationMode) {
      console.log("[AgentChatPage] 恢复创建模式:", sessionMeta.creationMode);
      setCreationMode(sessionMeta.creationMode as CreationMode);
    }

    restoredMetaSessionIdRef.current = sessionId;
  }, [
    initialTheme,
    lockTheme,
    sessionId,
    sessionMeta,
    setActiveTheme,
    setCreationMode,
  ]);

  useEffect(() => {
    if (!sessionId || sessionFiles.length === 0) {
      return;
    }

    if (restoredFilesSessionIdRef.current === sessionId) {
      return;
    }

    if (taskFilesLength > 0) {
      restoredFilesSessionIdRef.current = sessionId;
      return;
    }

    const restoredFiles = buildSessionTaskFilePlaceholders(sessionFiles);
    if (restoredFiles.length > 0) {
      console.log(
        "[AgentChatPage] 从持久化存储恢复文件清单:",
        sessionId,
        restoredFiles.length,
        "个文件",
      );
      setTaskFiles(restoredFiles);
    }

    restoredFilesSessionIdRef.current = sessionId;
  }, [sessionFiles, sessionId, setTaskFiles, taskFilesLength]);

  return {
    resetRestoredSessionState,
  };
}
