import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, Download, FolderOpen, RefreshCw } from "lucide-react";
import {
  getConfig,
  getLogs,
  getPersistedLogsTail,
} from "@/hooks/useTauri";
import {
  buildCrashDiagnosticPayload,
  copyCrashDiagnosticJsonToClipboard,
  copyCrashDiagnosticToClipboard,
  exportCrashDiagnosticToJson,
  isClipboardPermissionDeniedError,
  normalizeCrashReportingConfig,
  openCrashDiagnosticDownloadDirectory,
} from "@/lib/crashDiagnostic";
import { cn } from "@/lib/utils";
import { ClipboardPermissionGuideCard } from "@/components/settings-v2/system/shared/ClipboardPermissionGuideCard";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

interface CrashRecoveryPanelProps {
  error: Error | null;
  componentStack: string;
  onRetry: () => void;
}

export function CrashRecoveryPanel({
  error,
  componentStack,
  onRetry,
}: CrashRecoveryPanelProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [showClipboardGuide, setShowClipboardGuide] = useState(false);
  const errorMessage = error?.message ?? "";

  const sceneTag =
    errorMessage.includes("Workspace 路径不存在") ||
    errorMessage.includes("Workspace 路径存在但不是目录")
      ? "workspace-path-missing"
      : "crash-recovery";

  // 从错误消息中提取旧的 workspace 路径
  const oldWorkspacePath = useMemo(() => {
    const match = errorMessage.match(
      /Workspace 路径(?:不存在，且自动创建失败|存在但不是目录): (.+?)。/,
    );
    return match?.[1] ?? null;
  }, [errorMessage]);

  const stackPreview = useMemo(() => {
    const raw = componentStack.trim();
    if (!raw) {
      return "";
    }
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 8)
      .join(" | ");
  }, [componentStack]);

  const buildPayload = useCallback(async () => {
    const notes: string[] = [];
    if (error?.message) {
      notes.push(`boundary_error: ${error.message}`);
    }
    if (error?.stack) {
      notes.push(`boundary_error_stack: ${error.stack.split("\n").slice(0, 5).join(" | ")}`);
    }
    if (stackPreview) {
      notes.push(`boundary_component_stack: ${stackPreview}`);
    }

    const [config, logs, persistedLogs] = await Promise.all([
      getConfig().catch(() => {
        notes.push("get_config_failed");
        return null;
      }),
      getLogs().catch(() => {
        notes.push("get_logs_failed");
        return [];
      }),
      getPersistedLogsTail(250).catch(() => {
        notes.push("get_persisted_logs_tail_failed");
        return [];
      }),
    ]);

    return buildCrashDiagnosticPayload({
      crashConfig: normalizeCrashReportingConfig(config?.crash_reporting),
      logs,
      persistedLogTail: persistedLogs,
      appVersion: import.meta.env.VITE_APP_VERSION,
      platform: navigator.platform,
      userAgent: navigator.userAgent,
      maxCrashLogs: 40,
      maxPersistedLogs: 250,
      collectionNotes: notes,
    });
  }, [error, stackPreview]);

  const runAction = useCallback(
    async (
      action: (payload: Awaited<ReturnType<typeof buildPayload>>) => Promise<void> | void,
      successText: string,
    ) => {
      setBusy(true);
      setMessage(null);
      setShowClipboardGuide(false);
      try {
        const payload = await buildPayload();
        await action(payload);
        setMessage({ type: "success", text: successText });
      } catch (actionError) {
        const denied = isClipboardPermissionDeniedError(actionError);
        setShowClipboardGuide(denied);
        setMessage({
          type: "error",
          text: actionError instanceof Error ? actionError.message : "生成诊断信息失败",
        });
      } finally {
        setBusy(false);
      }
    },
    [buildPayload],
  );

  const handleCopyTemplate = useCallback(() => {
    void runAction(
      (payload) => copyCrashDiagnosticToClipboard(payload),
      "诊断信息已复制，可直接发送给开发者",
    );
  }, [runAction]);

  const handleCopyJson = useCallback(() => {
    void runAction(
      (payload) => copyCrashDiagnosticJsonToClipboard(payload),
      "纯 JSON 诊断信息已复制",
    );
  }, [runAction]);

  const handleExportJson = useCallback(() => {
    void runAction(async (payload) => {
      const result = exportCrashDiagnosticToJson(payload, { sceneTag });
      let openedPath: string | null = null;
      try {
        const opened = await openCrashDiagnosticDownloadDirectory();
        openedPath = opened.openedPath;
      } catch {
        openedPath = null;
      }
      setMessage({
        type: "success",
        text: openedPath
          ? `诊断文件已导出：${result.fileName}，并已打开目录：${openedPath}`
          : `诊断文件已导出：${result.fileName}（位置：${result.locationHint}）`,
      });
    }, "诊断文件已导出");
  }, [sceneTag, runAction]);

  const handleSelectNewDirectory = useCallback(async () => {
    if (!oldWorkspacePath) {
      setMessage({ type: "error", text: "无法从错误信息中提取 workspace 路径" });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const newPath = await openDialog({ directory: true, multiple: false });
      if (!newPath) {
        return;
      }
      const workspace = await invoke<{ id: string } | null>(
        "workspace_get_by_path",
        { rootPath: oldWorkspacePath },
      );
      if (!workspace) {
        setMessage({ type: "error", text: `未找到路径为 ${oldWorkspacePath} 的 workspace` });
        return;
      }
      await invoke("workspace_update", {
        id: workspace.id,
        request: { rootPath: newPath },
      });
      setMessage({ type: "success", text: `Workspace 路径已更新为：${newPath}` });
      onRetry();
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "更新 workspace 路径失败",
      });
    } finally {
      setBusy(false);
    }
  }, [oldWorkspacePath, onRetry]);

  const handleOpenDownloadDirectory = useCallback(() => {
    void runAction(
      async () => {
        const result = await openCrashDiagnosticDownloadDirectory();
        setMessage({
          type: "success",
          text: `已打开下载目录：${result.openedPath}`,
        });
      },
      "已打开下载目录",
    );
  }, [runAction]);

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-2xl rounded-xl border bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-start gap-3">
          <div className="rounded-lg bg-rose-500/10 p-2">
            <AlertTriangle className="h-5 w-5 text-rose-500" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">应用发生错误，已进入恢复模式</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              建议先复制或导出诊断信息，再点击“重试恢复”继续使用。
            </p>
          </div>
        </div>

        {error?.message && (
          <div className="mb-4 rounded-md border border-rose-200 bg-rose-50/70 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
            最近错误：{error.message}
          </div>
        )}

        {message && (
          <div
            className={cn(
              "mb-4 rounded-md px-3 py-2 text-sm",
              message.type === "success"
                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                : "bg-destructive/10 text-destructive",
            )}
          >
            {message.text}
          </div>
        )}

        {showClipboardGuide && <ClipboardPermissionGuideCard className="mb-4" />}

        <div className="flex flex-wrap items-center gap-2">
          {sceneTag === "workspace-path-missing" ? (
            <button
              type="button"
              onClick={() => void handleSelectNewDirectory()}
              disabled={busy}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border border-blue-400 bg-blue-50 px-3 py-1.5 text-xs text-blue-700 transition-colors dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-300",
                busy && "cursor-not-allowed opacity-50",
              )}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              重新选择目录
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleCopyTemplate}
            disabled={busy}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs transition-colors",
              busy && "cursor-not-allowed opacity-50",
            )}
          >
            复制诊断信息
          </button>
          <button
            type="button"
            onClick={handleCopyJson}
            disabled={busy}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs transition-colors",
              busy && "cursor-not-allowed opacity-50",
            )}
          >
            复制纯 JSON
          </button>
          <button
            type="button"
            onClick={handleExportJson}
            disabled={busy}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs transition-colors",
              busy && "cursor-not-allowed opacity-50",
            )}
          >
            <Download className="h-3.5 w-3.5" />
            导出诊断 JSON
          </button>
          <button
            type="button"
            onClick={handleOpenDownloadDirectory}
            disabled={busy}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs transition-colors",
              busy && "cursor-not-allowed opacity-50",
            )}
          >
            打开下载目录
          </button>
          <button
            type="button"
            onClick={onRetry}
            disabled={busy}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs transition-colors",
              busy && "cursor-not-allowed opacity-50",
            )}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            重试恢复
          </button>
        </div>
      </div>
    </div>
  );
}
