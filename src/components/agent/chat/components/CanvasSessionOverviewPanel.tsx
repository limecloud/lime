import {
  AlertTriangle,
  Bot,
  Clock3,
  FileText,
  ListChecks,
  Loader2,
  Search,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { QueuedTurnSnapshot } from "@/lib/api/agentRuntime";
import type {
  ActionRequired,
  AgentThreadItem,
  AgentThreadTurn,
} from "../types";
import { sortThreadItems } from "../utils/threadTimelineView";
import { extractFileNameFromPath } from "../workspace/workspacePath";

interface CanvasSessionOverviewPanelProps {
  turns: AgentThreadTurn[];
  threadItems: AgentThreadItem[];
  currentTurnId?: string | null;
  pendingActions?: ActionRequired[];
  queuedTurns?: QueuedTurnSnapshot[];
  isSending?: boolean;
  focusedItemId?: string | null;
}

type SessionStatusTone = "default" | "accent" | "success";

interface SessionActivityView {
  id: string;
  title: string;
  summary: string;
  timeLabel: string | null;
  statusLabel: string;
  tone: SessionStatusTone;
  icon: typeof Sparkles;
  iconClassName: string;
}

function shortenText(value?: string | null, maxLength = 120): string {
  const normalized = (value || "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function formatTimeLabel(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return null;
  }

  return timestamp.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function resolveTurnStatusLabel(status?: AgentThreadTurn["status"] | null): {
  label: string;
  tone: SessionStatusTone;
} {
  if (status === "running") {
    return { label: "执行中", tone: "accent" };
  }
  if (status === "completed") {
    return { label: "已完成", tone: "success" };
  }
  if (status === "failed") {
    return { label: "失败", tone: "default" };
  }
  if (status === "aborted") {
    return { label: "已中断", tone: "default" };
  }
  return { label: "空闲", tone: "default" };
}

function resolveItemStatusLabel(item: AgentThreadItem): {
  label: string;
  tone: SessionStatusTone;
} {
  if (item.status === "in_progress") {
    return { label: "进行中", tone: "accent" };
  }
  if (item.status === "failed") {
    return { label: "失败", tone: "default" };
  }
  return { label: "已完成", tone: "success" };
}

function resolvePendingActionPreview(action: ActionRequired): string {
  const prompt = shortenText(action.prompt, 120);
  if (prompt) {
    return prompt;
  }

  const firstQuestion = action.questions?.[0];
  const questionText = shortenText(firstQuestion?.question, 120);
  if (questionText) {
    return questionText;
  }

  if (action.toolName?.trim()) {
    return action.toolName.trim();
  }

  return action.requestId;
}

function buildActivityView(item: AgentThreadItem): SessionActivityView | null {
  const { label: statusLabel, tone } = resolveItemStatusLabel(item);
  const timeLabel = formatTimeLabel(
    item.updated_at || item.completed_at || item.started_at,
  );

  switch (item.type) {
    case "tool_call":
      return {
        id: item.id,
        title: item.tool_name || "工具调用",
        summary:
          shortenText(item.error, 100) ||
          shortenText(
            typeof item.arguments === "string"
              ? item.arguments
              : JSON.stringify(item.arguments ?? {}, null, 2),
            100,
          ) ||
          "工具已接入当前运行轨迹。",
        timeLabel,
        statusLabel,
        tone,
        icon: Sparkles,
        iconClassName: "text-sky-600",
      };
    case "command_execution":
      return {
        id: item.id,
        title: "exec_command",
        summary: shortenText(item.command, 100) || "命令执行中",
        timeLabel,
        statusLabel,
        tone,
        icon: ListChecks,
        iconClassName: "text-slate-600",
      };
    case "web_search":
      return {
        id: item.id,
        title: item.action?.trim() || "Web Search",
        summary:
          shortenText(item.query, 100) ||
          shortenText(item.output, 100) ||
          "正在检索外部信息。",
        timeLabel,
        statusLabel,
        tone,
        icon: Search,
        iconClassName: "text-sky-600",
      };
    case "request_user_input":
      return {
        id: item.id,
        title: "等待补充信息",
        summary:
          shortenText(item.prompt, 100) ||
          shortenText(item.questions?.[0]?.question, 100) ||
          "A2UI / 问答采集中",
        timeLabel,
        statusLabel,
        tone,
        icon: ShieldAlert,
        iconClassName: "text-amber-600",
      };
    case "approval_request":
      return {
        id: item.id,
        title: "等待确认",
        summary:
          shortenText(item.prompt, 100) ||
          shortenText(item.tool_name, 100) ||
          "需要用户确认后继续。",
        timeLabel,
        statusLabel,
        tone,
        icon: ShieldAlert,
        iconClassName: "text-amber-600",
      };
    case "file_artifact":
      return {
        id: item.id,
        title: "产物已写入",
        summary:
          shortenText(extractFileNameFromPath(item.path) || item.path, 100) ||
          "已产生新的文件产物。",
        timeLabel,
        statusLabel,
        tone,
        icon: FileText,
        iconClassName: "text-emerald-600",
      };
    case "subagent_activity":
      return {
        id: item.id,
        title: item.title?.trim() || "子 Agent 活动",
        summary:
          shortenText(item.summary, 100) ||
          shortenText(item.role, 100) ||
          shortenText(item.model, 100) ||
          "协作成员正在推进任务。",
        timeLabel,
        statusLabel,
        tone,
        icon: Bot,
        iconClassName: "text-sky-700",
      };
    case "warning":
      return {
        id: item.id,
        title: "运行警告",
        summary: shortenText(item.message, 100) || "运行过程中出现警告。",
        timeLabel,
        statusLabel,
        tone: "default",
        icon: AlertTriangle,
        iconClassName: "text-amber-600",
      };
    case "error":
      return {
        id: item.id,
        title: "执行失败",
        summary: shortenText(item.message, 100) || "当前回合执行失败。",
        timeLabel,
        statusLabel,
        tone: "default",
        icon: AlertTriangle,
        iconClassName: "text-rose-600",
      };
    case "context_compaction":
      return {
        id: item.id,
        title: item.stage === "started" ? "上下文压缩中" : "上下文压缩完成",
        summary:
          shortenText(item.detail, 100) ||
          shortenText(item.trigger, 100) ||
          "会话上下文正在整理。",
        timeLabel,
        statusLabel,
        tone,
        icon: Clock3,
        iconClassName: "text-slate-500",
      };
    case "reasoning":
      return {
        id: item.id,
        title: "思考过程",
        summary:
          shortenText(item.summary?.join(" "), 100) ||
          shortenText(item.text, 100) ||
          "模型正在整理思路。",
        timeLabel,
        statusLabel,
        tone,
        icon: Sparkles,
        iconClassName: "text-violet-600",
      };
    case "plan":
      return {
        id: item.id,
        title: "执行计划",
        summary: shortenText(item.text, 100) || "已生成执行计划。",
        timeLabel,
        statusLabel,
        tone,
        icon: ListChecks,
        iconClassName: "text-slate-600",
      };
    case "turn_summary":
      return {
        id: item.id,
        title: "回合总结",
        summary: shortenText(item.text, 100) || "当前回合已生成总结。",
        timeLabel,
        statusLabel,
        tone,
        icon: ListChecks,
        iconClassName: "text-slate-600",
      };
    default:
      return null;
  }
}

export function CanvasSessionOverviewPanel({
  turns,
  threadItems,
  currentTurnId = null,
  pendingActions = [],
  queuedTurns = [],
  isSending = false,
  focusedItemId = null,
}: CanvasSessionOverviewPanelProps) {
  const sortedItems = sortThreadItems(threadItems).filter(
    (item) => item.type !== "user_message" && item.type !== "agent_message",
  );

  const currentTurn =
    turns.find((turn) => turn.id === currentTurnId) || turns.at(-1) || null;
  const turnStatus = resolveTurnStatusLabel(
    isSending ? "running" : currentTurn?.status,
  );
  const inProgressCount = sortedItems.filter(
    (item) => item.status === "in_progress",
  ).length;
  const recentActivity = sortedItems
    .map((item) => buildActivityView(item))
    .filter((item): item is SessionActivityView => Boolean(item))
    .slice(-8)
    .reverse();
  const latestTurnPrompt =
    shortenText(currentTurn?.prompt_text, 160) || "当前还没有新的运行输入。";
  const latestTurnUpdatedAt = formatTimeLabel(
    currentTurn?.updated_at ||
      currentTurn?.completed_at ||
      currentTurn?.started_at,
  );
  const focusedActivity =
    recentActivity.find((item) => item.id === focusedItemId) ||
    recentActivity[0] ||
    null;

  return (
    <section
      data-testid="canvas-session-overview-panel"
      className="flex min-h-full flex-col gap-4"
    >
      <section className="rounded-[24px] border border-slate-200 bg-white px-5 py-5 shadow-sm shadow-slate-950/5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold text-slate-950">
                会话过程索引
              </div>
              <Badge
                variant="outline"
                className={cn(
                  turnStatus.tone === "accent" &&
                    "border-sky-200 bg-sky-50 text-sky-700",
                  turnStatus.tone === "success" &&
                    "border-emerald-200 bg-emerald-50 text-emerald-700",
                  turnStatus.tone === "default" &&
                    "border-slate-200 bg-white text-slate-600",
                )}
              >
                {turnStatus.label}
              </Badge>
              {focusedActivity ? (
                <Badge
                  variant="outline"
                  className="border-slate-200 bg-slate-50 text-slate-600"
                >
                  聚焦 {focusedActivity.title}
                </Badge>
              ) : null}
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              这里只补充当前回合的执行过程、待补信息和排队状态。主稿、Markdown
              与图片请直接从对话里的“在画布中打开”入口进入。
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                当前 turn：{currentTurn?.id || "尚未创建"}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                {inProgressCount > 0
                  ? `进行中 ${inProgressCount}`
                  : `轨迹 ${sortedItems.length}`}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                {pendingActions.length > 0
                  ? `待补信息 ${pendingActions.length}`
                  : queuedTurns.length > 0
                    ? `排队 ${queuedTurns.length}`
                    : "无需跟进"}
              </span>
            </div>
          </div>

          <div className="grid min-w-[240px] gap-2 rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <div className="text-[11px] font-medium text-slate-500">
                最近更新时间
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {latestTurnUpdatedAt || "--:--"}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-medium text-slate-500">
                当前焦点
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {focusedActivity?.title || "等待新的执行事件"}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {focusedActivity?.summary || latestTurnPrompt}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1.45fr),minmax(320px,0.9fr)]">
        <section className="rounded-[24px] border border-slate-200 bg-white">
          <div className="border-b border-slate-200/80 px-5 py-4">
            <div className="text-sm font-semibold text-slate-900">
              执行时间线
            </div>
            <div className="mt-1 text-xs leading-5 text-slate-500">
              这里展示当前会话的技能、工具、A2UI、文件产物与异常信号，方便直接判断下一步卡在哪里。
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {recentActivity.length > 0 ? (
              recentActivity.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "flex items-start gap-3 px-5 py-4 transition-colors",
                      focusedItemId === item.id && "bg-sky-50/80",
                    )}
                  >
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50">
                      {item.tone === "accent" ? (
                        <Loader2
                          className={cn(
                            "h-4 w-4 animate-spin",
                            item.iconClassName,
                          )}
                        />
                      ) : (
                        <Icon className={cn("h-4 w-4", item.iconClassName)} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-medium text-slate-900">
                          {item.title}
                        </div>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-medium",
                            item.tone === "accent" && "bg-sky-50 text-sky-700",
                            item.tone === "success" &&
                              "bg-emerald-50 text-emerald-700",
                            item.tone === "default" &&
                              "bg-slate-100 text-slate-600",
                          )}
                        >
                          {item.statusLabel}
                        </span>
                      </div>
                      <div className="mt-1 text-sm leading-6 text-slate-600">
                        {item.summary}
                      </div>
                    </div>
                    <div className="shrink-0 text-[11px] text-slate-400">
                      {item.timeLabel || "--:--"}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="px-5 py-6 text-sm leading-6 text-slate-500">
                当前还没有可展示的执行轨迹。新的工具调用、skills、A2UI
                与排队变化会出现在这里。
              </div>
            )}
          </div>
        </section>

        <div className="flex min-h-0 flex-col gap-4">
          <section className="rounded-[24px] border border-slate-200 bg-white">
            <div className="border-b border-slate-200/80 px-5 py-4">
              <div className="text-sm font-semibold text-slate-900">
                待处理交互
              </div>
              <div className="mt-1 text-xs leading-5 text-slate-500">
                缺少信息时，这里会明确显示等待补充的信息入口，便于与 A2UI
                收集流程对齐。
              </div>
            </div>

            <div className="space-y-3 px-5 py-4">
              {pendingActions.length > 0 ? (
                pendingActions.slice(0, 4).map((action) => (
                  <div
                    key={action.requestId}
                    className="rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-amber-700">
                        {action.actionType === "tool_confirmation"
                          ? "等待确认"
                          : "等待补充信息"}
                      </span>
                      <span className="text-[11px] text-amber-700/80">
                        {action.requestId}
                      </span>
                    </div>
                    <div className="mt-2 text-sm leading-6 text-amber-950">
                      {resolvePendingActionPreview(action)}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-[20px] border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm leading-6 text-slate-500">
                  当前没有等待中的确认或补充信息请求。
                </div>
              )}
            </div>
          </section>

          <section className="rounded-[24px] border border-slate-200 bg-white">
            <div className="border-b border-slate-200/80 px-5 py-4">
              <div className="text-sm font-semibold text-slate-900">
                排队消息
              </div>
              <div className="mt-1 text-xs leading-5 text-slate-500">
                多轮追问或连续提交时，这里保留稍后执行的输入快照。
              </div>
            </div>

            <div className="space-y-3 px-5 py-4">
              {queuedTurns.length > 0 ? (
                queuedTurns.slice(0, 4).map((item, index) => (
                  <div
                    key={item.queued_turn_id}
                    className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600">
                        排队 {index + 1}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {item.image_count > 0
                          ? `${item.image_count} 张图`
                          : "文本输入"}
                      </span>
                    </div>
                    <div className="mt-2 text-sm leading-6 text-slate-700">
                      {shortenText(
                        item.message_preview || item.message_text,
                        120,
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-[20px] border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm leading-6 text-slate-500">
                  当前没有排队中的消息。
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

export default CanvasSessionOverviewPanel;
