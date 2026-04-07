import { Bot, Copy, Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { OpenClawInstallProgressEvent } from "@/lib/api/openclaw";
import { cn } from "@/lib/utils";
import type { OpenClawOperationKind } from "./types";
import {
  openClawPanelClassName,
  openClawSecondaryButtonClassName,
  openClawSubPanelClassName,
} from "./openclawStyles";

interface OpenClawProgressPageProps {
  kind: OpenClawOperationKind;
  title?: string | null;
  description?: string | null;
  running: boolean;
  handingOffToAgent?: boolean;
  message: string | null;
  logs: OpenClawInstallProgressEvent[];
  repairPrompt: string;
  onClose: () => void;
  onCopyLogs: () => void;
  onCopyDiagnosticBundle: () => void;
  onCopyRepairPrompt: () => void;
  onAskAgentFix: () => void;
}

const titleMap: Record<OpenClawOperationKind, string> = {
  install: "正在修复环境并安装 OpenClaw",
  uninstall: "正在卸载 OpenClaw",
  restart: "正在重启 Gateway",
  repair: "正在修复 OpenClaw 环境",
  update: "正在升级 OpenClaw",
};

const descriptionMap: Record<OpenClawOperationKind, string> = {
  install: "正在准备 Node.js、Git 和 OpenClaw 环境，请保持当前页面并等待完成。",
  uninstall: "正在卸载 OpenClaw，请等待进度完成后返回安装页。",
  restart: "正在重启 Gateway，完成后将返回运行页。",
  repair: "正在修复 OpenClaw 依赖环境，请保持当前页面并等待完成。",
  update: "正在检查并升级 OpenClaw 本体，完成后会自动刷新版本与运行状态。",
};

export function OpenClawProgressPage({
  kind,
  title,
  description,
  running,
  handingOffToAgent = false,
  message,
  logs,
  repairPrompt,
  onClose,
  onCopyLogs,
  onCopyDiagnosticBundle,
  onCopyRepairPrompt,
  onAskAgentFix,
}: OpenClawProgressPageProps) {
  return (
    <div className="space-y-4">
      <section className={openClawPanelClassName}>
        <div className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold tracking-[0.14em] text-amber-700">
          IN PROGRESS
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
          {title || titleMap[kind]}
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
          {description || descriptionMap[kind]}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
            {running ? "处理中" : "已结束"}
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
            {logs.length} 条日志
          </span>
          {message ? (
            <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
              {message}
            </span>
          ) : null}
        </div>
      </section>

      <section className={openClawPanelClassName}>
        <div className="flex flex-col gap-4 border-b border-slate-200/80 pb-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">操作日志</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              {running
                ? "命令执行中，可随时复制当前日志，或直接选中文本。"
                : message || "操作已结束，可直接复制或手动选中日志。"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onCopyLogs}
              disabled={logs.length === 0}
              className={cn(
                openClawSecondaryButtonClassName,
                "px-3 py-2 text-sm",
              )}
            >
              <Copy className="h-4 w-4" />
              复制全部日志
            </button>
            <button
              type="button"
              onClick={onCopyDiagnosticBundle}
              disabled={logs.length === 0}
              className={cn(
                openClawSecondaryButtonClassName,
                "px-3 py-2 text-sm",
              )}
            >
              <Copy className="h-4 w-4" />
              复制 JSON 诊断包
            </button>
            <button
              type="button"
              onClick={onCopyRepairPrompt}
              disabled={!repairPrompt.trim()}
              className={cn(
                openClawSecondaryButtonClassName,
                "px-3 py-2 text-sm",
              )}
            >
              <Copy className="h-4 w-4" />
              复制修复提示词
            </button>
            <button
              type="button"
              onClick={onAskAgentFix}
              disabled={!repairPrompt.trim() || handingOffToAgent}
              className={cn(
                openClawSecondaryButtonClassName,
                "px-3 py-2 text-sm",
              )}
            >
              {handingOffToAgent ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Bot className="h-4 w-4" />
              )}
              {handingOffToAgent ? "转交中..." : "交给 AI 修复"}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={running}
              className={cn(
                openClawSecondaryButtonClassName,
                "px-3 py-2 text-sm",
              )}
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {running ? "处理中" : "关闭"}
            </button>
          </div>
        </div>

        <Tabs defaultValue="logs" className="mt-4">
          <TabsList className="grid h-auto w-full grid-cols-2 rounded-2xl bg-slate-100 p-1">
            <TabsTrigger value="logs" className="rounded-xl py-2">
              完整日志
            </TabsTrigger>
            <TabsTrigger value="summary" className="rounded-xl py-2">
              结果摘要
            </TabsTrigger>
          </TabsList>

          <TabsContent value="logs" className="mt-4">
            <div className="max-h-[420px] min-h-[300px] overflow-auto rounded-[22px] bg-slate-950 p-4 text-sm text-slate-100">
              {logs.length === 0 ? (
                <div className="text-slate-400">
                  {running ? "正在等待日志输出..." : "暂无日志输出"}
                </div>
              ) : (
                <div className="cursor-text select-text space-y-2 font-mono text-[13px] leading-6">
                  {logs.map((log, index) => (
                    <div
                      key={`${log.message}-${index}`}
                      className="whitespace-pre-wrap break-words"
                    >
                      <span
                        className={
                          log.level === "error"
                            ? "text-red-300"
                            : log.level === "warn"
                              ? "text-amber-300"
                              : "text-slate-200"
                        }
                      >
                        [{log.level.toUpperCase()}]
                      </span>{" "}
                      <span>{log.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="summary" className="mt-4">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className={openClawSubPanelClassName}>
                <div className="text-xs font-medium text-slate-500">
                  当前阶段
                </div>
                <div className="mt-2 text-sm font-medium text-slate-900">
                  {title || titleMap[kind]}
                </div>
                <div className="mt-3 text-sm leading-6 text-slate-600">
                  {running
                    ? "任务仍在执行，日志会持续追加到“完整日志”标签。"
                    : message || "当前操作已结束。"}
                </div>
              </div>

              <div className={openClawSubPanelClassName}>
                <div className="text-xs font-medium text-slate-500">
                  诊断动作
                </div>
                <div className="mt-2 text-sm leading-6 text-slate-600">
                  如果操作失败，可以切到“完整日志”直接复制，或复制 JSON
                  诊断包、修复提示词继续排障。
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}

export default OpenClawProgressPage;
