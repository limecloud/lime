import { useCallback, useEffect, useRef } from "react";
import type { TaskFile } from "../components/TaskFiles";
import type { CreationMode, ThemeType } from "@/components/content-creator/types";
import { isContentCreationTheme } from "@/components/content-creator/utils/systemPrompt";
import { normalizeInitialTheme } from "../agentChatWorkspaceShared";
import { normalizeSessionTaskFileType } from "./themeWorkbenchHelpers";

interface SessionFileSummary {
  name: string;
  fileType?: string | null;
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
  readSessionFile: (name: string) => Promise<string | null | undefined>;
  taskFilesLength: number;
  setActiveTheme: (theme: ThemeType) => void;
  setCreationMode: (mode: CreationMode) => void;
  setTaskFiles: (files: TaskFile[]) => void;
}

export function useWorkspaceSessionRestore({
  sessionId,
  sessionMeta,
  lockTheme,
  initialTheme,
  sessionFiles,
  readSessionFile,
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
      const restoredIsCreation = isContentCreationTheme(sessionMeta.theme);
      if (entryIsGeneral && restoredIsCreation) {
        console.log(
          "[AgentChatPage] 通用对话入口，跳过恢复内容创作主题:",
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

    console.log(
      "[AgentChatPage] 开始恢复文件:",
      sessionId,
      sessionFiles.length,
      "个文件",
    );

    const restoreFiles = async () => {
      const restoredFiles: TaskFile[] = [];

      for (const file of sessionFiles) {
        try {
          const content = await readSessionFile(file.name);
          if (content) {
            restoredFiles.push({
              id: crypto.randomUUID(),
              name: file.name,
              type: normalizeSessionTaskFileType(
                file.fileType ?? "other",
                file.name,
                content,
              ),
              content,
              version: 1,
              createdAt: file.createdAt ?? Date.now(),
              updatedAt: file.updatedAt ?? file.createdAt ?? Date.now(),
            });
          }
        } catch (err) {
          console.error("[AgentChatPage] 恢复文件失败:", file.name, err);
        }
      }

      if (restoredFiles.length > 0) {
        console.log(
          "[AgentChatPage] 从持久化存储恢复",
          restoredFiles.length,
          "个文件",
        );
        setTaskFiles(restoredFiles);
      }
      restoredFilesSessionIdRef.current = sessionId;
    };

    void restoreFiles();
  }, [
    readSessionFile,
    sessionFiles,
    sessionId,
    setTaskFiles,
    taskFilesLength,
  ]);

  return {
    resetRestoredSessionState,
  };
}
