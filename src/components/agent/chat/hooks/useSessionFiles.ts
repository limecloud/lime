/**
 * 会话文件管理 Hook
 *
 * 提供会话级别的文件持久化功能，
 * 支持文件保存、恢复、列表和清理。
 *
 * @module components/agent/chat/hooks/useSessionFiles
 */

import { useCallback, useEffect, useRef, useState } from "react";
import * as sessionFilesApi from "@/lib/api/session-files";
import type { SessionFile, SessionMeta } from "@/lib/api/session-files";

export interface UseSessionFilesOptions {
  /** 会话 ID */
  sessionId: string | null;
  /** 主题类型 */
  theme?: string;
  /** 创建模式 */
  creationMode?: string;
  /** 自动初始化 */
  autoInit?: boolean;
}

export interface UseSessionFilesReturn {
  /** 会话元数据 */
  meta: SessionMeta | null;
  /** 文件列表 */
  files: SessionFile[];
  /** 是否正在加载 */
  isLoading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 保存文件 */
  saveFile: (
    fileName: string,
    content: string,
    metadata?: Record<string, unknown>,
  ) => Promise<SessionFile | null>;
  /** 读取文件 */
  readFile: (fileName: string) => Promise<string | null>;
  /** 删除文件 */
  deleteFile: (fileName: string) => Promise<boolean>;
  /** 刷新文件列表 */
  refresh: () => Promise<void>;
  /** 更新会话元数据 */
  updateMeta: (updates: {
    title?: string;
    theme?: string;
    creationMode?: string;
  }) => Promise<void>;
}

/**
 * 会话文件管理 Hook
 */
export function useSessionFiles(
  options: UseSessionFilesOptions,
): UseSessionFilesReturn {
  const { sessionId, theme, creationMode, autoInit = true } = options;

  const [meta, setMeta] = useState<SessionMeta | null>(null);
  const [files, setFiles] = useState<SessionFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 追踪当前会话 ID，避免竞态条件
  const currentSessionId = useRef<string | null>(null);

  // 初始化会话
  const initSession = useCallback(async () => {
    if (!sessionId) {
      setMeta(null);
      setFiles([]);
      return;
    }

    // 如果会话 ID 没变，不重复初始化
    if (currentSessionId.current === sessionId && meta) {
      return;
    }

    currentSessionId.current = sessionId;
    setIsLoading(true);
    setError(null);

    try {
      // 获取或创建会话
      const sessionMeta = await sessionFilesApi.getOrCreateSession(sessionId);
      setMeta(sessionMeta);

      // 更新主题和创建模式（如果提供）
      if (theme || creationMode) {
        const updated = await sessionFilesApi.updateSessionMeta(sessionId, {
          theme,
          creationMode,
        });
        setMeta(updated);
      }

      // 加载文件列表
      const fileList = await sessionFilesApi.listFiles(sessionId);
      setFiles(fileList);

      console.log(
        "[useSessionFiles] 会话初始化完成:",
        sessionId,
        fileList.length,
        "个文件",
      );
    } catch (err) {
      console.error("[useSessionFiles] 初始化失败:", err);
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, theme, creationMode, meta]);

  // 自动初始化
  useEffect(() => {
    if (autoInit && sessionId) {
      initSession();
    }
  }, [autoInit, sessionId, initSession]);

  // 保存文件
  const saveFile = useCallback(
    async (
      fileName: string,
      content: string,
      metadata?: Record<string, unknown>,
    ): Promise<SessionFile | null> => {
      if (!sessionId) {
        console.warn("[useSessionFiles] 无法保存文件：没有活动会话");
        return null;
      }

      try {
        const file = await sessionFilesApi.saveFile(
          sessionId,
          fileName,
          content,
          metadata,
        );

        // 更新本地文件列表
        setFiles((prev) => {
          const existing = prev.findIndex((f) => f.name === fileName);
          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = file;
            return updated;
          }
          return [...prev, file];
        });

        console.log("[useSessionFiles] 文件已保存:", fileName);
        return file;
      } catch (err) {
        console.error("[useSessionFiles] 保存文件失败:", err);
        setError(String(err));
        return null;
      }
    },
    [sessionId],
  );

  // 读取文件
  const readFile = useCallback(
    async (fileName: string): Promise<string | null> => {
      if (!sessionId) {
        console.warn("[useSessionFiles] 无法读取文件：没有活动会话");
        return null;
      }

      try {
        return await sessionFilesApi.readFile(sessionId, fileName);
      } catch (err) {
        console.error("[useSessionFiles] 读取文件失败:", err);
        setError(String(err));
        return null;
      }
    },
    [sessionId],
  );

  // 删除文件
  const deleteFile = useCallback(
    async (fileName: string): Promise<boolean> => {
      if (!sessionId) {
        console.warn("[useSessionFiles] 无法删除文件：没有活动会话");
        return false;
      }

      try {
        await sessionFilesApi.deleteFile(sessionId, fileName);

        // 更新本地文件列表
        setFiles((prev) => prev.filter((f) => f.name !== fileName));

        console.log("[useSessionFiles] 文件已删除:", fileName);
        return true;
      } catch (err) {
        console.error("[useSessionFiles] 删除文件失败:", err);
        setError(String(err));
        return false;
      }
    },
    [sessionId],
  );

  // 刷新文件列表
  const refresh = useCallback(async () => {
    if (!sessionId) return;

    try {
      const fileList = await sessionFilesApi.listFiles(sessionId);
      setFiles(fileList);
    } catch (err) {
      console.error("[useSessionFiles] 刷新失败:", err);
      setError(String(err));
    }
  }, [sessionId]);

  // 更新会话元数据
  const updateMeta = useCallback(
    async (updates: {
      title?: string;
      theme?: string;
      creationMode?: string;
    }) => {
      if (!sessionId) return;

      try {
        const updated = await sessionFilesApi.updateSessionMeta(
          sessionId,
          updates,
        );
        setMeta(updated);
      } catch (err) {
        console.error("[useSessionFiles] 更新元数据失败:", err);
        setError(String(err));
      }
    },
    [sessionId],
  );

  return {
    meta,
    files,
    isLoading,
    error,
    saveFile,
    readFile,
    deleteFile,
    refresh,
    updateMeta,
  };
}
