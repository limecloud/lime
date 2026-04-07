/**
 * 内容同步 Hook
 *
 * 提供防抖同步、状态管理和失败重试功能
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { updateContent } from "@/lib/api/project";

export type SyncStatus = "idle" | "syncing" | "success" | "error";

interface UseContentSyncOptions {
  /** 防抖延迟（毫秒） */
  debounceMs?: number;
  /** 是否自动重试 */
  autoRetry?: boolean;
  /** 重试延迟（毫秒） */
  retryDelayMs?: number;
}

interface UseContentSyncReturn {
  /** 同步内容 */
  syncContent: (contentId: string, body: string) => void;
  /** 同步状态 */
  syncStatus: SyncStatus;
  /** 手动重置状态 */
  resetStatus: () => void;
}

export function useContentSync(
  options: UseContentSyncOptions = {},
): UseContentSyncReturn {
  const { debounceMs = 2000, autoRetry = true, retryDelayMs = 5000 } = options;

  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const statusResetTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const isSyncingRef = useRef(false);
  const lastSyncDataRef = useRef<{ contentId: string; body: string } | null>(
    null,
  );
  const lastSuccessfulSyncRef = useRef<{
    contentId: string;
    body: string;
  } | null>(null);

  const clearTimers = useCallback(() => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = undefined;
    }
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = undefined;
    }
    if (statusResetTimeoutRef.current) {
      clearTimeout(statusResetTimeoutRef.current);
      statusResetTimeoutRef.current = undefined;
    }
  }, []);

  const syncContent = useCallback(
    (contentId: string, body: string) => {
      const isSameAsLastSuccess =
        lastSuccessfulSyncRef.current?.contentId === contentId &&
        lastSuccessfulSyncRef.current.body === body;
      if (isSameAsLastSuccess) {
        return;
      }

      const isSameAsLatestPending =
        lastSyncDataRef.current?.contentId === contentId &&
        lastSyncDataRef.current.body === body;
      if (
        isSameAsLatestPending &&
        (Boolean(syncTimeoutRef.current) ||
          Boolean(retryTimeoutRef.current) ||
          isSyncingRef.current)
      ) {
        return;
      }

      lastSyncDataRef.current = { contentId, body };

      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = undefined;
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = undefined;
      }

      syncTimeoutRef.current = setTimeout(async () => {
        syncTimeoutRef.current = undefined;
        isSyncingRef.current = true;
        setSyncStatus("syncing");

        try {
          await updateContent(contentId, { body });
          lastSuccessfulSyncRef.current = { contentId, body };
          setSyncStatus("success");

          if (statusResetTimeoutRef.current) {
            clearTimeout(statusResetTimeoutRef.current);
          }
          statusResetTimeoutRef.current = setTimeout(() => {
            statusResetTimeoutRef.current = undefined;
            setSyncStatus((current) =>
              current === "success" ? "idle" : current,
            );
          }, 3000);
        } catch (error) {
          console.error("同步内容失败:", error);
          setSyncStatus("error");

          if (autoRetry && lastSyncDataRef.current) {
            retryTimeoutRef.current = setTimeout(() => {
              retryTimeoutRef.current = undefined;
              if (lastSyncDataRef.current) {
                console.log("[useContentSync] 重试同步...");
                syncContent(
                  lastSyncDataRef.current.contentId,
                  lastSyncDataRef.current.body,
                );
              }
            }, retryDelayMs);
          }
        } finally {
          isSyncingRef.current = false;
        }
      }, debounceMs);
    },
    [debounceMs, autoRetry, retryDelayMs],
  );

  const resetStatus = useCallback(() => {
    setSyncStatus("idle");
    clearTimers();
    isSyncingRef.current = false;
  }, [clearTimers]);

  useEffect(
    () => () => {
      clearTimers();
      isSyncingRef.current = false;
    },
    [clearTimers],
  );

  return { syncContent, syncStatus, resetStatus };
}
