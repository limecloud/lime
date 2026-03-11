/**
 * @file DeveloperSettings.tsx
 * @description 开发者设置页面 - 组件视图调试等开发工具
 */
import { useCallback, useState } from "react";
import { Bug, Code2, Eye, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useComponentDebug } from "@/contexts/ComponentDebugContext";
import { getConfig } from "@/lib/api/appConfig";
import { getLogs, getPersistedLogsTail } from "@/lib/api/logs";
import {
  getLogStorageDiagnostics,
  getServerDiagnostics,
  getWindowsStartupDiagnostics,
} from "@/lib/api/serverRuntime";
import {
  buildCrashDiagnosticPayload,
  clearCrashDiagnosticHistory,
  collectRuntimeSnapshotForDiagnostic,
  collectThemeWorkbenchDocumentStateForDiagnostic,
  CLEAR_CRASH_DIAGNOSTIC_HISTORY_CONFIRM_TEXT,
  copyCrashDiagnosticToClipboard,
  copyCrashDiagnosticJsonToClipboard,
  exportCrashDiagnosticToJson,
  isClipboardPermissionDeniedError,
  normalizeCrashReportingConfig,
  openCrashDiagnosticDownloadDirectory,
} from "@/lib/crashDiagnostic";
import { cn } from "@/lib/utils";
import { ClipboardPermissionGuideCard } from "../shared/ClipboardPermissionGuideCard";
import { WorkspaceRepairHistoryCard } from "../shared/WorkspaceRepairHistoryCard";

