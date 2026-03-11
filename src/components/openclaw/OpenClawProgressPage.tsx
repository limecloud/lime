import { Bot, Copy, Loader2 } from "lucide-react";
import type { OpenClawInstallProgressEvent } from "@/lib/api/openclaw";
import type { OpenClawOperationKind } from "./types";
import { OpenClawMark } from "./OpenClawMark";

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
};

const descriptionMap: Record<OpenClawOperationKind, string> = {
  install: "正在准备 Node.js、Git 和 OpenClaw 环境，请保持当前页面并等待完成。",
  uninstall: "正在卸载 OpenClaw，请等待进度完成后返回安装页。",
  restart: "正在重启 Gateway，完成后将返回运行页。",
  repair: "正在修复 OpenClaw 依赖环境，请保持当前页面并等待完成。",
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
    <div className="flex min-h-0 flex-col items-center px-6 py-10">
      <div className="w-full max-w-3xl space-y-8">
        <div className="flex flex-col items-center text-center">
          <OpenClawMark size="lg" />
          <h1 className="mt-6 text-4xl font-semibold tracking-tight">
            {title || titleMap[kind]}
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
            {description || descriptionMap[kind]}
          </p>
        </div>

        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b pb-4">
            <div>
              <h2 className="text-base font-semibold">操作日志</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {running ? "命令执行中，请稍候。" : message || "操作已结束。"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onCopyLogs}
                disabled={logs.length === 0}
                className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
              >
                <Copy className="h-4 w-4" />
                复制纯日志
              </button>
              <button
                type="button"
                onClick={onCopyDiagnosticBundle}
                disabled={logs.length === 0}
                className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
              >
                <Copy className="h-4 w-4" />
                复制 JSON 诊断包
              </button>
              <button
                type="button"
                onClick={onCopyRepairPrompt}
                disabled={!repairPrompt.trim()}
                className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
              >
                <Copy className="h-4 w-4" />
                复制修复提示词
              </button>
              <button
                type="button"
                onClick={onAskAgentFix}
                disabled={!repairPrompt.trim() || handingOffToAgent}
                className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
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
                className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
              >
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {running ? "处理中" : "关闭"}
              </button>
            </div>
          </div>

          <div className="mt-4 max-h-[360px] min-h-[260px] overflow-auto rounded-xl bg-slate-950 p-4 text-sm text-slate-100">
            {logs.length === 0 ? (
              <div className="text-slate-400">
                {running ? "正在等待日志输出..." : "暂无日志输出"}
              </div>
            ) : (
              <div className="space-y-2 leading-7">
                {logs.map((log, index) => (
                  <div key={`${log.message}-${index}`}>
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
        </section>
      </div>
    </div>
  );
}

export default OpenClawProgressPage;
