/**
 * @file useSession.ts
 * @description 会话管理 Hook（旧 general-chat 兼容实现）
 * @module components/general-chat/hooks/useSession
 *
 * 封装会话加载、切换、自动标题生成等逻辑
 *
 * @requirements 1.2, 1.5
 */

import { useCallback, useEffect } from "react";
import { useGeneralChatStore } from "../store/useGeneralChatStore";

/**
 * useSession Hook 配置
 */
interface UseSessionOptions {
  /** 自动加载会话列表 */
  autoLoad?: boolean;
  /** 会话切换回调 */
  onSessionChange?: (sessionId: string | null) => void;
}

/**
 * 会话管理 Hook
 *
 * @deprecated 该 Hook 仍停留在 general-chat compat 会话链路，仅用于兼容旧版 general-chat 页面。
 */
export const useSession = (options: UseSessionOptions = {}) => {
  const { autoLoad = true, onSessionChange } = options;

  const {
    sessions,
    currentSessionId,
    hydrateSessions,
    selectSession,
    createSession: createNewSession,
    deleteSession: removeSession,
    renameSession: renameSessionInStore,
  } = useGeneralChatStore();

  /**
   * 加载会话列表
   */
  const loadSessions = useCallback(async () => {
    try {
      await hydrateSessions();
    } catch (error) {
      console.error("加载会话列表失败:", error);
    }
  }, [hydrateSessions]);

  /**
   * 创建新会话
   */
  const createSession = useCallback(
    async (name?: string): Promise<string | null> => {
      try {
        const sessionId = await createNewSession();
        if (name?.trim()) {
          await renameSessionInStore(sessionId, name.trim());
        }
        onSessionChange?.(sessionId);
        return sessionId;
      } catch (error) {
        console.error("创建会话失败:", error);
        return null;
      }
    },
    [createNewSession, renameSessionInStore, onSessionChange],
  );

  /**
   * 切换会话
   */
  const switchSession = useCallback(
    async (sessionId: string) => {
      try {
        selectSession(sessionId);
        onSessionChange?.(sessionId);
      } catch (error) {
        console.error("切换会话失败:", error);
      }
    },
    [selectSession, onSessionChange],
  );

  /**
   * 删除会话
   */
  const deleteSession = useCallback(
    async (sessionId: string) => {
      try {
        await removeSession(sessionId);

        // 获取新的当前会话 ID 并触发回调
        const newCurrentId = useGeneralChatStore.getState().currentSessionId;
        onSessionChange?.(newCurrentId);
      } catch (error) {
        console.error("删除会话失败:", error);
      }
    },
    [removeSession, onSessionChange],
  );

  /**
   * 重命名会话
   */
  const renameSession = useCallback(
    async (sessionId: string, name: string) => {
      try {
        await renameSessionInStore(sessionId, name);
      } catch (error) {
        console.error("重命名会话失败:", error);
      }
    },
    [renameSessionInStore],
  );

  /**
   * 自动生成会话标题
   * 基于第一条用户消息，调用 AI 生成简短标题
   */
  const generateTitle = useCallback(
    async (sessionId: string, firstMessage: string) => {
      try {
        await renameSession(
          sessionId,
          firstMessage.slice(0, 20).trim() || "新话题",
        );
      } catch (error) {
        console.error("生成标题失败:", error);
        // 失败时使用简单截取作为 fallback
        const fallbackTitle =
          firstMessage.slice(0, 20) + (firstMessage.length > 20 ? "..." : "");
        await renameSession(sessionId, fallbackTitle);
      }
    },
    [renameSession],
  );

  // 自动加载会话列表
  useEffect(() => {
    if (autoLoad) {
      loadSessions();
    }
  }, [autoLoad, loadSessions]);

  return {
    sessions,
    currentSessionId,
    loadSessions,
    createSession,
    switchSession,
    deleteSession,
    renameSession,
    generateTitle,
  };
};

export default useSession;