export function DeveloperSettings() {
  const { enabled, setEnabled } = useComponentDebug();
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [showClipboardGuide, setShowClipboardGuide] = useState(false);

  const buildDiagnosticPayload = useCallback(async () => {
    const configPromise = getConfig();
    const runtimeSnapshotPromise = configPromise.then((config) =>
      collectRuntimeSnapshotForDiagnostic(config),
    );
    const [
      config,
      logs,
      persistedLogs,
      themeWorkbenchDocumentState,
      serverDiagnostics,
      logStorageDiagnostics,
      windowsStartupDiagnostics,
      runtimeSnapshotResult,
    ] = await Promise.all([
      configPromise,
      getLogs(),
      getPersistedLogsTail(200),
      collectThemeWorkbenchDocumentStateForDiagnostic(),
      getServerDiagnostics().catch(() => null),
      getLogStorageDiagnostics().catch(() => null),
      getWindowsStartupDiagnostics().catch(() => null),
      runtimeSnapshotPromise,
    ]);
    return buildCrashDiagnosticPayload({
      crashConfig: normalizeCrashReportingConfig(config.crash_reporting),
      logs,
      persistedLogTail: persistedLogs,
      collectionNotes: runtimeSnapshotResult.collectionNotes,
      themeWorkbenchDocumentState,
      serverDiagnostics,
      logStorageDiagnostics,
      windowsStartupDiagnostics,
      runtimeSnapshot: runtimeSnapshotResult.runtimeSnapshot,
      appVersion: import.meta.env.VITE_APP_VERSION,
      platform: navigator.platform,
      userAgent: navigator.userAgent,
    });
  }, []);

  const handleCopyDiagnostic = useCallback(async () => {
    setDiagnosticBusy(true);
    setMessage(null);
    setShowClipboardGuide(false);
    try {
      const payload = await buildDiagnosticPayload();
      await copyCrashDiagnosticToClipboard(payload);
      setMessage({
        type: "success",
        text: "诊断信息已复制，可直接发给开发者",
      });
      setTimeout(() => setMessage(null), 2500);
    } catch (err) {
      console.error("复制诊断信息失败:", err);
      const isPermissionDenied = isClipboardPermissionDeniedError(err);
      setShowClipboardGuide(isPermissionDenied);
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "复制诊断信息失败",
      });
    } finally {
      setDiagnosticBusy(false);
    }
  }, [buildDiagnosticPayload]);

  const handleCopyDiagnosticJson = useCallback(async () => {
    setDiagnosticBusy(true);
    setMessage(null);
    setShowClipboardGuide(false);
    try {
      const payload = await buildDiagnosticPayload();
      await copyCrashDiagnosticJsonToClipboard(payload);
      setMessage({
        type: "success",
        text: "纯 JSON 诊断信息已复制",
      });
      setTimeout(() => setMessage(null), 2500);
    } catch (err) {
      console.error("复制纯 JSON 失败:", err);
      const isPermissionDenied = isClipboardPermissionDeniedError(err);
      setShowClipboardGuide(isPermissionDenied);
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "复制纯 JSON 失败",
      });
    } finally {
      setDiagnosticBusy(false);
    }
  }, [buildDiagnosticPayload]);

  const handleExportDiagnostic = useCallback(async () => {
    setDiagnosticBusy(true);
    setMessage(null);
    setShowClipboardGuide(false);
    try {
      const payload = await buildDiagnosticPayload();
      const result = exportCrashDiagnosticToJson(payload, {
        sceneTag: "settings-developer",
      });
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
      setTimeout(() => setMessage(null), 2500);
    } catch (err) {
      console.error("导出诊断信息失败:", err);
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "导出诊断信息失败",
      });
    } finally {
      setDiagnosticBusy(false);
    }
  }, [buildDiagnosticPayload]);

  const handleOpenDownloadDirectory = useCallback(async () => {
    setDiagnosticBusy(true);
    setMessage(null);
    try {
      const result = await openCrashDiagnosticDownloadDirectory();
      setMessage({
        type: "success",
        text: `已打开下载目录：${result.openedPath}`,
      });
      setTimeout(() => setMessage(null), 2500);
    } catch (err) {
      console.error("打开下载目录失败:", err);
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "打开下载目录失败",
      });
    } finally {
      setDiagnosticBusy(false);
    }
  }, []);

  const handleClearDiagnosticHistory = useCallback(async () => {
    const confirmed =
      typeof window === "undefined" ||
      window.confirm(CLEAR_CRASH_DIAGNOSTIC_HISTORY_CONFIRM_TEXT);
    if (!confirmed) {
      return;
    }

    setDiagnosticBusy(true);
    setMessage(null);
    setShowClipboardGuide(false);
    try {
      await clearCrashDiagnosticHistory();
      setMessage({
        type: "success",
        text: "已清空旧诊断信息，后续复制将只包含新的诊断数据",
      });
      setTimeout(() => setMessage(null), 2500);
    } catch (err) {
      console.error("清空旧诊断信息失败:", err);
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "清空旧诊断信息失败",
      });
    } finally {
      setDiagnosticBusy(false);
    }
  }, []);

  return (
    <div className="space-y-6 max-w-2xl">
      {/* 标题 */}
      <div className="flex items-center gap-2 mb-4">
        <Code2 className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-semibold">开发者工具</h3>
      </div>

      {/* 消息提示 */}
      {message && (
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-sm",
            message.type === "success"
              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              : "bg-destructive/10 text-destructive",
          )}
        >
          {message.text}
        </div>
      )}

      {showClipboardGuide && <ClipboardPermissionGuideCard />}

      {/* 组件视图调试 */}
      <div className="border rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Eye className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <h4 className="font-medium">组件视图调试</h4>
              <p className="text-sm text-muted-foreground">
                显示组件轮廓，Alt+点击查看组件信息
              </p>
            </div>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        {enabled && (
          <div className="mt-4 p-3 bg-muted/50 rounded-md text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-2">使用说明:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>按住 Alt 键 + 鼠标悬浮显示组件轮廓</li>
              <li>Alt + 点击组件可查看名称和文件路径</li>
              <li>文件路径仅在开发模式 (npm run tauri dev) 下可用</li>
            </ul>
          </div>
        )}
      </div>

      {/* 崩溃诊断入口 */}
      <div className="border rounded-lg p-4 space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-rose-500/10 rounded-lg">
            <Bug className="w-5 h-5 text-rose-500" />
          </div>
          <div>
            <h4 className="font-medium">崩溃诊断日志（开发协作）</h4>
            <p className="text-sm text-muted-foreground">
              用于定位 Windows 闪退与初装异常，包含
              FrontendCrash、调用轨迹、服务器/日志诊断与 Windows 启动自检（DSN
              自动脱敏）
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleClearDiagnosticHistory()}
            disabled={diagnosticBusy}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-700 transition-colors dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300",
              diagnosticBusy && "opacity-50 cursor-not-allowed",
            )}
          >
            <Trash2 className="h-3.5 w-3.5" />
            清空旧诊断信息
          </button>
          <button
            type="button"
            onClick={() => void handleCopyDiagnostic()}
            disabled={diagnosticBusy}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs transition-colors",
              diagnosticBusy && "opacity-50 cursor-not-allowed",
            )}
          >
            复制诊断信息
          </button>
          <button
            type="button"
            onClick={() => void handleCopyDiagnosticJson()}
            disabled={diagnosticBusy}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs transition-colors",
              diagnosticBusy && "opacity-50 cursor-not-allowed",
            )}
          >
            复制纯 JSON
          </button>
          <button
            type="button"
            onClick={() => void handleExportDiagnostic()}
            disabled={diagnosticBusy}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs transition-colors",
              diagnosticBusy && "opacity-50 cursor-not-allowed",
            )}
          >
            导出诊断 JSON
          </button>
          <button
            type="button"
            onClick={() => void handleOpenDownloadDirectory()}
            disabled={diagnosticBusy}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs transition-colors",
              diagnosticBusy && "opacity-50 cursor-not-allowed",
            )}
          >
            打开下载目录
          </button>
        </div>
      </div>

      <WorkspaceRepairHistoryCard description="仅用于开发排查，记录最近自动修复/迁移（不打断用户操作）" />
    </div>
  );
}
